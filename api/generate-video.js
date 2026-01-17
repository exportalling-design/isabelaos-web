// /api/generate-video.js
// ============================================================
// IsabelaOS Studio — API de Generación de Video (Vercel Function)
// MODO: ASYNC REAL (worker encola y runner procesa)
// CLAVE: si ya hay job activo => devuelve ese job_id (no crea otro)
//
// ✅ SOLO CAMBIO: soporta prompt automatizado (optimizado):
// - acepta { optimized_prompt, optimized_negative_prompt, use_optimized }
// - manda al worker el prompt FINAL (optimizado o normal)
// - devuelve al frontend { used_prompt, used_negative_prompt, using_optimized }
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

const VIDEO_GPU_TYPE_IDS = (process.env.VIDEO_GPU_TYPE_IDS || "").trim();
const VIDEO_GPU_CLOUD_TYPE = (process.env.VIDEO_GPU_CLOUD_TYPE || "ALL").trim();
const VIDEO_GPU_COUNT = parseInt(process.env.VIDEO_GPU_COUNT || "1", 10);
const VIDEO_GPU_FALLBACK_ON_FAIL =
String(process.env.VIDEO_GPU_FALLBACK_ON_FAIL || "1") === "1";

const WORKER_PORT = parseInt(process.env.WORKER_PORT || "8000", 10);
const WORKER_HEALTH_PATH = process.env.WORKER_HEALTH_PATH || "/health";
const WORKER_ASYNC_PATH = process.env.WORKER_ASYNC_PATH || "/api/video_async";

const WAIT_WORKER_TIMEOUT_MS = parseInt(
process.env.WAIT_WORKER_TIMEOUT_MS || "180000",
10
);
const WAIT_WORKER_INTERVAL_MS = parseInt(
process.env.WAIT_WORKER_INTERVAL_MS || "2500",
10
);

const WAIT_RUNNING_TIMEOUT_MS = parseInt(
process.env.WAIT_RUNNING_TIMEOUT_MS || "240000",
10
);
const WAIT_RUNNING_INTERVAL_MS = parseInt(
process.env.WAIT_RUNNING_INTERVAL_MS || "3500",
10
);

const WAKE_LOCK_SECONDS = parseInt(process.env.WAKE_LOCK_SECONDS || "60", 10);

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
Authorization: Bearer ${RUNPOD_API_KEY},
"Content-Type": "application/json",
};
}

function workerBaseUrl(podId) {
return https://${podId}-${WORKER_PORT}.proxy.runpod.net;
}

function sleep(ms) {
return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------
// RunPod REST v1 helpers
// ---------------------------
async function runpodGetPod(podId) {
const r = await fetch(https://rest.runpod.io/v1/pods/${podId}, {
method: "GET",
headers: runpodHeaders(),
});
const t = await r.text().catch(() => "");
if (!r.ok) throw new Error(RunPod get pod falló (${r.status}): ${t});
try {
return JSON.parse(t);
} catch {
return { raw: t };
}
}

async function runpodStartPod(podId) {
const r = await fetch(https://rest.runpod.io/v1/pods/${podId}/start, {
method: "POST",
headers: runpodHeaders(),
});
if (r.ok) return true;
const t = await r.text().catch(() => "");
return { ok: false, status: r.status, raw: t };
}

async function runpodTerminatePod(podId) {
const r1 = await fetch(https://rest.runpod.io/v1/pods/${podId}/terminate, {
method: "POST",
headers: runpodHeaders(),
});
if (r1.ok) return true;

const r2 = await fetch(https://rest.runpod.io/v1/pods/${podId}, {
method: "DELETE",
headers: runpodHeaders(),
});
if (r2.ok) return true;

const t = await r2.text().catch(() => "");
throw new Error(RunPod terminate falló: ${t});
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
error: Pod no llegó a RUNNING en ${WAIT_RUNNING_TIMEOUT_MS}ms,
};
}

async function waitForWorker(podId) {
const base = workerBaseUrl(podId);
const url = ${base}${WORKER_HEALTH_PATH};
const start = Date.now();

while (Date.now() - start < WAIT_WORKER_TIMEOUT_MS) {
try {
const r = await fetch(url, { method: "GET" });
if (r.ok) return { ok: true, url };
} catch (_) {}
await sleep(WAIT_WORKER_INTERVAL_MS);
}
return { ok: false, error: Worker no respondió tras ${WAIT_WORKER_TIMEOUT_MS}ms, url };
}

// ---------------------------
// LOCK (atómico) — SOLO para ensure pod
// ---------------------------
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
const r = await fetch(https://rest.runpod.io/v1/pods, {
method: "POST",
headers: runpodHeaders(),
body: JSON.stringify(payload),
});

const t = await r.text().catch(() => "");
if (!r.ok) {
const err = new Error(RunPod create failed (${r.status}): ${t});
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
if (!podId)
throw new Error(RunPod create no devolvió podId. Respuesta: ${t});

return { podId, raw: json };
}

async function runpodCreatePodFromTemplate({ name, log }) {
if (!VIDEO_RUNPOD_TEMPLATE_ID) throw new Error("Falta VIDEO_RUNPOD_TEMPLATE_ID");
if (!VIDEO_RUNPOD_NETWORK_VOLUME_ID)
throw new Error("Falta VIDEO_RUNPOD_NETWORK_VOLUME_ID");

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
if (log)
log(createPod attempt=${a.label}, {
hasGpuTypeIds: Boolean(a.payload.gpuTypeIds),
cloudType: a.payload.cloudType || null,
gpuCount: a.payload.gpuCount,
});
const created = await runpodCreatePodOnce(a.payload);
return { ...created, attempt: a.label, used: a.payload };
} catch (e) {
lastErr = e;
if (log) log(createPod failed attempt=${a.label}, String(e?.message || e));
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

if (!statePodId) {
const created = await runpodCreatePodFromTemplate({
name: isabela-video-${Date.now()},
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
if (!running.ok)  
  throw new Error(  
    `Pod nuevo no llegó a RUNNING: ${running.error || running.status}`  
  );  

const ready = await waitForWorker(created.podId);  
if (!ready.ok)  
  throw new Error(`Worker no listo tras crear pod: ${ready.error}`);  

await touch("RUNNING", false);  
return {  
  podId: created.podId,  
  action: "CREADO_Y_LISTO",  
  createAttempt: created.attempt,  
};

}

try {
await runpodGetPod(statePodId);

const st = await runpodStartPod(statePodId);  
if (st !== true) log("warn=startPod failed (ignored)", st);  

const running = await waitForRunning(statePodId);  
if (!running.ok)  
  throw new Error(`Pod no RUNNING: ${running.error || running.status}`);  

const ready = await waitForWorker(statePodId);  
if (!ready.ok)  
  throw new Error(`Worker no respondió en pod existente: ${ready.error}`);  

await touch("RUNNING", false);  
return { podId: statePodId, action: "REUSADO" };

} catch (e) {
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
if (!running.ok)  
  throw new Error(`Pod nuevo no RUNNING: ${running.error || running.status}`);  

const ready = await waitForWorker(created.podId);  
if (!ready.ok)  
  throw new Error(`Worker no listo tras recrear pod: ${ready.error}`);  

await touch("RUNNING", false);  

await runpodTerminatePod(oldPodId).catch(() => {});  
return {  
  podId: created.podId,  
  action: "RECREADO",  
  oldPodId,  
  createAttempt: created.attempt,  
};

}
}

// ---------------------------
// 1) Buscar job activo del usuario (para no crear otro)
// ---------------------------
async function getActiveJobForUser(sb, user_id) {
const { data, error } = await sb
.from(VIDEO_JOBS_TABLE)
.select(
"id,status,progress,eta_seconds,queue_position,video_url,error,created_at,updated_at"
)
.eq("user_id", user_id)
.in("status", ACTIVE_STATUSES)
.order("created_at", { ascending: false })
.limit(1);

if (error) throw error;
return data?.[0] || null;
}

// ---------------------------
// ✅ SOLO AÑADIDO: resolver prompt final (optimizado o normal)
// ---------------------------
function pickFinalPrompts(body) {
const prompt = String(body?.prompt || "").trim();
const negative = String(body?.negative_prompt || "").trim();

const useOptimized =
body?.use_optimized === true || body?.useOptimized === true;

const optPrompt = String(
body?.optimized_prompt || body?.optimizedPrompt || ""
).trim();
const optNeg = String(
body?.optimized_negative_prompt || body?.optimizedNegativePrompt || ""
).trim();

const usingOptimized = Boolean(useOptimized && optPrompt);
const finalPrompt = usingOptimized ? optPrompt : prompt;
const finalNegative = usingOptimized ? optNeg : negative;

return { finalPrompt, finalNegative, usingOptimized };
}

// ---------------------------
// Handler principal
// ---------------------------
export default async function handler(req, res) {
const log = (...args) => console.log("[GV]", ...args);

let lockAcquired = false;

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
  steps,  
  height,  
  width,  
  num_frames,  
  fps,  
  guidance_scale,  
  image_base64 = null,  
} = body;  

// ✅ SOLO CAMBIO: usar prompt final  
const { finalPrompt, finalNegative, usingOptimized } = pickFinalPrompts(body);  

if (!finalPrompt) {  
  return res.status(400).json({ ok: false, error: "Falta prompt" });  
}  

const sb = sbAdmin();  

// A) Si ya hay job activo, devolvelo y NO crees otro  
const active = await getActiveJobForUser(sb, user_id);  
if (active) {  
  return res.status(200).json({  
    ok: true,  
    status: "ALREADY_RUNNING",  
    job_id: active.id,  
    job: active,  

    // ✅ para UI  
    using_optimized: usingOptimized,  
    used_prompt: finalPrompt,  
    used_negative_prompt: finalNegative,  
  });  
}  

// B) Lock SOLO para ensurePod  
log("step=LOCK_BEGIN");  
const lock = await tryAcquireLockAtomic(sb, WAKE_LOCK_SECONDS);  
if (!lock.ok) {  
  log("step=LOCK_BUSY");  
  return res.status(200).json({  
    ok: true,  
    status: "LOCK_BUSY",  
    retry_after_ms: 2500,  

    // ✅ para UI  
    using_optimized: usingOptimized,  
    used_prompt: finalPrompt,  
    used_negative_prompt: finalNegative,  
  });  
}  
lockAcquired = true;  
log("step=LOCK_OK", { locked_until: lock.locked_until });  

// 2) Ensure pod  
log("step=ENSURE_POD_BEGIN");  
const podInfo = await ensureWorkingPod(sb, log);  
log("step=ENSURE_POD_OK", podInfo);  

// C) Liberar lock YA  
await releaseLock(sb);  
lockAcquired = false;  
log("step=LOCK_RELEASED");  

// 3) Dispatch ASYNC REAL al worker  
const podId = podInfo.podId;  
const dispatchUrl = `${workerBaseUrl(podId)}${WORKER_ASYNC_PATH}`;  

// ✅ SOLO CAMBIO: prompt final  
const payload = {  
  user_id,  
  mode,  
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

log("step=DISPATCH_BEGIN", {  
  dispatchUrl,  
  usingOptimized,  
  promptLen: String(finalPrompt || "").length,  
});  

const rr = await fetch(dispatchUrl, {  
  method: "POST",  
  headers: { "Content-Type": "application/json" },  
  body: JSON.stringify(payload),  
});  

const tt = await rr.text().catch(() => "");  
if (!rr.ok) throw new Error(`Worker dispatch failed (${rr.status}): ${tt}`);  

let j = null;  
try {  
  j = JSON.parse(tt);  
} catch {  
  j = null;  
}  

const job_id = j?.job_id || j?.id || null;  
if (!job_id) throw new Error(`Worker no devolvió job_id. Respuesta: ${tt}`);  

return res.status(200).json({  
  ok: true,  
  status: "PENDING",  
  job_id,  
  pod: podInfo,  
  dispatch: { ok: true, url: dispatchUrl },  

  // ✅ para UI  
  using_optimized: usingOptimized,  
  used_prompt: finalPrompt,  
  used_negative_prompt: finalNegative,  
});

} catch (e) {
const msg = String(e?.message || e);
console.error("[GV] fatal:", msg);
return res.status(500).json({ ok: false, error: msg });
} finally {
if (lockAcquired) {
try {
const sb = sbAdmin();
await releaseLock(sb);
} catch {}
}
}
} Y // /api/video-status.js
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const VIDEO_JOBS_TABLE = process.env.VIDEO_JOBS_TABLE || "video_jobs";

// Para fallback si queue_position no está guardado (calcula vivo)
const QUEUE_STATUSES = ["PENDING", "IN_QUEUE", "QUEUED", "DISPATCHED", "IN_PROGRESS"];
const ACTIVE_STATUSES = [...QUEUE_STATUSES, "RUNNING"];

function sbAdmin() {
if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
auth: { persistSession: false },
});
}

function normStatus(s) {
const t = String(s || "").trim();
if (!t) return "PENDING";
return t.toUpperCase();
}

function shapeResponseFromJob(job) {
const status = normStatus(job.status);

const progress =
typeof job.progress === "number"
? job.progress
: job.progress != null
? Number(job.progress)
: 0;

let queue_position =
typeof job.queue_position === "number"
? job.queue_position
: job.queue_position != null
? Number(job.queue_position)
: null;

let eta_seconds =
typeof job.eta_seconds === "number"
? job.eta_seconds
: job.eta_seconds != null
? Number(job.eta_seconds)
: null;

if (status === "RUNNING") queue_position = 0;

return {
ok: true,
// ✅ devolvemos ambos IDs para que el frontend sea consistente
id: job.id ?? null, // PK (si existe)
job_id: job.job_id ?? null, // ✅ el que tú usas en el flujo
status,
progress: Math.max(0, Math.min(100, Number(progress || 0))),
queue_position: queue_position != null ? Math.max(0, Number(queue_position)) : null,
eta_seconds: eta_seconds != null ? Math.max(0, Number(eta_seconds)) : null,
video_url: job.video_url || null,
error: job.error || null,
created_at: job.created_at || null,
updated_at: job.updated_at || null,
};
}

export default async function handler(req, res) {
try {
// ✅ Auth primero (soporta llamada sin jobId)
const auth = await requireUser(req);
if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });
const user_id = auth.user.id;

const sb = sbAdmin();  

const jobIdRaw =  
  (req.query?.jobId ||  
    req.query?.job_id ||  
    req.query?.jobID ||  
    req.query?.id ||  
    "").toString().trim();  

// ✅ Nuevo: mode opcional para el fallback sin jobId ("i2v" o "t2v")  
const mode = String(req.query?.mode || "").trim() || null;  

// -------------------------------------------------------  
// 0) Si NO viene jobId -> devolver job activo más reciente  
// -------------------------------------------------------  
if (!jobIdRaw) {  
  let q = sb  
    .from(VIDEO_JOBS_TABLE)  
    .select("*")  
    .eq("user_id", user_id)  
    .in("status", ACTIVE_STATUSES)  
    .order("created_at", { ascending: false })  
    .limit(1);  

  // Filtro opcional por payload.mode (JSONB)  
  if (mode) q = q.eq("payload->>mode", mode);  

  const { data, error } = await q;  

  if (error) {  
    return res.status(500).json({ ok: false, error: error.message || "DB error" });  
  }  

  const job = data?.[0] || null;  

  // Si no hay job activo, responde IDLE (sin romper UI)  
  if (!job) {  
    return res.status(200).json({  
      ok: true,  
      id: null,  
      job_id: null,  
      status: "IDLE",  
      progress: 0,  
      queue_position: null,  
      eta_seconds: null,  
      video_url: null,  
      error: null,  
      created_at: null,  
      updated_at: null,  
    });  
  }  

  return res.status(200).json(shapeResponseFromJob(job));  
}  

// -------------------------------------------------------  
// 1) ✅ Buscar por job_id primero (TU FLUJO REAL)  
// 2) Fallback: buscar por id (compatibilidad)  
// -------------------------------------------------------  
let job = null;  

// 1) job_id  
{  
  const r1 = await sb  
    .from(VIDEO_JOBS_TABLE)  
    .select("*")  
    .eq("job_id", jobIdRaw)  
    .eq("user_id", user_id)  
    .maybeSingle();  

  if (!r1.error && r1.data) job = r1.data;  
}  

// 2) id (fallback)  
if (!job) {  
  const r2 = await sb  
    .from(VIDEO_JOBS_TABLE)  
    .select("*")  
    .eq("id", jobIdRaw)  
    .eq("user_id", user_id)  
    .maybeSingle();  

  if (!r2.error && r2.data) job = r2.data;  
}  

if (!job) return res.status(404).json({ ok: false, error: "Job not found" });  

const status = normStatus(job.status);  

const progress =  
  typeof job.progress === "number"  
    ? job.progress  
    : job.progress != null  
    ? Number(job.progress)  
    : 0;  

let queue_position =  
  typeof job.queue_position === "number"  
    ? job.queue_position  
    : job.queue_position != null  
    ? Number(job.queue_position)  
    : null;  

let eta_seconds =  
  typeof job.eta_seconds === "number"  
    ? job.eta_seconds  
    : job.eta_seconds != null  
    ? Number(job.eta_seconds)  
    : null;  

// Fallback: si no está guardado queue_position, lo calculamos en vivo  
// (ojo: esto cuenta global, si quieres por usuario/mode lo ajusto)  
if (  
  (queue_position == null || Number.isNaN(queue_position)) &&  
  QUEUE_STATUSES.includes(status) &&  
  job.created_at  
) {  
  const { count } = await sb  
    .from(VIDEO_JOBS_TABLE)  
    .select("id", { count: "exact", head: true })  
    .in("status", QUEUE_STATUSES)  
    .lt("created_at", job.created_at);  

  if (typeof count === "number") queue_position = count + 1;  
}  

if (status === "RUNNING") queue_position = 0;  

return res.status(200).json({  
  ok: true,  
  id: job.id ?? null,  
  job_id: job.job_id ?? null, // ✅ clave para tu frontend  
  status,  
  progress: Math.max(0, Math.min(100, Number(progress || 0))),  
  queue_position: queue_position != null ? Math.max(0, Number(queue_position)) : null,  
  eta_seconds: eta_seconds != null ? Math.max(0, Number(eta_seconds)) : null,  
  video_url: job.video_url || null,  
  error: job.error || null,  
  created_at: job.created_at || null,  
  updated_at: job.updated_at || null,  
});

} catch (e) {
console.error("[video-status] fatal:", e);
return res.status(500).json({ ok: false, error: String(e?.message || e) });
}
}