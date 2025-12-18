// /api/generate-video.js
// ============================================================
// IsabelaOS Studio - Video Generate API (Vercel Serverless Function)
//
// MODO B (Pods): crea Pod nuevo por job y DISPATCH async (sin esperar MP4)
//
// Flujo:
// 1) Lock Supabase (pod_lock) para evitar 2 pods simultáneos
// 2) Crea pod nuevo desde template + network volume
// 3) Espera RUNNING/READY
// 4) Espera worker listo (/health)
// 5) Crea job_id (uuid) y guarda en video_jobs (QUEUED)
// 6) DISPATCH al worker /api/video_async y espera SOLO respuesta rápida (202)
// 7) Responde al frontend { ok:true, job_id } inmediato
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

// Clamps (para que “mínimo” pruebe rápido)
const MAX_STEPS = parseInt(process.env.VIDEO_MAX_STEPS || "25", 10);

// ✅ “modo prueba rápida”: si existe, fuerza valores mínimos SIN romper si tu worker no los usa
const FAST_TEST_MODE = (process.env.VIDEO_FAST_TEST_MODE || "0") === "1";

// Tablas Supabase
const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";
const VIDEO_JOBS_TABLE = "video_jobs";

// Timing
const LOCK_SECONDS = 180;
const READY_TIMEOUT_MS = 12 * 60 * 1000;
const POLL_MS = 3000;

const WORKER_READY_TIMEOUT_MS = 10 * 60 * 1000;
const HEALTH_FETCH_TIMEOUT_MS = 8000;

// ✅ IMPORTANTE: aquí NO esperamos generación; solo dispatch rápido al worker
const DISPATCH_TIMEOUT_MS = 15000;

// =====================
// Helpers
// =====================
function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL (o VITE_SUPABASE_URL)");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setPodState(sb, patch) {
  const { error } = await sb.from(POD_STATE_TABLE).update(patch).eq("id", 1);
  if (error) throw error;
}

function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY / VIDEO_RUNPOD_API_KEY");
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

// =====================
// Worker readiness
// =====================
async function waitForWorkerReady(workerBase, maxMs = WORKER_READY_TIMEOUT_MS) {
  const start = Date.now();
  const base = workerBase.endsWith("/") ? workerBase.slice(0, -1) : workerBase;

  const candidates = [`${base}/health`, `${base}/api/video_async`, `${base}/api/video`];
  let lastInfo = "no-attempt";

  while (Date.now() - start < maxMs) {
    for (const url of candidates) {
      try {
        const r = await fetchWithTimeout(url, { method: "GET" }, HEALTH_FETCH_TIMEOUT_MS);
        const txt = await r.text().catch(() => "");
        console.log("[GV] waitWorker url=", url, "status=", r.status, "body=", txt.slice(0, 120));

        // OK o endpoints que no permiten GET (405)
        if (r.ok) return true;
        if (r.status === 405) return true;

        lastInfo = `${url} -> ${r.status} ${txt.slice(0, 120)}`;
      } catch (e) {
        lastInfo = `${url} -> ERR ${String(e)}`;
        console.log("[GV] waitWorker error url=", url, "err=", String(e));
      }
    }
    await sleep(2500);
  }

  throw new Error("Worker not ready. Último: " + lastInfo);
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
// RunPod: crear pod (modo B)
// =====================
async function runpodCreatePodFromTemplate() {
  if (!VIDEO_RUNPOD_TEMPLATE_ID) {
    throw new Error("Falta VIDEO_RUNPOD_TEMPLATE_ID");
  }
  if (!VIDEO_RUNPOD_NETWORK_VOLUME_ID) {
    throw new Error("Falta VIDEO_RUNPOD_NETWORK_VOLUME_ID (necesario para /workspace)");
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
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, { headers: runpodHeaders() });
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
  let lastSample = "";

  while (Date.now() - start < READY_TIMEOUT_MS) {
    const pod = await runpodGetPod(podId);
    const status = pickPodStatus(pod);

    if (!status) {
      const sample = {
        keys: Object.keys(pod || {}),
        status: pod?.status,
        state: pod?.state,
        desiredStatus: pod?.desiredStatus,
        runtime: pod?.runtime,
      };
      lastSample = JSON.stringify(sample).slice(0, 900);
      console.log("[GV] waitRunning status=EMPTY sample=", lastSample, "podId=", podId);
    } else {
      console.log("[GV] waitRunning status=", status, "podId=", podId);
    }

    if (status === "RUNNING" || status === "READY" || status === "ACTIVE") return pod;
    await sleep(POLL_MS);
  }

  throw new Error("Timeout: pod no llegó a RUNNING/READY. Last: " + lastSample);
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
// Job helpers (Supabase)
// =====================
async function createVideoJob(sb, job) {
  const { error } = await sb.from(VIDEO_JOBS_TABLE).insert(job);
  if (error) throw error;
}

async function updateVideoJob(sb, job_id, patch) {
  const { error } = await sb.from(VIDEO_JOBS_TABLE).update(patch).eq("job_id", job_id);
  if (error) throw error;
}

// =====================
// Main: crea pod y asegura worker arriba
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
// API route
// =====================
export default async function handler(req, res) {
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

    // clamp steps (igual que tu script)
    const requestedSteps =
      typeof payloadRaw.steps === "number"
        ? payloadRaw.steps
        : (typeof payloadRaw.num_inference_steps === "number" ? payloadRaw.num_inference_steps : null);

    const safeSteps = requestedSteps == null ? MAX_STEPS : Math.min(requestedSteps, MAX_STEPS);

    // “mínimo” de prueba (si lo activas por ENV, no rompe si tu worker ignora campos)
    const maybeFast = FAST_TEST_MODE
      ? {
          steps: Math.min(safeSteps, 8),
          // sugerencias “rápidas” (tu worker puede ignorar)
          num_frames: 8,
          fps: 6,
          width: 384,
          height: 672,
        }
      : { steps: safeSteps };

    const payload = {
      user_id: payloadRaw.user_id || "web-user",
      ...payloadRaw,
      ...maybeFast,
    };

    console.log("[GV] payload steps=", payload.steps, "MAX_STEPS=", MAX_STEPS, "FAST_TEST_MODE=", FAST_TEST_MODE);

    // 1) Pod nuevo + worker ready
    const fresh = await ensureFreshPod(sb);
    podId = fresh.podId;

    // 2) Crea job en Supabase
    const job_id = crypto.randomUUID();
    console.log("[GV] step=JOB_CREATE", "job_id=", job_id);

    await createVideoJob(sb, {
      job_id,
      user_id: payloadRaw.user_id || null,
      status: "QUEUED",
      payload,
      pod_id: podId,
      worker_url: fresh.workerUrl,
      updated_at: new Date().toISOString(),
    });

    // 3) Dispatch al worker (async endpoint)
    const dispatchUrl = `${fresh.workerUrl}/api/video_async`;
    console.log("[GV] step=DISPATCH_BEGIN url=", dispatchUrl);

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
    console.log("[GV] step=DISPATCH_RESPONSE status=", r.status, "body=", txt.slice(0, 200));

    if (r.status !== 202 && r.status !== 200) {
      await updateVideoJob(sb, job_id, {
        status: "ERROR",
        error: `Worker dispatch failed: ${r.status} ${txt.slice(0, 200)}`,
        updated_at: new Date().toISOString(),
      });
      throw new Error(`Worker dispatch failed: ${r.status}`);
    }

    // ============================
    // ✅ CAMBIO ÚNICO:
    // Normaliza respuesta del worker:
    // - A veces devuelve JSON tipo: [ {ok:true,...}, 202 ]
    // - A veces devuelve objeto normal
    // Guardamos el "reply" normalizado en Supabase para debugging/polling.
    // ============================
    let workerReply = null;
    try {
      const raw = txt ? JSON.parse(txt) : null;
      workerReply = Array.isArray(raw) ? raw[0] : raw;
    } catch {
      workerReply = { raw_text: txt?.slice(0, 500) || "" };
    }

    try {
      await updateVideoJob(sb, job_id, {
        status: workerReply?.status || "IN_PROGRESS",
        worker_reply: workerReply,
        updated_at: new Date().toISOString(),
      });
    } catch (e) {
      console.log("[GV] warn: no pude guardar worker_reply en video_jobs:", String(e));
    }

    // 4) Respuesta inmediata al frontend (sin esperar MP4)
    console.log("[GV] step=DISPATCH_OK job_id=", job_id);

    // Nota: NO terminamos el pod aquí, porque el worker sigue generando.
    // El terminate lo haces cuando el job termine (desde worker) o con un “reaper” después.
    return res.status(200).json({
      ok: true,
      job_id,
      status: "IN_PROGRESS",
      podId,
      worker: fresh.workerUrl,
      note: "Video sigue generándose en el pod. Usa /api/video-status?job_id=...",
    });
  } catch (e) {
    const msg = String(e?.message || e);
    console.error("[GV] ERROR:", msg);

    try {
      if (sb) {
        await setPodState(sb, {
          status: "ERROR",
          last_error: msg,
          last_used_at: new Date().toISOString(),
        });
      }
    } catch {}

    // ⚠️ No hacemos terminate aquí si el worker pudo arrancar; podrías matar un job vivo.
    return res.status(500).json({ ok: false, error: msg, podId });
  }
}
