// /api/generate-video.js
// ============================================================
// IsabelaOS Studio — API Generación Video (Vercel Function)
// - 1 solo pod (pod_state.id=1)
// - lock atómico (pod_lock.id=1)
// - arranque rápido: si no corre rápido -> terminate y recrea
// - si no hay GPU -> devuelve mensaje suave "Intenta de nuevo"
// - dispatch async a worker: /api/video_async
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

// -------------------- ENV: Supabase --------------------
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// -------------------- ENV: RunPod --------------------
const RUNPOD_API_KEY =
  process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY || null;

const VIDEO_RUNPOD_TEMPLATE_ID = process.env.VIDEO_RUNPOD_TEMPLATE_ID || null;

const VIDEO_RUNPOD_NETWORK_VOLUME_ID =
  process.env.VIDEO_RUNPOD_NETWORK_VOLUME_ID ||
  process.env.VIDEO_NETWORK_VOLUME_ID ||
  null;

const VIDEO_VOLUME_MOUNT_PATH = process.env.VIDEO_VOLUME_MOUNT_PATH || "/workspace";

const VIDEO_GPU_TYPE_IDS = (process.env.VIDEO_GPU_TYPE_IDS || "").trim(); // "A100-SXM4-80GB,H100-SXM5-80GB"
const VIDEO_GPU_CLOUD_TYPE = (process.env.VIDEO_GPU_CLOUD_TYPE || "ALL").trim();
const VIDEO_GPU_COUNT = parseInt(process.env.VIDEO_GPU_COUNT || "1", 10);
const VIDEO_GPU_FALLBACK_ON_FAIL =
  String(process.env.VIDEO_GPU_FALLBACK_ON_FAIL || "1") === "1";

// -------------------- ENV: Worker --------------------
const WORKER_PORT = parseInt(process.env.WORKER_PORT || "8000", 10);
const WORKER_HEALTH_PATH = process.env.WORKER_HEALTH_PATH || "/health";
const WORKER_ASYNC_PATH = process.env.WORKER_ASYNC_PATH || "/api/video_async";

// -------------------- Timeouts (rápidos) --------------------
// Si quieres aún más agresivo: baja a 45-60s, pero 90s suele ser estable.
const WAIT_RUNNING_TIMEOUT_MS = parseInt(
  process.env.WAIT_RUNNING_TIMEOUT_MS || String(90 * 1000),
  10
);
const WAIT_RUNNING_INTERVAL_MS = parseInt(
  process.env.WAIT_RUNNING_INTERVAL_MS || "2500",
  10
);

const WAIT_WORKER_TIMEOUT_MS = parseInt(
  process.env.WAIT_WORKER_TIMEOUT_MS || String(90 * 1000),
  10
);
const WAIT_WORKER_INTERVAL_MS = parseInt(
  process.env.WAIT_WORKER_INTERVAL_MS || "2500",
  10
);

// lock corto para “wake”
const WAKE_LOCK_SECONDS = parseInt(process.env.WAKE_LOCK_SECONDS || "60", 10);

// -------------------- Tablas --------------------
const POD_STATE_TABLE = process.env.POD_STATE_TABLE || "pod_state";
const POD_LOCK_TABLE = process.env.POD_LOCK_TABLE || "pod_lock";
const VIDEO_JOBS_TABLE = process.env.VIDEO_JOBS_TABLE || "video_jobs";

const ACTIVE_STATUSES = [
  "PENDING",
  "IN_QUEUE",
  "QUEUED",
  "DISPATCHED",
  "IN_PROGRESS",
  "RUNNING",
];

// ============================================================
// Helpers
// ============================================================
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

function softRetryResponse(res, reason, details = {}) {
  // Mensaje NO rojo: el frontend lo puede renderizar como “Intenta de nuevo”
  return res.status(200).json({
    ok: true,
    status: "RETRY",
    message: "Intenta de nuevo",
    reason,
    ...details,
  });
}

// ============================================================
// RunPod REST helpers
// ============================================================
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

// terminate inmediato (y fallback DELETE)
async function runpodTerminatePod(podId) {
  // POST /terminate
  const r1 = await fetch(`https://rest.runpod.io/v1/pods/${podId}/terminate`, {
    method: "POST",
    headers: runpodHeaders(),
  });
  if (r1.ok) return true;

  // DELETE /pods/{id}
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

    if (status.includes("RUNNING")) return { ok: true, status, pod };

    // si falla fuerte -> corto
    if (status.includes("FAILED") || status.includes("ERROR")) {
      return { ok: false, status, error: "Pod entró en FAILED/ERROR", pod };
    }

    await sleep(WAIT_RUNNING_INTERVAL_MS);
  }
  return { ok: false, status: "TIMEOUT", error: "Pod no llegó a RUNNING a tiempo" };
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

  return { ok: false, error: "Worker no respondió a tiempo", url };
}

// ============================================================
// LOCK (atómico) — pod_lock.id=1
// ============================================================
async function ensureLockRow(sb) {
  const { data, error } = await sb.from(POD_LOCK_TABLE).select("id").eq("id", 1).maybeSingle();
  if (error) throw error;
  if (data) return true;

  const { error: insErr } = await sb.from(POD_LOCK_TABLE).insert([
    { id: 1, locked_until: new Date(0).toISOString() },
  ]);

  if (insErr) {
    const msg = String(insErr?.message || insErr);
    if (!msg.toLowerCase().includes("duplicate")) throw insErr;
  }
  return true;
}

async function tryAcquireLockAtomic(sb, seconds = 60) {
  await ensureLockRow(sb);

  const now = new Date();
  const until = new Date(now.getTime() + seconds * 1000);

  const nowIso = now.toISOString();

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
  const { error } = await sb.from(POD_LOCK_TABLE).update({ locked_until: pastIso }).eq("id", 1);
  if (error) throw error;
}

// ============================================================
// Crear pod desde template (preferencia GPU + fallback)
// ============================================================
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
  try {
    json = JSON.parse(t);
  } catch {
    json = { raw: t };
  }

  const podId =
    json?.id || json?.podId || json?.pod?.id || json?.data?.id || null;

  if (!podId) throw new Error(`RunPod create no devolvió podId. Respuesta: ${t}`);
  return { podId, raw: json };
}

async function runpodCreatePodFromTemplate({ name, log }) {
  if (!VIDEO_RUNPOD_TEMPLATE_ID) throw new Error("Falta VIDEO_RUNPOD_TEMPLATE_ID");
  if (!VIDEO_RUNPOD_NETWORK_VOLUME_ID) throw new Error("Falta VIDEO_RUNPOD_NETWORK_VOLUME_ID");

  const gpuTypeIds = parseGpuTypeList();

  const basePayload = {
    name,
    templateId: VIDEO_RUNPOD_TEMPLATE_ID,
    networkVolumeId: VIDEO_RUNPOD_NETWORK_VOLUME_ID,
    volumeMountPath: VIDEO_VOLUME_MOUNT_PATH,
    ports: ["8000/http", "8888/http"],
    gpuCount: VIDEO_GPU_COUNT,
  };

  const attempts = [];

  attempts.push({
    label: "PREFERRED_GPU",
    payload: {
      ...basePayload,
      cloudType: VIDEO_GPU_CLOUD_TYPE || "ALL",
      ...(gpuTypeIds ? { gpuTypeIds } : {}),
    },
  });

  if (VIDEO_GPU_FALLBACK_ON_FAIL) {
    attempts.push({
      label: "FALLBACK_CLOUD_ONLY",
      payload: { ...basePayload, cloudType: VIDEO_GPU_CLOUD_TYPE || "ALL" },
    });
    attempts.push({
      label: "FALLBACK_PLAIN",
      payload: { ...basePayload },
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
      return { ...created, attempt: a.label };
    } catch (e) {
      lastErr = e;
      if (log) log(`createPod failed attempt=${a.label}`, String(e?.message || e));
      if (!VIDEO_GPU_FALLBACK_ON_FAIL) throw e;
    }
  }

  throw lastErr || new Error("RunPod create failed: sin detalle");
}

// ============================================================
// ensureWorkingPod (REGLA: 1 pod, si falla => TERMINATE y recrea)
// ============================================================
async function ensureWorkingPod(sb, log) {
  const nowIso = new Date().toISOString();

  const { data: podState, error: psErr } = await sb
    .from(POD_STATE_TABLE)
    .select("*")
    .eq("id", 1)
    .single();

  if (psErr) throw psErr;

  const statePodId = String(podState?.pod_id || "").trim();

  async function touch(patch) {
    await sb.from(POD_STATE_TABLE).update({ ...patch, updated_at: nowIso }).eq("id", 1);
  }

  // helper: valida que el pod exista y worker esté listo RÁPIDO
  async function validatePodOrThrow(podId) {
    // start best-effort
    const st = await runpodStartPod(podId);
    if (st !== true) log("warn=startPod failed (ignored)", st);

    const running = await waitForRunning(podId);
    if (!running.ok) {
      const err = new Error(`Pod no RUNNING: ${running.error || running.status}`);
      err.code = "POD_NOT_RUNNING";
      throw err;
    }

    const ready = await waitForWorker(podId);
    if (!ready.ok) {
      const err = new Error(`Worker no listo: ${ready.error}`);
      err.code = "WORKER_NOT_READY";
      throw err;
    }

    return { workerUrl: workerBaseUrl(podId) };
  }

  // 1) Si no hay pod => crear
  if (!statePodId) {
    // crear -> start -> wait -> health
    const created = await runpodCreatePodFromTemplate({
      name: `isabela-video-${Date.now()}`,
      log,
    });

    await touch({ pod_id: created.podId, status: "STARTING", busy: false, last_used_at: nowIso });

    try {
      const v = await validatePodOrThrow(created.podId);
      await touch({ status: "RUNNING", busy: false, worker_url: v.workerUrl, last_used_at: nowIso });
      return { podId: created.podId, workerUrl: v.workerUrl, action: "CREATED" };
    } catch (e) {
      // si el nuevo falló, terminate inmediato
      try { await runpodTerminatePod(created.podId); } catch (_) {}
      await touch({
        pod_id: null,
        worker_url: null,
        status: "IDLE",
        busy: false,
        last_error: `Create pod failed: ${String(e?.message || e)}`,
        last_used_at: nowIso,
      });

      // Propaga para que el handler responda "RETRY"
      throw e;
    }
  }

  // 2) Hay pod guardado => validar rápido. Si falla => terminate y recrea
  try {
    await runpodGetPod(statePodId);
    const v = await validatePodOrThrow(statePodId);
    await touch({ status: "RUNNING", busy: false, worker_url: v.workerUrl, last_used_at: nowIso });
    return { podId: statePodId, workerUrl: v.workerUrl, action: "REUSED" };
  } catch (e) {
    const msg = String(e?.message || e);
    log("ensureWorkingPod: existing pod failed -> TERMINATE & recreate", statePodId, msg);

    // TERMINATE inmediato el viejo
    try { await runpodTerminatePod(statePodId); } catch (_) {}

    // limpia estado para evitar pods fantasmas
    await touch({
      pod_id: null,
      worker_url: null,
      status: "IDLE",
      busy: false,
      last_error: `Old pod terminated: ${msg}`,
      last_used_at: nowIso,
    });

    // recrea (1 intento)
    const created = await runpodCreatePodFromTemplate({
      name: `isabela-video-${Date.now()}`,
      log,
    });

    await touch({ pod_id: created.podId, status: "STARTING", busy: false, last_used_at: nowIso });

    try {
      const v2 = await validatePodOrThrow(created.podId);
      await touch({ status: "RUNNING", busy: false, worker_url: v2.workerUrl, last_used_at: nowIso });
      return { podId: created.podId, workerUrl: v2.workerUrl, action: "RECREATED" };
    } catch (e2) {
      // si recreación falla -> terminate y dejar limpio
      try { await runpodTerminatePod(created.podId); } catch (_) {}
      await touch({
        pod_id: null,
        worker_url: null,
        status: "IDLE",
        busy: false,
        last_error: `Recreate pod failed: ${String(e2?.message || e2)}`,
        last_used_at: nowIso,
      });
      throw e2;
    }
  }
}

// ============================================================
// 1) Buscar job activo del usuario (no duplicar)
// ============================================================
async function getActiveJobForUser(sb, user_id, mode = null) {
  let q = sb
    .from(VIDEO_JOBS_TABLE)
    .select("id,job_id,status,progress,eta_seconds,queue_position,video_url,error,created_at,updated_at,payload")
    .eq("user_id", user_id)
    .in("status", ACTIVE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1);

  if (mode) q = q.eq("payload->>mode", mode);

  const { data, error } = await q;
  if (error) throw error;
  return data?.[0] || null;
}

// ============================================================
// Prompt Optimizer support
// ============================================================
function pickFinalPrompts(body) {
  const prompt = String(body?.prompt || "").trim();
  const negative = String(body?.negative_prompt || body?.negative || "").trim();

  const useOptimized = body?.use_optimized === true || body?.useOptimized === true;

  const optPrompt = String(body?.optimized_prompt || body?.optimizedPrompt || "").trim();
  const optNeg = String(
    body?.optimized_negative_prompt || body?.optimizedNegativePrompt || ""
  ).trim();

  const usingOptimized = Boolean(useOptimized && optPrompt);
  const finalPrompt = usingOptimized ? optPrompt : prompt;
  const finalNegative = usingOptimized ? optNeg : negative;

  return { finalPrompt, finalNegative, usingOptimized };
}

// ============================================================
// Handler principal
// ============================================================
export default async function handler(req, res) {
  const log = (...args) => console.log("[GV]", ...args);

  let lockAcquired = false;
  let sb = null;

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

    const {
      mode = "t2v",
      steps = null,
      height = null,
      width = null,
      num_frames = null,
      fps = null,
      guidance_scale = null,
      image_base64 = null,
    } = body;

    const { finalPrompt, finalNegative, usingOptimized } = pickFinalPrompts(body);

    if (!finalPrompt) {
      return res.status(400).json({ ok: false, error: "Falta prompt" });
    }

    sb = sbAdmin();

    // A) Si ya hay job activo, devolvelo
    const active = await getActiveJobForUser(sb, user_id, mode);
    if (active) {
      return res.status(200).json({
        ok: true,
        status: "ALREADY_RUNNING",
        job_id: active.job_id || active.id,
        job: active,
        using_optimized: usingOptimized,
        used_prompt: finalPrompt,
        used_negative_prompt: finalNegative,
      });
    }

    // B) Lock SOLO para ensurePod
    log("step=LOCK_BEGIN");
    const lock = await tryAcquireLockAtomic(sb, WAKE_LOCK_SECONDS);
    if (!lock.ok) {
      // Respuesta suave, el frontend reintenta
      return res.status(200).json({
        ok: true,
        status: "LOCK_BUSY",
        retry_after_ms: 1500,
        message: "Intenta de nuevo",
        using_optimized: usingOptimized,
        used_prompt: finalPrompt,
        used_negative_prompt: finalNegative,
      });
    }

    lockAcquired = true;
    log("step=LOCK_OK", { locked_until: lock.locked_until });

    // C) Ensure pod (rápido). Si no hay GPU -> lo dejamos como RETRY.
    let podInfo = null;
    try {
      log("step=ENSURE_POD_BEGIN");
      podInfo = await ensureWorkingPod(sb, log);
      log("step=ENSURE_POD_OK", podInfo);
    } catch (e) {
      const msg = String(e?.message || e);
      log("step=ENSURE_POD_FAIL", msg);

      // liberar lock antes de salir
      try { await releaseLock(sb); } catch (_) {}
      lockAcquired = false;

      // ✅ respuesta suave (no error rojo)
      return softRetryResponse(res, "NO_GPU_OR_POD_START_FAILED", {
        debug: msg,
        retry_after_ms: 2500,
      });
    }

    // D) Liberar lock YA
    await releaseLock(sb);
    lockAcquired = false;
    log("step=LOCK_RELEASED");

    // E) Marcar pod_state busy mientras se despacha
    const nowIso = new Date().toISOString();
    await sb.from(POD_STATE_TABLE).update({
      status: "BUSY",
      busy: true,
      last_used_at: nowIso,
      updated_at: nowIso,
    }).eq("id", 1);

    // F) Dispatch ASYNC al worker
    const podId = podInfo.podId;
    const dispatchUrl = `${podInfo.workerUrl}${WORKER_ASYNC_PATH}`;

    const payload = {
      user_id,
      mode, // "t2v" o "i2v" si lo usas aquí también
      prompt: finalPrompt,
      negative_prompt: finalNegative,
      steps,
      height,
      width,
      num_frames,
      fps,
      guidance_scale,
      image_base64,
    };

    log("step=DISPATCH_BEGIN", { dispatchUrl, mode });

    const rr = await fetch(dispatchUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const tt = await rr.text().catch(() => "");
    if (!rr.ok) {
      // si falla dispatch: TERMINATE inmediato y limpiar pod_state
      log("dispatch failed -> terminate", rr.status, tt.slice(0, 180));

      try { await runpodTerminatePod(podId); } catch (_) {}

      try {
        const cleanIso = new Date().toISOString();
        await sb.from(POD_STATE_TABLE).update({
          pod_id: null,
          worker_url: null,
          status: "IDLE",
          busy: false,
          last_error: `dispatch failed (${rr.status}) -> terminated pod ${podId}`,
          last_used_at: cleanIso,
          updated_at: cleanIso,
        }).eq("id", 1);
      } catch (_) {}

      // respuesta suave
      return softRetryResponse(res, "WORKER_DISPATCH_FAILED", {
        retry_after_ms: 2500,
      });
    }

    let j = null;
    try {
      j = JSON.parse(tt);
    } catch {
      j = null;
    }

    const job_id = j?.job_id || j?.id || null;
    if (!job_id) {
      // Si worker no devolvió job_id, también terminamos para evitar pod colgado
      try { await runpodTerminatePod(podId); } catch (_) {}
      try {
        const cleanIso = new Date().toISOString();
        await sb.from(POD_STATE_TABLE).update({
          pod_id: null,
          worker_url: null,
          status: "IDLE",
          busy: false,
          last_error: `worker no devolvió job_id -> terminated pod ${podId}`,
          last_used_at: cleanIso,
          updated_at: cleanIso,
        }).eq("id", 1);
      } catch (_) {}

      return softRetryResponse(res, "WORKER_NO_JOB_ID", { retry_after_ms: 2500 });
    }

    // G) Ya despachado: pod_state vuelve a RUNNING (no busy)
    await sb.from(POD_STATE_TABLE).update({
      status: "RUNNING",
      busy: false,
      last_used_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", 1);

    return res.status(200).json({
      ok: true,
      status: "PENDING",
      job_id,
      pod: { podId, action: podInfo.action },
      dispatch: { ok: true, url: dispatchUrl },

      // UI
      using_optimized: usingOptimized,
      used_prompt: finalPrompt,
      used_negative_prompt: finalNegative,
    });
  } catch (e) {
    const msg = String(e?.message || e);
    console.error("[GV] fatal:", msg);

    // liberar lock si quedó tomado
    if (lockAcquired && sb) {
      try { await releaseLock(sb); } catch (_) {}
    }

    // no “rojo” si quieres: pero aquí sí es fatal real
    return res.status(500).json({ ok: false, error: msg });
  }
}