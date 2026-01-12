// /api/generate-video.js
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { requireUser } from "./_auth.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY =
  process.env.VIDEO_RUNPOD_API_KEY ||
  process.env.RUNPOD_API_KEY ||
  null;

// Tablas
const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";
const VIDEO_JOBS_TABLE = "video_jobs";

// ✅ Pod fijo (single pod)
const FIXED_POD_ID = "2dz3jc4mbgcyq3";

// Worker
const WORKER_PORT = 8000;
const WORKER_HEALTH_PATH = "/health";
const WAIT_WORKER_TIMEOUT_MS = parseInt(process.env.WAIT_WORKER_TIMEOUT_MS || "90000", 10);
const WAIT_WORKER_INTERVAL_MS = parseInt(process.env.WAIT_WORKER_INTERVAL_MS || "2500", 10);

// Lock corto para “wake”
const WAKE_LOCK_SECONDS = parseInt(process.env.WAKE_LOCK_SECONDS || "120", 10);

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY (set VIDEO_RUNPOD_API_KEY or RUNPOD_API_KEY in Vercel Production)");
  return {
    Authorization: `Bearer ${RUNPOD_API_KEY}`,
    "Content-Type": "application/json",
  };
}

function workerBaseUrl(podId) {
  return `https://${podId}-${WORKER_PORT}.proxy.runpod.net`;
}

async function waitForWorker(podId) {
  const base = workerBaseUrl(podId);
  const url = `${base}${WORKER_HEALTH_PATH}`;
  const start = Date.now();

  while (Date.now() - start < WAIT_WORKER_TIMEOUT_MS) {
    try {
      const r = await fetch(url, { method: "GET" });
      if (r.ok) return { ok: true, url };
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, WAIT_WORKER_INTERVAL_MS));
  }

  return { ok: false, error: `Worker not ready after ${WAIT_WORKER_TIMEOUT_MS}ms`, url };
}

// ✅ Estado REAL en RunPod
async function runpodGetPod(podId) {
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, {
    method: "GET",
    headers: runpodHeaders(),
  });
  const t = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`RunPod get pod failed (${r.status}): ${t}`);

  let json = null;
  try { json = JSON.parse(t); } catch { json = { raw: t }; }

  return json;
}

async function runpodStartPod(podId) {
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}/start`, {
    method: "POST",
    headers: runpodHeaders(),
  });
  const t = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`RunPod start failed (${r.status}): ${t}`);
  return true;
}

async function tryAcquireLock(sb, seconds = 120) {
  const now = new Date();
  const until = new Date(now.getTime() + seconds * 1000);

  const { data: lockRow, error: lerr } = await sb.from(POD_LOCK_TABLE).select("*").eq("id", 1).single();
  if (lerr) throw lerr;

  const lockedUntil = lockRow?.locked_until ? new Date(lockRow.locked_until) : null;
  if (lockedUntil && lockedUntil > now) {
    return { ok: false, reason: "lock active", locked_until: lockRow.locked_until };
  }

  const { error: uerr } = await sb
    .from(POD_LOCK_TABLE)
    .update({ locked_until: until.toISOString() })
    .eq("id", 1);

  if (uerr) throw uerr;

  return { ok: true, locked_until: until.toISOString() };
}

export default async function handler(req, res) {
  const startedAt = Date.now();

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // ✅ Auth real
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    const user_id = auth.user.id;

    const {
      mode = "t2v",
      prompt,
      negative_prompt = "",
      steps = 25,
      height = 704,
      width = 1280,
      num_frames = 121,
      guidance_scale = 5.0,
    } = req.body || {};

    if (!prompt) return res.status(400).json({ ok: false, error: "Missing prompt" });

    const sb = sbAdmin();
    const job_id = crypto.randomUUID();

    // 1) crear job
    const { error: insErr } = await sb.from(VIDEO_JOBS_TABLE).insert({
      job_id,
      user_id,
      mode,
      prompt,
      negative_prompt,
      steps,
      height,
      width,
      num_frames,
      guidance_scale,
      status: "PENDING",
    });
    if (insErr) throw insErr;

    // 2) touch last_used_at
    await sb.from(POD_STATE_TABLE).update({ last_used_at: new Date().toISOString() }).eq("id", 1);

    // 3) wake on demand
    let wakeInfo = { attempted: true, ok: true, action: "NOOP" };

    try {
      const currentPodId = FIXED_POD_ID;

      // asegurar que pod_id sea el fijo
      const { data: podState, error: psErr } = await sb
        .from(POD_STATE_TABLE)
        .select("*")
        .eq("id", 1)
        .single();
      if (psErr) throw psErr;

      if (podState?.pod_id !== currentPodId) {
        await sb.from(POD_STATE_TABLE).update({ pod_id: currentPodId }).eq("id", 1);
      }

      // ✅ Estado REAL desde RunPod (esto evita que tu tabla quede “desfasada”)
      const podReal = await runpodGetPod(currentPodId);
      const realStatus = String(podReal?.desiredStatus || podReal?.status || podReal?.pod?.status || "").toUpperCase();

      console.log("[GV] podRealStatus=", realStatus, "podId=", currentPodId);

      const shouldWake = ["STOPPED", "PAUSED", "EXITED", "SLEEPING", "NOT_RUNNING"].includes(realStatus);

      if (shouldWake) {
        const lock = await tryAcquireLock(sb, WAKE_LOCK_SECONDS);
        if (!lock.ok) {
          wakeInfo = { attempted: true, ok: true, action: "SKIP_WAKE_LOCKED", locked_until: lock.locked_until, realStatus };
        } else {
          await sb.from(POD_STATE_TABLE).update({
            status: "STARTING",
            last_used_at: new Date().toISOString(),
            pod_id: currentPodId,
          }).eq("id", 1);

          console.log("[GV] starting pod via RunPod REST...");
          await runpodStartPod(currentPodId);

          const ready = await waitForWorker(currentPodId);
          if (!ready.ok) {
            wakeInfo = { attempted: true, ok: false, action: "WAKE_FAILED", error: ready.error, health_url: ready.url, realStatus };
          } else {
            await sb.from(POD_STATE_TABLE).update({
              status: "RUNNING",
              last_used_at: new Date().toISOString(),
            }).eq("id", 1);

            wakeInfo = { attempted: true, ok: true, action: "WOKE", pod_id: currentPodId, health_url: ready.url, realStatus };
          }
        }
      } else {
        // si “parece running”, verificamos health
        const ready = await waitForWorker(currentPodId);
        if (!ready.ok) {
          // recovery: intentar start de todas formas
          const lock = await tryAcquireLock(sb, WAKE_LOCK_SECONDS);
          if (lock.ok) {
            await sb.from(POD_STATE_TABLE).update({
              status: "STARTING",
              last_used_at: new Date().toISOString(),
            }).eq("id", 1);

            console.log("[GV] health dead, trying start as recovery...");
            await runpodStartPod(currentPodId);

            const ready2 = await waitForWorker(currentPodId);
            if (ready2.ok) {
              await sb.from(POD_STATE_TABLE).update({
                status: "RUNNING",
                last_used_at: new Date().toISOString(),
              }).eq("id", 1);

              wakeInfo = { attempted: true, ok: true, action: "RECOVERED", pod_id: currentPodId, health_url: ready2.url, realStatus };
            } else {
              wakeInfo = { attempted: true, ok: false, action: "RUNNING_BUT_DEAD", error: ready2.error, health_url: ready2.url, realStatus };
            }
          } else {
            wakeInfo = { attempted: true, ok: false, action: "RUNNING_BUT_DEAD_LOCKED", error: ready.error, health_url: ready.url, realStatus };
          }
        } else {
          wakeInfo = { attempted: true, ok: true, action: "NO_WAKE_NEEDED", pod_id: currentPodId, health_url: ready.url, realStatus };
        }
      }
    } catch (wakeErr) {
      console.error("[GV] wakeErr:", wakeErr);
      wakeInfo = { attempted: true, ok: false, action: "WAKE_ERROR", error: String(wakeErr?.message || wakeErr) };
    }

    console.log("[GV] done", { job_id, wakeInfo, ms: Date.now() - startedAt });

    return res.status(200).json({
      ok: true,
      job_id,
      status: "PENDING",
      wake: wakeInfo,
    });
  } catch (e) {
    console.error("[GV] fatal:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}