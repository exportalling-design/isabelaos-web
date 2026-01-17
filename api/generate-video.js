// /api/generate-video.js
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// RunPod
const RUNPOD_API_KEY =
  process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY || null;

const VIDEO_RUNPOD_TEMPLATE_ID = process.env.VIDEO_RUNPOD_TEMPLATE_ID || null;
const VIDEO_RUNPOD_NETWORK_VOLUME_ID =
  process.env.VIDEO_RUNPOD_NETWORK_VOLUME_ID || process.env.VIDEO_NETWORK_VOLUME_ID || null;

const VIDEO_VOLUME_MOUNT_PATH = process.env.VIDEO_VOLUME_MOUNT_PATH || "/workspace";

const VIDEO_GPU_TYPE_IDS = (process.env.VIDEO_GPU_TYPE_IDS || "").trim();
const VIDEO_GPU_CLOUD_TYPE = (process.env.VIDEO_GPU_CLOUD_TYPE || "ALL").trim();
const VIDEO_GPU_COUNT = parseInt(process.env.VIDEO_GPU_COUNT || "1", 10);
const VIDEO_GPU_FALLBACK_ON_FAIL =
  String(process.env.VIDEO_GPU_FALLBACK_ON_FAIL || "1") === "1";

// Worker
const WORKER_PORT = parseInt(process.env.WORKER_PORT || "8000", 10);
const WORKER_HEALTH_PATH = process.env.WORKER_HEALTH_PATH || "/health";
const WORKER_ASYNC_PATH = process.env.WORKER_ASYNC_PATH || "/api/video_async";

// Timeouts (más agresivos para no dejarte esperando 8 min)
const WAIT_RUNNING_TIMEOUT_MS = parseInt(process.env.WAIT_RUNNING_TIMEOUT_MS || "240000", 10); // 4 min
const WAIT_RUNNING_INTERVAL_MS = parseInt(process.env.WAIT_RUNNING_INTERVAL_MS || "3500", 10);

const WAIT_WORKER_TIMEOUT_MS = parseInt(process.env.WAIT_WORKER_TIMEOUT_MS || "180000", 10); // 3 min
const WAIT_WORKER_INTERVAL_MS = parseInt(process.env.WAIT_WORKER_INTERVAL_MS || "2500", 10);

// Lock corto: sólo 1 proceso despierta/crea pod
const WAKE_LOCK_SECONDS = parseInt(process.env.WAKE_LOCK_SECONDS || "60", 10);

const POD_STATE_TABLE = process.env.POD_STATE_TABLE || "pod_state";
const POD_LOCK_TABLE = process.env.POD_LOCK_TABLE || "pod_lock";
const VIDEO_JOBS_TABLE = process.env.VIDEO_JOBS_TABLE || "video_jobs";

const ACTIVE_STATUSES = ["PENDING", "IN_QUEUE", "QUEUED", "DISPATCHED", "IN_PROGRESS", "RUNNING"];

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Falta SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
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

// ---------------------------
// RunPod REST helpers
// ---------------------------
async function runpodGetPod(podId) {
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, {
    method: "GET",
    headers: runpodHeaders(),
  });
  const t = await r.text().catch(() => "");
  if (!r.ok) {
    const e = new Error(`RunPod get pod falló (${r.status}): ${t}`);
    e.status = r.status;
    e.raw = t;
    throw e;
  }
  try { return JSON.parse(t); } catch { return { raw: t }; }
}

async function runpodStartPod(podId) {
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}/start`, {
    method: "POST",
    headers: runpodHeaders(),
  });
  const t = await r.text().catch(() => "");
  if (r.ok) return true;
  return { ok: false, status: r.status, raw: t };
}

async function runpodTerminatePod(podId) {
  // terminate endpoint
  const r1 = await fetch(`https://rest.runpod.io/v1/pods/${podId}/terminate`, {
    method: "POST",
    headers: runpodHeaders(),
  });
  if (r1.ok) return true;

  // delete fallback
  const r2 = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, {
    method: "DELETE",
    headers: runpodHeaders(),
  });
  const t2 = await r2.text().catch(() => "");
  if (r2.ok) return true;

  throw new Error(`RunPod terminate falló (${r2.status}): ${t2}`);
}

async function waitForRunning(podId) {
  const start = Date.now();
  while (Date.now() - start < WAIT_RUNNING_TIMEOUT_MS) {
    let pod;
    try {
      pod = await runpodGetPod(podId);
    } catch (e) {
      // si dio 404 => pod ya no existe => fallo duro
      const msg = String(e?.message || e);
      if (msg.includes("(404)")) return { ok: false, status: "NOT_FOUND", error: "Pod no existe (404)" };
      await sleep(WAIT_RUNNING_INTERVAL_MS);
      continue;
    }

    const status = String(pod?.desiredStatus || pod?.status || pod?.pod?.status || "").toUpperCase();

    if (status.includes("RUNNING")) return { ok: true, status };
    if (status.includes("FAILED") || status.includes("ERROR")) return { ok: false, status, error: "Pod FAILED/ERROR" };

    await sleep(WAIT_RUNNING_INTERVAL_MS);
  }
  return { ok: false, status: "TIMEOUT", error: `Pod no llegó a RUNNING en ${WAIT_RUNNING_TIMEOUT_MS}ms` };
}

async function waitForWorker(podId) {
  const base = workerBaseUrl(podId);
  const url = `${base}${WORKER_HEALTH_PATH}`;
  const start = Date.now();

  while (Date.now() - start < WAIT_WORKER_TIMEOUT_MS) {
    try {
      const r = await fetch(url, { method: "GET" });
      if (r.ok) return { ok: true, url };
      // 404/502 aquí es NORMAL mientras calienta → seguimos intentando
    } catch (_) {}
    await sleep(WAIT_WORKER_INTERVAL_MS);
  }
  return { ok: false, url, error: `Worker no respondió tras ${WAIT_WORKER_TIMEOUT_MS}ms` };
}

// ---------------------------
// LOCK atómico (pod_lock id=1)
// ---------------------------
async function tryAcquireLockAtomic(sb, seconds = 60) {
  const now = new Date();
  const until = new Date(now.getTime() + seconds * 1000);
  const nowIso = now.toISOString();

  // si no existe la fila id=1, la creamos una vez (best-effort)
  await sb.from(POD_LOCK_TABLE).insert([{ id: 1, locked_until: new Date(0).toISOString() }]).catch(() => {});

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
  await sb.from(POD_LOCK_TABLE).update({ locked_until: pastIso }).eq("id", 1);
}

// ---------------------------
// Create pod from template (REST)
// ---------------------------
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
    attempts.push({ label: "FALLBACK_CLOUD_ONLY", payload: { ...basePayload, cloudType: VIDEO_GPU_CLOUD_TYPE || "ALL" } });
    attempts.push({ label: "FALLBACK_PLAIN", payload: { ...basePayload } });
  }

  let lastErr = null;
  for (const a of attempts) {
    try {
      log?.(`createPod attempt=${a.label}`, {
        hasGpuTypeIds: Boolean(a.payload.gpuTypeIds),
        cloudType: a.payload.cloudType || null,
        gpuCount: a.payload.gpuCount,
      });
      const created = await runpodCreatePodOnce(a.payload);
      return { ...created, attempt: a.label };
    } catch (e) {
      lastErr = e;
      log?.(`createPod failed attempt=${a.label}`, String(e?.message || e));
      if (!VIDEO_GPU_FALLBACK_ON_FAIL) throw e;
    }
  }
  throw lastErr || new Error("RunPod create failed: sin detalle");
}

// ---------------------------
// Ensure ONE pod (SI falla → terminate old + recreate)
// ---------------------------
async function ensureWorkingPod(sb, log) {
  const nowIso = new Date().toISOString();

  // leer pod_state fila id=1
  const { data: podState, error: psErr } = await sb
    .from(POD_STATE_TABLE)
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (psErr) throw psErr;

  const statePodId = String(podState?.pod_id || "").trim();

  async function setState(patch) {
    await sb.from(POD_STATE_TABLE).upsert([{ id: 1, ...patch, last_used_at: nowIso }]);
  }

  // helper: intentar “usar” un podId (start -> running -> worker ok)
  async function tryMakeReady(podId) {
    // start (si ya está running da 400 a veces; lo ignoramos)
    const st = await runpodStartPod(podId);
    if (st !== true) log?.("warn=startPod failed (ignored)", st);

    const running = await waitForRunning(podId);
    if (!running.ok) return { ok: false, step: "RUNNING", ...running };

    const ready = await waitForWorker(podId);
    if (!ready.ok) return { ok: false, step: "WORKER", ...ready };

    return { ok: true, workerUrl: workerBaseUrl(podId) };
  }

  // 1) Si hay pod en state → intentar usarlo
  if (statePodId) {
    log?.("ensureWorkingPod: found pod_state.pod_id", statePodId);
    await setState({ status: "STARTING", busy: false, worker_url: null });

    const attempt = await tryMakeReady(statePodId);
    if (attempt.ok) {
      await setState({ status: "RUNNING", busy: false, worker_url: attempt.workerUrl, pod_id: statePodId });
      return { podId: statePodId, workerUrl: attempt.workerUrl, action: "REUSADO" };
    }

    // fallo => TERMINATE inmediato (regla tuya)
    log?.("ensureWorkingPod: existing pod failed -> TERMINATE", { podId: statePodId, step: attempt.step, err: attempt.error });
    try { await runpodTerminatePod(statePodId); } catch (e) { log?.("terminate old failed (ignored)", String(e?.message || e)); }

    await setState({
      status: "IDLE",
      busy: false,
      pod_id: null,
      worker_url: null,
      last_error: `old pod failed (${attempt.step}): ${attempt.error || attempt.status || "unknown"}`,
    });
  }

  // 2) No hay pod => crear UNO SOLO
  await setState({ status: "CREATING", busy: false, pod_id: null, worker_url: null });

  const created = await runpodCreatePodFromTemplate({ name: `isabela-video-${Date.now()}`, log });
  const newPodId = created.podId;

  await setState({ status: "STARTING", busy: false, pod_id: newPodId, worker_url: null });

  // 3) hacer ready
  const make = await tryMakeReady(newPodId);
  if (!make.ok) {
    // si falla el pod nuevo => terminate y limpiar
    try { await runpodTerminatePod(newPodId); } catch {}
    await setState({
      status: "IDLE",
      busy: false,
      pod_id: null,
      worker_url: null,
      last_error: `new pod failed (${make.step}): ${make.error || make.status || "unknown"}`,
    });
    throw new Error(`Pod nuevo falló (${make.step}). Intenta de nuevo.`);
  }

  await setState({ status: "RUNNING", busy: false, pod_id: newPodId, worker_url: make.workerUrl });

  return { podId: newPodId, workerUrl: make.workerUrl, action: "CREADO_Y_LISTO", createAttempt: created.attempt };
}

// ---------------------------
// Buscar job activo del usuario
// ---------------------------
async function getActiveJobForUser(sb, user_id) {
  const { data, error } = await sb
    .from(VIDEO_JOBS_TABLE)
    .select("*")
    .eq("user_id", user_id)
    .in("status", ACTIVE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return data?.[0] || null;
}

// ---------------------------
// Prompt final (optimizado o normal)
// ---------------------------
function pickFinalPrompts(body) {
  const prompt = String(body?.prompt || "").trim();
  const negative = String(body?.negative_prompt || body?.negative || "").trim();

  const useOptimized = body?.use_optimized === true || body?.useOptimized === true;

  const optPrompt = String(body?.optimized_prompt || body?.optimizedPrompt || "").trim();
  const optNeg = String(body?.optimized_negative_prompt || body?.optimizedNegativePrompt || "").trim();

  const usingOptimized = Boolean(useOptimized && optPrompt);
  const finalPrompt = usingOptimized ? optPrompt : prompt;
  const finalNegative = usingOptimized ? optNeg : negative;

  return { finalPrompt, finalNegative, usingOptimized };
}

// ---------------------------
// Handler
// ---------------------------
export default async function handler(req, res) {
  const log = (...args) => console.log("[GV]", ...args);
  let lockAcquired = false;

  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });

    const auth = await requireUser(req); // NO TOCO _auth.js
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });

    const user_id = auth.user.id;
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const sb = sbAdmin();

    // A) si ya hay job activo => devolverlo
    const active = await getActiveJobForUser(sb, user_id);
    if (active) {
      return res.status(200).json({
        ok: true,
        status: "ALREADY_RUNNING",
        job_id: active.job_id || active.id,
        job: active,
      });
    }

    // B) prompts finales
    const { finalPrompt, finalNegative, usingOptimized } = pickFinalPrompts(body);
    if (!finalPrompt) return res.status(400).json({ ok: false, error: "Falta prompt" });

    // C) lock para ensure pod (evitar 2 pods)
    const lock = await tryAcquireLockAtomic(sb, WAKE_LOCK_SECONDS);
    if (!lock.ok) {
      return res.status(200).json({
        ok: true,
        status: "LOCK_BUSY",
        retry_after_ms: 2500,
        message: "Motor ocupado despertando. Intentá de nuevo.",
      });
    }
    lockAcquired = true;

    // D) ensure pod
    log("step=ENSURE_POD_BEGIN");
    const podInfo = await ensureWorkingPod(sb, log);
    log("step=ENSURE_POD_OK", podInfo);

    // liberar lock YA
    await releaseLock(sb);
    lockAcquired = false;

    // E) dispatch al worker (ASYNC)
    const payload = {
      user_id,
      mode: body.mode || "t2v",
      prompt: finalPrompt,
      negative_prompt: finalNegative,
      steps: body.steps,
      height: body.height,
      width: body.width,
      num_frames: body.num_frames,
      fps: body.fps,
      guidance_scale: body.guidance_scale,
      image_base64: body.image_base64 || null,
    };

    const dispatchUrl = `${podInfo.workerUrl}${WORKER_ASYNC_PATH}`;
    log("step=DISPATCH_BEGIN", dispatchUrl);

    const rr = await fetch(dispatchUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const tt = await rr.text().catch(() => "");
    if (!rr.ok) {
      // Si dispatch falla (404/502) -> terminate pod (regla tuya) y dejar retry friendly
      try { await runpodTerminatePod(podInfo.podId); } catch {}
      await sb.from(POD_STATE_TABLE).upsert([{
        id: 1,
        pod_id: null,
        worker_url: null,
        status: "IDLE",
        busy: false,
        last_error: `dispatch failed (${rr.status}): ${tt.slice(0, 200)}`,
        last_used_at: new Date().toISOString(),
      }]);

      return res.status(200).json({
        ok: false,
        retry: true,
        message: "El motor está arrancando. Intentá de nuevo.",
        detail: `dispatch failed (${rr.status})`,
      });
    }

    // IMPORTANTE: aquí arreglamos tu “No se recibió job_id”
    let j = null;
    try { j = JSON.parse(tt); } catch { j = null; }

    const job_id = j?.job_id || j?.id || j?.jobId || null;

    // si el worker no devolvió job_id => NO DEJAMOS AL FRONT BOTADO
    if (!job_id) {
      return res.status(200).json({
        ok: false,
        retry: true,
        message: "El motor respondió sin job_id. Intentá de nuevo.",
        raw: tt?.slice(0, 200) || "",
      });
    }

    return res.status(200).json({
      ok: true,
      status: "PENDING",
      job_id,
      pod: { podId: podInfo.podId, action: podInfo.action },
      using_optimized: usingOptimized,
      used_prompt: finalPrompt,
      used_negative_prompt: finalNegative,
    });

  } catch (e) {
    const msg = String(e?.message || e);
    console.error("[GV] fatal:", msg);

    // Respuesta amigable (no rojo)
    return res.status(200).json({
      ok: false,
      retry: true,
      message: "Intentá de nuevo. Estamos despertando el motor.",
      detail: msg.slice(0, 200),
    });

  } finally {
    if (lockAcquired) {
      try {
        const sb = sbAdmin();
        await releaseLock(sb);
      } catch {}
    }
  }
}