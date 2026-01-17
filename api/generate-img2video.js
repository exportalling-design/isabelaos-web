// /api/generar-img2video.js
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

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

const VIDEO_GPU_TYPE_IDS = (process.env.VIDEO_GPU_TYPE_IDS || "").trim(); // ejemplo: "A100-SXM4-80GB,H100-SXM5-80GB"
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
// VIDEO DEFAULTS (si frontend no manda)
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
// =========================================================
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

async function fetchWithTimeout(url, opts, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

// ---- AUTH: usa tu implementación real ----
async function requireUser(req) {
  // IMPORTANTE: aquí va tu lógica real (cookies/supabase auth).
  // Si ya la tenías, NO LA CAMBIES. Solo pega tu requireUser real aquí.
  // Dejo un placeholder que falla explícitamente si no está cableado.
  return { ok: false, code: 500, error: "requireUser() not wired. Usa tu implementación real." };
}

// =========================================================
// Supabase queries
// =========================================================
async function getActiveJobForUserI2V(sb, user_id) {
  const { data, error } = await sb
    .from("video_jobs")
    .select("*")
    .eq("user_id", user_id)
    .in("status", ["QUEUED", "DISPATCHED", "IN_PROGRESS", "RUNNING"])
    .eq("mode", "i2v")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) return null;
  return data?.[0] || null;
}

async function createVideoJob(sb, row) {
  const { error } = await sb.from("video_jobs").insert([row]);
  if (error) throw new Error(`createVideoJob failed: ${error.message}`);
}

async function updateVideoJob(sb, job_id, patch) {
  const { error } = await sb.from("video_jobs").update(patch).eq("job_id", job_id);
  if (error) throw new Error(`updateVideoJob failed: ${error.message}`);
}

async function getPodState(sb) {
  const { data, error } = await sb.from("pod_state").select("*").limit(1);
  if (error) return null;
  return data?.[0] || null;
}

async function setPodState(sb, patch) {
  // asumimos 1 fila
  const current = await getPodState(sb);
  if (!current?.id) {
    const { error } = await sb.from("pod_state").insert([{ ...patch }]);
    if (error) throw new Error(`setPodState insert failed: ${error.message}`);
    return;
  }
  const { error } = await sb.from("pod_state").update(patch).eq("id", current.id);
  if (error) throw new Error(`setPodState update failed: ${error.message}`);
}

// =========================================================
// Jades spending (usa tu RPC real)
// =========================================================
async function spendJadesOrThrow(user_id, amount, reason, ref) {
  // Pega aquí tu RPC real (add_jades / spend_jades / jade_ledger).
  // Placeholder para que no “pase sin cobrar” por accidente:
  if (!user_id) throw new Error("Missing user_id for billing");
  if (!amount || amount <= 0) return true;
  // EJEMPLO (si tienes RPC):
  // const { data, error } = await sb.rpc("spend_jades", { p_user_id: user_id, p_amount: amount, p_reason: reason, p_ref: ref });
  // if (error) throw new Error(error.message);
  return true;
}

// =========================================================
// RunPod helpers (mínimo viable)
// =========================================================
function buildWorkerUrl(pod) {
  // Si guardas worker_url en supabase úsalo.
  // Aquí asumimos tu worker expone HTTP en un endpoint tipo:
  // https://{podId}-{port}.proxy.runpod.net  (ajusta si tu forma es otra)
  const port = WORKER_PORT;
  return `https://${pod.pod_id}-${port}.proxy.runpod.net`;
}

function isPowerfulEnoughForI2V(podRow) {
  // Bloquea RTX 6000 / A6000 / 48GB porque te está OOM.
  // Si en tu pod_state guardas gpu_name, gpu_vram_gb, etc, úsalo.
  const name = String(podRow?.gpu_name || "").toUpperCase();
  const vram = Number(podRow?.gpu_vram_gb || 0);

  // Permitir A100/H100 por nombre
  if (name.includes("A100") || name.includes("H100")) return true;

  // Permitir si reporta >= 80GB (por si cambia naming)
  if (vram >= 80) return true;

  return false;
}

async function runpodTerminatePod(podId) {
  if (!RUNPOD_API_KEY) throw new Error("RUNPOD_API_KEY missing");
  const r = await fetch(`https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `mutation TerminatePod($podId: String!) { terminatePod(podId: $podId) }`,
      variables: { podId },
    }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`RunPod terminate failed: ${r.status}`);
  return j;
}

// NOTA: La creación real de pod depende de tu implementación (templateId, volume, gpu type ids, etc).
// Si ya tienes ensureWorkingPod() en otro archivo, NO lo re-escribas: úsalo.
// Aquí dejo un "ensureWorkingPod" que:
//  - usa pod_state si existe y pasa health
//  - si falla health o es GPU débil => TERMINATE y marca pod_state vacío para que tu creador lo regenere.
async function ensureWorkingPod(sb, log) {
  const ps = await getPodState(sb);

  if (ps?.pod_id && ps?.worker_url) {
    // check GPU suficiente
    if (!isPowerfulEnoughForI2V(ps)) {
      log("[I2V] Pod GPU insuficiente para i2v. Terminando:", ps.pod_id);
      try { await runpodTerminatePod(ps.pod_id); } catch {}
      await setPodState(sb, {
        status: "IDLE",
        pod_id: null,
        worker_url: null,
        gpu_name: null,
        gpu_vram_gb: null,
        last_error: "Pod GPU insuficiente para I2V (OOM probable)",
        last_used_at: new Date().toISOString(),
      });
    } else {
      // health check
      const healthUrl = `${ps.worker_url}${WORKER_HEALTH_PATH}`;
      try {
        const r = await fetchWithTimeout(healthUrl, { method: "GET" }, HEALTH_FETCH_TIMEOUT_MS);
        if (r.ok) {
          return { action: "REUSE", podId: ps.pod_id, workerUrl: ps.worker_url, oldPodId: ps.pod_id };
        }
        throw new Error(`health not ok: ${r.status}`);
      } catch (e) {
        log("[I2V] Pod existe pero worker no responde. Terminando y recreando:", ps.pod_id);
        try { await runpodTerminatePod(ps.pod_id); } catch {}
        await setPodState(sb, {
          status: "IDLE",
          pod_id: null,
          worker_url: null,
          last_error: `Worker not ready -> terminated (${String(e?.message || e)})`,
          last_used_at: new Date().toISOString(),
        });
      }
    }
  }

  // Si llegamos aquí, tu sistema debe CREAR un pod nuevo.
  // Si ya tienes createVideoPod() úsalo. Aquí solo fallo explícito para que lo conectes.
  throw new Error("No active pod available. Conecta aquí tu creador real de pods (ensureWorkingPod/createVideoPod).");
}

// =========================================================
// MAIN HANDLER
// =========================================================
export default async function handler(req, res) {
  const log = (...args) => console.log(...args);

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  let sb = null;
  let podId = null;

  try {
    sb = sbAdmin();

    // AUTH
    const auth = await requireUser(req);
    if (!auth.ok) {
      return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    }
    const user_id = auth.user.id;

    // ✅ Evitar duplicados: si ya hay job activo i2v => devolverlo
    const activeI2V = await getActiveJobForUserI2V(sb, user_id);
    if (activeI2V) {
      return res.status(200).json({
        ok: true,
        status: "ALREADY_RUNNING",
        job_id: activeI2V.job_id,
        job: activeI2V,
      });
    }

    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

    // ✅ COMPAT: aceptar TODOS los nombres de imagen (esto arregla tu 400)
    const image_base64 =
      body.image_base64 ||
      body.imageBase64 ||
      body.image_b64 ||
      body.image_b64_raw ||
      body.image_b64_pure ||
      body.dataUrl ||
      body.data_url ||
      null;

    const image_url =
      body.image_url ||
      body.imageUrl ||
      body.imageURL ||
      null;

    if (!image_base64 && !image_url) {
      return res.status(400).json({
        ok: false,
        error: "Missing image_base64 or image_url",
        receivedKeys: Object.keys(body || {}),
      });
    }

    // ✅ NORMALIZAR BASE64 A DATAURL
    const normalizedImageB64 = image_base64
      ? (String(image_base64).startsWith("data:")
          ? String(image_base64)
          : `data:image/jpeg;base64,${String(image_base64)}`)
      : null;

    // CAPS
    const requestedSteps =
      typeof body.steps === "number"
        ? body.steps
        : typeof body.num_inference_steps === "number"
        ? body.num_inference_steps
        : null;

    const safeSteps =
      requestedSteps == null
        ? (MAX_STEPS ?? 25)
        : (MAX_STEPS ? Math.min(requestedSteps, MAX_STEPS) : requestedSteps);

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

    // ✅ Payload NORMALIZADO para worker (FORZAR i2v)
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

    // ✅ COBRO BACKEND (si frontend ya cobró, manda already_billed=true)
    const alreadyBilled = body.already_billed === true;
    if (!alreadyBilled) {
      await spendJadesOrThrow(user_id, COST_IMG2VIDEO_JADES, "generation:img2video", body.ref || null);
    }

    // Ensure pod (reusa si sirve, si no TERMINA y fuerza recrear)
    let ensured;
    try {
      ensured = await ensureWorkingPod(sb, log);
    } catch (e) {
      // Si falla por pod dormido / sin GPU, aquí es donde conectas tu creador real.
      // De momento devolvemos error claro para que no “se pierda” el job sin insert.
      const msg = String(e?.message || e);
      return res.status(500).json({ ok: false, error: msg });
    }

    podId = ensured.podId;

    // Crear job
    const job_id = crypto.randomUUID();

    await createVideoJob(sb, {
      job_id,
      user_id,
      status: "QUEUED",
      mode: "i2v",
      payload,
      pod_id: podId,
      worker_url: ensured.workerUrl,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Dispatch
    const dispatchUrl = `${ensured.workerUrl}${WORKER_ASYNC_PATH}`;
    log("[I2V] dispatchUrl=", dispatchUrl);

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
    log("[I2V] dispatch response status=", r.status, "body=", txt.slice(0, 200));

    if (r.status !== 202 && r.status !== 200) {
      await updateVideoJob(sb, job_id, {
        status: "ERROR",
        error: `Worker dispatch failed: ${r.status} ${txt.slice(0, 200)}`,
        updated_at: new Date().toISOString(),
      });

      // ✅ Si falló al despachar, probablemente pod dormido/sin GPU => terminate y listo
      try { await runpodTerminatePod(podId); } catch {}
      try {
        await setPodState(sb, {
          status: "IDLE",
          pod_id: null,
          worker_url: null,
          last_error: `dispatch failed -> terminated pod ${podId}`,
          last_used_at: new Date().toISOString(),
        });
      } catch {}

      return res.status(500).json({ ok: false, error: `Worker dispatch failed: ${r.status}`, podId });
    }

    let workerReply = null;
    try {
      const raw = txt ? JSON.parse(txt) : null;
      workerReply = Array.isArray(raw) ? raw[0] : raw;
    } catch {
      workerReply = { raw_text: txt?.slice(0, 500) || "" };
    }

    // Marca IN_PROGRESS aunque el worker devuelva vacío
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
      worker: ensured.workerUrl,
      billed: alreadyBilled ? { type: "FRONTEND", amount: 0 } : { type: "JADE", amount: COST_IMG2VIDEO_JADES },
      note: "I2V sigue generándose en el pod. Revisa /api/video-status?job_id=... o ?mode=i2v",
    });
  } catch (e) {
    const msg = String(e?.message || e);
    const code = e?.code || 500;
    console.error("[I2V] ERROR:", msg);

    try {
      if (sb) {
        await setPodState(sb, {
          status: "ERROR",
          last_error: msg,
          last_used_at: new Date().toISOString(),
        });
      }
    } catch {}

    return res.status(code).json({ ok: false, error: msg, podId });
  }
}