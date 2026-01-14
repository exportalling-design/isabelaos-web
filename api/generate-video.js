// /api/generate-video.js
// ============================================================
// IsabelaOS Studio — API de Generación de Video (Vercel Function)
// ============================================================
//
// OBJETIVO (sin romper tu ASYNC real):
// - Inserta el job en Supabase (video_jobs) para que exista historial/estado.
// - Toma un lock corto (pod_lock id=1 con locked_until) para evitar 2 "wake/start/create" simultáneos.
// - Asegura que hay un POD funcional:
//    - Si hay pod_id guardado -> lo reanuda si está en STOP/PAUSE y espera RUNNING.
//    - Si el pod ya no existe (404) o perdió GPU -> crea uno nuevo desde TEMPLATE + Network Volume.
// - Espera que el worker responda en /health.
// - Despacha el job al worker vía /api/video_async (POST) y retorna job_id inmediatamente.
// - Si el dispatch falla, marca el job como FAILED (para no dejar PENDING infinito).
//
// NOTAS IMPORTANTES:
// 1) ✅ FIX RunPod REST v1: usa gpuTypeIds (array), NO gpuTypeId.
// 2) ✅ FIX RunPod REST v1: ports debe ser array de strings (ej "8000/http"), NO objects.
// 3) ✅ NO usamos .catch() en query builders de Supabase (eso causaba: ".catch is not a function").
// 4) Comentarios y títulos en español, como pediste.
//
// ============================================================

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { requireUser } from "./_auth.js";

// ------------------------------------------------------------
// ENV (Vercel)
// ------------------------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY =
  process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY || null;

// Template/Volume/GPU
const VIDEO_RUNPOD_TEMPLATE_ID = process.env.VIDEO_RUNPOD_TEMPLATE_ID || null; // ej: kcr5u5mdbv
const VIDEO_RUNPOD_NETWORK_VOLUME_ID = process.env.VIDEO_RUNPOD_NETWORK_VOLUME_ID || null; // ej: x4ppgiwpse
const VIDEO_VOLUME_MOUNT_PATH = process.env.VIDEO_VOLUME_MOUNT_PATH || "/workspace"; // ej: /workspace
const RUNPOD_GPU_TYPE = process.env.RUNPOD_GPU_TYPE || null; // ej: A100_SXM (se manda como gpuTypeIds:[...])

// Si quieres “pod fijo”, déjalo vacío para usar pod_state.pod_id.
// Si lo pones, fuerza a usar ese pod.
const FIXED_POD_ID = process.env.VIDEO_FIXED_POD_ID || "";

// Worker config
const WORKER_PORT = parseInt(process.env.WORKER_PORT || "8000", 10);
const WORKER_HEALTH_PATH = process.env.WORKER_HEALTH_PATH || "/health";
const WORKER_ASYNC_PATH = process.env.WORKER_ASYNC_PATH || "/api/video_async";

// Waits
const WAIT_WORKER_TIMEOUT_MS = parseInt(process.env.WAIT_WORKER_TIMEOUT_MS || "120000", 10);
const WAIT_WORKER_INTERVAL_MS = parseInt(process.env.WAIT_WORKER_INTERVAL_MS || "2500", 10);
const WAIT_RUNNING_TIMEOUT_MS = parseInt(process.env.WAIT_RUNNING_TIMEOUT_MS || "180000", 10);
const WAIT_RUNNING_INTERVAL_MS = parseInt(process.env.WAIT_RUNNING_INTERVAL_MS || "3500", 10);

// Locks
const WAKE_LOCK_SECONDS = parseInt(process.env.WAKE_LOCK_SECONDS || "120", 10);

// Behavior
const TERMINATE_AFTER_JOB = String(process.env.TERMINATE_AFTER_JOB || "0") === "1";

// ------------------------------------------------------------
// Tablas
// ------------------------------------------------------------
const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";
const VIDEO_JOBS_TABLE = "video_jobs";

// ------------------------------------------------------------
// Helpers base
// ------------------------------------------------------------
function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Falta SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Falta RUNPOD_API_KEY (VIDEO_RUNPOD_API_KEY o RUNPOD_API_KEY)");
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

function looksLikeGpuNotAvailable(msg) {
  const s = String(msg || "").toLowerCase();
  return (
    s.includes("gpus are no longer available") ||
    s.includes("gpu are no longer available") ||
    s.includes("no longer available") ||
    s.includes("gpu not available") ||
    s.includes("insufficient capacity") ||
    s.includes("not enough") ||
    s.includes("cannot allocate") ||
    s.includes("pod migration") ||
    s.includes("hardware has been deployed by another user")
  );
}

// ------------------------------------------------------------
// Esperar worker vivo (/health)
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// RunPod REST v1 helpers
// ------------------------------------------------------------
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
  const t = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`RunPod start falló (${r.status}): ${t}`);
  return true;
}

async function runpodTerminatePod(podId) {
  // Intento 1: endpoint terminate
  {
    const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}/terminate`, {
      method: "POST",
      headers: runpodHeaders(),
    });
    if (r.ok) return true;
  }
  // Intento 2: DELETE
  {
    const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, {
      method: "DELETE",
      headers: runpodHeaders(),
    });
    if (r.ok) return true;
    const t = await r.text().catch(() => "");
    throw new Error(`RunPod terminate falló: ${t}`);
  }
}

async function waitForRunning(podId) {
  const start = Date.now();
  while (Date.now() - start < WAIT_RUNNING_TIMEOUT_MS) {
    const pod = await runpodGetPod(podId);
    const status = String(pod?.desiredStatus || pod?.status || pod?.pod?.status || "").toUpperCase();

    if (status.includes("RUNNING")) return { ok: true, status };
    if (status.includes("FAILED") || status.includes("ERROR")) {
      return { ok: false, status, error: "Pod entró en FAILED/ERROR" };
    }

    await sleep(WAIT_RUNNING_INTERVAL_MS);
  }
  return { ok: false, status: "TIMEOUT", error: `Pod no llegó a RUNNING en ${WAIT_RUNNING_TIMEOUT_MS}ms` };
}

// ------------------------------------------------------------
// LOCK (Supabase) usando pod_lock(id=1, locked_until)
// ------------------------------------------------------------
async function tryAcquireLock(sb, seconds = 120) {
  const now = new Date();
  const until = new Date(now.getTime() + seconds * 1000);

  const { data: lockRow, error: lerr } = await sb
    .from(POD_LOCK_TABLE)
    .select("*")
    .eq("id", 1)
    .single();
  if (lerr) throw lerr;

  const lockedUntil = lockRow?.locked_until ? new Date(lockRow.locked_until) : null;
  if (lockedUntil && lockedUntil > now) {
    return { ok: false, reason: "lock active", locked_until: lockRow.locked_until };
  }

  const { error: uerr } = await sb.from(POD_LOCK_TABLE).update({ locked_until: until.toISOString() }).eq("id", 1);
  if (uerr) throw uerr;

  return { ok: true, locked_until: until.toISOString() };
}

async function releaseLock(sb) {
  const pastIso = new Date(Date.now() - 1000).toISOString();
  const { error } = await sb.from(POD_LOCK_TABLE).update({ locked_until: pastIso }).eq("id", 1);
  if (error) throw error;
}

// ------------------------------------------------------------
// ✅ CREAR POD DESDE TEMPLATE (RunPod REST v1) — FIXES IMPORTANTES
// - gpuTypeIds (array) en lugar de gpuTypeId
// - ports: array de strings, no objects
// ------------------------------------------------------------
async function runpodCreatePodFromTemplate({ name }) {
  if (!VIDEO_RUNPOD_TEMPLATE_ID) throw new Error("Falta VIDEO_RUNPOD_TEMPLATE_ID");
  if (!VIDEO_RUNPOD_NETWORK_VOLUME_ID) throw new Error("Falta VIDEO_RUNPOD_NETWORK_VOLUME_ID");
  if (!VIDEO_VOLUME_MOUNT_PATH) throw new Error("Falta VIDEO_VOLUME_MOUNT_PATH");

  // Payload compatible con REST v1 (ajustado a los errores que te dio RunPod)
  const payload = {
    name,
    templateId: VIDEO_RUNPOD_TEMPLATE_ID,

    // ✅ FIX: si defines GPU, RunPod espera gpuTypeIds: ["A100_SXM", ...]
    ...(RUNPOD_GPU_TYPE ? { gpuTypeIds: [RUNPOD_GPU_TYPE] } : {}),

    networkVolumeId: VIDEO_RUNPOD_NETWORK_VOLUME_ID,
    volumeMountPath: VIDEO_VOLUME_MOUNT_PATH,

    // ✅ FIX: ports son strings en schema REST v1
    ports: ["8000/http", "8888/http"],
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

  if (!podId) {
    throw new Error(`RunPod create no devolvió podId. Respuesta: ${t}`);
  }

  return { podId, raw: json };
}

// ------------------------------------------------------------
// Asegurar que hay un pod usable (reanudar o recrear si GPU perdida / 404)
// ------------------------------------------------------------
async function ensureWorkingPod(sb) {
  const nowIso = new Date().toISOString();

  const { data: podState, error: psErr } = await sb
    .from(POD_STATE_TABLE)
    .select("*")
    .eq("id", 1)
    .single();
  if (psErr) throw psErr;

  const statePodId = String(podState?.pod_id || "");
  const desiredPodId = FIXED_POD_ID ? FIXED_POD_ID : statePodId;

  // Caso A: no hay pod guardado => crear uno nuevo
  if (!desiredPodId) {
    const created = await runpodCreatePodFromTemplate({ name: `isabela-video-${Date.now()}` });

    await sb
      .from(POD_STATE_TABLE)
      .update({ pod_id: created.podId, status: "STARTING", last_used_at: nowIso, busy: false })
      .eq("id", 1);

    await runpodStartPod(created.podId);

    const running = await waitForRunning(created.podId);
    if (!running.ok) throw new Error(`Pod nuevo no llegó a RUNNING: ${running.error || running.status}`);

    const ready = await waitForWorker(created.podId);
    if (!ready.ok) throw new Error(`Worker no listo tras crear pod: ${ready.error}`);

    await sb.from(POD_STATE_TABLE).update({ status: "RUNNING", last_used_at: nowIso, busy: false }).eq("id", 1);

    return { podId: created.podId, action: "CREADO_Y_LISTO" };
  }

  // Caso B: hay pod guardado => validar/arrancar/recuperar
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
    if (!ready.ok) {
      // reintento de recuperación
      await runpodStartPod(desiredPodId);
      const running2 = await waitForRunning(desiredPodId);
      if (!running2.ok) throw new Error(`Recovery start falló: ${running2.error || running2.status}`);

      const ready2 = await waitForWorker(desiredPodId);
      if (!ready2.ok) throw new Error(`Worker sigue sin responder: ${ready2.error}`);
    }

    await sb
      .from(POD_STATE_TABLE)
      .update({ pod_id: desiredPodId, status: "RUNNING", last_used_at: nowIso, busy: false })
      .eq("id", 1);

    return { podId: desiredPodId, action: shouldStart ? "REANUDADO" : "YA_CORRIENDO" };
  } catch (e) {
    const msg = String(e?.message || e);

    // Si el pod no existe (404) o GPU perdida => recrear
    const is404 = msg.includes("(404)") || msg.toLowerCase().includes("pod not found");
    if (is404 || looksLikeGpuNotAvailable(msg)) {
      const oldPodId = desiredPodId;

      const created = await runpodCreatePodFromTemplate({ name: `isabela-video-${Date.now()}` });

      await sb
        .from(POD_STATE_TABLE)
        .update({ pod_id: created.podId, status: "STARTING", last_used_at: nowIso, busy: false })
        .eq("id", 1);

      await runpodStartPod(created.podId);

      const running = await waitForRunning(created.podId);
      if (!running.ok) throw new Error(`Pod nuevo no RUNNING: ${running.error || running.status}`);

      const ready = await waitForWorker(created.podId);
      if (!ready.ok) throw new Error(`Worker no listo en pod nuevo: ${ready.error}`);

      await sb.from(POD_STATE_TABLE).update({ status: "RUNNING", last_used_at: nowIso, busy: false }).eq("id", 1);

      // ✅ Opcional: terminar el viejo (si quieres sí o sí)
      // Si el viejo era 404, esto fallará y lo ignoramos.
      await runpodTerminatePod(oldPodId).catch(() => {});

      return { podId: created.podId, action: is404 ? "RECREADO_POR_404" : "RECREADO_POR_GPU_PERDIDA", oldPodId };
    }

    throw e;
  }
}

// ------------------------------------------------------------
// MAIN
// ------------------------------------------------------------
export default async function handler(req, res) {
  const startedAt = Date.now();
  const log = (...args) => console.log("[GV]", ...args);

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Método no permitido" });
    }

    // Auth (tu lógica actual)
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    const user_id = auth.user.id;

    // Payload
    const {
      mode = "t2v",
      prompt,
      negative_prompt = "",
      steps = 25,
      height = 704,
      width = 1280,
      num_frames = 121,
      guidance_scale = 5.0,
      seed = null,
      image_base64 = null, // si usas i2v más adelante
    } = req.body || {};

    if (!prompt) return res.status(400).json({ ok: false, error: "Falta prompt" });

    const sb = sbAdmin();

    // ✅ job_id para tu tabla si lo usas (además del PK id)
    const job_id = crypto.randomUUID();

    // 1) Insert job (PENDING)
    // Importante: insertamos primero para tener registro, pero NO dejamos infinito:
    // si algo falla, marcamos FAILED con error.
    let inserted = null;
    {
      const { data, error } = await sb
        .from(VIDEO_JOBS_TABLE)
        .insert({
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
          image_base64,
          status: "PENDING",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select("*")
        .single();
      if (error) throw error;
      inserted = data;
    }

    // 2) Touch last_used_at
    {
      const { error } = await sb
        .from(POD_STATE_TABLE)
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", 1);
      if (error) throw error;
    }

    // 3) Lock corto para wake/start/create
    log("step=LOCK_BEGIN");
    const lock = await tryAcquireLock(sb, WAKE_LOCK_SECONDS);

    if (!lock.ok) {
      // ✅ No rompemos tu async: devolvemos job_id y queda en PENDING.
      // El usuario puede reintentar; o si el worker runner procesa cola, lo tomará cuando pueda.
      log("step=LOCK_BUSY", lock);
      return res.status(200).json({
        ok: true,
        job_id: inserted?.id || inserted?.job_id || job_id,
        status: "PENDING",
        wake: { ok: false, action: "LOCKED", locked_until: lock.locked_until },
        ms: Date.now() - startedAt,
      });
    }

    log("step=LOCK_OK", { locked_until: lock.locked_until });

    // 4) Ensure pod usable (reanudar/recrear)
    await sb.from(POD_STATE_TABLE).update({ status: "STARTING" }).eq("id", 1);

    log("step=ENSURE_POD_BEGIN");
    const podInfo = await ensureWorkingPod(sb);
    log("step=ENSURE_POD_OK", podInfo);

    // 5) Dispatch async al worker
    const podId = podInfo.podId;
    const base = workerBaseUrl(podId);
    const dispatchUrl = `${base}${WORKER_ASYNC_PATH}`;

    const payload = {
      job_id: inserted?.id || null, // ✅ tu worker puede usar PK id; si no, usa job_id
      user_id,
      mode,
      prompt,
      negative_prompt,
      steps,
      height,
      width,
      num_frames,
      guidance_scale,
      seed,
      image_base64,
      terminate_after_job: TERMINATE_AFTER_JOB ? 1 : 0,
    };

    log("step=DISPATCH_BEGIN", { dispatchUrl });

    let dispatchOk = false;
    let dispatchErr = null;

    try {
      const rr = await fetch(dispatchUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const tt = await rr.text().catch(() => "");
      if (!rr.ok) {
        dispatchOk = false;
        dispatchErr = `Worker dispatch failed (${rr.status}): ${tt}`;
      } else {
        dispatchOk = true;
      }
    } catch (e) {
      dispatchOk = false;
      dispatchErr = `Worker dispatch exception: ${String(e?.message || e)}`;
    }

    if (!dispatchOk) {
      // ✅ marcar FAILED (no más PENDING infinito)
      await sb
        .from(VIDEO_JOBS_TABLE)
        .update({
          status: "FAILED",
          error: dispatchErr,
          updated_at: new Date().toISOString(),
        })
        .eq("id", inserted.id);

      await sb
        .from(POD_STATE_TABLE)
        .update({ status: "ERROR", last_used_at: new Date().toISOString(), pod_id: podId, busy: false })
        .eq("id", 1);

      log("step=DISPATCH_FAIL", { dispatchErr });

      return res.status(200).json({
        ok: true,
        job_id: inserted.id,
        status: "FAILED",
        pod: podInfo,
        dispatch: { ok: false, url: dispatchUrl, error: dispatchErr },
        ms: Date.now() - startedAt,
      });
    }

    // ✅ marcar RUNNING en DB (para que video-status muestre progreso)
    await sb
      .from(VIDEO_JOBS_TABLE)
      .update({ status: "RUNNING", updated_at: new Date().toISOString() })
      .eq("id", inserted.id);

    await sb
      .from(POD_STATE_TABLE)
      .update({ status: "RUNNING", last_used_at: new Date().toISOString(), pod_id: podId, busy: false })
      .eq("id", 1);

    log("step=DISPATCH_OK");

    return res.status(200).json({
      ok: true,
      job_id: inserted.id,
      status: "RUNNING",
      pod: podInfo,
      dispatch: { ok: true, url: dispatchUrl },
      ms: Date.now() - startedAt,
    });
  } catch (e) {
    const msg = String(e?.message || e);
    console.error("[GV] fatal:", msg);
    return res.status(500).json({ ok: false, error:msg });
  } finally {
    // Nota: el lock se libera automáticamente por TTL,
    // pero si quieres liberarlo aquí también, descomenta:
    try {
      const sb = sbAdmin();
      await releaseLock(sb);
    } catch (_) {}

    // TERMINATE_AFTER_JOB se maneja en video-status o autosleep, no aquí
  }
}