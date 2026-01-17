// /api/generate-img2video.js
import crypto from "crypto";
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

const VIDEO_VOLUME_MOUNT_PATH =
  process.env.VIDEO_VOLUME_MOUNT_PATH || "/workspace";

// GPU selection
const VIDEO_GPU_TYPE_IDS = (process.env.VIDEO_GPU_TYPE_IDS || "").trim(); // e.g. "NVIDIA A100-SXM4-80GB"
const VIDEO_GPU_CLOUD_TYPE = (process.env.VIDEO_GPU_CLOUD_TYPE || "ALL").trim(); // "ALL" o "SECURE"
const VIDEO_GPU_COUNT = parseInt(process.env.VIDEO_GPU_COUNT || "1", 10);

// Fallback behavior
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
// Timeouts / Locks
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
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const VIDEO_JOBS_TABLE = process.env.VIDEO_JOBS_TABLE || "video_jobs";
const POD_STATE_TABLE = process.env.POD_STATE_TABLE || "pod_state";
const POD_LOCK_TABLE = process.env.POD_LOCK_TABLE || "pod_lock";
const POD_STATE_ID = parseInt(process.env.POD_STATE_ID || "1", 10);

const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "generations";

// Costs
const COST_IMG2VIDEO_JADES = parseInt(process.env.COST_IMG2VIDEO_JADES || "25", 10);

// =====================
// Helpers
// =====================
function sbAdmin() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

async function requireUser(req) {
  // Usa tu auth real. Aquí dejamos un placeholder típico:
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return { ok: false, code: 401, error: "No auth token" };
  }
  // Si ya tienes requireUser en otro archivo, reemplaza esto por tu implementación.
  // Para no romper, devolvemos "not implemented" si no está tu sistema.
  // -----
  // ✅ IMPORTANTE: aquí debe devolverte { ok:true, user:{id} }
  // -----
  return { ok: false, code: 500, error: "requireUser() not wired. Usa tu implementación real." };
}

function clampNum(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function applyCaps(payload) {
  const out = { ...payload };

  // defaults
  out.width = Number.isFinite(out.width) ? out.width : DEF_WIDTH;
  out.height = Number.isFinite(out.height) ? out.height : DEF_HEIGHT;
  out.num_frames = Number.isFinite(out.num_frames) ? out.num_frames : DEF_FRAMES;
  out.fps = Number.isFinite(out.fps) ? out.fps : DEF_FPS;
  out.guidance_scale = out.guidance_scale ?? DEF_GUIDANCE;

  // caps (si no hay cap => no tocamos)
  if (MAX_WIDTH) out.width = clampNum(out.width, 128, MAX_WIDTH);
  if (MAX_HEIGHT) out.height = clampNum(out.height, 128, MAX_HEIGHT);
  if (MAX_FRAMES) out.num_frames = clampNum(out.num_frames, 8, MAX_FRAMES);
  if (MAX_FPS) out.fps = clampNum(out.fps, 6, MAX_FPS);
  if (MAX_STEPS) out.steps = clampNum(out.steps, 1, MAX_STEPS);

  // fast test
  if (FAST_TEST_MODE) {
    out.steps = Math.min(Number(out.steps || 8), 8);
    out.num_frames = Math.min(Number(out.num_frames || 8), 8);
    out.fps = Math.min(Number(out.fps || 6), 6);
    out.width = 384;
    out.height = 672;
  }

  return out;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ac.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

function normalizeDataUrl(b64) {
  if (!b64) return null;
  const s = String(b64);
  if (s.startsWith("data:")) return s;
  return `data:image/jpeg;base64,${s}`;
}

// ===============
// RunPod GraphQL
// ===============
async function runpodGQL(query, variables) {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY");
  const r = await fetch("https://api.runpod.io/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RUNPOD_API_KEY}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors?.length) {
    throw new Error(j.errors.map((e) => e.message).join(" | "));
  }
  return j.data;
}

async function getPod(sb) {
  const { data, error } = await sb
    .table(POD_STATE_TABLE)
    .select("*")
    .eq("id", POD_STATE_ID)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function setPodState(sb, patch) {
  const { error } = await sb
    .table(POD_STATE_TABLE)
    .update({ ...patch })
    .eq("id", POD_STATE_ID);
  if (error) throw new Error(error.message);
}

async function acquireLock(sb, key) {
  const now = new Date();
  const until = new Date(now.getTime() + LOCK_SECONDS * 1000).toISOString();

  // simple lock row: { key: "video", locked_until, locked_at }
  // upsert and check locked_until
  const { data: existing } = await sb
    .table(POD_LOCK_TABLE)
    .select("*")
    .eq("key", key)
    .maybeSingle();

  if (existing?.locked_until) {
    const lockedUntil = new Date(existing.locked_until).getTime();
    if (lockedUntil > Date.now()) {
      return { ok: false, until: existing.locked_until };
    }
  }

  const { error } = await sb.table(POD_LOCK_TABLE).upsert({
    key,
    locked_until: until,
    locked_at: now.toISOString(),
  });
  if (error) throw new Error(error.message);
  return { ok: true, until };
}

async function releaseLock(sb, key) {
  try {
    await sb.table(POD_LOCK_TABLE).update({ locked_until: null }).eq("key", key);
  } catch {}
}

function workerUrlFromPod(pod) {
  // En tu setup normalmente guardas worker_url directo en pod_state.
  // Si no, construye con proxy (pero lo más estable es guardarlo en pod_state al crear).
  return pod?.worker_url || null;
}

async function waitPodRunning(podId, log) {
  const started = Date.now();
  while (Date.now() - started < READY_TIMEOUT_MS) {
    const data = await runpodGQL(
      `
      query Pod($id: String!) {
        pod(id: $id) {
          id
          desiredStatus
          runtime {
            uptimeInSeconds
          }
          machine {
            gpuDisplayName
          }
        }
      }`,
      { id: podId }
    );

    const p = data?.pod;
    if (p?.desiredStatus === "RUNNING") {
      return {
        ok: true,
        gpu: p?.machine?.gpuDisplayName || null,
      };
    }

    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return { ok: false, error: "Pod did not reach RUNNING in time" };
}

async function waitWorkerHealthy(workerUrl, log) {
  const started = Date.now();
  while (Date.now() - started < WORKER_READY_TIMEOUT_MS) {
    try {
      const r = await fetchWithTimeout(
        `${workerUrl}${WORKER_HEALTH_PATH}`,
        { method: "GET" },
        HEALTH_FETCH_TIMEOUT_MS
      );
      if (r.ok) {
        const j = await r.json().catch(() => null);
        // ✅ zombie check
        if (j?.gpu === true && Number(j?.vram_mb || 0) > 0) {
          return { ok: true, health: j };
        }
        // Si responde pero dice gpu false, consideramos inválido
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { ok: false, error: "Worker not healthy (gpu missing) in time" };
}

async function terminatePod(podId, log) {
  try {
    await runpodGQL(
      `
      mutation Terminate($podId: String!) {
        terminatePod(podId: $podId)
      }`,
      { podId }
    );
  } catch (e) {
    log("[terminatePod] warn:", String(e?.message || e));
  }
}

// ✅ Crea pod con gpuTypeIds + cloudType
async function createPod(log) {
  if (!VIDEO_RUNPOD_TEMPLATE_ID) throw new Error("Missing VIDEO_RUNPOD_TEMPLATE_ID");
  if (!VIDEO_RUNPOD_NETWORK_VOLUME_ID) throw new Error("Missing VIDEO_RUNPOD_NETWORK_VOLUME_ID");

  // gpuTypeIds: puede venir como CSV en env
  const gpuTypeIdsArr = VIDEO_GPU_TYPE_IDS
    ? VIDEO_GPU_TYPE_IDS.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const input = {
    name: `isabela-video-${Date.now()}`,
    templateId: VIDEO_RUNPOD_TEMPLATE_ID,
    cloudType: VIDEO_GPU_CLOUD_TYPE, // "ALL" o "SECURE"
    gpuCount: VIDEO_GPU_COUNT,
    // RunPod usa gpuTypeIds (string list)
    gpuTypeIds: gpuTypeIdsArr.length ? gpuTypeIdsArr : null,
    volumeInGb: null,
    networkVolumeId: VIDEO_RUNPOD_NETWORK_VOLUME_ID,
    containerDiskInGb: null,
    volumeMountPath: VIDEO_VOLUME_MOUNT_PATH,
  };

  const data = await runpodGQL(
    `
    mutation CreatePod($input: PodInput!) {
      podFindAndDeployOnDemand(input: $input) {
        id
      }
    }`,
    { input }
  );

  const podId = data?.podFindAndDeployOnDemand?.id;
  if (!podId) throw new Error("Failed to create pod (no id)");
  return podId;
}

// ✅ ensure pod:
// - si existe y está RUNNING => verifica /health con GPU
// - si está PAUSED/STOPPED => intenta reanudar, y si falla => terminate + create new
// - si no existe => create new
async function ensureWorkingPod(sb, log) {
  const lock = await acquireLock(sb, "video");
  if (!lock.ok) {
    throw new Error(`Lock activo, intenta luego. locked_until=${lock.until}`);
  }

  try {
    const state = await getPod(sb);

    // 1) Si ya hay podId guardado, intentamos usarlo
    if (state?.pod_id) {
      const podId = state.pod_id;
      const wurl = workerUrlFromPod(state);

      // Si ya tienes worker_url guardado, probamos primero
      if (wurl) {
        const wh = await waitWorkerHealthy(wurl, log).catch(() => ({ ok: false }));
        if (wh.ok) {
          return { action: "REUSE", podId, workerUrl: wurl, health: wh.health };
        }
      }

      // Si no está healthy, esperamos RUNNING y revalidamos /health
      const running = await waitPodRunning(podId, log);
      if (!running.ok) {
        // primer fallo: terminate y recrear
        await terminatePod(podId, log);
        await setPodState(sb, { pod_id: null, worker_url: null, status: "TERMINATED" });
      } else {
        // Si volvió running, intentamos health (si no hay worker_url, aquí es donde tu sistema debe construirlo o guardarlo)
        const w2 = workerUrlFromPod(state);
        if (!w2) {
          throw new Error("pod_state.worker_url is missing. Necesitas guardar worker_url al crear el pod.");
        }
        const wh2 = await waitWorkerHealthy(w2, log);
        if (wh2.ok) {
          return { action: "RESUMED", podId, workerUrl: w2, health: wh2.health };
        }

        // Si revive pero /health no tiene GPU => zombie => terminate y recrear
        await terminatePod(podId, log);
        await setPodState(sb, { pod_id: null, worker_url: null, status: "TERMINATED" });
      }
    }

    // 2) Crear nuevo
    const newPodId = await createPod(log);
    await setPodState(sb, {
      pod_id: newPodId,
      status: "STARTING",
      busy: false,
      last_used_at: new Date().toISOString(),
    });

    const running2 = await waitPodRunning(newPodId, log);
    if (!running2.ok) {
      await terminatePod(newPodId, log);
      await setPodState(sb, { pod_id: null, worker_url: null, status: "TERMINATED" });
      throw new Error("Pod nuevo no llegó a RUNNING a tiempo.");
    }

    const state2 = await getPod(sb);
    const wurl2 = workerUrlFromPod(state2);
    if (!wurl2) {
      // Sin worker_url no se puede seguir.
      // (Tu sistema antes lo tenía; si lo quitaste, hay que volverlo a guardar)
      throw new Error("pod_state.worker_url missing. Vuelve a guardar worker_url al crear/reusar pod.");
    }

    const wh3 = await waitWorkerHealthy(wurl2, log);
    if (!wh3.ok) {
      await terminatePod(newPodId, log);
      await setPodState(sb, { pod_id: null, worker_url: null, status: "TERMINATED" });
      throw new Error("Worker no healthy (sin GPU) en pod nuevo.");
    }

    return { action: "CREATED", podId: newPodId, workerUrl: wurl2, health: wh3.health };
  } finally {
    await releaseLock(sb, "video");
  }
}

// ---------------------------
// Jobs helpers
// ---------------------------
async function getActiveJobForUserI2V(sb, user_id) {
  const { data, error } = await sb
    .table(VIDEO_JOBS_TABLE)
    .select("*")
    .eq("user_id", user_id)
    .in("status", ["PENDING", "QUEUED", "DISPATCHED", "IN_PROGRESS", "RUNNING"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw new Error(error.message);
  return (data && data[0]) || null;
}

async function createVideoJob(sb, row) {
  const { error } = await sb.table(VIDEO_JOBS_TABLE).insert(row);
  if (error) throw new Error(error.message);
}

async function updateVideoJob(sb, job_id, patch) {
  // ✅ actualizamos por id OR job_id (por compatibilidad)
  const q = sb.table(VIDEO_JOBS_TABLE).update(patch);
  const { error } = await q.or(`id.eq.${job_id},job_id.eq.${job_id}`);
  if (error) throw new Error(error.message);
}

// ---------------------------
// JADE billing (stub)
// ---------------------------
async function spendJadesOrThrow(user_id, amount, reason, ref) {
  // Aquí llama tu RPC real (add_jades / spend_jades).
  // Dejo un error claro si no está implementado para que no genere gratis.
  if (Number(amount) > 0) {
    throw new Error("spendJadesOrThrow() not wired. Conecta tu RPC de cobro de jades aquí.");
  }
}

// =====================
// API
// =====================
export default async function handler(req, res) {
  const log = (...args) => console.log("[I2V]", ...args);

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  let sb = null;
  let podId = null;

  try {
    sb = sbAdmin();

    // AUTH (usa tu implementación real)
    const auth = await requireUser(req);
    if (!auth.ok) {
      return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    }
    const user_id = auth.user.id;

    // Si ya hay job i2v activo => devolverlo (evita duplicados)
    const activeI2V = await getActiveJobForUserI2V(sb, user_id);
    if (activeI2V) {
      return res.status(200).json({
        ok: true,
        status: "ALREADY_RUNNING",
        job_id: activeI2V.job_id || activeI2V.id,
        job: activeI2V,
      });
    }

    const payloadRaw =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

    const image_b64 =
      payloadRaw.image_b64 ||
      payloadRaw.image_base64 ||
      payloadRaw.image_b64_raw ||
      null;

    const image_url = payloadRaw.image_url || null;

    if (!image_b64 && !image_url) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing image_b64 (o image_base64) or image_url" });
    }

    const normalizedImageB64 = image_b64 ? normalizeDataUrl(image_b64) : null;

    const requestedSteps =
      typeof payloadRaw.steps === "number"
        ? payloadRaw.steps
        : typeof payloadRaw.num_inference_steps === "number"
        ? payloadRaw.num_inference_steps
        : null;

    // ✅ fuerza i2v
    let payload = {
      user_id,
      mode: "i2v", // ✅ SIEMPRE i2v
      prompt: payloadRaw.prompt || "",
      negative_prompt: payloadRaw.negative_prompt || "",
      width: typeof payloadRaw.width === "number" ? payloadRaw.width : DEF_WIDTH,
      height: typeof payloadRaw.height === "number" ? payloadRaw.height : DEF_HEIGHT,
      num_frames: typeof payloadRaw.num_frames === "number" ? payloadRaw.num_frames : DEF_FRAMES,
      fps: typeof payloadRaw.fps === "number" ? payloadRaw.fps : DEF_FPS,
      steps: typeof requestedSteps === "number" ? requestedSteps : (MAX_STEPS ?? 20),
      guidance_scale: payloadRaw.guidance_scale ?? DEF_GUIDANCE,
      image_base64: normalizedImageB64,
      image_url: image_url || null,
    };

    // caps / fast test
    payload = applyCaps(payload);

    // COBRO (si frontend ya cobró, manda already_billed=true)
    const alreadyBilled = payloadRaw.already_billed === true;
    if (!alreadyBilled) {
      await spendJadesOrThrow(
        user_id,
        COST_IMG2VIDEO_JADES,
        "generation:img2video",
        payloadRaw.ref || null
      );
    }

    // Ensure pod (con lógica de terminate+recreate si resume falla)
    const ensured = await ensureWorkingPod(sb, log);
    podId = ensured.podId;

    // ✅ Detectar GPU del worker (para debug)
    const gpuName = ensured?.health?.gpu_name || ensured?.health?.gpuName || null;

    // Crear job id
    const job_uuid = crypto.randomUUID();

    // ✅ Guardamos id y job_id iguales SIEMPRE (arregla el “no aparece running”)
    const nowIso = new Date().toISOString();

    await createVideoJob(sb, {
      id: job_uuid,
      job_id: job_uuid,
      user_id,
      status: "QUEUED",
      mode: "i2v",
      payload, // si tienes jsonb payload
      pod_id: podId,
      worker_url: ensured.workerUrl,
      created_at: nowIso,
      updated_at: nowIso,
    });

    // Dispatch
    const dispatchUrl = `${ensured.workerUrl}${WORKER_ASYNC_PATH}`;
    log("dispatchUrl=", dispatchUrl, "gpu=", gpuName);

    await setPodState(sb, {
      status: "BUSY",
      busy: true,
      last_used_at: new Date().toISOString(),
      pod_id: podId,
    });

    await updateVideoJob(sb, job_uuid, { status: "DISPATCHED", updated_at: nowIso });

    const r = await fetchWithTimeout(
      dispatchUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: job_uuid, ...payload }), // worker usa job_id
      },
      DISPATCH_TIMEOUT_MS
    );

    const txt = await r.text().catch(() => "");
    log("dispatch status=", r.status, "body=", txt.slice(0, 200));

    if (r.status !== 202 && r.status !== 200) {
      const errMsg = `Worker dispatch failed: ${r.status} ${txt.slice(0, 300)}`;
      await updateVideoJob(sb, job_uuid, { status: "ERROR", error: errMsg, updated_at: new Date().toISOString() });

      // ✅ Si el primer intento falla, hacemos terminate + clear pod para que el siguiente request cree otro
      await terminatePod(podId, log);
      await setPodState(sb, { pod_id: null, worker_url: null, status: "TERMINATED", busy: false });

      return res.status(500).json({ ok: false, error: errMsg, podId });
    }

    // Worker reply
    let workerReply = null;
    try {
      workerReply = txt ? JSON.parse(txt) : null;
    } catch {
      workerReply = { raw_text: txt?.slice(0, 500) || "" };
    }

    await updateVideoJob(sb, job_uuid, {
      status: "IN_PROGRESS",
      worker_reply: workerReply,
      updated_at: new Date().toISOString(),
    });

    return res.status(200).json({
      ok: true,
      job_id: job_uuid,
      status: "IN_PROGRESS",
      podId,
      worker: ensured.workerUrl,
      gpu: gpuName,
      billed: alreadyBilled
        ? { type: "FRONTEND", amount: 0 }
        : { type: "JADE", amount: COST_IMG2VIDEO_JADES },
      note:
        "I2V en progreso. Revisa /api/video-status?job_id=... (asegúrate que video-status busque por id o job_id).",
    });
  } catch (e) {
    const msg = String(e?.message || e);
    console.error("[I2V] ERROR:", msg);

    try {
      if (sb) {
        await setPodState(sb, {
          status: "ERROR",
          busy: false,
          last_error: msg,
          last_used_at: new Date().toISOString(),
        });
      }
    } catch {}

    return res.status(500).json({ ok: false, error: msg, podId });
  }
}