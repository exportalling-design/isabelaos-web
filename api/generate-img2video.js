// /api/generar-img2video.js
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

// =========================================================
// FORZAR SIEMPRE IMG2VIDEO (para que NO use el modelo T2V)
// =========================================================
const FORCED_MODE = "i2v"; // <- clave: nunca se toma del frontend

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
// Timeouts (RÁPIDO)
// =========================================================
const WAIT_RUNNING_TIMEOUT_MS = parseInt(process.env.WAIT_RUNNING_TIMEOUT_MS || "90000", 10); // 90s
const WAIT_RUNNING_INTERVAL_MS = parseInt(process.env.WAIT_RUNNING_INTERVAL_MS || "2500", 10);

const WAIT_WORKER_TIMEOUT_MS = parseInt(process.env.WAIT_WORKER_TIMEOUT_MS || "90000", 10); // 90s
const WAIT_WORKER_INTERVAL_MS = parseInt(process.env.WAIT_WORKER_INTERVAL_MS || "2500", 10);

const HEALTH_FETCH_TIMEOUT_MS = 6000;
const DISPATCH_TIMEOUT_MS = 15000;

const WAKE_LOCK_SECONDS = parseInt(process.env.WAKE_LOCK_SECONDS || "45", 10);

const POD_STATE_TABLE = process.env.POD_STATE_TABLE || "pod_state";
const POD_LOCK_TABLE = process.env.POD_LOCK_TABLE || "pod_lock";
const VIDEO_JOBS_TABLE = process.env.VIDEO_JOBS_TABLE || "video_jobs";

// =========================================================
// Helpers
// =========================================================
function sbAdmin() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase env missing (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY");
  return { Authorization: `Bearer ${RUNPOD_API_KEY}`, "Content-Type": "application/json" };
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

function workerBaseUrl(podId) {
  return `https://${podId}-${WORKER_PORT}.proxy.runpod.net`;
}

// =========================================================
// Supabase jobs
// =========================================================
async function getActiveJobForUserI2V(sb, user_id) {
  const { data, error } = await sb
    .from(VIDEO_JOBS_TABLE)
    .select("*")
    .eq("user_id", user_id)
    .in("status", ["QUEUED", "DISPATCHED", "IN_PROGRESS", "RUNNING", "PENDING", "IN_QUEUE"])
    .eq("payload->>mode", FORCED_MODE) // <- forzado
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) return null;
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
// LOCK (atómico) pod_lock.id=1
// =========================================================
async function tryAcquireLockAtomic(sb, seconds = 45) {
  const now = new Date();
  const until = new Date(now.getTime() + seconds * 1000);

  const { data, error } = await sb
    .from(POD_LOCK_TABLE)
    .update({ locked_until: until.toISOString() })
    .eq("id", 1)
    .lte("locked_until", now.toISOString())
    .select("locked_until")
    .maybeSingle();

  if (error) throw error;
  if (!data) return { ok: false, reason: "lock active" };
  return { ok: true, locked_until: data.locked_until };
}

async function releaseLock(sb) {
  const pastIso = new Date(Date.now() - 1000).toISOString();
  await sb.from(POD_LOCK_TABLE).update({ locked_until: pastIso }).eq("id", 1);
}

// =========================================================
// POD STATE helpers
// =========================================================
async function getPodState(sb) {
  const { data, error } = await sb.from(POD_STATE_TABLE).select("*").eq("id", 1).maybeSingle();
  if (error) return null;
  return data || null;
}

async function patchPodState(sb, patch) {
  const { error } = await sb.from(POD_STATE_TABLE).update(patch).eq("id", 1);
  if (error) throw new Error(`pod_state update failed: ${error.message}`);
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
  if (!r.ok) throw new Error(`RunPod get pod failed (${r.status}): ${t}`);
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
  throw new Error(`RunPod terminate failed: ${t}`);
}

async function waitForRunning(podId) {
  const start = Date.now();
  while (Date.now() - start < WAIT_RUNNING_TIMEOUT_MS) {
    const pod = await runpodGetPod(podId);
    const st = String(pod?.desiredStatus || pod?.status || pod?.pod?.status || "").toUpperCase();

    if (st.includes("RUNNING")) return { ok: true, status: st };
    if (st.includes("FAILED") || st.includes("ERROR")) return { ok: false, status: st, error: "FAILED/ERROR" };

    await sleep(WAIT_RUNNING_INTERVAL_MS);
  }
  return { ok: false, status: "TIMEOUT", error: "RUNNING timeout" };
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
  return { ok: false, error: "WORKER timeout", url };
}

// =========================================================
// Create Pod (template + GPU preference + fallback)
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
  const json = JSON.parse(t);
  const podId = json?.id || json?.podId || json?.pod?.id || json?.data?.id || null;
  if (!podId) throw new Error(`RunPod create did not return podId: ${t}`);
  return { podId, raw: json };
}

async function runpodCreatePodFromTemplate({ name, log }) {
  if (!VIDEO_RUNPOD_TEMPLATE_ID) throw new Error("Missing VIDEO_RUNPOD_TEMPLATE_ID");
  if (!VIDEO_RUNPOD_NETWORK_VOLUME_ID) throw new Error("Missing VIDEO_RUNPOD_NETWORK_VOLUME_ID");

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
    attempts.push({ label: "FALLBACK_CLOUD_ONLY", payload: { ...basePayload, cloudType: VIDEO_GPU_CLOUD_TYPE || "ALL" } });
    attempts.push({ label: "FALLBACK_PLAIN", payload: { ...basePayload } });
  }

  let lastErr = null;
  for (const a of attempts) {
    try {
      log?.("createPod attempt", a.label);
      const created = await runpodCreatePodOnce(a.payload);
      return { ...created, attempt: a.label };
    } catch (e) {
      lastErr = e;
      log?.("createPod failed", a.label, String(e?.message || e));
      if (!VIDEO_GPU_FALLBACK_ON_FAIL) throw e;
    }
  }
  throw lastErr || new Error("RunPod create failed");
}

// =========================================================
// Ensure pod (fail-fast). NO crea 2 pods en un mismo request.
// =========================================================
async function ensureWorkingPodFast(sb, log) {
  const nowIso = new Date().toISOString();
  const ps = await getPodState(sb);

  const statePodId = String(ps?.pod_id || "").trim();

  async function clearStateWithError(msg) {
    await patchPodState(sb, {
      pod_id: null,
      worker_url: null,
      status: "IDLE",
      busy: false,
      last_error: msg,
      last_used_at: nowIso,
    });
  }

  if (!statePodId) {
    const created = await runpodCreatePodFromTemplate({ name: `isabela-video-${Date.now()}`, log });
    await patchPodState(sb, { pod_id: created.podId, status: "STARTING", busy: false, last_used_at: nowIso });

    const st = await runpodStartPod(created.podId);
    if (st !== true) log?.("warn startPod", st);

    const running = await waitForRunning(created.podId);
    if (!running.ok) {
      await runpodTerminatePod(created.podId).catch(() => {});
      await clearStateWithError(`new pod not RUNNING: ${running.error || running.status}`);
      const err = new Error("No hay GPU disponible ahora. Intenta de nuevo.");
      err.retryable = true;
      throw err;
    }

    const ready = await waitForWorker(created.podId);
    if (!ready.ok) {
      await runpodTerminatePod(created.podId).catch(() => {});
      await clearStateWithError(`new pod worker not ready: ${ready.error}`);
      const err = new Error("El pod no terminó de iniciar. Intenta de nuevo.");
      err.retryable = true;
      throw err;
    }

    const workerUrl = workerBaseUrl(created.podId);
    await patchPodState(sb, { status: "RUNNING", worker_url: workerUrl, busy: false, last_used_at: nowIso });

    return { podId: created.podId, workerUrl, action: "CREATED" };
  }

  try {
    await runpodGetPod(statePodId);

    const st = await runpodStartPod(statePodId);
    if (st !== true) log?.("warn startPod", st);

    const running = await waitForRunning(statePodId);
    if (!running.ok) throw new Error(`pod not RUNNING: ${running.error || running.status}`);

    const ready = await waitForWorker(statePodId);
    if (!ready.ok) throw new Error(`worker not ready: ${ready.error}`);

    const workerUrl = ps?.worker_url || workerBaseUrl(statePodId);
    await patchPodState(sb, { status: "RUNNING", worker_url: workerUrl, busy: false, last_used_at: nowIso });

    return { podId: statePodId, workerUrl, action: "REUSED" };
  } catch (e) {
    const msg = String(e?.message || e);
    log?.("ensureWorkingPodFast failed -> terminate & clear", msg);

    await runpodTerminatePod(statePodId).catch(() => {});
    await patchPodState(sb, {
      pod_id: null,
      worker_url: null,
      status: "IDLE",
      busy: false,
      last_error: `terminated bad pod: ${msg}`,
      last_used_at: nowIso,
    });

    const err = new Error("El pod falló al iniciar. Intenta de nuevo.");
    err.retryable = true;
    throw err;
  }
}

// =========================================================
// Jades spending (NO invento tu RPC aquí)
// =========================================================
async function spendJadesOrThrow(sb, user_id, amount, reason, ref) {
  if (!user_id) throw new Error("Missing user_id for billing");
  if (!amount || amount <= 0) return true;

  // Si ya tienes RPC, descomenta y ajusta nombres:
  // const { data, error } = await sb.rpc("spend_jades", {
  //   p_user_id: user_id,
  //   p_amount: amount,
  //   p_reason: reason,
  //   p_ref: ref,
  // });
  // if (error) throw new Error(error.message);

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

    // ✅ BLOQUEO: si el frontend intenta mandar "mode", se ignora. Siempre i2v.
    // (esto evita que por error el worker abra t2v)
    // const clientMode = body.mode; // <- NO SE USA

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

    // =====================================================
    // ✅ PAYLOAD FORZADO A IMG2VIDEO:
    // - mode: "i2v" siempre
    // - model_hint / pipeline_hint: ayuda al worker a NO abrir T2V
    //   (si tu worker no usa estos campos, no estorban)
    // =====================================================
    const payload = {
      user_id,
      mode: FORCED_MODE,
      model_hint: "img2video",
      pipeline_hint: "i2v",
      force_i2v: true,

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

    const alreadyBilled = body.already_billed === true;
    if (!alreadyBilled) {
      await spendJadesOrThrow(sb, user_id, COST_IMG2VIDEO_JADES, "generation:img2video", body.ref || null);
    }

    const lock = await tryAcquireLockAtomic(sb, WAKE_LOCK_SECONDS);
    if (!lock.ok) {
      return res.status(200).json({
        ok: true,
        status: "LOCK_BUSY",
        retry_after_ms: 1500,
        message: "El sistema está iniciando otro pod. Intenta de nuevo.",
      });
    }
    lockAcquired = true;

    let ensured = null;
    try {
      ensured = await ensureWorkingPodFast(sb, log);
    } finally {
      await releaseLock(sb).catch(() => {});
      lockAcquired = false;
    }

    const job_id = crypto.randomUUID();

    await createVideoJob(sb, {
      job_id,
      user_id,
      status: "QUEUED",
      payload, // <- queda guardado con mode=i2v
      pod_id: ensured.podId,
      worker_url: ensured.workerUrl,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const dispatchUrl = `${ensured.workerUrl}${WORKER_ASYNC_PATH}`;

    await patchPodState(sb, { status: "BUSY", busy: true, last_used_at: new Date().toISOString() });
    await updateVideoJob(sb, job_id, { status: "DISPATCHED", updated_at: new Date().toISOString() });

    // ✅ DISPATCH: también forzamos mode=i2v en el POST (por si el worker usa body.mode directo)
    const dispatchBody = { job_id, ...payload, mode: FORCED_MODE };

    const r = await fetchWithTimeout(
      dispatchUrl,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dispatchBody) },
      DISPATCH_TIMEOUT_MS
    );

    const txt = await r.text().catch(() => "");
    if (r.status !== 202 && r.status !== 200) {
      await updateVideoJob(sb, job_id, {
        status: "ERROR",
        error: `Worker dispatch failed: ${r.status} ${txt.slice(0, 200)}`,
        updated_at: new Date().toISOString(),
      });

      await runpodTerminatePod(ensured.podId).catch(() => {});
      await patchPodState(sb, {
        pod_id: null,
        worker_url: null,
        status: "IDLE",
        busy: false,
        last_error: `dispatch failed -> terminated pod ${ensured.podId}`,
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
      mode: FORCED_MODE,
    });
  } catch (e) {
    const msg = String(e?.message || e);
    const retryable = Boolean(e?.retryable);

    return res.status(200).json({
      ok: false,
      retryable,
      status: "TRY_AGAIN",
      message: retryable ? msg : "Ocurrió un error. Intenta de nuevo.",
      error: retryable ? null : msg,
    });
  } finally {
    if (lockAcquired) {
      await releaseLock(sb).catch(() => {});
    }
  }
}