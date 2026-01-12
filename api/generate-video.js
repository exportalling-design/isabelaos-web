// /api/generate-video.js
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { requireUser } from "./_auth.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY = process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY || null;

// Tablas
const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";

// ✅ Pod fijo
const FIXED_POD_ID = "2dz3jc4mbgcyq3";

// Worker
const WORKER_PORT = 8000;
const WORKER_HEALTH_PATH = "/health";

// Tiempos
const WAIT_WORKER_TIMEOUT_MS = parseInt(process.env.WAIT_WORKER_TIMEOUT_MS || "60000", 10);
const WAIT_WORKER_INTERVAL_MS = parseInt(process.env.WAIT_WORKER_INTERVAL_MS || "2500", 10);
const WAKE_LOCK_SECONDS = parseInt(process.env.WAKE_LOCK_SECONDS || "120", 10);

// ✅ Health-check rápido antes de decidir “start”
const QUICK_HEALTH_TIMEOUT_MS = parseInt(process.env.QUICK_HEALTH_TIMEOUT_MS || "3500", 10);

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY (set VIDEO_RUNPOD_API_KEY or RUNPOD_API_KEY)");
  return {
    Authorization: `Bearer ${RUNPOD_API_KEY}`,
    "Content-Type": "application/json",
  };
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

function workerBaseUrl(podId) {
  return `https://${podId}-${WORKER_PORT}.proxy.runpod.net`;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
    await sleep(WAIT_WORKER_INTERVAL_MS);
  }

  return { ok: false, error: `Worker not ready after ${WAIT_WORKER_TIMEOUT_MS}ms`, url };
}

async function quickHealth(podId) {
  const base = workerBaseUrl(podId);
  const url = `${base}${WORKER_HEALTH_PATH}`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), QUICK_HEALTH_TIMEOUT_MS);

  try {
    const r = await fetch(url, { method: "GET", signal: ctrl.signal });
    clearTimeout(t);
    return { ok: r.ok, url };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, url, error: String(e?.message || e) };
  }
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

  const { error: uerr } = await sb.from(POD_LOCK_TABLE).update({ locked_until: until.toISOString() }).eq("id", 1);
  if (uerr) throw uerr;

  return { ok: true, locked_until: until.toISOString() };
}

export default async function handler(req, res) {
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

    // 1) crear job (PENDING)
    const { error } = await sb.from("video_jobs").insert({
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
    if (error) throw error;

    // 2) touch last_used_at
    await sb.from(POD_STATE_TABLE).update({ last_used_at: new Date().toISOString() }).eq("id", 1);

    // 3) WAKE agresivo
    let wakeInfo = { attempted: true, ok: true, action: "NOOP" };

    try {
      const { data: podState, error: psErr } = await sb.from(POD_STATE_TABLE).select("*").eq("id", 1).single();
      if (psErr) throw psErr;

      const currentPodId = FIXED_POD_ID;
      const status = String(podState?.status || "").toUpperCase();

      // asegurar pod_id fijo
      if (podState?.pod_id !== currentPodId) {
        await sb.from(POD_STATE_TABLE).update({ pod_id: currentPodId }).eq("id", 1);
      }

      // ✅ Health rápido (3.5s). Si no responde, arrancamos.
      const h = await quickHealth(currentPodId);

      // ✅ regla simple:
      // - Si NO está RUNNING -> start inmediato
      // - Si está RUNNING pero health falla -> start igual (recuperación)
      const mustStart = status !== "RUNNING" || !h.ok;

      if (mustStart) {
        const lock = await tryAcquireLock(sb, WAKE_LOCK_SECONDS);
        if (!lock.ok) {
          wakeInfo = { attempted: true, ok: true, action: "SKIP_WAKE_LOCKED", locked_until: lock.locked_until, pod_status: status };
        } else {
          await sb.from(POD_STATE_TABLE).update({
            status: "STARTING",
            last_used_at: new Date().toISOString(),
            pod_id: currentPodId,
          }).eq("id", 1);

          await runpodStartPod(currentPodId);

          const ready = await waitForWorker(currentPodId);
          if (!ready.ok) {
            wakeInfo = { attempted: true, ok: false, action: "WAKE_FAILED", error: ready.error, health_url: ready.url, pod_status: status };
          } else {
            await sb.from(POD_STATE_TABLE).update({
              status: "RUNNING",
              last_used_at: new Date().toISOString(),
            }).eq("id", 1);

            wakeInfo = { attempted: true, ok: true, action: "WOKE", pod_id: currentPodId, health_url: ready.url, prev_status: status, quick_health: h };
          }
        }
      } else {
        wakeInfo = { attempted: true, ok: true, action: "NO_WAKE_NEEDED", pod_status: status, pod_id: currentPodId, quick_health: h };
      }
    } catch (wakeErr) {
      wakeInfo = { attempted: true, ok: false, action: "WAKE_ERROR", error: String(wakeErr?.message || wakeErr) };
    }

    return res.status(200).json({
      ok: true,
      job_id,
      status: "PENDING",
      wake: wakeInfo,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}