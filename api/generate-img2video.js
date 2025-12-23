// /api/generate-img2video.js
// ============================================================
// IsabelaOS Studio - Image → Video (Pods + async dispatch)
//
// + AUTH UNIFICADO (requireUser)
// + COBRO UNIFICADO (spend_jades) ANTES de crear pod/job
// ============================================================

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { requireUser } from "./_auth";

// =====================
// COSTOS (JADE)
// =====================
const COST_IMG2VIDEO_JADES = 3; // <- AJUSTA AQUÍ

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY =
  process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY || null;

const VIDEO_RUNPOD_TEMPLATE_ID = process.env.VIDEO_RUNPOD_TEMPLATE_ID;

const VIDEO_RUNPOD_NETWORK_VOLUME_ID =
  process.env.VIDEO_RUNPOD_NETWORK_VOLUME_ID ||
  process.env.VIDEO_NETWORK_VOLUME_ID ||
  null;

const VIDEO_VOLUME_MOUNT_PATH = process.env.VIDEO_VOLUME_MOUNT_PATH || "/workspace";

const MAX_STEPS = parseInt(process.env.VIDEO_MAX_STEPS || "25", 10);
const FAST_TEST_MODE = (process.env.VIDEO_FAST_TEST_MODE || "0") === "1";

const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";
const VIDEO_JOBS_TABLE = "video_jobs";

const LOCK_SECONDS = 180;
const READY_TIMEOUT_MS = 12 * 60 * 1000;
const POLL_MS = 3000;

const WORKER_READY_TIMEOUT_MS = 10 * 60 * 1000;
const HEALTH_FETCH_TIMEOUT_MS = 8000;
const DISPATCH_TIMEOUT_MS = 15000;

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL (o VITE_SUPABASE_URL)");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setPodState(sb, patch) {
  const { error } = await sb.from(POD_STATE_TABLE).update(patch).eq("id", 1);
  if (error) throw error;
}

function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY / VIDEO_RUNPOD_API_KEY");
  return {
    Authorization: `Bearer ${RUNPOD_API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

// =====================
// ✅ Cobro unificado
// =====================
async function spendJadesOrThrow(user_id, amount, reason, ref = null) {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  const rpcUrl = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/spend_jades`;

  const r = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_user_id: user_id,
      p_amount: amount,
      p_reason: reason,
      p_ref: ref,
    }),
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    if ((t || "").includes("INSUFFICIENT_JADES")) {
      const err = new Error("INSUFFICIENT_JADES");
      err.code = 402;
      throw err;
    }
    const err = new Error("RPC_SPEND_JADES_ERROR: " + t.slice(0, 300));
    err.code = 500;
    throw err;
  }
  return true;
}

async function waitForWorkerReady(workerBase, maxMs = WORKER_READY_TIMEOUT_MS) {
  const start = Date.now();
  const base = workerBase.endsWith("/") ? workerBase.slice(0, -1) : workerBase;

  const candidates = [`${base}/health`, `${base}/api/video_async`, `${base}/api/video`];
  let lastInfo = "no-attempt";

  while (Date.now() - start < maxMs) {
    for (const url of candidates) {
      try {
        const r = await fetchWithTimeout(url, { method: "GET" }, HEALTH_FETCH_TIMEOUT_MS);
        const txt = await r.text().catch(() => "");
        console.log("[I2V] waitWorker url=", url, "status=", r.status, "body=", txt.slice(0, 120));
        if (r.ok) return true;
        if (r.status === 405) return true;
        lastInfo = `${url} -> ${r.status} ${txt.slice(0, 120)}`;
      } catch (e) {
        lastInfo = `${url} -> ERR ${String(e)}`;
        console.log("[I2V] waitWorker error url=", url, "err=", String(e));
      }
    }
    await sleep(2500);
  }

  throw new Error("Worker not ready. Último: " + lastInfo);
}

// ---------- Lock ----------
async function acquireLock(sb) {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + LOCK_SECONDS * 1000).toISOString();

  const { data: row, error: readErr } = await sb.from(POD_LOCK_TABLE).select("*").eq("id", 1).single();
  if (readErr) throw new Error("No existe pod_lock id=1 (crea row en Supabase)");

  const current = row.locked_until ? new Date(row.locked_until) : null;
  if (current && current > now) return { ok: false, locked_until: row.locked_until };

  const { error: updErr } = await sb.from(POD_LOCK_TABLE).update({ locked_until: lockedUntil }).eq("id", 1);
  if (updErr) return { ok: false, locked_until: row.locked_until };

  return { ok: true, locked_until: lockedUntil };
}

async function waitForUnlock(sb) {
  while (true) {
    const { data, error } = await sb.from(POD_LOCK_TABLE).select("*").eq("id", 1).single();
    if (error) throw error;

    const until = data.locked_until ? new Date(data.locked_until) : null;
    const now = new Date();

    if (!until || until <= now) return true;
    await sleep(1500);
  }
}

// ---------- RunPod Pods ----------
async function runpodCreatePodFromTemplate() {
  if (!VIDEO_RUNPOD_TEMPLATE_ID) throw new Error("Falta VIDEO_RUNPOD_TEMPLATE_ID");
  if (!VIDEO_RUNPOD_NETWORK_VOLUME_ID) throw new Error("Falta VIDEO_RUNPOD_NETWORK_VOLUME_ID (necesario para /workspace)");

  const body = {
    name: `isabela-i2v-${Date.now()}`,
    templateId: VIDEO_RUNPOD_TEMPLATE_ID,
    networkVolumeId: VIDEO_RUNPOD_NETWORK_VOLUME_ID,
    volumeMountPath: VIDEO_VOLUME_MOUNT_PATH,
  };

  const r = await fetch("https://rest.runpod.io/v1/pods", {
    method: "POST",
    headers: runpodHeaders(),
    body: JSON.stringify(body),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`RunPod create pod failed (${r.status}): ${JSON.stringify(data)}`);
  if (!data?.id) throw new Error("RunPod create pod: no devolvió id");
  return data;
}

async function runpodGetPod(podId) {
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, { headers: runpodHeaders() });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`RunPod GET pod failed (${r.status}): ${JSON.stringify(data)}`);
  return data?.pod || data;
}

function pickPodStatus(pod) {
  const raw = pod?.status ?? pod?.state ?? pod?.desiredStatus ?? pod?.runtime?.status ?? pod?.pod?.status ?? "";
  return String(raw || "").toUpperCase();
}

async function runpodWaitUntilRunning(podId) {
  const start = Date.now();
  while (Date.now() - start < READY_TIMEOUT_MS) {
    const pod = await runpodGetPod(podId);
    const status = pickPodStatus(pod);
    console.log("[I2V] waitRunning status=", status || "EMPTY", "podId=", podId);
    if (status === "RUNNING" || status === "READY" || status === "ACTIVE") return pod;
    await sleep(POLL_MS);
  }
  throw new Error("Timeout: pod no llegó a RUNNING/READY.");
}

function buildProxyUrl(podId) {
  return `https://${podId}-8000.proxy.runpod.net`;
}

// ---------- video_jobs ----------
async function createVideoJob(sb, job) {
  const { error } = await sb.from(VIDEO_JOBS_TABLE).insert(job);
  if (error) throw error;
}

async function updateVideoJob(sb, job_id, patch) {
  const { error } = await sb.from(VIDEO_JOBS_TABLE).update(patch).eq("job_id", job_id);
  if (error) throw error;
}

// ---------- ensure pod ----------
async function ensureFreshPod(sb) {
  console.log("[I2V] step=LOCK_BEGIN");
  const got = await acquireLock(sb);

  if (!got.ok) {
    console.log("[I2V] step=LOCK_BUSY wait...");
    await waitForUnlock(sb);
    return await ensureFreshPod(sb);
  }

  console.log("[I2V] step=LOCK_OK");
  await setPodState(sb, { status: "CREATING", last_used_at: new Date().toISOString() });

  console.log("[I2V] step=CREATE_POD_REQUEST");
  const created = await runpodCreatePodFromTemplate();
  const podId = created.id;
  console.log("[I2V] created podId=", podId);

  await setPodState(sb, { status: "STARTING", pod_id: podId, worker_url: null, last_used_at: new Date().toISOString() });

  console.log("[I2V] step=WAIT_RUNNING_BEGIN", { podId });
  await runpodWaitUntilRunning(podId);
  console.log("[I2V] step=WAIT_RUNNING_OK", { podId });

  const workerUrl = buildProxyUrl(podId);
  console.log("[I2V] workerBase=", workerUrl);

  await setPodState(sb, { status: "RUNNING", pod_id: podId, worker_url: workerUrl, last_used_at: new Date().toISOString() });

  console.log("[I2V] step=WAIT_WORKER_BEGIN");
  await waitForWorkerReady(workerUrl);
  console.log("[I2V] step=WAIT_WORKER_OK");

  return { podId, workerUrl };
}

// ---------- API ----------
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });

  let sb = null;
  let podId = null;

  try {
    sb = sbAdmin();

    // ✅ AUTH ÚNICO
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    const user_id = auth.user.id;

    const payloadRaw = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    // Requerido para I2V
    const image_b64 = payloadRaw.image_b64 || null;
    const image_url = payloadRaw.image_url || null;
    if (!image_b64 && !image_url) {
      return res.status(400).json({ ok: false, error: "Missing image_b64 or image_url" });
    }

    const requestedSteps =
      typeof payloadRaw.steps === "number"
        ? payloadRaw.steps
        : (typeof payloadRaw.num_inference_steps === "number" ? payloadRaw.num_inference_steps : null);

    const safeSteps = requestedSteps == null ? MAX_STEPS : Math.min(requestedSteps, MAX_STEPS);

    const maybeFast = FAST_TEST_MODE
      ? { steps: Math.min(safeSteps, 8), num_frames: 8, fps: 6, width: 384, height: 672 }
      : { steps: safeSteps };

    // Payload final para worker
    const payload = {
      user_id, // ✅ SIEMPRE desde auth
      prompt: payloadRaw.prompt || "",
      negative_prompt: payloadRaw.negative_prompt || "",
      image_b64,
      image_url,
      action: "img2video",
      kind: "vid_img2vid",
      ...payloadRaw,
      ...maybeFast,
    };

    // ✅ COBRO ANTES de pod/job
    await spendJadesOrThrow(user_id, COST_IMG2VIDEO_JADES, "generation:img2video", payloadRaw.ref || null);

    // 1) Pod + worker ready
    const fresh = await ensureFreshPod(sb);
    podId = fresh.podId;

    // 2) Crea job en Supabase
    const job_id = crypto.randomUUID();

    await createVideoJob(sb, {
      job_id,
      user_id,
      status: "QUEUED",
      payload,
      pod_id: podId,
      worker_url: fresh.workerUrl,
      updated_at: new Date().toISOString(),
    });

    // 3) Dispatch async al worker
    const dispatchUrl = `${fresh.workerUrl}/api/video_async`;
    console.log("[I2V] dispatchUrl=", dispatchUrl);

    await setPodState(sb, { status: "BUSY", last_used_at: new Date().toISOString() });
    await updateVideoJob(sb, job_id, { status: "DISPATCHED", updated_at: new Date().toISOString() });

    const r = await fetchWithTimeout(
      dispatchUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id, ...payload }),
      },
      DISPATCH_TIMEOUT_MS
    );

    const txt = await r.text().catch(() => "");
    console.log("[I2V] dispatch response status=", r.status, "body=", txt.slice(0, 200));

    if (r.status !== 202 && r.status !== 200) {
      await updateVideoJob(sb, job_id, {
        status: "ERROR",
        error: `Worker dispatch failed: ${r.status} ${txt.slice(0, 200)}`,
        updated_at: new Date().toISOString(),
      });
      return res.status(500).json({ ok: false, error: `Worker dispatch failed: ${r.status}`, podId });
    }

    // Guardar respuesta normalizada (debug)
    let workerReply = null;
    try {
      const raw = txt ? JSON.parse(txt) : null;
      workerReply = Array.isArray(raw) ? raw[0] : raw;
    } catch {
      workerReply = { raw_text: txt?.slice(0, 500) || "" };
    }

    try {
      await updateVideoJob(sb, job_id, {
        status: workerReply?.status || "IN_PROGRESS",
        worker_reply: workerReply,
        updated_at: new Date().toISOString(),
      });
    } catch {}

    return res.status(200).json({
      ok: true,
      job_id,
      status: "IN_PROGRESS",
      podId,
      worker: fresh.workerUrl,
      billed: { type: "JADE", amount: COST_IMG2VIDEO_JADES },
      note: "I2V sigue generándose en el pod. Usa /api/video-status?job_id=...",
    });
  } catch (e) {
    const msg = String(e?.message || e);
    const code = e?.code || 500;
    console.error("[I2V] ERROR:", msg);

    try {
      if (sb) {
        await setPodState(sb, { status: "ERROR", last_error: msg, last_used_at: new Date().toISOString() });
      }
    } catch {}

    return res.status(code).json({ ok: false, error: msg, podId });
  }
}
