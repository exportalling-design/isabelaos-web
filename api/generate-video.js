// /api/generate-video.js
// ============================================================
// IsabelaOS Studio — API de Generación de Video (Vercel Function)
// MODO: ASYNC REAL (worker encola y runner procesa)
// CLAVE: si ya hay job activo => devuelve ese job_id (no crea otro)
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY =
  process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY || null;

const VIDEO_RUNPOD_TEMPLATE_ID = process.env.VIDEO_RUNPOD_TEMPLATE_ID || null;
const VIDEO_RUNPOD_NETWORK_VOLUME_ID = process.env.VIDEO_RUNPOD_NETWORK_VOLUME_ID || null;
const VIDEO_VOLUME_MOUNT_PATH = process.env.VIDEO_VOLUME_MOUNT_PATH || "/workspace";

// ✅ Preferencias de GPU (prioridad) — acepta lo que tú pongas (IDs o nombres).
// Ejemplo recomendado (por tu UI):
// "H100 NVL,A100 SXM,A100 PCIe,RTX 6000 Ada,L40S,L40,RTX A6000"
const VIDEO_GPU_TYPE_IDS = (process.env.VIDEO_GPU_TYPE_IDS || "").trim();

// ✅ Truco datacenter: ALL suele encontrar más stock (si tu cuenta lo permite)
const VIDEO_GPU_CLOUD_TYPE = (process.env.VIDEO_GPU_CLOUD_TYPE || "ALL").trim();

// ✅ Fuerza 1 GPU
const VIDEO_GPU_COUNT = parseInt(process.env.VIDEO_GPU_COUNT || "1", 10);

// ✅ Si la creación con GPU preferida falla, NO confirmamos falla al usuario:
// hacemos fallback automático a crear sin gpuTypeIds / sin cloudType.
const VIDEO_GPU_FALLBACK_ON_FAIL = String(process.env.VIDEO_GPU_FALLBACK_ON_FAIL || "1") === "1";

const WORKER_PORT = parseInt(process.env.WORKER_PORT || "8000", 10);
const WORKER_HEALTH_PATH = process.env.WORKER_HEALTH_PATH || "/health";
const WORKER_ASYNC_PATH = process.env.WORKER_ASYNC_PATH || "/api/video_async";

const WAIT_WORKER_TIMEOUT_MS = parseInt(process.env.WAIT_WORKER_TIMEOUT_MS || "180000", 10);
const WAIT_WORKER_INTERVAL_MS = parseInt(process.env.WAIT_WORKER_INTERVAL_MS || "2500", 10);

const WAIT_RUNNING_TIMEOUT_MS = parseInt(process.env.WAIT_RUNNING_TIMEOUT_MS || "240000", 10);
const WAIT_RUNNING_INTERVAL_MS = parseInt(process.env.WAIT_RUNNING_INTERVAL_MS || "3500", 10);

// Lock SOLO para arranque/ensure (no para render)
const WAKE_LOCK_SECONDS = parseInt(process.env.WAKE_LOCK_SECONDS || "60", 10);

const POD_STATE_TABLE = process.env.POD_STATE_TABLE || "pod_state";
const POD_LOCK_TABLE = process.env.POD_LOCK_TABLE || "pod_lock";
const VIDEO_JOBS_TABLE = process.env.VIDEO_JOBS_TABLE || "video_jobs";

// 👇 Estados activos (los mismos que video-current usa / y runner usa)
const ACTIVE_STATUSES = ["PENDING", "IN_QUEUE", "QUEUED", "DISPATCHED", "IN_PROGRESS", "RUNNING"];

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

// ---------------------------
// RunPod REST v1 helpers
// ---------------------------
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
  // best-effort
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}/start`, {
    method: "POST",
    headers: runpodHeaders(),
  });
  if (r.ok) return true;
  const t = await r.text().catch(() => "");
  return { ok: false, status: r.status, raw: t };
}

async function runpodTerminatePod(podId) {
  // best-effort terminate
  const r1 = await fetch(`https://rest.runpod.io/v1/pods/${podId}/terminate`, {
    method: "POST",
    headers: runpodHeaders(),
  });
  if (r1.ok) return true;

  const r2 = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, {
    method: "DELETE",
    headers: runpodHeaders(),
  });
  if (r2.ok) return true;

  const t = await r2.text().catch(() => "");
  throw new Error(`RunPod terminate falló: ${t}`);
}

async function waitForRunning(podId) {
  const start = Date.now();
  while (Date.now() - start < WAIT_RUNNING_TIMEOUT_MS) {
    const pod = await runpodGetPod(podId);
    const status = String(
      pod?.desiredStatus || pod?.status || pod?.pod?.status || ""
    ).toUpperCase();

    if (status.includes("RUNNING")) return { ok: true, status };
    if (status.includes("FAILED") || status.includes("ERROR")) {
      return { ok: false, status, error: "Pod entró en FAILED/ERROR" };
    }
    await sleep(WAIT_RUNNING_INTERVAL_MS);
  }
  return {
    ok: false,
    status: "TIMEOUT",
    error: `Pod no llegó a RUNNING en ${WAIT_RUNNING_TIMEOUT_MS}ms`,
  };
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
  return { ok: false, error: `Worker no respondió tras ${WAIT_WORKER_TIMEOUT_MS}ms`, url };
}

// ---------------------------
// LOCK (atómico) — SOLO para ensure pod
// ---------------------------
async function tryAcquireLockAtomic(sb, seconds = 60) {
  const now = new Date();
  const until = new Date(now.getTime() + seconds * 1000);
  const nowIso = now.toISOString();

  // ✅ UPDATE atómico: solo toma lock si ya expiró
  const { data, error } = await sb
    .from(POD_LOCK_TABLE)
    .update({ locked_until: until.toISOString() })
    .eq("id", 1)
    .lte("locked_until", nowIso)
    .select("locked_until")
    .maybeSingle();

  if (error) throw error;
  if (!data) return { ok: false, reason: "lock active" };

  return { ok: true, locked_until: data.locked_until };
}

async function releaseLock(sb) {
  const pastIso = new Date(Date.now() - 1000).toISOString();
  const { error } = await sb
    .from(POD_LOCK_TABLE)
    .update({ locked_until: pastIso })
    .eq("id", 1);
  if (error) throw error;
}

// ---------------------------
// Crear pod desde template (con preferencia de GPU + fallback)
// ---------------------------
function parseGpuTypeList() {
  if (!VIDEO_GPU_TYPE_IDS) return null;
  const arr = VIDEO_GPU_TYPE_IDS
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return arr.length ? arr : null;
}

async function runpodCreatePodOnce(payload) {
  const r = await fetch(`https://rest.runpod.io/v1/pods`, {
    method: "POST",
    headers: runpodHeaders(),
    body: JSON.stringify(payload),
  });

  const t = await r.text().catch(() => "");
  if (!r.ok) {
    const err = new Error(`RunPod create failed (${r.status}): ${t}`);
    err.status = r.status;
    err.raw = t;
    throw err;
  }

  let json = null;
  try { json = JSON.parse(t); } catch { json = { raw: t }; }

  const podId = json?.id || json?.podId || json?.pod?.id || json?.data?.id || null;
  if (!podId) throw new Error(`RunPod create no devolvió podId. Respuesta: ${t}`);

  return { podId, raw: json };
}

async function runpodCreatePodFromTemplate({ name, log }) {
  if (!VIDEO_RUNPOD_TEMPLATE_ID) throw new Error("Falta VIDEO_RUNPOD_TEMPLATE_ID");
  if (!VIDEO_RUNPOD_NETWORK_VOLUME_ID) throw new Error("Falta VIDEO_RUNPOD_NETWORK_VOLUME_ID");

  const gpuTypeIds = parseGpuTypeList();

  // Intento #1: preferencia GPU + cloudType + gpuCount
  const basePayload = {
    name,
    templateId: VIDEO_RUNPOD_TEMPLATE_ID,
    networkVolumeId: VIDEO_RUNPOD_NETWORK_VOLUME_ID,
    volumeMountPath: VIDEO_VOLUME_MOUNT_PATH,
    ports: ["8000/http", "8888/http"],
    gpuCount: VIDEO_GPU_COUNT,
  };

  const attempts = [];

  // A) preferida
  attempts.push({
    label: "PREFERRED_GPU",
    payload: {
      ...basePayload,
      cloudType: VIDEO_GPU_CLOUD_TYPE || "ALL",
      ...(gpuTypeIds ? { gpuTypeIds } : {}),
    },
  });

  if (VIDEO_GPU_FALLBACK_ON_FAIL) {
    // B) sin gpuTypeIds pero con cloudType (más stock)
    attempts.push({
      label: "FALLBACK_CLOUD_ONLY",
      payload: {
        ...basePayload,
        cloudType: VIDEO_GPU_CLOUD_TYPE || "ALL",
      },
    });

    // C) pelado (máxima compatibilidad)
    attempts.push({
      label: "FALLBACK_PLAIN",
      payload: {
        ...basePayload,
      },
    });
  }

  let lastErr = null;
  for (const a of attempts) {
    try {
      if (log) log(`createPod attempt=${a.label}`, {
        hasGpuTypeIds: Boolean(a.payload.gpuTypeIds),
        cloudType: a.payload.cloudType || null,
        gpuCount: a.payload.gpuCount,
      });
      const created = await runpodCreatePodOnce(a.payload);
      return { ...created, attempt: a.label, used: a.payload };
    } catch (e) {
      lastErr = e;
      if (log) log(`createPod failed attempt=${a.label}`, String(e?.message || e));
      // si no hay fallback, romper de una
      if (!VIDEO_GPU_FALLBACK_ON_FAIL) throw e;
    }
  }

  throw lastErr || new Error("RunPod create failed: sin detalle");
}

// ---------------------------
// Ensure pod (reutiliza SIEMPRE el pod_state.pod_id)
// ---------------------------
async function ensureWorkingPod(sb, log) {
  const nowIso = new Date().toISOString();

  const { data: podState, error: psErr } = await sb
    .from(POD_STATE_TABLE)
    .select("*")
    .eq("id", 1)
    .single();
  if (psErr) throw psErr;

  const statePodId = String(podState?.pod_id || "").trim();

  async function touch(status, busy = false) {
    await sb
      .from(POD_STATE_TABLE)
      .update({ status, last_used_at: nowIso, busy })
      .eq("id", 1);
  }

  // Si no hay pod guardado => crear
  if (!statePodId) {
    const created = await runpodCreatePodFromTemplate({
      name: `isabela-video-${Date.now()}`,
      log,
    });

    await sb
      .from(POD_STATE_TABLE)
      .update({
        pod_id: created.podId,
        status: "STARTING",
        last_used_at: nowIso,
        busy: false,
      })
      .eq("id", 1);

    const st = await runpodStartPod(created.podId);
    if (st !== true) log("warn=startPod failed (ignored)", st);

    const running = await waitForRunning(created.podId);
    if (!running.ok) throw new Error(`Pod nuevo no llegó a RUNNING: ${running.error || running.status}`);

    const ready = await waitForWorker(created.podId);
    if (!ready.ok) throw new Error(`Worker no listo tras crear pod: ${ready.error}`);

    await touch("RUNNING", false);
    return { podId: created.podId, action: "CREADO_Y_LISTO", createAttempt: created.attempt };
  }

  // Si ya existe pod => reusar
  try {
    await runpodGetPod(statePodId);

    const st = await runpodStartPod(statePodId);
    if (st !== true) log("warn=startPod failed (ignored)", st);

    const running = await waitForRunning(statePodId);
    if (!running.ok) throw new Error(`Pod no RUNNING: ${running.error || running.status}`);

    const ready = await waitForWorker(statePodId);
    if (!ready.ok) throw new Error(`Worker no respondió en pod existente: ${ready.error}`);

    await touch("RUNNING", false);
    return { podId: statePodId, action: "REUSADO" };
  } catch (e) {
    // Si el pod guardado murió => recrear y reemplazar
    const msg = String(e?.message || e);
    log("ensureWorkingPod: pod existente falló, recreo", msg);

    const oldPodId = statePodId;
    const created = await runpodCreatePodFromTemplate({
      name: `isabela-video-${Date.now()}`,
      log,
    });

    await sb
      .from(POD_STATE_TABLE)
      .update({
        pod_id: created.podId,
        status: "STARTING",
        last_used_at: nowIso,
        busy: false,
      })
      .eq("id", 1);

    const st = await runpodStartPod(created.podId);
    if (st !== true) log("warn=startPod failed (ignored)", st);

    const running = await waitForRunning(created.podId);
    if (!running.ok) throw new Error(`Pod nuevo no RUNNING: ${running.error || running.status}`);

    const ready = await waitForWorker(created.podId);
    if (!ready.ok) throw new Error(`Worker no listo tras recrear pod: ${ready.error}`);

    await touch("RUNNING", false);

    await runpodTerminatePod(oldPodId).catch(() => {});
    return { podId: created.podId, action: "RECREADO", oldPodId, createAttempt: created.attempt };
  }
}

// ---------------------------
// 1) Buscar job activo del usuario (para no crear otro)
// ---------------------------
async function getActiveJobForUser(sb, user_id) {
  const { data, error } = await sb
    .from(VIDEO_JOBS_TABLE)
    .select("id,status,progress,eta_seconds,queue_position,video_url,error,created_at,updated_at")
    .eq("user_id", user_id)
    .in("status", ACTIVE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return data?.[0] || null;
}

// ---------------------------
// Handler principal
// ---------------------------
export default async function handler(req, res) {
  const log = (...args) => console.log("[GV]", ...args);

  let lockAcquired = false;

  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });

    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });

    const user_id = auth.user.id;

    const {
      mode = "t2v",
      prompt,
      negative_prompt = "",
      steps = 34,
      height = 720,
      width = 1280,
      num_frames = 80,
      fps = 24,
      guidance_scale = 6.5,
      image_base64 = null,
    } = req.body || {};

    if (!prompt) return res.status(400).json({ ok: false, error: "Falta prompt" });

    const sb = sbAdmin();

    // ✅ A) Si ya hay job activo, devolvelo y NO crees otro
    const active = await getActiveJobForUser(sb, user_id);
    if (active) {
      return res.status(200).json({
        ok: true,
        status: "ALREADY_RUNNING",
        job_id: active.id,
        job: active,
      });
    }

    // ✅ B) Lock SOLO para ensurePod (se libera inmediatamente)
    log("step=LOCK_BEGIN");
    const lock = await tryAcquireLockAtomic(sb, WAKE_LOCK_SECONDS);
    if (!lock.ok) {
      log("step=LOCK_BUSY");
      return res.status(200).json({
        ok: true,
        status: "LOCK_BUSY",
        retry_after_ms: 2500,
      });
    }
    lockAcquired = true;
    log("step=LOCK_OK", { locked_until: lock.locked_until });

    // 2) Ensure pod (reusar el mismo pod si ya existe)
    log("step=ENSURE_POD_BEGIN");
    const podInfo = await ensureWorkingPod(sb, log);
    log("step=ENSURE_POD_OK", podInfo);

    // ✅ C) Liberar lock YA (no esperar render)
    await releaseLock(sb);
    lockAcquired = false;
    log("step=LOCK_RELEASED");

    // 3) Dispatch ASYNC REAL al worker (él inserta video_jobs y devuelve job_id)
    const podId = podInfo.podId;
    const dispatchUrl = `${workerBaseUrl(podId)}${WORKER_ASYNC_PATH}`;

    const payload = {
      user_id, // ✅ fuente de verdad
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

    log("step=DISPATCH_BEGIN", { dispatchUrl });

    const rr = await fetch(dispatchUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const tt = await rr.text().catch(() => "");
    if (!rr.ok) throw new Error(`Worker dispatch failed (${rr.status}): ${tt}`);

    let j = null;
    try { j = JSON.parse(tt); } catch { j = null; }

    const job_id = j?.job_id || j?.id || null;
    if (!job_id) throw new Error(`Worker no devolvió job_id. Respuesta: ${tt}`);

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
    // Si por error quedó lock, liberarlo best-effort
    if (lockAcquired) {
      try {
        const sb = sbAdmin();
        await releaseLock(sb);
      } catch {}
    }
  }
}