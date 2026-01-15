// /api/generate-video.js
// ============================================================
// IsabelaOS Studio — Video Generate API (Vercel)
// ASYNC REAL: dispatch a worker /api/video_async
// - Reusa pod si existe (pod_state.id=1.pod_id)
// - Lock por RPC (TTL corto) + release inmediato en finally
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

// -------------------------
// ENV
// -------------------------
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY =
  process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY || null;

const VIDEO_RUNPOD_TEMPLATE_ID = process.env.VIDEO_RUNPOD_TEMPLATE_ID || null;
const VIDEO_RUNPOD_NETWORK_VOLUME_ID =
  process.env.VIDEO_RUNPOD_NETWORK_VOLUME_ID || null;
const VIDEO_VOLUME_MOUNT_PATH = process.env.VIDEO_VOLUME_MOUNT_PATH || "/workspace";

const WORKER_PORT = parseInt(process.env.WORKER_PORT || "8000", 10);
const WORKER_HEALTH_PATH = process.env.WORKER_HEALTH_PATH || "/health";
const WORKER_ASYNC_PATH = process.env.WORKER_ASYNC_PATH || "/api/video_async";

const WAIT_WORKER_TIMEOUT_MS = parseInt(process.env.WAIT_WORKER_TIMEOUT_MS || "180000", 10);
const WAIT_WORKER_INTERVAL_MS = parseInt(process.env.WAIT_WORKER_INTERVAL_MS || "2500", 10);

const WAIT_RUNNING_TIMEOUT_MS = parseInt(process.env.WAIT_RUNNING_TIMEOUT_MS || "240000", 10);
const WAIT_RUNNING_INTERVAL_MS = parseInt(process.env.WAIT_RUNNING_INTERVAL_MS || "3500", 10);

// Lock (RPC)
const WAKE_LOCK_SECONDS = parseInt(process.env.WAKE_LOCK_SECONDS || "60", 10);
const LOCK_WAIT_TIMEOUT_MS = parseInt(process.env.LOCK_WAIT_TIMEOUT_MS || "45000", 10);
const LOCK_WAIT_INTERVAL_MS = parseInt(process.env.LOCK_WAIT_INTERVAL_MS || "1200", 10);

// Tables
const POD_STATE_TABLE = process.env.POD_STATE_TABLE || "pod_state";

// -------------------------
// Helpers
// -------------------------
function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Falta SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Falta RUNPOD_API_KEY");
  return {
    Authorization: `Bearer ${RUNPOD_API_KEY}`,
    "Content-Type": "application/json",
  };
}

function workerBaseUrl(podId) {
  return `https://${podId}-${WORKER_PORT}.proxy.runpod.net`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// -------------------------
// RunPod REST v1
// -------------------------
async function runpodGetPod(podId) {
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, {
    method: "GET",
    headers: runpodHeaders(),
  });
  const t = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`RunPod get pod falló (${r.status}): ${t}`);
  try {
    return JSON.parse(t);
  } catch {
    return { raw: t };
  }
}

async function runpodStartPod(podId) {
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}/start`, {
    method: "POST",
    headers: runpodHeaders(),
  });
  if (r.ok) return true;
  const t = await r.text().catch(() => "");
  return { ok: false, status: r.status, raw: t };
}

async function runpodTerminatePod(podId) {
  // intenta /terminate y si no, DELETE
  {
    const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}/terminate`, {
      method: "POST",
      headers: runpodHeaders(),
    });
    if (r.ok) return true;
  }
  {
    const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, {
      method: "DELETE",
      headers: runpodHeaders(),
    });
    const t = await r.text().catch(() => "");
    if (r.ok) return true;
    throw new Error(`RunPod terminate falló: ${t}`);
  }
}

function extractRunpodStatus(pod) {
  const candidates = [
    pod?.runtime?.status,
    pod?.runtime?.desiredStatus,
    pod?.desiredStatus,
    pod?.status,
    pod?.pod?.status,
    pod?.pod?.desiredStatus,
  ];
  for (const c of candidates) {
    if (c) return String(c).toUpperCase();
  }
  return "";
}

async function waitForRunning(podId) {
  const start = Date.now();
  while (Date.now() - start < WAIT_RUNNING_TIMEOUT_MS) {
    const pod = await runpodGetPod(podId);
    const status = extractRunpodStatus(pod);

    if (status.includes("RUNNING")) return { ok: true, status };

    if (status.includes("FAILED") || status.includes("ERROR")) {
      return { ok: false, status, error: "Pod entró en FAILED/ERROR" };
    }
    if (status.includes("TERMINATED") || status.includes("EXITED")) {
      return { ok: false, status, error: "Pod está TERMINATED/EXITED" };
    }
    await sleep(WAIT_RUNNING_INTERVAL_MS);
  }
  return { ok: false, status: "TIMEOUT", error: `Pod no llegó a RUNNING en ${WAIT_RUNNING_TIMEOUT_MS}ms` };
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
  return { ok: false, url, error: `Worker no respondió tras ${WAIT_WORKER_TIMEOUT_MS}ms` };
}

async function runpodCreatePodFromTemplate({ name }) {
  if (!VIDEO_RUNPOD_TEMPLATE_ID) throw new Error("Falta VIDEO_RUNPOD_TEMPLATE_ID");
  if (!VIDEO_RUNPOD_NETWORK_VOLUME_ID) throw new Error("Falta VIDEO_RUNPOD_NETWORK_VOLUME_ID");

  const payload = {
    name,
    templateId: VIDEO_RUNPOD_TEMPLATE_ID,
    networkVolumeId: VIDEO_RUNPOD_NETWORK_VOLUME_ID,
    volumeMountPath: VIDEO_VOLUME_MOUNT_PATH,
    ports: [`${WORKER_PORT}/http`, "8888/http"],
  };

  const r = await fetch(`https://rest.runpod.io/v1/pods`, {
    method: "POST",
    headers: runpodHeaders(),
    body: JSON.stringify(payload),
  });

  const t = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`RunPod create failed (${r.status}): ${t}`);

  let json = null;
  try {
    json = JSON.parse(t);
  } catch {
    json = { raw: t };
  }

  const podId = json?.id || json?.podId || json?.pod?.id || json?.data?.id || null;
  if (!podId) throw new Error(`RunPod create no devolvió podId. Respuesta: ${t}`);

  // verificación rápida
  const verifyStart = Date.now();
  while (Date.now() - verifyStart < 30000) {
    try {
      await runpodGetPod(podId);
      return { podId, raw: json };
    } catch {
      await sleep(1500);
    }
  }

  throw new Error(`Pod creado pero NO verificable por GET. podId=${podId}`);
}

// -------------------------
// RPC Lock (Supabase)
// -------------------------
async function acquireLockWithWait(sb, seconds = WAKE_LOCK_SECONDS) {
  const start = Date.now();

  while (Date.now() - start < LOCK_WAIT_TIMEOUT_MS) {
    const { data, error } = await sb.rpc("acquire_pod_lock", { p_seconds: seconds });
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    if (row?.ok) return { ok: true, locked_until: row.locked_until };

    await sleep(LOCK_WAIT_INTERVAL_MS);
  }
  return { ok: false, error: `Timeout esperando lock (${LOCK_WAIT_TIMEOUT_MS}ms)` };
}

async function releaseLockRpc(sb) {
  const { error } = await sb.rpc("release_pod_lock");
  if (error) throw error;
}

// -------------------------
// Ensure pod
// -------------------------
async function ensureWorkingPod(sb, log) {
  const nowIso = new Date().toISOString();

  const { data: podState, error: psErr } = await sb
    .from(POD_STATE_TABLE)
    .select("*")
    .eq("id", 1)
    .single();
  if (psErr) throw psErr;

  const statePodId = String(podState?.pod_id || "");

  async function touch(status, busy = false) {
    await sb
      .from(POD_STATE_TABLE)
      .update({ status, last_used_at: nowIso, busy })
      .eq("id", 1);
  }

  if (!statePodId) {
    const created = await runpodCreatePodFromTemplate({ name: `isabela-video-${Date.now()}` });

    await sb
      .from(POD_STATE_TABLE)
      .update({ pod_id: created.podId, status: "STARTING", last_used_at: nowIso, busy: false })
      .eq("id", 1);

    const st = await runpodStartPod(created.podId);
    if (st !== true) log("warn=startPod failed (ignored)", st);

    const running = await waitForRunning(created.podId);
    if (!running.ok) throw new Error(`Pod nuevo no llegó a RUNNING: ${running.error || running.status}`);

    const ready = await waitForWorker(created.podId);
    if (!ready.ok) throw new Error(`Worker no listo tras crear pod: ${ready.error}`);

    await touch("RUNNING", false);
    return { podId: created.podId, action: "CREADO_Y_LISTO" };
  }

  // reusar
  try {
    await runpodGetPod(statePodId);

    const st = await runpodStartPod(statePodId);
    if (st !== true) log("warn=startPod failed (ignored)", st);

    const running = await waitForRunning(statePodId);
    if (!running.ok) throw new Error(`Pod no RUNNING: ${running.error || running.status}`);

    const ready = await waitForWorker(statePodId);
    if (!ready.ok) throw new Error(`Worker no respondió: ${ready.error}`);

    await touch("RUNNING", false);
    return { podId: statePodId, action: "REUSADO" };
  } catch (e) {
    const msg = String(e?.message || e);
    log("ensureWorkingPod: pod existente falló, recreo", msg);

    const oldPodId = statePodId;
    const created = await runpodCreatePodFromTemplate({ name: `isabela-video-${Date.now()}` });

    await sb
      .from(POD_STATE_TABLE)
      .update({ pod_id: created.podId, status: "STARTING", last_used_at: nowIso, busy: false })
      .eq("id", 1);

    const st = await runpodStartPod(created.podId);
    if (st !== true) log("warn=startPod failed (ignored)", st);

    const running = await waitForRunning(created.podId);
    if (!running.ok) throw new Error(`Pod nuevo no RUNNING: ${running.error || running.status}`);

    const ready = await waitForWorker(created.podId);
    if (!ready.ok) throw new Error(`Worker no listo tras recrear: ${ready.error}`);

    await touch("RUNNING", false);

    await runpodTerminatePod(oldPodId).catch(() => {});
    return { podId: created.podId, action: "RECREADO", oldPodId };
  }
}

// -------------------------
// Handler
// -------------------------
export default async function handler(req, res) {
  const log = (...args) => console.log("[GV]", ...args);
  let lockAcquired = false;

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Método no permitido" });
    }

    const auth = await requireUser(req);
    if (!auth.ok) {
      return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    }
    const user_id = auth.user.id;

    const body = req.body || {};
    const payloadIn = typeof body === "string" ? JSON.parse(body) : body;

    const {
      mode = "t2v",
      prompt,
      negative_prompt = "",
      steps = 22,
      height = 512,
      width = 896,
      num_frames = 49,
      fps = 24,
      guidance_scale = 6.0,
      image_base64 = null,
    } = payloadIn;

    if (!prompt) return res.status(400).json({ ok: false, error: "Falta prompt" });

    const sb = sbAdmin();

    log("step=LOCK_WAIT_BEGIN", { ttl_s: WAKE_LOCK_SECONDS, wait_ms: LOCK_WAIT_TIMEOUT_MS });
    const lock = await acquireLockWithWait(sb, WAKE_LOCK_SECONDS);
    if (!lock.ok) return res.status(503).json({ ok: false, error: lock.error });

    lockAcquired = true;
    log("step=LOCK_OK", { locked_until: lock.locked_until });

    log("step=ENSURE_POD_BEGIN");
    const podInfo = await ensureWorkingPod(sb, log);
    log("step=ENSURE_POD_OK", podInfo);

    const podId = podInfo.podId;
    const dispatchUrl = `${workerBaseUrl(podId)}${WORKER_ASYNC_PATH}`;

    const payload = {
      user_id,
      mode,
      prompt,
      negative_prompt,
      steps,
      height,
      width,
      num_frames,
      fps,
      guidance_scale,
      image_base64,
    };

    log("step=DISPATCH_BEGIN", { url: dispatchUrl });

    const rr = await fetch(dispatchUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const tt = await rr.text().catch(() => "");
    if (!rr.ok) {
      log("step=DISPATCH_FAIL", { status: rr.status, body: tt?.slice?.(0, 500) || tt });
      throw new Error(`Worker dispatch failed (${rr.status}): ${tt}`);
    }

    let j = null;
    try {
      j = JSON.parse(tt);
    } catch {
      j = null;
    }

    const job_id = j?.job_id || j?.id || null;
    if (!job_id) throw new Error(`Worker no devolvió job_id. Respuesta: ${tt}`);

    log("step=DISPATCH_OK", { job_id });

    return res.status(200).json({
      ok: true,
      status: "PENDING",
      job_id,
      pod: podInfo,
      dispatch: { ok: true, url: dispatchUrl },
    });
  } catch (e) {
    const msg = String(e?.message || e);
    console.error("[GV] fatal:", msg);
    return res.status(500).json({ ok: false, error: msg });
  } finally {
    if (lockAcquired) {
      try {
        const sb = sbAdmin();
        await releaseLockRpc(sb);
        console.log("[GV] step=LOCK_RELEASED");
      } catch (e) {
        console.log("[GV] warn=LOCK_RELEASE_FAIL", String(e?.message || e));
      }
    }
  }
}