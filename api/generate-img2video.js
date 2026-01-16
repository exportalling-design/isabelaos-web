// /api/generate-img2video.js
// ============================================================
// IsabelaOS Studio — Image → Video (Vercel Function)
//
// ✅ AUTH UNIFICADO (requireUser)
// ✅ REUSO de POD (pod_state.pod_id)
// ✅ Si hay job activo (MISMO MODO i2v) => devuelve ese job_id
// ✅ Payload NORMALIZADO para el worker (mode=i2v + image_base64/image_url)
// ✅ Evita doble cobro: soporta already_billed=true
// ✅ FIX IMPORTANTE: image_base64 normalizado a DataURL
// ============================================================

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { requireUser } from "./_auth.js";

// =====================
// COSTOS (JADE)
// =====================
const COST_IMG2VIDEO_JADES = 3; // <- AJUSTA AQUÍ

// =====================
// ENV (Supabase)
// =====================
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

const VIDEO_VOLUME_MOUNT_PATH = process.env.VIDEO_VOLUME_MOUNT_PATH || "/workspace";

const VIDEO_GPU_TYPE_IDS = (process.env.VIDEO_GPU_TYPE_IDS || "").trim();
const VIDEO_GPU_CLOUD_TYPE = (process.env.VIDEO_GPU_CLOUD_TYPE || "ALL").trim();
const VIDEO_GPU_COUNT = parseInt(process.env.VIDEO_GPU_COUNT || "1", 10);
const VIDEO_GPU_FALLBACK_ON_FAIL =
  String(process.env.VIDEO_GPU_FALLBACK_ON_FAIL || "1") === "1";

// =====================
// ENV (Worker)
// =====================
const WORKER_PORT = parseInt(process.env.WORKER_PORT || "8000", 10);
const WORKER_HEALTH_PATH = process.env.WORKER_HEALTH_PATH || "/health";
const WORKER_ASYNC_PATH = process.env.WORKER_ASYNC_PATH || "/api/video_async";

// =====================
// VIDEO LIMITS / MODES
// =====================
const MAX_STEPS = parseInt(process.env.VIDEO_MAX_STEPS || "25", 10);
const FAST_TEST_MODE = (process.env.VIDEO_FAST_TEST_MODE || "0") === "1";

// =====================
// Timeouts
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
// Tablas
// =====================
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

// =====================
// Helpers
// =====================
function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL (o VITE_SUPABASE_URL)");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
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

function workerBaseUrl(podId) {
  return `https://${podId}-${WORKER_PORT}.proxy.runpod.net`;
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
// ✅ Cobro unificado (backend) — opcional si frontend ya cobró
// =====================
async function spendJadesOrThrow(user_id, amount, reason, ref = null) {
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
async function waitForWorkerReady(podId, maxMs = WORKER_READY_TIMEOUT_MS) {
  const start = Date.now();
  const base = workerBaseUrl(podId);

  const healthUrl = `${base}${WORKER_HEALTH_PATH}`;
  const asyncUrl = `${base}${WORKER_ASYNC_PATH}`;

  let lastInfo = "no-attempt";

  while (Date.now() - start < maxMs) {
    try {
      const r = await fetchWithTimeout(
        healthUrl,
        { method: "GET" },
        HEALTH_FETCH_TIMEOUT_MS
      );
      if (r.ok) return true;
      const txt = await r.text().catch(() => "");
      lastInfo = `${healthUrl} -> ${r.status} ${txt.slice(0, 120)}`;
    } catch (e) {
      lastInfo = `${healthUrl} -> ERR ${String(e)}`;
    }

    try {
      const r = await fetchWithTimeout(
        asyncUrl,
        { method: "GET" },
        HEALTH_FETCH_TIMEOUT_MS
      );
      if (r.ok || r.status === 405) return true;
      const txt = await r.text().catch(() => "");
      lastInfo = `${asyncUrl} -> ${r.status} ${txt.slice(0, 120)}`;
    } catch (e) {
      lastInfo = `${asyncUrl} -> ERR ${String(e)}`;
    }

    await sleep(2500);
  }

  throw new Error("Worker not ready. Último: " + lastInfo);
}

// =====================
// Lock
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

async function releaseLock(sb) {
  const pastIso = new Date(Date.now() - 1000).toISOString();
  const { error } = await sb.from(POD_LOCK_TABLE).update({ locked_until: pastIso }).eq("id", 1);
  if (error) throw error;
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
// RunPod helpers
// =====================
function parseGpuTypeList() {
  if (!VIDEO_GPU_TYPE_IDS) return null;
  const arr = VIDEO_GPU_TYPE_IDS
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return arr.length ? arr : null;
}

async function runpodCreatePodOnce(payload) {
  const r = await fetch("https://rest.runpod.io/v1/pods", {
    method: "POST",
    headers: runpodHeaders(),
    body: JSON.stringify(payload),
  });

  const t = await r.text().catch(() => "");
  if (!r.ok) {
    const err = new Error(`RunPod create pod failed (${r.status}): ${t}`);
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

  const podId = json?.id || json?.podId || json?.pod?.id || json?.data?.id || null;
  if (!podId) throw new Error("RunPod create pod: no devolvió id");

  return { id: podId, raw: json };
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
      if (log) log(`[I2V] createPod attempt=${a.label}`, {
        hasGpuTypeIds: Boolean(a.payload.gpuTypeIds),
        cloudType: a.payload.cloudType || null,
        gpuCount: a.payload.gpuCount,
      });
      const created = await runpodCreatePodOnce(a.payload);
      return { ...created, attempt: a.label, used: a.payload };
    } catch (e) {
      lastErr = e;
      if (log) log(`[I2V] createPod failed attempt=${a.label}`, String(e?.message || e));
      if (!VIDEO_GPU_FALLBACK_ON_FAIL) throw e;
    }
  }

  throw lastErr || new Error("RunPod create failed: sin detalle");
}

async function runpodGetPod(podId) {
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, {
    headers: runpodHeaders(),
  });

  const t = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`RunPod GET pod failed (${r.status}): ${t}`);

  try {
    const data = JSON.parse(t);
    return data?.pod || data;
  } catch {
    return { raw: t };
  }
}

async function runpodStartPod(podId) {
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}/start`, {
    method: "POST",
    headers: runpodHeaders(),
  });
  if (r.ok) return true;
  const t = await r.text().catch(() => "");
  return { ok: false, status: r.status, raw: t };
}

function pickPodStatus(pod) {
  const raw =
    pod?.desiredStatus ??
    pod?.status ??
    pod?.state ??
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

    console.log("[I2V] waitRunning status=", status || "EMPTY", "podId=", podId);

    if (status.includes("RUNNING") || status.includes("READY") || status.includes("ACTIVE")) return true;
    if (status.includes("FAILED") || status.includes("ERROR")) throw new Error("Pod entró en FAILED/ERROR");

    await sleep(POLL_MS);
  }
  throw new Error("Timeout: pod no llegó a RUNNING/READY.");
}

// =====================
// video_jobs helpers
// =====================
async function createVideoJob(sb, job) {
  const { error } = await sb.from(VIDEO_JOBS_TABLE).insert(job);
  if (error) throw error;
}

async function updateVideoJob(sb, job_id, patch) {
  // OJO: tu tabla usa job_id
  const { error } = await sb.from(VIDEO_JOBS_TABLE).update(patch).eq("job_id", job_id);
  if (error) throw error;
}

// ✅ job activo SOLO del modo i2v (para este panel)
async function getActiveJobForUserI2V(sb, user_id) {
  const { data, error } = await sb
    .from(VIDEO_JOBS_TABLE)
    .select("job_id,status,progress,eta_seconds,queue_position,video_url,error,created_at,updated_at,payload")
    .eq("user_id", user_id)
    .in("status", ACTIVE_STATUSES)
    .eq("payload->>mode", "i2v")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return data?.[0] || null;
}

// =====================
// ensure pod (reuso)
// =====================
async function ensureWorkingPod(sb, log) {
  log("[I2V] step=LOCK_BEGIN");
  const got = await acquireLock(sb);

  if (!got.ok) {
    log("[I2V] step=LOCK_BUSY wait...");
    await waitForUnlock(sb);
    return await ensureWorkingPod(sb, log);
  }

  let lockHeld = true;

  try {
    const nowIso = new Date().toISOString();

    const { data: podState, error: psErr } = await sb
      .from(POD_STATE_TABLE)
      .select("*")
      .eq("id", 1)
      .single();
    if (psErr) throw psErr;

    const statePodId = String(podState?.pod_id || "").trim();

    async function touch(status, patch = {}) {
      await setPodState(sb, { status, last_used_at: nowIso, ...patch });
    }

    async function createAndBoot() {
      await touch("CREATING");
      log("[I2V] step=CREATE_POD_REQUEST");

      const created = await runpodCreatePodFromTemplate({
        name: `isabela-i2v-${Date.now()}`,
        log,
      });

      const podId = created.id;
      log("[I2V] created podId=", podId, "attempt=", created.attempt);

      await touch("STARTING", { pod_id: podId, worker_url: null });

      const st = await runpodStartPod(podId);
      if (st !== true) log("[I2V] warn=startPod failed (ignored)", st);

      await runpodWaitUntilRunning(podId);

      const workerUrl = workerBaseUrl(podId);
      await touch("RUNNING", { pod_id: podId, worker_url: workerUrl });

      log("[I2V] step=WAIT_WORKER_BEGIN");
      await waitForWorkerReady(podId);
      log("[I2V] step=WAIT_WORKER_OK");

      return { podId, workerUrl, action: "CREATED", createAttempt: created.attempt };
    }

    if (!statePodId) {
      const fresh = await createAndBoot();
      await releaseLock(sb);
      lockHeld = false;
      return fresh;
    }

    try {
      await runpodGetPod(statePodId);

      const st = await runpodStartPod(statePodId);
      if (st !== true) log("[I2V] warn=startPod failed (ignored)", st);

      await touch("STARTING", { pod_id: statePodId });

      await runpodWaitUntilRunning(statePodId);

      const workerUrl = workerBaseUrl(statePodId);
      await touch("RUNNING", { pod_id: statePodId, worker_url: workerUrl });

      log("[I2V] step=WAIT_WORKER_BEGIN");
      await waitForWorkerReady(statePodId);
      log("[I2V] step=WAIT_WORKER_OK");

      await releaseLock(sb);
      lockHeld = false;
      return { podId: statePodId, workerUrl, action: "REUSED" };
    } catch (e) {
      log("[I2V] existing pod failed => recreating:", String(e?.message || e));

      const oldPodId = statePodId;
      const fresh = await createAndBoot();

      try {
        await fetch(`https://rest.runpod.io/v1/pods/${oldPodId}/terminate`, {
          method: "POST",
          headers: runpodHeaders(),
        });
      } catch {}

      await releaseLock(sb);
      lockHeld = false;
      return { ...fresh, action: "RECREATED", oldPodId };
    }
  } finally {
    if (lockHeld) {
      try {
        await releaseLock(sb);
      } catch {}
    }
  }
}

// =====================
// API
// =====================
export default async function handler(req, res) {
  const log = (...args) => console.log(...args);

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  let sb = null;
  let podId = null;

  try {
    sb = sbAdmin();

    // AUTH
    const auth = await requireUser(req);
    if (!auth.ok) {
      return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    }
    const user_id = auth.user.id;

    // ✅ Si ya hay job activo i2v => devolverlo (evita duplicados)
    const activeI2V = await getActiveJobForUserI2V(sb, user_id);
    if (activeI2V) {
      return res.status(200).json({
        ok: true,
        status: "ALREADY_RUNNING",
        job_id: activeI2V.job_id,
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

    // ✅ NORMALIZAR BASE64 A DATAURL (evita que el worker lo lea mal)
    const normalizedImageB64 = image_b64
      ? (String(image_b64).startsWith("data:")
          ? String(image_b64)
          : `data:image/jpeg;base64,${String(image_b64)}`)
      : null;

    const requestedSteps =
      typeof payloadRaw.steps === "number"
        ? payloadRaw.steps
        : typeof payloadRaw.num_inference_steps === "number"
        ? payloadRaw.num_inference_steps
        : null;

    const safeSteps =
      requestedSteps == null ? MAX_STEPS : Math.min(requestedSteps, MAX_STEPS);

    const maybeFast = FAST_TEST_MODE
      ? { steps: Math.min(safeSteps, 8), num_frames: 8, fps: 6, width: 384, height: 672 }
      : { steps: safeSteps };

    // ✅ Payload NORMALIZADO para worker
    const payload = {
      user_id,
      mode: "i2v",
      prompt: payloadRaw.prompt || "",
      negative_prompt: payloadRaw.negative_prompt || "",

      width: typeof payloadRaw.width === "number" ? payloadRaw.width : 896,
      height: typeof payloadRaw.height === "number" ? payloadRaw.height : 512,
      num_frames: typeof payloadRaw.num_frames === "number" ? payloadRaw.num_frames : 49,
      fps: typeof payloadRaw.fps === "number" ? payloadRaw.fps : 24,
      guidance_scale: payloadRaw.guidance_scale ?? 6.0,

      // ✅ fijo
      image_base64: normalizedImageB64,
      image_url: image_url || null,

      ...maybeFast,
    };

    // ✅ COBRO: si frontend ya cobró, manda already_billed=true y no cobramos aquí
    const alreadyBilled = payloadRaw.already_billed === true;
    if (!alreadyBilled) {
      await spendJadesOrThrow(
        user_id,
        COST_IMG2VIDEO_JADES,
        "generation:img2video",
        payloadRaw.ref || null
      );
    }

    // Ensure pod
    const ensured = await ensureWorkingPod(sb, log);
    podId = ensured.podId;

    // Crear job
    const job_id = crypto.randomUUID();

    await createVideoJob(sb, {
      job_id,
      user_id,
      status: "QUEUED",
      payload,
      pod_id: podId,
      worker_url: ensured.workerUrl,
      updated_at: new Date().toISOString(),
    });

    // Dispatch
    const dispatchUrl = `${ensured.workerUrl}${WORKER_ASYNC_PATH}`;
    log("[I2V] dispatchUrl=", dispatchUrl);

    await setPodState(sb, { status: "BUSY", last_used_at: new Date().toISOString() });
    await updateVideoJob(sb, job_id, { status: "DISPATCHED", updated_at: new Date().toISOString() });

    const r = await fetchWithTimeout(
      dispatchUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // ✅ IMPORTANTE: mandamos job_id + payload
        body: JSON.stringify({ job_id, ...payload }),
      },
      DISPATCH_TIMEOUT_MS
    );

    const txt = await r.text().catch(() => "");
    log("[I2V] dispatch response status=", r.status, "body=", txt.slice(0, 200));

    if (r.status !== 202 && r.status !== 200) {
      await updateVideoJob(sb, job_id, {
        status: "ERROR",
        error: `Worker dispatch failed: ${r.status} ${txt.slice(0, 200)}`,
        updated_at: new Date().toISOString(),
      });
      return res
        .status(500)
        .json({ ok: false, error: `Worker dispatch failed: ${r.status}`, podId });
    }

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
    } catch {}

    return res.status(200).json({
      ok: true,
      job_id,
      status: "IN_PROGRESS",
      podId,
      pod: {
        action: ensured.action,
        oldPodId: ensured.oldPodId || null,
        createAttempt: ensured.createAttempt || null,
      },
      worker: ensured.workerUrl,
      billed: alreadyBilled
        ? { type: "FRONTEND", amount: 0 }
        : { type: "JADE", amount: COST_IMG2VIDEO_JADES },
      note: "I2V sigue generándose en el pod. Usa /api/video-status?job_id=... o /api/video-status?mode=i2v",
    });
  } catch (e) {
    const msg = String(e?.message || e);
    const code = e?.code || 500;
    console.error("[I2V] ERROR:", msg);

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