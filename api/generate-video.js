// /api/generate-video.js
// ============================================================
// IsabelaOS Studio - Video Generate API (Vercel Serverless Function)
//
// FIX DEFINITIVO:
// - NO devuelve MP4 por HTTP (evita 524 del proxy RunPod)
// - El video sigue generándose en el pod (Network Volume)
// - Responde rápido con JSON
// ============================================================

import { createClient } from "@supabase/supabase-js";

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

// Tablas existentes (NO SE TOCAN)
const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";

// Timing
const LOCK_SECONDS = 180;
const READY_TIMEOUT_MS = 12 * 60 * 1000;
const POLL_MS = 3000;

const WORKER_READY_TIMEOUT_MS = 10 * 60 * 1000;
const HEALTH_FETCH_TIMEOUT_MS = 8000;

// 🔥 Timeout SOLO para despachar (NO esperar render)
const DISPATCH_TIMEOUT_MS = 20000;

// =====================
// Helpers
// =====================
function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY)
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setPodState(sb, patch) {
  const { error } = await sb.from(POD_STATE_TABLE).update(patch).eq("id", 1);
  if (error) throw error;
}

function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY");
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
// Worker readiness (SIN CAMBIOS)
// =====================
async function waitForWorkerReady(workerBase, maxMs = WORKER_READY_TIMEOUT_MS) {
  const start = Date.now();
  const base = workerBase.endsWith("/") ? workerBase.slice(0, -1) : workerBase;

  while (Date.now() - start < maxMs) {
    try {
      const r = await fetchWithTimeout(
        `${base}/health`,
        { method: "GET" },
        HEALTH_FETCH_TIMEOUT_MS
      );
      if (r.ok) return true;
    } catch {}
    await sleep(2500);
  }

  throw new Error("Worker not ready");
}

// =====================
// Lock (SIN CAMBIOS)
// =====================
async function acquireLock(sb) {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + LOCK_SECONDS * 1000).toISOString();

  const { data, error } = await sb
    .from(POD_LOCK_TABLE)
    .select("*")
    .eq("id", 1)
    .single();

  if (error) throw error;

  const current = data.locked_until ? new Date(data.locked_until) : null;
  if (current && current > now) return false;

  await sb.from(POD_LOCK_TABLE).update({ locked_until: lockedUntil }).eq("id", 1);
  return true;
}

// =====================
// RunPod
// =====================
async function runpodCreatePodFromTemplate() {
  if (!VIDEO_RUNPOD_TEMPLATE_ID)
    throw new Error("Missing VIDEO_RUNPOD_TEMPLATE_ID");
  if (!VIDEO_RUNPOD_NETWORK_VOLUME_ID)
    throw new Error("Missing VIDEO_RUNPOD_NETWORK_VOLUME_ID");

  const r = await fetch("https://rest.runpod.io/v1/pods", {
    method: "POST",
    headers: runpodHeaders(),
    body: JSON.stringify({
      name: `isabela-video-${Date.now()}`,
      templateId: VIDEO_RUNPOD_TEMPLATE_ID,
      networkVolumeId: VIDEO_RUNPOD_NETWORK_VOLUME_ID,
      volumeMountPath: VIDEO_VOLUME_MOUNT_PATH,
    }),
  });

  const data = await r.json().catch(() => ({}));
  if (!data?.id) throw new Error("RunPod no devolvió podId");
  return data.id;
}

async function runpodGetPod(podId) {
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, {
    headers: runpodHeaders(),
  });
  const data = await r.json();
  return data?.pod || data;
}

async function runpodWaitUntilRunning(podId) {
  const start = Date.now();
  while (Date.now() - start < READY_TIMEOUT_MS) {
    const pod = await runpodGetPod(podId);
    const status = String(pod?.status || "").toUpperCase();
    if (status === "RUNNING" || status === "READY") return;
    await sleep(POLL_MS);
  }
  throw new Error("Pod no llegó a RUNNING");
}

function buildProxyUrl(podId) {
  return `https://${podId}-8000.proxy.runpod.net`;
}

// =====================
// Main: crea pod y asegura worker arriba
// =====================
async function ensureFreshPod(sb) {
  await acquireLock(sb);

  await setPodState(sb, { status: "CREATING" });

  const podId = await runpodCreatePodFromTemplate();

  await setPodState(sb, { status: "STARTING", pod_id: podId });

  await runpodWaitUntilRunning(podId);

  const workerUrl = buildProxyUrl(podId);

  await setPodState(sb, {
    status: "RUNNING",
    pod_id: podId,
    worker_url: workerUrl,
  });

  await waitForWorkerReady(workerUrl);

  return { podId, workerUrl };
}

// =====================
// API route
// =====================
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false });
  }

  let sb = null;
  let podId = null;

  try {
    console.log("[GV] START");
    sb = sbAdmin();

    const payload =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;

    // 1) Pod + worker
    const fresh = await ensureFreshPod(sb);
    podId = fresh.podId;

    const url = `${fresh.workerUrl}/api/video`;

    await setPodState(sb, { status: "BUSY" });

    // 2) 🔥 DISPATCH (NO ESPERAR RESULTADO)
    await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      DISPATCH_TIMEOUT_MS
    );

    console.log("[GV] DISPATCH OK - video sigue generándose en el pod");

    // 3) RESPUESTA RÁPIDA (NO 524)
    return res.status(200).json({
      ok: true,
      status: "PROCESSING",
      pod_id: podId,
      message: "Video en generación. No se devuelve por HTTP.",
    });
  } catch (e) {
    console.error("[GV] ERROR:", String(e));
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
