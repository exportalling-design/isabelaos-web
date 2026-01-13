// /api/generate-video.js
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { requireUser } from "./_auth.js";

// ============================================================
// IsabelaOS Studio — Generar Video (Pod dinámico + Encendido + Dispatch)
// ------------------------------------------------------------
// OBJETIVO:
// - Si no hay pod (o se perdió): crea UNO NUEVO desde TEMPLATE
// - Monta SIEMPRE tu Network Volume (persistencia)
// - Espera a que el pod esté RUNNING
// - Espera a que el worker responda /health
// - Envía el trabajo al worker (modo asíncrono)
// ------------------------------------------------------------
// NOTA IMPORTANTE (RunPod REST):
// - El error que viste (400) era por "ports": RunPod aquí espera STRINGS,
//   no objetos. Ej: ["8000/http", "8888/http"].
// ============================================================

// ---------------------
// VARIABLES DE ENTORNO (Vercel)
// ---------------------
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY =
  process.env.VIDEO_RUNPOD_API_KEY ||
  process.env.RUNPOD_API_KEY ||
  null;

const VIDEO_RUNPOD_TEMPLATE_ID = process.env.VIDEO_RUNPOD_TEMPLATE_ID || null; // ej: kcr5u5mdbv
const VIDEO_RUNPOD_NETWORK_VOLUME_ID = process.env.VIDEO_RUNPOD_NETWORK_VOLUME_ID || null; // ej: x4ppgiwpse
const VIDEO_VOLUME_MOUNT_PATH = process.env.VIDEO_VOLUME_MOUNT_PATH || "/workspace"; // ej: /workspace
const RUNPOD_GPU_TYPE = process.env.RUNPOD_GPU_TYPE || null; // ej: A100_SXM

// Si quieres “pod fijo”, déjalo vacío y el sistema usará pod_state.pod_id.
// Si lo pones, forzará a usar ese pod.
const FIXED_POD_ID = process.env.VIDEO_FIXED_POD_ID || "";

// Config del Worker
const WORKER_PORT = parseInt(process.env.WORKER_PORT || "8000", 10);
const WORKER_HEALTH_PATH = process.env.WORKER_HEALTH_PATH || "/health";
const WORKER_ASYNC_PATH = process.env.WORKER_ASYNC_PATH || "/api/video_async";

// Tiempos de espera
const WAIT_WORKER_TIMEOUT_MS = parseInt(process.env.WAIT_WORKER_TIMEOUT_MS || "120000", 10);
const WAIT_WORKER_INTERVAL_MS = parseInt(process.env.WAIT_WORKER_INTERVAL_MS || "2500", 10);
const WAIT_RUNNING_TIMEOUT_MS = parseInt(process.env.WAIT_RUNNING_TIMEOUT_MS || "180000", 10);
const WAIT_RUNNING_INTERVAL_MS = parseInt(process.env.WAIT_RUNNING_INTERVAL_MS || "3500", 10);

// Lock para “wake” (evitar 2 arranques simultáneos)
const WAKE_LOCK_SECONDS = parseInt(process.env.WAKE_LOCK_SECONDS || "120", 10);

// Comportamiento
const TERMINATE_AFTER_JOB = String(process.env.TERMINATE_AFTER_JOB || "0") === "1";

// ---------------------
// TABLAS (Supabase)
// ---------------------
const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";
const VIDEO_JOBS_TABLE = "video_jobs";

// ---------------------
// HELPERS
// ---------------------
function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Falta SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Falta RUNPOD_API_KEY (usa VIDEO_RUNPOD_API_KEY o RUNPOD_API_KEY)");
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

function pareceGpuNoDisponible(msg) {
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

async function esperarWorker(podId) {
  const base = workerBaseUrl(podId);
  const url = `${base}${WORKER_HEALTH_PATH}`;
  const start = Date.now();

  while (Date.now() - start < WAIT_WORKER_TIMEOUT_MS) {
    try {
      const r = await fetch(url, { method: "GET" });
      if (r.ok) return { ok: true, url };
    } catch (_) {
      // ignorar
    }
    await sleep(WAIT_WORKER_INTERVAL_MS);
  }

  return { ok: false, error: `Worker no respondió en ${WAIT_WORKER_TIMEOUT_MS}ms`, url };
}

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

async function esperarRunning(podId) {
  const start = Date.now();

  while (Date.now() - start < WAIT_RUNNING_TIMEOUT_MS) {
    const pod = await runpodGetPod(podId);
    const status = String(pod?.desiredStatus || pod?.status || pod?.pod?.status || "").toUpperCase();

    if (status.includes("RUNNING")) return { ok: true, status };
    if (status.includes("FAILED") || status.includes("ERROR")) {
      return { ok: false, status, error: "El pod entró en FAILED/ERROR" };
    }

    await sleep(WAIT_RUNNING_INTERVAL_MS);
  }

  return { ok: false, status: "TIMEOUT", error: `El pod no llegó a RUNNING en ${WAIT_RUNNING_TIMEOUT_MS}ms` };
}

async function intentarLock(sb, seconds = 120) {
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
    return { ok: false, reason: "lock activo", locked_until: lockRow.locked_until };
  }

  const { error: uerr } = await sb
    .from(POD_LOCK_TABLE)
    .update({ locked_until: until.toISOString() })
    .eq("id", 1);
  if (uerr) throw uerr;

  return { ok: true, locked_until: until.toISOString() };
}

// ------------------------------------------------------------
// CREAR POD DESDE TEMPLATE (con volumen + puertos)
// ------------------------------------------------------------
async function runpodCrearPodDesdeTemplate({ name }) {
  if (!VIDEO_RUNPOD_TEMPLATE_ID) throw new Error("Falta VIDEO_RUNPOD_TEMPLATE_ID");
  if (!VIDEO_RUNPOD_NETWORK_VOLUME_ID) throw new Error("Falta VIDEO_RUNPOD_NETWORK_VOLUME_ID");
  if (!VIDEO_VOLUME_MOUNT_PATH) throw new Error("Falta VIDEO_VOLUME_MOUNT_PATH");
  if (!RUNPOD_GPU_TYPE) throw new Error("Falta RUNPOD_GPU_TYPE (ej. A100_SXM)");

  // ✅ CORRECCIÓN CLAVE:
  // RunPod REST aquí espera ports como STRING, no como objeto.
  // Ejemplos válidos:
  // - ["8000/http"]
  // - ["8000/http", "8888/http"]
  const payload = {
    name,
    templateId: VIDEO_RUNPOD_TEMPLATE_ID,
    gpuTypeId: RUNPOD_GPU_TYPE,
    networkVolumeId: VIDEO_RUNPOD_NETWORK_VOLUME_ID,
    volumeMountPath: VIDEO_VOLUME_MOUNT_PATH,
    ports: ["8000/http", "8888/http"],
  };

  const r = await fetch(`https://rest.runpod.io/v1/pods`, {
    method: "POST",
    headers: runpodHeaders(),
    body: JSON.stringify(payload),
  });

  const t = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`RunPod create pod falló (${r.status}): ${t}`);

  let json = null;
  try {
    json = JSON.parse(t);
  } catch {
    json = { raw: t };
  }

  const podId = json?.id || json?.podId || json?.pod?.id || json?.data?.id || null;
  if (!podId) throw new Error(`RunPod create no devolvió podId. Respuesta: ${t}`);

  return { podId, raw: json };
}

// ------------------------------------------------------------
// ASEGURAR POD UTILIZABLE (arranca o recrea si se perdió)
// ------------------------------------------------------------
async function asegurarPodOperativo(sb) {
  const nowIso = new Date().toISOString();

  const { data: podState, error: psErr } = await sb
    .from(POD_STATE_TABLE)
    .select("*")
    .eq("id", 1)
    .single();
  if (psErr) throw psErr;

  const statePodId = String(podState?.pod_id || "");
  const desiredPodId = FIXED_POD_ID ? FIXED_POD_ID : statePodId;

  // Caso 1: no hay pod guardado -> crear
  if (!desiredPodId) {
    const creado = await runpodCrearPodDesdeTemplate({ name: `isabela-video-${Date.now()}` });

    await sb
      .from(POD_STATE_TABLE)
      .update({ pod_id: creado.podId, status: "STARTING", last_used_at: nowIso })
      .eq("id", 1);

    await runpodStartPod(creado.podId);

    const running = await esperarRunning(creado.podId);
    if (!running.ok) throw new Error(`El pod nuevo no llegó a RUNNING: ${running.error || running.status}`);

    const ready = await esperarWorker(creado.podId);
    if (!ready.ok) throw new Error(`El worker no estuvo listo en el pod nuevo: ${ready.error}`);

    await sb
      .from(POD_STATE_TABLE)
      .update({ status: "RUNNING", last_used_at: nowIso })
      .eq("id", 1);

    return { podId: creado.podId, action: "CREADO_Y_LISTO" };
  }

  // Caso 2: hay pod -> verificar y arrancar si es necesario
  try {
    const podReal = await runpodGetPod(desiredPodId);
    const realStatus = String(podReal?.desiredStatus || podReal?.status || podReal?.pod?.status || "").toUpperCase();

    const debeArrancar = ["STOPPED", "PAUSED", "EXITED", "SLEEPING", "NOT_RUNNING"].some((s) => realStatus.includes(s));

    if (debeArrancar) {
      await runpodStartPod(desiredPodId);
      const running = await esperarRunning(desiredPodId);
      if (!running.ok) throw new Error(`El pod no llegó a RUNNING: ${running.error || running.status}`);
    }

    const ready = await esperarWorker(desiredPodId);
    if (!ready.ok) {
      // reintento: arrancar otra vez y volver a esperar
      await runpodStartPod(desiredPodId);
      const running2 = await esperarRunning(desiredPodId);
      if (!running2.ok) throw new Error(`Reintento falló al llegar a RUNNING: ${running2.error || running2.status}`);

      const ready2 = await esperarWorker(desiredPodId);
      if (!ready2.ok) throw new Error(`El worker sigue sin responder: ${ready2.error}`);
    }

    await sb
      .from(POD_STATE_TABLE)
      .update({ pod_id: desiredPodId, status: "RUNNING", last_used_at: nowIso })
      .eq("id", 1);

    return { podId: desiredPodId, action: debeArrancar ? "ARRANCADO" : "YA_CORRIENDO" };
  } catch (e) {
    // Si parece pérdida de GPU / no disponible -> recrear
    if (pareceGpuNoDisponible(e?.message || e)) {
      const oldPodId = desiredPodId;

      const creado = await runpodCrearPodDesdeTemplate({ name: `isabela-video-${Date.now()}` });

      await sb
        .from(POD_STATE_TABLE)
        .update({ pod_id: creado.podId, status: "STARTING", last_used_at: nowIso })
        .eq("id", 1);

      await runpodStartPod(creado.podId);

      const running = await esperarRunning(creado.podId);
      if (!running.ok) throw new Error(`El pod nuevo no llegó a RUNNING: ${running.error || running.status}`);

      const ready = await esperarWorker(creado.podId);
      if (!ready.ok) throw new Error(`El worker no estuvo listo en el pod nuevo: ${ready.error}`);

      await sb
        .from(POD_STATE_TABLE)
        .update({ status: "RUNNING", last_used_at: nowIso })
        .eq("id", 1);

      return { podId: creado.podId, action: "RECREADO_POR_GPU", oldPodId };
    }

    throw e;
  }
}

// ------------------------------------------------------------
// HANDLER PRINCIPAL
// ------------------------------------------------------------
export default async function handler(req, res) {
  const startedAt = Date.now();

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Método no permitido" });
    }

    // Autenticación
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    const user_id = auth.user.id;

    // Datos del job
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
    } = req.body || {};

    if (!prompt) return res.status(400).json({ ok: false, error: "Falta prompt" });

    const sb = sbAdmin();
    const job_id = crypto.randomUUID();

    // 1) Insertar job en la tabla
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

    // 2) Marcar uso reciente (para autosleep)
    await sb.from(POD_STATE_TABLE).update({ last_used_at: new Date().toISOString() }).eq("id", 1);

    // 3) Lock corto para evitar 2 “wake/start” simultáneos
    const lock = await intentarLock(sb, WAKE_LOCK_SECONDS);
    if (!lock.ok) {
      return res.status(200).json({
        ok: true,
        job_id,
        status: "PENDING",
        wake: { ok: false, action: "LOCK_ACTIVO", locked_until: lock.locked_until },
      });
    }

    // 4) Asegurar pod operativo
    await sb.from(POD_STATE_TABLE).update({ status: "STARTING" }).eq("id", 1);
    const podInfo = await asegurarPodOperativo(sb);

    // 5) Enviar al worker (asíncrono)
    const podId = podInfo.podId;
    const base = workerBaseUrl(podId);
    const dispatchUrl = `${base}${WORKER_ASYNC_PATH}`;

    const payload = {
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
      seed,
      // para que el worker / status sepan si deben terminar pods
      terminate_after_job: TERMINATE_AFTER_JOB ? 1 : 0,
    };

    let dispatch = { ok: true, url: dispatchUrl };

    try {
      const rr = await fetch(dispatchUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const tt = await rr.text().catch(() => "");

      if (!rr.ok) {
        await sb
          .from(VIDEO_JOBS_TABLE)
          .update({ status: "FAILED", error: `Dispatch al worker falló (${rr.status}): ${tt}` })
          .eq("job_id", job_id);

        dispatch = { ok: false, url: dispatchUrl, error: `Dispatch falló (${rr.status}): ${tt}` };
      } else {
        await sb.from(VIDEO_JOBS_TABLE).update({ status: "RUNNING" }).eq("job_id", job_id);
      }
    } catch (e) {
      await sb
        .from(VIDEO_JOBS_TABLE)
        .update({ status: "FAILED", error: `Excepción en dispatch: ${String(e?.message || e)}` })
        .eq("job_id", job_id);

      dispatch = { ok: false, url: dispatchUrl, error: String(e?.message || e) };
    }

    // 6) Guardar estado del pod
    await sb
      .from(POD_STATE_TABLE)
      .update({
        status: dispatch.ok ? "RUNNING" : "ERROR",
        last_used_at: new Date().toISOString(),
        pod_id: podId,
      })
      .eq("id", 1);

    // 7) Respuesta al frontend
    return res.status(200).json({
      ok: true,
      job_id,
      status: dispatch.ok ? "RUNNING" : "FAILED",
      pod: podInfo,
      dispatch,
      ms: Date.now() - startedAt,
    });
  } catch (e) {
    console.error("[GV] fatal:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}