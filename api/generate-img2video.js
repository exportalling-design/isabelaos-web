// /api/generar-img2video.js
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

// =========================================================
// ENV (Supabase)
// =========================================================
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// =========================================================
// ENV (RunPod)
// =========================================================
const RUNPOD_API_KEY =
  process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY || null;

const VIDEO_RUNPOD_TEMPLATE_ID = process.env.VIDEO_RUNPOD_TEMPLATE_ID || null;

const VIDEO_RUNPOD_NETWORK_VOLUME_ID =
  process.env.VIDEO_RUNPOD_NETWORK_VOLUME_ID ||
  process.env.VIDEO_NETWORK_VOLUME_ID ||
  null;

const VIDEO_VOLUME_MOUNT_PATH = process.env.VIDEO_VOLUME_MOUNT_PATH || "/workspace";

const VIDEO_GPU_TYPE_IDS = (process.env.VIDEO_GPU_TYPE_IDS || "").trim();
const VIDEO_GPU_CLOUD_TYPE = (process.env.VIDEO_GPU_CLOUD_TYPE || "ALL").trim();
const VIDEO_GPU_COUNT = parseInt(process.env.VIDEO_GPU_COUNT || "1", 10);
const VIDEO_GPU_FALLBACK_ON_FAIL =
  String(process.env.VIDEO_GPU_FALLBACK_ON_FAIL || "1") === "1";

// =========================================================
// ENV (Worker)
// =========================================================
const WORKER_PORT = parseInt(process.env.WORKER_PORT || "8000", 10);
const WORKER_HEALTH_PATH = process.env.WORKER_HEALTH_PATH || "/health";
const WORKER_ASYNC_PATH = process.env.WORKER_ASYNC_PATH || "/api/video_async";

// =========================================================
// CAPS (si MAX=0 => sin cap)
// =========================================================
const MAX_STEPS_RAW = parseInt(process.env.VIDEO_MAX_STEPS || "25", 10);
const MAX_WIDTH_RAW = parseInt(process.env.VIDEO_MAX_WIDTH || "0", 10);
const MAX_HEIGHT_RAW = parseInt(process.env.VIDEO_MAX_HEIGHT || "0", 10);
const MAX_FRAMES_RAW = parseInt(process.env.VIDEO_MAX_FRAMES || "0", 10);
const MAX_FPS_RAW = parseInt(process.env.VIDEO_MAX_FPS || "0", 10);

const MAX_STEPS = MAX_STEPS_RAW > 0 ? MAX_STEPS_RAW : null;
const MAX_WIDTH = MAX_WIDTH_RAW > 0 ? MAX_WIDTH_RAW : null;
const MAX_HEIGHT = MAX_HEIGHT_RAW > 0 ? MAX_HEIGHT_RAW : null;
const MAX_FRAMES = MAX_FRAMES_RAW > 0 ? MAX_FRAMES_RAW : null;
const MAX_FPS = MAX_FPS_RAW > 0 ? MAX_FPS_RAW : null;

// =========================================================
// VIDEO DEFAULTS
// =========================================================
const DEF_WIDTH = parseInt(process.env.VIDEO_DEF_WIDTH || "896", 10);
const DEF_HEIGHT = parseInt(process.env.VIDEO_DEF_HEIGHT || "512", 10);
const DEF_FRAMES = parseInt(process.env.VIDEO_DEF_FRAMES || "49", 10);
const DEF_FPS = parseInt(process.env.VIDEO_DEF_FPS || "24", 10);
const DEF_GUIDANCE = Number(process.env.VIDEO_DEF_GUIDANCE || "6.0");

// =========================================================
// FAST TEST MODE
// =========================================================
const FAST_TEST_MODE = (process.env.VIDEO_FAST_TEST_MODE || "0") === "1";

// =========================================================
// JADES
// =========================================================
const COST_IMG2VIDEO_JADES = parseInt(process.env.COST_IMG2VIDEO_JADES || "25", 10);

// =========================================================
// Timeouts
// (Ponelos alineados a generate-video si querés, aquí están rápidos)
// =========================================================
const WAIT_WORKER_TIMEOUT_MS = parseInt(process.env.WAIT_WORKER_TIMEOUT_MS || "180000", 10);
const WAIT_WORKER_INTERVAL_MS = parseInt(process.env.WAIT_WORKER_INTERVAL_MS || "2500", 10);

const WAIT_RUNNING_TIMEOUT_MS = parseInt(process.env.WAIT_RUNNING_TIMEOUT_MS || "240000", 10);
const WAIT_RUNNING_INTERVAL_MS = parseInt(process.env.WAIT_RUNNING_INTERVAL_MS || "3500", 10);

const HEALTH_FETCH_TIMEOUT_MS = 6000;
const DISPATCH_TIMEOUT_MS = 15000;

const WAKE_LOCK_SECONDS = parseInt(process.env.WAKE_LOCK_SECONDS || "60", 10);

const POD_STATE_TABLE = process.env.POD_STATE_TABLE || "pod_state";
const POD_LOCK_TABLE = process.env.POD_LOCK_TABLE || "pod_lock";
const VIDEO_JOBS_TABLE = process.env.VIDEO_JOBS_TABLE || "video_jobs";

const ACTIVE_STATUSES = ["PENDING","IN_QUEUE","QUEUED","DISPATCHED","IN_PROGRESS","RUNNING"];

// =========================================================
// Helpers
// =========================================================
function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Falta SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Falta RUNPOD_API_KEY");
  return { Authorization: `Bearer ${RUNPOD_API_KEY}`, "Content-Type": "application/json" };
}

function workerBaseUrl(podId) {
  return `https://${podId}-${WORKER_PORT}.proxy.runpod.net`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(url, opts, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

// =========================================================
// RunPod REST helpers
// =========================================================
async function runpodGetPod(podId) {
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, {
    method: "GET",
    headers: runpodHeaders(),
  });
  const t = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`RunPod get pod falló (${r.status}): ${t}`);
  try { return JSON.parse(t); } catch { return { raw: t }; }
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
    const st = String(pod?.desiredStatus || pod?.status || pod?.pod?.status || "").toUpperCase();

    if (st.includes("RUNNING")) return { ok: true, status: st };
    if (st.includes("FAILED") || st.includes("ERROR")) {
      return { ok: false, status: st, error: "Pod entró en FAILED/ERROR" };
    }
    await sleep(WAIT_RUNNING_INTERVAL_MS);
  }
  return { ok: false, status: "TIMEOUT", error: "Pod no llegó a RUNNING a tiempo" };
}

async function waitForWorker(podId) {
  const url = `${workerBaseUrl(podId)}${WORKER_HEALTH_PATH}`;
  const start = Date.now();

  while (Date.now() - start < WAIT_WORKER_TIMEOUT_MS) {
    try {
      const r = await fetchWithTimeout(url, { method: "GET" }, HEALTH_FETCH_TIMEOUT_MS);
      if (r.ok) return { ok: true, url };
    } catch (_) {}
    await sleep(WAIT_WORKER_INTERVAL_MS);
  }
  return { ok: false, error: "Worker no respondió a tiempo", url };
}

// =========================================================
// Supabase: pod_state + lock + jobs
// =========================================================
async function getPodState(sb) {
  const { data, error } = await sb.from(POD_STATE_TABLE).select("*").eq("id", 1).single();
  if (error) throw error;
  return data;
}

async function patchPodState(sb, patch) {
  const { error } = await sb.from(POD_STATE_TABLE).update(patch).eq("id", 1);
  if (error) throw error;
}

async function tryAcquireLockAtomic(sb, seconds = 60) {
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

async function getActiveJobForUserI2V(sb, user_id) {
  const { data, error } = await sb
    .from(VIDEO_JOBS_TABLE)
    .select("*")
    .eq("user_id", user_id)
    .in("status", ACTIVE_STATUSES)
    .eq("payload->>mode", "i2v")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return data?.[0] || null;
}

async function createVideoJob(sb, row) {
  const { error } = await sb.from(VIDEO_JOBS_TABLE).insert([row]);
  if (error) throw new Error(`createVideoJob failed: ${error.message}`);
}

async function updateVideoJob(sb, job_id, patch) {
  const { error } = await sb.from(VIDEO_JOBS_TABLE).update(patch).eq("job_id", job_id);
  if (error) throw new Error(`updateVideoJob failed: ${error.message}`);
}

// =========================================================
// Create pod from template (igual que generate-video)
// =========================================================
function parseGpuTypeList() {
  if (!VIDEO_GPU_TYPE_IDS) return null;
  const arr = VIDEO_GPU_TYPE_IDS.split(",").map((s) => s.trim()).filter(Boolean);
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
      log?.("createPod attempt", a.label, {
        hasGpuTypeIds: Boolean(a.payload.gpuTypeIds),
        cloudType: a.payload.cloudType || null,
        gpuCount: a.payload.gpuCount,
      });
      const created = await runpodCreatePodOnce(a.payload);
      return { ...created, attempt: a.label, used: a.payload };
    } catch (e) {
      lastErr = e;
      log?.("createPod failed", a.label, String(e?.message || e));
      if (!VIDEO_GPU_FALLBACK_ON_FAIL) throw e;
    }
  }

  throw lastErr || new Error("RunPod create failed: sin detalle");
}

// =========================================================
// ensureWorkingPod (MISMA FILOSOFIA de generate-video)
// - si pod_state vacío => crea
// - si existe => start+wait
// - si falla => recrea (y termina el viejo)
// - si 404 => stale => recrea
// =========================================================
async function ensureWorkingPod(sb, log) {
  const nowIso = new Date().toISOString();

  const podState = await getPodState(sb);
  const statePodId = String(podState?.pod_id || "").trim();

  async function touch(status, busy = false) {
    await patchPodState(sb, { status, last_used_at: nowIso, busy });
  }

  async function setPod(podId) {
    await patchPodState(sb, {
      pod_id: podId,
      status: "STARTING",
      last_used_at: nowIso,
      busy: false,
      worker_url: workerBaseUrl(podId),
    });
  }

  async function createStartWait() {
    const created = await runpodCreatePodFromTemplate({
      name: `isabela-video-${Date.now()}`,
      log,
    });

    await setPod(created.podId);

    const st = await runpodStartPod(created.podId);
    if (st !== true) log?.("warn=startPod failed (ignored)", st);

    const running = await waitForRunning(created.podId);
    if (!running.ok) throw new Error(`Pod nuevo no RUNNING: ${running.error || running.status}`);

    const ready = await waitForWorker(created.podId);
    if (!ready.ok) throw new Error(`Worker no listo tras crear pod: ${ready.error}`);

    await touch("RUNNING", false);
    return { podId: created.podId, workerUrl: workerBaseUrl(created.podId), action: "CREADO_Y_LISTO", attempt: created.attempt };
  }

  // 1) no hay pod => crea
  if (!statePodId) {
    return await createStartWait();
  }

  // 2) hay pod => validar existencia
  try {
    await runpodGetPod(statePodId);
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.includes("(404)") || msg.includes("404")) {
      log?.("stale pod 404 -> recreo", statePodId);
      await patchPodState(sb, { pod_id: null, worker_url: null, status: "IDLE", busy: false, last_used_at: nowIso });
      return await createStartWait();
    }
    throw e;
  }

  // 3) arrancar y esperar
  try {
    const st = await runpodStartPod(statePodId);
    if (st !== true) log?.("warn=startPod failed (ignored)", st);

    const running = await waitForRunning(statePodId);
    if (!running.ok) throw new Error(`Pod no RUNNING: ${running.error || running.status}`);

    const ready = await waitForWorker(statePodId);
    if (!ready.ok) throw new Error(`Worker no respondió en pod existente: ${ready.error}`);

    await patchPodState(sb, { worker_url: workerBaseUrl(statePodId) });
    await touch("RUNNING", false);
    return { podId: statePodId, workerUrl: workerBaseUrl(statePodId), action: "REUSADO" };
  } catch (e) {
    const msg = String(e?.message || e);
    log?.("pod existente falló -> recreo", msg);

    const oldPodId = statePodId;

    const created = await createStartWait();

    await runpodTerminatePod(oldPodId).catch(() => {});
    return { ...created, action: "RECREADO", oldPodId };
  }
}

// =========================================================
// (Opcional) Cobro jades: aquí lo dejo como stub igual a tu script
// =========================================================
async function spendJadesOrThrow(sb, user_id, amount, reason, ref) {
  if (!user_id) throw new Error("Missing user_id for billing");
  if (!amount || amount <= 0) return true;
  // aquí conectas tu RPC real si quieres
  return true;
}

// =========================================================
// MAIN
// =========================================================
export default async function handler(req, res) {
  const log = (...args) => console.log("[I2V]", ...args);

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  const sb = sbAdmin();
  let lockAcquired = false;

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    const user_id = auth.user.id;

    // A) si ya hay job i2v activo => devolverlo
    const activeI2V = await getActiveJobForUserI2V(sb, user_id);
    if (activeI2V) {
      return res.status(200).json({
        ok: true,
        status: "ALREADY_RUNNING",
        job_id: activeI2V.job_id,
        job: activeI2V,
      });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    const image_base64 =
      body.image_base64 ||
      body.imageBase64 ||
      body.image_b64 ||
      body.image_b64_raw ||
      body.image_b64_pure ||
      body.dataUrl ||
      body.data_url ||
      null;

    const image_url = body.image_url || body.imageUrl || body.imageURL || null;

    if (!image_base64 && !image_url) {
      return res.status(400).json({
        ok: false,
        error: "Missing image_base64 or image_url",
        receivedKeys: Object.keys(body || {}),
      });
    }

    const normalizedImageB64 = image_base64
      ? (String(image_base64).startsWith("data:")
          ? String(image_base64)
          : `data:image/jpeg;base64,${String(image_base64)}`)
      : null;

    // caps/params
    const requestedSteps =
      typeof body.steps === "number"
        ? body.steps
        : typeof body.num_inference_steps === "number"
        ? body.num_inference_steps
        : null;

    const safeSteps =
      requestedSteps == null ? (MAX_STEPS ?? 25) : (MAX_STEPS ? Math.min(requestedSteps, MAX_STEPS) : requestedSteps);

    const widthRaw = typeof body.width === "number" ? body.width : DEF_WIDTH;
    const heightRaw = typeof body.height === "number" ? body.height : DEF_HEIGHT;
    const framesRaw = typeof body.num_frames === "number" ? body.num_frames : DEF_FRAMES;
    const fpsRaw = typeof body.fps === "number" ? body.fps : DEF_FPS;

    const width = MAX_WIDTH ? Math.min(widthRaw, MAX_WIDTH) : widthRaw;
    const height = MAX_HEIGHT ? Math.min(heightRaw, MAX_HEIGHT) : heightRaw;
    const num_frames = MAX_FRAMES ? Math.min(framesRaw, MAX_FRAMES) : framesRaw;
    const fps = MAX_FPS ? Math.min(fpsRaw, MAX_FPS) : fpsRaw;

    const maybeFast = FAST_TEST_MODE
      ? { steps: Math.min(safeSteps, 8), num_frames: 8, fps: 6, width: 384, height: 672 }
      : { steps: safeSteps };

    // ✅ Clave: mode=i2v para que el worker use el modelo correcto
    const payload = {
      user_id,
      mode: "i2v",
      prompt: body.prompt || "",
      negative_prompt: body.negative_prompt || body.negative || "",
      width,
      height,
      num_frames,
      fps,
      guidance_scale: body.guidance_scale ?? DEF_GUIDANCE,
      image_base64: normalizedImageB64,
      image_url: image_url || null,
      ...maybeFast,
    };

    // cobro si no viene already_billed
    const alreadyBilled = body.already_billed === true;
    if (!alreadyBilled) {
      await spendJadesOrThrow(sb, user_id, COST_IMG2VIDEO_JADES, "generation:img2video", body.ref || null);
    }

    // B) Lock solo para ensure pod
    const lock = await tryAcquireLockAtomic(sb, WAKE_LOCK_SECONDS);
    if (!lock.ok) {
      return res.status(200).json({
        ok: true,
        status: "LOCK_BUSY",
        retry_after_ms: 2500,
        message: "El sistema está iniciando otro pod. Intenta de nuevo.",
      });
    }
    lockAcquired = true;

    // C) Ensure pod (MISMA LOGICA de generate-video)
    const ensured = await ensureWorkingPod(sb, log);

    // liberar lock ya
    await releaseLock(sb);
    lockAcquired = false;

    const job_id = crypto.randomUUID();

    await createVideoJob(sb, {
      job_id,
      user_id,
      status: "QUEUED",
      payload,
      pod_id: ensured.podId,
      worker_url: ensured.workerUrl,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const dispatchUrl = `${ensured.workerUrl}${WORKER_ASYNC_PATH}`;

    await patchPodState(sb, { status: "BUSY", busy: true, last_used_at: new Date().toISOString() });
    await updateVideoJob(sb, job_id, { status: "DISPATCHED", updated_at: new Date().toISOString() });

    const r = await fetchWithTimeout(
      dispatchUrl,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job_id, ...payload }) },
      DISPATCH_TIMEOUT_MS
    );

    const txt = await r.text().catch(() => "");
    if (r.status !== 202 && r.status !== 200) {
      await updateVideoJob(sb, job_id, {
        status: "ERROR",
        error: `Worker dispatch failed: ${r.status} ${txt.slice(0, 200)}`,
        updated_at: new Date().toISOString(),
      });

      // si dispatch falla => terminate para que el siguiente intento sea limpio
      await runpodTerminatePod(ensured.podId).catch(() => {});
      await patchPodState(sb, {
        pod_id: null,
        worker_url: null,
        status: "IDLE",
        busy: false,
        last_used_at: new Date().toISOString(),
      });

      return res.status(200).json({
        ok: false,
        retryable: true,
        status: "TRY_AGAIN",
        message: "No se pudo iniciar el worker. Intenta de nuevo.",
      });
    }

    await updateVideoJob(sb, job_id, { status: "IN_PROGRESS", updated_at: new Date().toISOString() }).catch(() => {});
    await patchPodState(sb, { status: "RUNNING", busy: false, last_used_at: new Date().toISOString() }).catch(() => {});

    return res.status(200).json({
      ok: true,
      job_id,
      status: "IN_PROGRESS",
      worker: ensured.workerUrl,
      billed: alreadyBilled ? { type: "FRONTEND", amount: 0 } : { type: "JADE", amount: COST_IMG2VIDEO_JADES },
    });
  } catch (e) {
    const msg = String(e?.message || e);

    // mensaje suave
    return res.status(200).json({
      ok: false,
      retryable: true,
      status: "TRY_AGAIN",
      message: "Intenta de nuevo.",
      debug: msg,
    });
  } finally {
    if (lockAcquired) {
      await releaseLock(sb).catch(() => {});
    }
  }
}