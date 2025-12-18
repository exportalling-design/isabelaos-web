// /api/generate-video.js
// ============================================================
// IsabelaOS Studio - Video Generate API (Vercel Serverless Function)
//
// FIX FINAL:
// - Mantiene TODOS los logs (evita freeze en Vercel)
// - NO devuelve MP4 por HTTP
// - El video se genera en background en el pod
// ============================================================

import { createClient } from "@supabase/supabase-js";

// =====================
// ENV
// =====================
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY =
  process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY;

const VIDEO_RUNPOD_TEMPLATE_ID = process.env.VIDEO_RUNPOD_TEMPLATE_ID;
const VIDEO_RUNPOD_NETWORK_VOLUME_ID =
  process.env.VIDEO_RUNPOD_NETWORK_VOLUME_ID ||
  process.env.VIDEO_NETWORK_VOLUME_ID;

const VIDEO_VOLUME_MOUNT_PATH = process.env.VIDEO_VOLUME_MOUNT_PATH || "/workspace";

const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";

// Timing
const LOCK_SECONDS = 180;
const READY_TIMEOUT_MS = 12 * 60 * 1000;
const POLL_MS = 3000;

const WORKER_READY_TIMEOUT_MS = 10 * 60 * 1000;
const HEALTH_FETCH_TIMEOUT_MS = 8000;

// 👇 SOLO para disparar (NO esperar render)
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
// Worker readiness
// =====================
async function waitForWorkerReady(workerBase, maxMs = WORKER_READY_TIMEOUT_MS) {
  console.log("[GV] step=WAIT_WORKER_BEGIN");
  const start = Date.now();

  while (Date.now() - start < maxMs) {
    try {
      const r = await fetchWithTimeout(
        `${workerBase}/health`,
        {},
        HEALTH_FETCH_TIMEOUT_MS
      );
      console.log("[GV] waitWorker status=", r.status);
      if (r.ok) return;
    } catch (e) {
      console.log("[GV] waitWorker retry");
    }
    await sleep(2500);
  }

  throw new Error("Worker not ready");
}

// =====================
// Lock
// =====================
async function acquireLock(sb) {
  console.log("[GV] step=LOCK_BEGIN");
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + LOCK_SECONDS * 1000).toISOString();

  const { data } = await sb.from(POD_LOCK_TABLE).select("*").eq("id", 1).single();
  const current = data.locked_until ? new Date(data.locked_until) : null;

  if (current && current > now) {
    console.log("[GV] step=LOCK_BUSY");
    return false;
  }

  await sb.from(POD_LOCK_TABLE).update({ locked_until: lockedUntil }).eq("id", 1);
  console.log("[GV] step=LOCK_OK");
  return true;
}

// =====================
// RunPod
// =====================
async function createPod() {
  console.log("[GV] step=CREATE_POD_REQUEST");
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
  console.log("[GV] created podId=", d.id);
  return d.id;
}

async function waitPodRunning(podId) {
  console.log("[GV] step=WAIT_RUNNING_BEGIN");
  const start = Date.now();

  while (Date.now() - start < READY_TIMEOUT_MS) {
    const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, {
      headers: runpodHeaders(),
    });
    const d = await r.json();
    const status = String(d?.pod?.status || "").toUpperCase();
    console.log("[GV] waitRunning status=", status);
    if (status === "RUNNING") return;
    await sleep(POLL_MS);
  }

  throw new Error("Pod no llegó a RUNNING");
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

    const payload =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;

    // 1) Lock
    await acquireLock(sb);

    // 2) Pod
    const podId = await createPod();
    await waitPodRunning(podId);

    const workerUrl = proxyUrl(podId);
    await setPodState(sb, { status: "RUNNING", pod_id: podId, worker_url: workerUrl });

    // 3) Worker ready
    await waitForWorkerReady(workerUrl);

    console.log("[GV] step=CALL_API_VIDEO_BEGIN", workerUrl);

    // 4) 🔥 DISPATCH (NO esperar resultado)
    await fetchWithTimeout(
      `${workerUrl}/api/video`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      DISPATCH_TIMEOUT_MS
    );

    console.log("[GV] DISPATCH OK - video sigue generándose en el pod");

    // 5) RESPUESTA RÁPIDA
    return res.status(200).json({
      ok: true,
      status: "PROCESSING",
      pod_id: podId,
    });
  } catch (e) {
    console.error("[GV] ERROR:", String(e));
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
