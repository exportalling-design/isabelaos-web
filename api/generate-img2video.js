// /api/generar-img2video.js
import { createClient } from "@supabase/supabase-js";

// =====================
// ENV (RunPod)
// =====================
const RUNPOD_API_KEY =
  process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY || null;

const VIDEO_RUNPOD_TEMPLATE_ID = process.env.VIDEO_RUNPOD_TEMPLATE_ID || null;

const VIDEO_RUNPOD_NETWORK_VOLUME_ID =
  process.env.VIDEO_RUNPOD_NETWORK_VOLUME_ID ||
  process.env.VIDEO_NETWORK_VOLUME_ID ||
  null;

const VIDEO_VOLUME_MOUNT_PATH = process.env.VIDEO_VOLUME_MOUNT_PATH || "/workspace";

const VIDEO_GPU_TYPE_IDS = (process.env.VIDEO_GPU_TYPE_IDS || "").trim(); // "A100_SXM,H100_PCIe" etc
const VIDEO_GPU_CLOUD_TYPE = (process.env.VIDEO_GPU_CLOUD_TYPE || "ALL").trim();
const VIDEO_GPU_COUNT = parseInt(process.env.VIDEO_GPU_COUNT || "1", 10);

const VIDEO_GPU_FALLBACK_ON_FAIL =
  String(process.env.VIDEO_GPU_FALLBACK_ON_FAIL || "1") === "1";

// =====================
// ENV (Worker)
// =====================
const WORKER_PORT = parseInt(process.env.WORKER_PORT || "8000", 10);
const WORKER_HEALTH_PATH = process.env.WORKER_HEALTH_PATH || "/health";
const WORKER_ASYNC_PATH = process.env.WORKER_ASYNC_PATH || "/api/video_async";

// =====================
// CAPS (si MAX=0 => sin cap)
// =====================
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

// =====================
// VIDEO DEFAULTS (si frontend no manda)
// =====================
const DEF_WIDTH = parseInt(process.env.VIDEO_DEF_WIDTH || "896", 10);
const DEF_HEIGHT = parseInt(process.env.VIDEO_DEF_HEIGHT || "512", 10);
const DEF_FRAMES = parseInt(process.env.VIDEO_DEF_FRAMES || "49", 10);
const DEF_FPS = parseInt(process.env.VIDEO_DEF_FPS || "24", 10);
const DEF_GUIDANCE = Number(process.env.VIDEO_DEF_GUIDANCE || "6.0");

// =====================
// FAST TEST MODE
// =====================
const FAST_TEST_MODE = (process.env.VIDEO_FAST_TEST_MODE || "0") === "1";

// =====================
// Timeouts
// =====================
const LOCK_SECONDS = parseInt(process.env.WAKE_LOCK_SECONDS || "180", 10);

const READY_TIMEOUT_MS = parseInt(
  process.env.WAIT_RUNNING_TIMEOUT_MS || String(12 * 60 * 1000),
  10
);
const POLL_MS = parseInt(process.env.WAIT_RUNNING_INTERVAL_MS || "3000", 10);

const WORKER_READY_TIMEOUT_MS = parseInt(
  process.env.WAIT_WORKER_TIMEOUT_MS || String(10 * 60 * 1000),
  10
);

const HEALTH_FETCH_TIMEOUT_MS = 8000;
const DISPATCH_TIMEOUT_MS = 15000;

// =====================
// Supabase
// =====================
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || null;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || null;

const VIDEO_JOBS_TABLE = process.env.VIDEO_JOBS_TABLE || "video_jobs";
const POD_STATE_TABLE = process.env.POD_STATE_TABLE || "pod_state";
const POD_STATE_ID = parseInt(process.env.POD_STATE_ID || "1", 10);

// job id field unificado
const JOB_ID_FIELD = process.env.JOB_ID_FIELD || "job_id";

// ---------------------
// helpers base
// ---------------------
function sbAdmin() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function clampInt(v, lo, hi, fallback) {
  const n = Number.parseInt(v, 10);
  const x = Number.isFinite(n) ? n : fallback;
  return Math.max(lo, Math.min(hi, x));
}

function capIfMax(val, maxOrNull) {
  if (!maxOrNull) return val;
  return Math.min(val, maxOrNull);
}

function readBearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  if (typeof h === "string" && h.toLowerCase().startsWith("bearer ")) {
    return h.slice(7).trim();
  }
  return null;
}

// intenta leer cookie típica de supabase (puede variar)
function readCookie(req, name) {
  const c = req.headers.cookie || "";
  if (!c) return null;
  const parts = c.split(";").map((x) => x.trim());
  for (const p of parts) {
    if (p.startsWith(name + "=")) return decodeURIComponent(p.slice(name.length + 1));
  }
  return null;
}

// ✅ ESTA ES LA PARTE QUE TE ESTÁ FALLANDO AHORA (adiós "not wired")
async function requireUser(req) {
  const token =
    readBearerToken(req) ||
    readCookie(req, "sb-access-token") ||
    readCookie(req, "sb:token") ||
    null;

  if (!token) {
    const e = new Error("Unauthorized: missing access token");
    e.statusCode = 401;
    throw e;
  }

  const sb = sbAdmin();
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) {
    const e = new Error("Unauthorized: invalid token");
    e.statusCode = 401;
    throw e;
  }
  return data.user;
}

async function upsertJob(sb, jobId, patch) {
  // intenta update; si no existe, insert
  const { data: existing } = await sb
    .from(VIDEO_JOBS_TABLE)
    .select(JOB_ID_FIELD)
    .eq(JOB_ID_FIELD, jobId)
    .limit(1);

  if (existing && existing.length) {
    await sb.from(VIDEO_JOBS_TABLE).update(patch).eq(JOB_ID_FIELD, jobId);
    return;
  }
  await sb.from(VIDEO_JOBS_TABLE).insert([{ [JOB_ID_FIELD]: jobId, ...patch }]);
}

// ---------------------
// TU PIPELINE RUNPOD (AJUSTA NOMBRES A TUS HELPERS)
// ---------------------
// Deben existir en tu proyecto. Si tienen otro nombre, renombrás las llamadas.
async function ensureVideoPodReadyOrThrow({ forceTerminateOnFail = true } = {}) {
  // EJEMPLO: aquí deberías:
  // 1) tomar pod_id de supabase pod_state (si existe)
  // 2) si pod está paused, intentar resume/start
  // 3) esperar READY_TIMEOUT_MS
  // 4) comprobar worker /health
  //
  // Si falla primer intento y forceTerminateOnFail==true:
  // terminate y crear pod nuevo (y actualizar pod_state)

  // ⚠️ Placeholder para que no te reviente import:
  // Reemplaza por tu implementación real
  throw new Error(
    "ensureVideoPodReadyOrThrow not implemented in this file. Wire it to your RunPod helpers."
  );
}

async function dispatchToWorkerAsync({ workerBaseUrl, payload }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), DISPATCH_TIMEOUT_MS);

  try {
    const r = await fetch(workerBaseUrl + WORKER_ASYNC_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });

    const txt = await r.text();
    let json = null;
    try {
      json = JSON.parse(txt);
    } catch {
      // ignore
    }

    if (!r.ok) {
      throw new Error(json?.error || json?.detail || txt || `Worker error ${r.status}`);
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}

// ---------------------
// API handler
// ---------------------
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const sb = (() => {
    try {
      return sbAdmin();
    } catch (e) {
      return null;
    }
  })();

  let user;
  try {
    // ✅ si esto no está cableado, te tiraba el mensaje rojo “not wired”
    user = await requireUser(req);
  } catch (e) {
    const code = e.statusCode || 401;
    return res.status(code).json({ ok: false, error: String(e.message || e) });
  }

  // body
  let body = req.body || {};
  const user_id = user.id;

  // fuerza I2V para este endpoint
  const mode = "i2v";

  const job_id = (body.job_id || body.id || cryptoRandomUUIDSafe()).toString();

  // params con defaults + caps
  let width = clampInt(body.width ?? DEF_WIDTH, 128, 4096, DEF_WIDTH);
  let height = clampInt(body.height ?? DEF_HEIGHT, 128, 4096, DEF_HEIGHT);
  let num_frames = clampInt(body.num_frames ?? DEF_FRAMES, 8, 200, DEF_FRAMES);
  let fps = clampInt(body.fps ?? DEF_FPS, 8, 60, DEF_FPS);
  let steps = clampInt(body.steps ?? 20, 1, 80, 20);
  let guidance_scale = Number.isFinite(Number(body.guidance_scale))
    ? Number(body.guidance_scale)
    : DEF_GUIDANCE;

  // caps globales
  width = capIfMax(width, MAX_WIDTH);
  height = capIfMax(height, MAX_HEIGHT);
  num_frames = capIfMax(num_frames, MAX_FRAMES);
  fps = capIfMax(fps, MAX_FPS);
  steps = capIfMax(steps, MAX_STEPS);

  // fast test
  if (FAST_TEST_MODE) {
    steps = Math.min(steps, 8);
    num_frames = Math.min(num_frames, 25);
  }

  // imagen: base64 o url
  const image_base64 = body.image_base64 || body.imageBase64 || null;
  const image_url = body.image_url || body.imageUrl || null;

  if (!image_base64 && !image_url) {
    return res.status(400).json({ ok: false, error: "Missing image_base64 or image_url" });
  }

  const prompt = (body.prompt || "").toString();
  const negative_prompt = (body.negative || body.negative_prompt || "").toString();

  // registra PENDING en supabase (para que te salga en tabla)
  try {
    if (!sb) throw new Error("Supabase env missing in function");
    await upsertJob(sb, job_id, {
      user_id,
      mode,
      prompt,
      negative_prompt,
      width,
      height,
      num_frames,
      fps,
      steps,
      guidance_scale,
      image_base64: image_base64 || null, // si worker convierte desde url, ok
      status: "PENDING",
      video_url: null,
      error: null,
      updated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    // si esto falla, igual devolvemos error claro (no 500 silencioso)
    return res.status(500).json({ ok: false, error: `Supabase upsert failed: ${String(e.message || e)}` });
  }

  // 1) asegurar pod (si primer wake falla => terminate + nuevo)
  let workerBaseUrl;
  try {
    // 🔥 AQUI cableás tu lógica real de runpod/pod_state
    // Debe terminar y recrear si falla primer intento por GPU/paused sin GPU.
    const ready = await ensureVideoPodReadyOrThrow({ forceTerminateOnFail: true });

    // Ejemplo de lo que tu helper debería devolver:
    // ready.workerBaseUrl = "https://xxxxx-8000.proxy.runpod.net"
    workerBaseUrl = ready.workerBaseUrl;
    if (!workerBaseUrl) throw new Error("Pod ready but missing workerBaseUrl");
  } catch (e) {
    // marca ERROR en job
    try {
      await sb.from(VIDEO_JOBS_TABLE).update({
        status: "ERROR",
        error: `Pod/worker not ready: ${String(e.message || e)}`,
        updated_at: new Date().toISOString(),
      }).eq(JOB_ID_FIELD, job_id);
    } catch {}
    return res.status(500).json({ ok: false, error: `Pod/worker not ready: ${String(e.message || e)}`, job_id });
  }

  // 2) dispatch al worker (async)
  try {
    // marca RUNNING (para que en supabase lo veas)
    await sb.from(VIDEO_JOBS_TABLE).update({
      status: "RUNNING",
      error: null,
      updated_at: new Date().toISOString(),
    }).eq(JOB_ID_FIELD, job_id);

    const payload = {
      mode,
      user_id,
      job_id,
      prompt,
      negative_prompt,
      width,
      height,
      num_frames,
      fps,
      steps,
      guidance_scale,
      image_base64: image_base64 || undefined,
      image_url: image_url || undefined, // worker puede convertir si le habilitaste
    };

    const out = await dispatchToWorkerAsync({ workerBaseUrl, payload });

    // responde al frontend con job_id para polling
    return res.status(202).json({ ok: true, job_id, dispatch: out });
  } catch (e) {
    // si dispatch falla, marcá ERROR + (ideal) terminate y recrea en siguiente intento
    try {
      await sb.from(VIDEO_JOBS_TABLE).update({
        status: "ERROR",
        error: `Dispatch failed: ${String(e.message || e)}`,
        updated_at: new Date().toISOString(),
      }).eq(JOB_ID_FIELD, job_id);
    } catch {}
    return res.status(500).json({ ok: false, error: `Dispatch failed: ${String(e.message || e)}`, job_id });
  }
}

// node<19 no trae crypto.randomUUID a veces en edge; esto lo hace seguro
function cryptoRandomUUIDSafe() {
  try {
    // eslint-disable-next-line no-undef
    return crypto.randomUUID();
  } catch {
    return "job_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
  }
}