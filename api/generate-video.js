// /api/generate-video.js
// ============================================================
// IsabelaOS Studio - Video Generate API (Vercel Serverless Function)
//
// FIX: NO devolver MP4 por HTTP (evita 524 del proxy RunPod).
// El video se sigue generando en el pod (Network Volume).
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

const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";

// Timing
const LOCK_SECONDS = 180;
const READY_TIMEOUT_MS = 12 * 60 * 1000;
const POLL_MS = 3000;

const WORKER_READY_TIMEOUT_MS = 10 * 60 * 1000;
const HEALTH_FETCH_TIMEOUT_MS = 8000;

// ⚠️ YA NO IMPORTA QUE SEA LARGO, NO ESPERAMOS EL RESULTADO
const DISPATCH_TIMEOUT_MS = 20000;

// =====================
// Helpers
// =====================
function sbAdmin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setPodState(sb, patch) {
  await sb.from(POD_STATE_TABLE).update(patch).eq("id", 1);
}

function runpodHeaders() {
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
      const r = await fetchWithTimeout(`${base}/health`, {}, HEALTH_FETCH_TIMEOUT_MS);
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

  const { data } = await sb.from(POD_LOCK_TABLE).select("*").eq("id", 1).single();
  const current = data.locked_until ? new Date(data.locked_until) : null;

  if (current && current > now) return false;

  await sb.from(POD_LOCK_TABLE).update({ locked_until: lockedUntil }).eq("id", 1);
  return true;
}

// =====================
// RunPod
// =====================
async function createPod() {
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

  const d = await r.json();
  if (!d?.id) throw new Error("No podId");
  return d.id;
}

function proxyUrl(podId) {
  return `https://${podId}-8000.proxy.runpod.net`;
}

// =====================
// API
// =====================
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false });
  }

  try {
    console.log("[GV] START");
    const sb = sbAdmin();
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    // 1) Lock
    await acquireLock(sb);

    // 2) Pod
    const podId = await createPod();
    const workerUrl = proxyUrl(podId);

    await setPodState(sb, {
      status: "RUNNING",
      pod_id: podId,
      worker_url: workerUrl,
    });

    // 3) Worker ready
    await waitForWorkerReady(workerUrl);

    // 4) 🔥 DISPATCH (NO ESPERAR RESULTADO)
    await fetchWithTimeout(
      `${workerUrl}/api/video`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      DISPATCH_TIMEOUT_MS
    );

    console.log("[GV] DISPATCH OK – video sigue generándose en el pod");

    // 5) RESPONDER ANTES DE QUE EL PROXY CORTE
    return res.status(200).json({
      ok: true,
      status: "PROCESSING",
      pod_id: podId,
      note: "El video se genera en background en el pod (no se devuelve por HTTP).",
    });
  } catch (e) {
    console.error("[GV] ERROR", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
