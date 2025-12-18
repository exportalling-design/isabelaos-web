// /api/generate-video.js
// ============================================================
// IsabelaOS Studio - Video Generate API (Vercel Serverless Function)
//
// FIX REAL: Cloudflare/RunPod proxy corta HTTP largo (524).
// Solución mínima: DISPARAR JOB async y hacer polling de estado.
// ============================================================

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

// =====================
// ENV (Vercel)
// =====================
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY =
  process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY || null;

const VIDEO_RUNPOD_TEMPLATE_ID = process.env.VIDEO_RUNPOD_TEMPLATE_ID;

const VIDEO_RUNPOD_NETWORK_VOLUME_ID =
  process.env.VIDEO_RUNPOD_NETWORK_VOLUME_ID ||
  process.env.VIDEO_NETWORK_VOLUME_ID ||
  null;

const VIDEO_VOLUME_MOUNT_PATH = process.env.VIDEO_VOLUME_MOUNT_PATH || "/workspace";

const TERMINATE_AFTER_JOB = (process.env.TERMINATE_AFTER_JOB || "0") === "1";

// Config mínima para pruebas rápidas
const MAX_STEPS = parseInt(process.env.VIDEO_MAX_STEPS || "25", 10);
const TEST_MIN_STEPS = parseInt(process.env.VIDEO_TEST_MIN_STEPS || "8", 10);
const TEST_W = parseInt(process.env.VIDEO_TEST_W || "256", 10);
const TEST_H = parseInt(process.env.VIDEO_TEST_H || "256", 10);

// Tablas Supabase
const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";
const VIDEO_JOBS_TABLE = "video_jobs"; // ← crear esta tabla (ver abajo)

// Timing
const LOCK_SECONDS = 180;
const READY_TIMEOUT_MS = 12 * 60 * 1000; // 12 min
const POLL_MS = 3000;

// Worker checks
const WORKER_READY_TIMEOUT_MS = 10 * 60 * 1000;
const HEALTH_FETCH_TIMEOUT_MS = 8000;

// Para el POST async: no debería tardar
const DISPATCH_TIMEOUT_MS = 25000;

// =====================
// Helpers
// =====================
function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL (o VITE_SUPABASE_URL)");
  if (!SUPABASE_SERVICE_ROLE_KEY)
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (backend only)");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runpodHeaders() {
  if (!RUNPOD_API_KEY)
    throw new Error("Missing RUNPOD_API_KEY / VIDEO_RUNPOD_API_KEY in Vercel");
  return {
    Authorization: `Bearer ${RUNPOD_API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

function makeJobId() {
  return crypto.randomBytes(10).toString("hex"); // 20 chars
}

function normalizeStatus(s) {
  return String(s || "").toUpperCase();
}

// =====================
// Supabase helpers
// =====================
async function setPodState(sb, patch) {
  const { error } = await sb.from(POD_STATE_TABLE).update(patch).eq("id", 1);
  if (error) throw error;
}

async function createJob(sb, job) {
  const { error } = await sb.from(VIDEO_JOBS_TABLE).insert(job);
  if (error) throw error;
}

async function updateJob(sb, job_id, patch) {
  const { error } = await sb.from(VIDEO_JOBS_TABLE).update(patch).eq("job_id", job_id);
  if (error) throw error;
}

async function getJob(sb, job_id) {
  const { data, error } = await sb
    .from(VIDEO_JOBS_TABLE)
    .select("*")
    .eq("job_id", job_id)
    .single();
  if (error) throw error;
  return data;
}

// =====================
// Worker readiness
// =====================
async function waitForWorkerReady(workerBase, maxMs = WORKER_READY_TIMEOUT_MS) {
  const start = Date.now();
  const base = workerBase.endsWith("/") ? workerBase.slice(0, -1) : workerBase;

  // Solo health aquí
  const url = `${base}/health`;
  let lastInfo = "no-attempt";

  while (Date.now() - start < maxMs) {
    try {
      const r = await fetchWithTimeout(url, { method: "GET" }, HEALTH_FETCH_TIMEOUT_MS);
      const txt = await r.text().catch(() => "");
      console.log("[GV] waitWorker url=", url, "status=", r.status, "body=", txt.slice(0, 120));
      if (r.ok) return true;
      lastInfo = `${r.status} ${txt.slice(0, 120)}`;
    } catch (e) {
      lastInfo = `ERR ${String(e)}`;
      console.log("[GV] waitWorker error url=", url, "err=", String(e));
    }
    await sleep(2500);
  }

  throw new Error("Worker not ready. Last: " + lastInfo);
}

// =====================
// Lock (Supabase)
// =====================
async function acquireLock(sb) {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + LOCK_SECONDS * 1000).toISOString();

  const { data: row, error: readErr } = await sb
    .from(POD_LOCK_TABLE)
    .select("*")
    .eq("id", 1)
    .single();

  if (readErr) throw new Error("No existe pod_lock id=1 (crea row en Supabase)");

  const current = row.locked_until ? new Date(row.locked_until) : null;
  if (current && current > now) return { ok: false, locked_until: row.locked_until };

  const { error: updErr } = await sb
    .from(POD_LOCK_TABLE)
    .update({ locked_until: lockedUntil })
    .eq("id", 1);

  if (updErr) return { ok: false, locked_until: row.locked_until };

  return { ok: true, locked_until: lockedUntil };
}

async function waitForUnlock(sb) {
  while (true) {
    const { data, error } = await sb.from(POD_LOCK_TABLE).select("*").eq("id", 1).single();
    if (error) throw error;
    const until = data.locked_until ? new Date(data.locked_until) : null;
    const now = new Date();
    if (!until || until <= now) return true;
    await sleep(1500);
  }
}

// =====================
// RunPod REST
// =====================
async function runpodCreatePodFromTemplate() {
  if (!VIDEO_RUNPOD_TEMPLATE_ID) {
    throw new Error("Falta VIDEO_RUNPOD_TEMPLATE_ID en Vercel");
  }
  if (!VIDEO_RUNPOD_NETWORK_VOLUME_ID) {
    throw new Error("Falta VIDEO_RUNPOD_NETWORK_VOLUME_ID en Vercel");
  }

  const body = {
    name: `isabela-video-${Date.now()}`,
    templateId: VIDEO_RUNPOD_TEMPLATE_ID,
    networkVolumeId: VIDEO_RUNPOD_NETWORK_VOLUME_ID,
    volumeMountPath: VIDEO_VOLUME_MOUNT_PATH,
  };

  const r = await fetch("https://rest.runpod.io/v1/pods", {
    method: "POST",
    headers: runpodHeaders(),
    body: JSON.stringify(body),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`RunPod create pod failed (${r.status}): ${JSON.stringify(data)}`);
  if (!data?.id) throw new Error("RunPod create pod: no devolvió id");
  return data;
}

async function runpodGetPod(podId) {
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, {
    headers: runpodHeaders(),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`RunPod GET pod failed (${r.status}): ${JSON.stringify(data)}`);
  return data?.pod || data;
}

function pickPodStatus(pod) {
  const raw =
    pod?.status ??
    pod?.state ??
    pod?.desiredStatus ??
    pod?.runtime?.status ??
    pod?.pod?.status ??
    "";
  return String(raw || "").toUpperCase();
}

async function runpodWaitUntilRunning(podId) {
  const start = Date.now();
  while (Date.now() - start < READY_TIMEOUT_MS) {
    const pod = await runpodGetPod(podId);
    const status = pickPodStatus(pod);
    console.log("[GV] waitRunning status=", status || "EMPTY", "podId=", podId);
    if (status === "RUNNING" || status === "READY" || status === "ACTIVE") return pod;
    await sleep(POLL_MS);
  }
  throw new Error("Timeout: el pod no llegó a RUNNING/READY a tiempo");
}

async function runpodTerminatePod(podId) {
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, {
    method: "DELETE",
    headers: runpodHeaders(),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`RunPod terminate failed (${r.status}): ${t}`);
  }
  return true;
}

function buildProxyUrl(podId) {
  return `https://${podId}-8000.proxy.runpod.net`;
}

// =====================
// Ensure pod & worker
// =====================
async function ensureFreshPod(sb) {
  console.log("[GV] step=LOCK_BEGIN");
  const got = await acquireLock(sb);

  if (!got.ok) {
    console.log("[GV] step=LOCK_BUSY wait...");
    await waitForUnlock(sb);
    return await ensureFreshPod(sb);
  }

  console.log("[GV] step=LOCK_OK");
  await setPodState(sb, { status: "CREATING", last_used_at: new Date().toISOString() });

  console.log("[GV] step=CREATE_POD_REQUEST");
  const created = await runpodCreatePodFromTemplate();
  const podId = created.id;
  console.log("[GV] created podId=", podId);

  await setPodState(sb, {
    status: "STARTING",
    pod_id: podId,
    worker_url: null,
    last_used_at: new Date().toISOString(),
  });

  console.log("[GV] step=WAIT_RUNNING_BEGIN", { podId });
  await runpodWaitUntilRunning(podId);
  console.log("[GV] step=WAIT_RUNNING_OK", { podId });

  const workerUrl = buildProxyUrl(podId);
  console.log("[GV] workerBase=", workerUrl);

  await setPodState(sb, {
    status: "RUNNING",
    pod_id: podId,
    worker_url: workerUrl,
    last_used_at: new Date().toISOString(),
  });

  console.log("[GV] step=WAIT_WORKER_BEGIN");
  await waitForWorkerReady(workerUrl);
  console.log("[GV] step=WAIT_WORKER_OK");

  return { podId, workerUrl };
}

// =====================
// Main handler
// =====================
export default async function handler(req, res) {
  // ✅ GET => status
  if (req.method === "GET") {
    try {
      const sb = sbAdmin();
      const job_id = req.query?.job_id;
      if (!job_id) return res.status(400).json({ ok: false, error: "missing job_id" });
      const job = await getJob(sb, job_id);
      return res.status(200).json({ ok: true, job });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }

  // ✅ POST => create job
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  let sb = null;
  let podId = null;

  try {
    console.log("[GV] step=START");
    sb = sbAdmin();

    const payloadRaw =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    // -----------------------
    // CONFIG MINIMA DE PRUEBA
    // -----------------------
    const requestedSteps =
      typeof payloadRaw.steps === "number"
        ? payloadRaw.steps
        : (typeof payloadRaw.num_inference_steps === "number" ? payloadRaw.num_inference_steps : null);

    // para pruebas: si no mandan steps, usamos TEST_MIN_STEPS (más rápido)
    const baseSteps = requestedSteps == null ? TEST_MIN_STEPS : requestedSteps;
    const safeSteps = Math.min(baseSteps, MAX_STEPS);

    const payload = {
      user_id: payloadRaw.user_id || "web-user",
      ...payloadRaw,
      steps: safeSteps,

      // si tu worker soporta width/height, forzamos mínimos si no vienen
      width: payloadRaw.width || TEST_W,
      height: payloadRaw.height || TEST_H,

      // hint async (si tu worker lo soporta)
      async: true,
    };

    console.log("[GV] payload steps=", payload.steps, "MAX_STEPS=", MAX_STEPS, "w/h=", payload.width, payload.height);

    // 1) Pod + worker listo
    const fresh = await ensureFreshPod(sb);
    podId = fresh.podId;

    // 2) Crear job en Supabase
    const job_id = makeJobId();
    const createdAt = new Date().toISOString();

    await createJob(sb, {
      job_id,
      status: "QUEUED",
      pod_id: podId,
      worker_url: fresh.workerUrl,
      created_at: createdAt,
      updated_at: createdAt,
      payload: payload, // jsonb
      output_path: `/workspace/outputs/${job_id}.mp4`,
      error: null,
    });

    // 3) DISPATCH async (rápido)
    const url = `${fresh.workerUrl}/api/video`;
    console.log("[GV] step=DISPATCH_BEGIN url=", url, "job_id=", job_id);

    const dispatchBody = { ...payload, job_id };

    const r = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dispatchBody),
      },
      DISPATCH_TIMEOUT_MS
    );

    const ct = (r.headers.get("content-type") || "").toLowerCase();
    const txt = await r.text().catch(() => "");
    console.log("[GV] step=DISPATCH_RESPONSE status=", r.status, "ct=", ct, "body=", txt.slice(0, 250));

    // Si el worker aceptó, marcamos PROCESSING aunque responda 200/202
    if (r.ok) {
      await updateJob(sb, job_id, {
        status: "PROCESSING",
        updated_at: new Date().toISOString(),
      });
    } else {
      await updateJob(sb, job_id, {
        status: "ERROR",
        error: `dispatch_failed_${r.status}: ${txt.slice(0, 500)}`,
        updated_at: new Date().toISOString(),
      });
    }

    // 4) Responder rápido (sin esperar MP4)
    console.log("[GV] step=DONE_ASYNC job_id=", job_id);

    return res.status(200).json({
      ok: true,
      mode: "async",
      job_id,
      podId,
      workerUrl: fresh.workerUrl,
      poll_url: `/api/generate-video?job_id=${job_id}`,
      output_hint: `/workspace/outputs/${job_id}.mp4`,
      terminate_after_job: TERMINATE_AFTER_JOB ? 1 : 0,
    });
  } catch (e) {
    const msg = String(e?.message || e);
    console.error("[GV] ERROR:", msg);
    return res.status(500).json({ ok: false, error: msg, podId });
  }
}
