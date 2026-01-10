// /api/generate-video.js
// ============================================================
// IsabelaOS Studio - Video Generate API (Vercel Serverless)
//
// MODO B: crea Pod nuevo por job y DISPATCH async (sin esperar MP4)
// ✅ AUTH UNIFICADO (requireUser)
// ✅ COBRO UNIFICADO (spend_jades) ANTES de crear pod/job
// ============================================================

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { requireUser } from "./_auth";

// =====================
// COSTOS (JADE)
// =====================
const COST_VIDEO_PROMPT_JADES = 10; // ✅ 10 jades por video

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

// Clamps
const MAX_STEPS = parseInt(process.env.VIDEO_MAX_STEPS || "25", 10);
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

// Dispatch
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
// ✅ Cobro unificado (RPC spend_jades)
// =====================
async function spendJadesOrThrow(user_id, amount, reason, ref = null) {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  const rpcUrl = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/spend_jades`;

  const r = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_user_id: user_id,
      p_amount: amount,
      p_reason: reason,
      p_ref: ref,
    }),
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    if ((t || "").includes("INSUFFICIENT_JADES")) {
      const err = new Error("INSUFFICIENT_JADES");
      err.code = 402;
      throw err;
    }
    const err = new Error("RPC_SPEND_JADES_ERROR: " + t.slice(0, 300));
    err.code = 500;
    throw err;
  }
  return true;
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
        if (r.ok) return true;
        if (r.status === 405) return true; // POST-only endpoint, pero responde
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

  const { error: updErr } = await sb.from(POD_LOCK_TABLE).update({ locked_until: lockedUntil }).eq("id", 1);
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
  if (!VIDEO_RUNPOD_TEMPLATE_ID) throw new Error("Falta VIDEO_RUNPOD_TEMPLATE_ID");
  if (!VIDEO_RUNPOD_NETWORK_VOLUME_ID)
    throw new Error("Falta VIDEO_RUNPOD_NETWORK_VOLUME_ID (necesario para /workspace)");

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

    console.log("[GV] waitRunning status=", status || "EMPTY", "podId=", podId);

    if (status === "RUNNING" || status === "READY" || status === "ACTIVE") return pod;
    await sleep(POLL_MS);
  }

  throw new Error("Timeout: pod no llegó a RUNNING/READY. Last: " + lastSample);
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

    // ✅ AUTH ÚNICO
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    const user_id = auth.user.id;

    const payloadRaw =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    // clamp steps
    const requestedSteps =
      typeof payloadRaw.steps === "number"
        ? payloadRaw.steps
        : (typeof payloadRaw.num_inference_steps === "number" ? payloadRaw.num_inference_steps : null);

    const safeSteps = requestedSteps == null ? MAX_STEPS : Math.min(requestedSteps, MAX_STEPS);

    const maybeFast = FAST_TEST_MODE
      ? { steps: Math.min(safeSteps, 8), num_frames: 8, fps: 6, width: 384, height: 672 }
      : { steps: safeSteps };

    const payload = {
      user_id, // ✅ SIEMPRE desde auth
      ...payloadRaw,
      ...maybeFast,
    };

    console.log("[GV] payload steps=", payload.steps, "MAX_STEPS=", MAX_STEPS, "FAST_TEST_MODE=", FAST_TEST_MODE);

    // ✅ COBRO SOLO AQUÍ (no en frontend)
    await spendJadesOrThrow(user_id, COST_VIDEO_PROMPT_JADES, "generation:video_prompt", payloadRaw.ref || null);

    // 1) Pod nuevo + worker ready
    const fresh = await ensureFreshPod(sb);
    podId = fresh.podId;

    // 2) Crea job en Supabase
    const job_id = crypto.randomUUID();
    console.log("[GV] step=JOB_CREATE", "job_id=", job_id);

    await createVideoJob(sb, {
      job_id,
      user_id,
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

    return res.status(200).json({
      ok: true,
      job_id,
      status: "IN_PROGRESS",
      podId,
      worker: fresh.workerUrl,
      billed: { type: "JADE", amount: COST_VIDEO_PROMPT_JADES },
      note: "Video sigue generándose en el pod. Usa /api/video-status?job_id=...",
    });
  } catch (e) {
    const msg = String(e?.message || e);
    const code = e?.code || 500;
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

    return res.status(code).json({ ok: false, error: msg, podId });
  }
}