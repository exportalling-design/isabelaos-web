// /api/generate-video.js
// ============================================================
// IsabelaOS Studio - API de Generación de Video (Vercel Function)
// ============================================================
// Objetivo (sin romper el async):
// 1) Inserta job en video_jobs (PENDING)
// 2) Lock corto (evita 2 pods al mismo tiempo)
// 3) Reanuda pod si existe y sirve
// 4) Si no existe / perdió GPU: crea pod nuevo desde TEMPLATE + VOLUME
// 5) Espera RUNNING + /health
// 6) Dispatch rápido a /api/video_async (NO espera render)
// 7) job pasa a RUNNING (el worker runner lo completa)
// ============================================================

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { requireUser } from "./_auth.js";

// ---------------------
// ENV
// ---------------------
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY = process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY || null;

const VIDEO_RUNPOD_TEMPLATE_ID = process.env.VIDEO_RUNPOD_TEMPLATE_ID || null;
const VIDEO_RUNPOD_NETWORK_VOLUME_ID = process.env.VIDEO_RUNPOD_NETWORK_VOLUME_ID || null;
const VIDEO_VOLUME_MOUNT_PATH = process.env.VIDEO_VOLUME_MOUNT_PATH || "/workspace";
const RUNPOD_GPU_TYPE = process.env.RUNPOD_GPU_TYPE || null;

const FIXED_POD_ID = process.env.VIDEO_FIXED_POD_ID || ""; // opcional

const WORKER_PORT = parseInt(process.env.WORKER_PORT || "8000", 10);
const WORKER_HEALTH_PATH = process.env.WORKER_HEALTH_PATH || "/health";
const WORKER_ASYNC_PATH = process.env.WORKER_ASYNC_PATH || "/api/video_async";

const WAIT_RUNNING_TIMEOUT_MS = parseInt(process.env.WAIT_RUNNING_TIMEOUT_MS || "180000", 10);
const WAIT_RUNNING_INTERVAL_MS = parseInt(process.env.WAIT_RUNNING_INTERVAL_MS || "3500", 10);

const WAIT_WORKER_TIMEOUT_MS = parseInt(process.env.WAIT_WORKER_TIMEOUT_MS || "120000", 10);
const WAIT_WORKER_INTERVAL_MS = parseInt(process.env.WAIT_WORKER_INTERVAL_MS || "2500", 10);

const WAKE_LOCK_SECONDS = parseInt(process.env.WAKE_LOCK_SECONDS || "120", 10);

// Tablas
const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";
const VIDEO_JOBS_TABLE = "video_jobs";

// ---------------------
// Helpers
// ---------------------
function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Falta SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Falta RUNPOD_API_KEY / VIDEO_RUNPOD_API_KEY");
  return { Authorization: `Bearer ${RUNPOD_API_KEY}`, "Content-Type": "application/json" };
}

function workerBaseUrl(podId) {
  return `https://${podId}-${WORKER_PORT}.proxy.runpod.net`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function looksLikeGpuNotAvailable(msg) {
  const s = String(msg || "").toLowerCase();
  return (
    s.includes("gpus are no longer available") ||
    s.includes("gpu not available") ||
    s.includes("insufficient capacity") ||
    s.includes("cannot allocate") ||
    s.includes("hardware has been deployed by another user")
  );
}

// ---------------------
// RunPod REST v1
// ---------------------
async function runpodGetPod(podId) {
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, { method: "GET", headers: runpodHeaders() });
  const t = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`RunPod get pod failed (${r.status}): ${t}`);
  return t ? JSON.parse(t) : {};
}

async function runpodStartPod(podId) {
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}/start`, { method: "POST", headers: runpodHeaders() });
  const t = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`RunPod start failed (${r.status}): ${t}`);
  return true;
}

async function runpodTerminatePod(podId) {
  // terminate endpoint
  {
    const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}/terminate`, {
      method: "POST",
      headers: runpodHeaders(),
    });
    if (r.ok) return true;
  }
  // fallback delete
  {
    const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, { method: "DELETE", headers: runpodHeaders() });
    const t = await r.text().catch(() => "");
    if (!r.ok) throw new Error(`RunPod terminate failed (${r.status}): ${t}`);
    return true;
  }
}

// Crea pod desde template (REST v1)
async function runpodCreatePodFromTemplate({ name }) {
  if (!VIDEO_RUNPOD_TEMPLATE_ID) throw new Error("Falta VIDEO_RUNPOD_TEMPLATE_ID");
  if (!VIDEO_RUNPOD_NETWORK_VOLUME_ID) throw new Error("Falta VIDEO_RUNPOD_NETWORK_VOLUME_ID");
  if (!RUNPOD_GPU_TYPE) throw new Error("Falta RUNPOD_GPU_TYPE");
  if (!VIDEO_VOLUME_MOUNT_PATH) throw new Error("Falta VIDEO_VOLUME_MOUNT_PATH");

  const payload = {
    name,
    templateId: VIDEO_RUNPOD_TEMPLATE_ID,
    gpuTypeId: RUNPOD_GPU_TYPE,
    networkVolumeId: VIDEO_RUNPOD_NETWORK_VOLUME_ID,
    volumeMountPath: VIDEO_VOLUME_MOUNT_PATH,
    ports: [
      { containerPort: 8000, protocol: "http" },
      { containerPort: 8888, protocol: "http" },
    ],
  };

  const r = await fetch(`https://rest.runpod.io/v1/pods`, {
    method: "POST",
    headers: runpodHeaders(),
    body: JSON.stringify(payload),
  });

  const t = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`RunPod create failed (${r.status}): ${t}`);

  const json = t ? JSON.parse(t) : {};
  const podId = json?.id || json?.podId || json?.pod?.id || json?.data?.id || null;

  if (!podId) throw new Error(`RunPod create no devolvió podId. Respuesta: ${t}`);
  return { podId, raw: json };
}

async function waitForRunning(podId) {
  const start = Date.now();
  while (Date.now() - start < WAIT_RUNNING_TIMEOUT_MS) {
    const pod = await runpodGetPod(podId);
    const status = String(pod?.desiredStatus || pod?.status || pod?.pod?.status || "").toUpperCase();
    if (status.includes("RUNNING")) return { ok: true, status };
    if (status.includes("FAILED") || status.includes("ERROR")) return { ok: false, status, error: "Pod FAILED/ERROR" };
    await sleep(WAIT_RUNNING_INTERVAL_MS);
  }
  return { ok: false, status: "TIMEOUT", error: "Pod no llegó a RUNNING" };
}

async function waitForWorker(podId) {
  const base = workerBaseUrl(podId);
  const url = `${base}${WORKER_HEALTH_PATH}`;
  const start = Date.now();

  while (Date.now() - start < WAIT_WORKER_TIMEOUT_MS) {
    try {
      const r = await fetch(url, { method: "GET" });
      if (r.ok) return { ok: true };
    } catch {}
    await sleep(WAIT_WORKER_INTERVAL_MS);
  }
  return { ok: false, error: `Worker no respondió a ${WORKER_HEALTH_PATH}` };
}

// ---------------------
// Lock corto (id=1, locked_until)
// ---------------------
async function tryAcquireLock(sb, seconds = 120) {
  const now = new Date();
  const until = new Date(now.getTime() + seconds * 1000).toISOString();

  const { data: lockRow, error: lerr } = await sb.from(POD_LOCK_TABLE).select("*").eq("id", 1).single();
  if (lerr) throw lerr;

  const lockedUntil = lockRow?.locked_until ? new Date(lockRow.locked_until) : null;
  if (lockedUntil && lockedUntil > now) {
    return { ok: false, reason: "lock active", locked_until: lockRow.locked_until };
  }

  const { error: uerr } = await sb.from(POD_LOCK_TABLE).update({ locked_until: until }).eq("id", 1);
  if (uerr) throw uerr;

  return { ok: true, locked_until: until };
}

async function releaseLock(sb) {
  const pastIso = new Date(Date.now() - 1000).toISOString();
  await sb.from(POD_LOCK_TABLE).update({ locked_until: pastIso }).eq("id", 1);
}

// ---------------------
// Asegurar pod usable
// ---------------------
async function ensureWorkingPod(sb) {
  const nowIso = new Date().toISOString();

  const { data: podState, error: psErr } = await sb.from(POD_STATE_TABLE).select("*").eq("id", 1).single();
  if (psErr) throw psErr;

  const statePodId = String(podState?.pod_id || "");
  const desiredPodId = FIXED_POD_ID ? FIXED_POD_ID : statePodId;

  // No hay pod guardado: crear
  if (!desiredPodId) {
    const created = await runpodCreatePodFromTemplate({ name: `isabela-video-${Date.now()}` });

    await sb.from(POD_STATE_TABLE).update({
      pod_id: created.podId,
      status: "STARTING",
      busy: false,
      last_used_at: nowIso,
    }).eq("id", 1);

    await runpodStartPod(created.podId);
    const running = await waitForRunning(created.podId);
    if (!running.ok) throw new Error(`Pod nuevo no llegó a RUNNING: ${running.error || running.status}`);

    const ready = await waitForWorker(created.podId);
    if (!ready.ok) throw new Error(`Worker no listo en pod nuevo: ${ready.error}`);

    await sb.from(POD_STATE_TABLE).update({ status: "RUNNING", last_used_at: nowIso }).eq("id", 1);
    return { podId: created.podId, action: "CREATED" };
  }

  // Hay pod: validar y arrancar si está pausado
  try {
    const podReal = await runpodGetPod(desiredPodId);
    const realStatus = String(podReal?.desiredStatus || podReal?.status || podReal?.pod?.status || "").toUpperCase();

    const shouldStart = ["STOPPED", "PAUSED", "EXITED", "SLEEPING", "NOT_RUNNING"].some((s) => realStatus.includes(s));

    if (shouldStart) {
      await runpodStartPod(desiredPodId);
      const running = await waitForRunning(desiredPodId);
      if (!running.ok) throw new Error(`Pod no llegó a RUNNING: ${running.error || running.status}`);
    }

    const ready = await waitForWorker(desiredPodId);
    if (!ready.ok) throw new Error(`Worker no listo: ${ready.error}`);

    await sb.from(POD_STATE_TABLE).update({
      pod_id: desiredPodId,
      status: "RUNNING",
      last_used_at: nowIso,
    }).eq("id", 1);

    return { podId: desiredPodId, action: shouldStart ? "RESUMED" : "ALREADY_RUNNING" };
  } catch (e) {
    // Si GPU se perdió: crear nuevo y terminar viejo
    if (looksLikeGpuNotAvailable(e?.message || e)) {
      const oldPodId = desiredPodId;

      const created = await runpodCreatePodFromTemplate({ name: `isabela-video-${Date.now()}` });

      await sb.from(POD_STATE_TABLE).update({
        pod_id: created.podId,
        status: "STARTING",
        busy: false,
        last_used_at: nowIso,
      }).eq("id", 1);

      await runpodStartPod(created.podId);
      const running = await waitForRunning(created.podId);
      if (!running.ok) throw new Error(`Pod nuevo no RUNNING: ${running.error || running.status}`);

      const ready = await waitForWorker(created.podId);
      if (!ready.ok) throw new Error(`Worker no listo en pod nuevo: ${ready.error}`);

      // terminar viejo
      await runpodTerminatePod(oldPodId).catch(() => {});

      await sb.from(POD_STATE_TABLE).update({ status: "RUNNING", last_used_at: nowIso }).eq("id", 1);
      return { podId: created.podId, action: "RECREATED_AND_TERMINATED_OLD", oldPodId };
    }

    // Si el podId guardado es falso/no existe -> también recrear
    const msg = String(e?.message || e);
    if (msg.toLowerCase().includes("get pod failed (404)") || msg.toLowerCase().includes("not found")) {
      const oldPodId = desiredPodId;
      const created = await runpodCreatePodFromTemplate({ name: `isabela-video-${Date.now()}` });

      await sb.from(POD_STATE_TABLE).update({
        pod_id: created.podId,
        status: "STARTING",
        busy: false,
        last_used_at: nowIso,
      }).eq("id", 1);

      await runpodStartPod(created.podId);
      const running = await waitForRunning(created.podId);
      if (!running.ok) throw new Error(`Pod nuevo no RUNNING: ${running.error || running.status}`);

      const ready = await waitForWorker(created.podId);
      if (!ready.ok) throw new Error(`Worker no listo en pod nuevo: ${ready.error}`);

      await runpodTerminatePod(oldPodId).catch(() => {});

      await sb.from(POD_STATE_TABLE).update({ status: "RUNNING", last_used_at: nowIso }).eq("id", 1);
      return { podId: created.podId, action: "RECREATED_BAD_SAVED_ID", oldPodId };
    }

    throw e;
  }
}

// ---------------------
// MAIN
// ---------------------
export default async function handler(req, res) {
  const startedAt = Date.now();
  const log = (...args) => console.log("[GV]", ...args);

  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });

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
      fps = 24,
      guidance_scale = 5.0,
      image_base64 = null,
      seed = null,
    } = req.body || {};

    if (!prompt) return res.status(400).json({ ok: false, error: "Missing prompt" });

    const sb = sbAdmin();

    // 1) Insert job (PENDING)
    const job_id = crypto.randomUUID();
    const { data: job, error: insErr } = await sb.from(VIDEO_JOBS_TABLE).insert({
      job_id,
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
      status: "PENDING",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).select("*").single();
    if (insErr) throw insErr;

    // 2) Lock corto (solo para WAKE)
    const lock = await tryAcquireLock(sb, WAKE_LOCK_SECONDS);
    if (!lock.ok) {
      // No fallamos: se queda en cola, otro request despertará
      return res.status(200).json({
        ok: true,
        job_id: job.id,
        status: "PENDING",
        wake: { ok: false, action: "SKIP_WAKE_LOCKED", locked_until: lock.locked_until },
        ms: Date.now() - startedAt,
      });
    }

    // 3) Ensure pod usable
    await sb.from(POD_STATE_TABLE).update({ last_used_at: new Date().toISOString() }).eq("id", 1);
    const podInfo = await ensureWorkingPod(sb);

    // 4) Dispatch rápido al worker (no esperamos render)
    const dispatchUrl = `${workerBaseUrl(podInfo.podId)}${WORKER_ASYNC_PATH}`;

    const payload = {
      job_id: job.id,        // PK id (lo que el runner usa si está configurado así)
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
      seed,
    };

    const rr = await fetch(dispatchUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const tt = await rr.text().catch(() => "");
    if (!rr.ok) {
      await sb.from(VIDEO_JOBS_TABLE).update({
        status: "ERROR",
        error: `DISPATCH_FAIL (${rr.status}): ${tt}`,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);

      return res.status(200).json({
        ok: true,
        job_id: job.id,
        status: "ERROR",
        pod: podInfo,
        dispatch: { ok: false, url: dispatchUrl, error: tt },
        ms: Date.now() - startedAt,
      });
    }

    await sb.from(VIDEO_JOBS_TABLE).update({
      status: "DISPATCHED",
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);

    return res.status(200).json({
      ok: true,
      job_id: job.id,
      status: "DISPATCHED",
      pod: podInfo,
      dispatch: { ok: true, url: dispatchUrl },
      ms: Date.now() - startedAt,
    });
  } catch (e) {
    log("fatal:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  } finally {
    // liberamos lock (best effort)
    try {
      const sb = sbAdmin();
      await releaseLock(sb);
    } catch {}
  }
}