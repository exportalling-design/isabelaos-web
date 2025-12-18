// /api/generate-video.js
import { createClient } from "@supabase/supabase-js";

// =====================
// ENV
// =====================
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY =
  process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY;

const VIDEO_RUNPOD_TEMPLATE_ID =
  process.env.VIDEO_RUNPOD_TEMPLATE_ID;

// 🔴 OBLIGATORIO PARA TU CASO
const VIDEO_NETWORK_VOLUME_ID =
  process.env.VIDEO_NETWORK_VOLUME_ID;

const VIDEO_VOLUME_MOUNT_PATH =
  process.env.VIDEO_VOLUME_MOUNT_PATH || "/workspace";

const TERMINATE_AFTER_JOB =
  (process.env.TERMINATE_AFTER_JOB || "0") === "1";

const READY_TIMEOUT_MS = 12 * 60 * 1000;
const POLL_MS = 3000;

// =====================
function sbAdmin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function runpodHeaders() {
  return {
    Authorization: `Bearer ${RUNPOD_API_KEY}`,
    "Content-Type": "application/json",
  };
}

// =====================
// RUNPOD
// =====================
async function createPod() {
  const body = {
    name: `isabela-video-${Date.now()}`,
    templateId: VIDEO_RUNPOD_TEMPLATE_ID,

    // 🔴 ESTO ES LO QUE FALTABA
    networkVolumeId: VIDEO_NETWORK_VOLUME_ID,
    volumeMountPath: VIDEO_VOLUME_MOUNT_PATH,
  };

  const r = await fetch("https://rest.runpod.io/v1/pods", {
    method: "POST",
    headers: runpodHeaders(),
    body: JSON.stringify(body),
  });

  const data = await r.json();
  if (!r.ok) {
    throw new Error(`RunPod create failed: ${JSON.stringify(data)}`);
  }

  return data.id;
}

async function getPod(podId) {
  const r = await fetch(
    `https://rest.runpod.io/v1/pods/${podId}`,
    { headers: runpodHeaders() }
  );
  return r.json();
}

async function waitForRunning(podId) {
  const start = Date.now();
  while (Date.now() - start < READY_TIMEOUT_MS) {
    const pod = await getPod(podId);
    if (String(pod.status).toUpperCase() === "RUNNING") return;
    await sleep(POLL_MS);
  }
  throw new Error("Pod no llegó a RUNNING");
}

function proxyUrl(podId) {
  return `https://${podId}-8000.proxy.runpod.net`;
}

async function waitForWorker(url) {
  const start = Date.now();
  while (Date.now() - start < READY_TIMEOUT_MS) {
    try {
      const r = await fetch(`${url}/health`);
      if (r.ok || r.status === 404 || r.status === 405) return;
    } catch {}
    await sleep(2500);
  }
  throw new Error("Worker no respondió");
}

async function terminatePod(podId) {
  await fetch(
    `https://rest.runpod.io/v1/pods/${podId}`,
    { method: "DELETE", headers: runpodHeaders() }
  );
}

// =====================
// API
// =====================
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false });
  }

  let podId = null;

  try {
    podId = await createPod();
    await waitForRunning(podId);

    const worker = proxyUrl(podId);
    await waitForWorker(worker);

    const r = await fetch(`${worker}/api/video`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });

    const data = await r.json();

    if (TERMINATE_AFTER_JOB) {
      await terminatePod(podId);
    }

    res.status(r.status).json(data);

  } catch (e) {
    if (TERMINATE_AFTER_JOB && podId) {
      try { await terminatePod(podId); } catch {}
    }
    res.status(500).json({ ok: false, error: String(e.message) });
  }
}
