// /api/generate-video.js
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { requireUser } from "./_auth.js";

// ============================================================
// IsabelaOS Studio — Generate Video (Dynamic Pod + Wake + Dispatch)
// - Si el pod perdió GPU: crea uno NUEVO desde TEMPLATE automáticamente
// - Monta tu Network Volume (persistencia) siempre
// - Fuerza puertos 8000/8888
// - Opcional: TERMINATE_AFTER_JOB (se termina el pod al finalizar -> ver video-status.js)
// ============================================================

// ---------------------
// ENV (Vercel)
// ---------------------
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY =
  process.env.VIDEO_RUNPOD_API_KEY ||
  process.env.RUNPOD_API_KEY ||
  null;

const VIDEO_RUNPOD_TEMPLATE_ID = process.env.VIDEO_RUNPOD_TEMPLATE_ID || null; // ej: kcr5u5mdbv
const VIDEO_RUNPOD_NETWORK_VOLUME_ID = process.env.VIDEO_RUNPOD_NETWORK_VOLUME_ID || null; // ej: x4ppgiwpse
const VIDEO_VOLUME_MOUNT_PATH = process.env.VIDEO_VOLUME_MOUNT_PATH || "/workspace"; // ej: /workspace
const RUNPOD_GPU_TYPE = process.env.RUNPOD_GPU_TYPE || null; // ej: A100_SXM

// Si quieres “pod fijo”, déjalo vacío y el sistema usará pod_state.pod_id.
// Si lo pones, forzará a usar ese pod (no recomendado con el problema de GPU).
const FIXED_POD_ID = process.env.VIDEO_FIXED_POD_ID || "";

// Worker config
const WORKER_PORT = parseInt(process.env.WORKER_PORT || "8000", 10);
const WORKER_HEALTH_PATH = process.env.WORKER_HEALTH_PATH || "/health";
const WORKER_ASYNC_PATH = process.env.WORKER_ASYNC_PATH || "/api/video_async";

// Waits
const WAIT_WORKER_TIMEOUT_MS = parseInt(process.env.WAIT_WORKER_TIMEOUT_MS || "120000", 10);
const WAIT_WORKER_INTERVAL_MS = parseInt(process.env.WAIT_WORKER_INTERVAL_MS || "2500", 10);
const WAIT_RUNNING_TIMEOUT_MS = parseInt(process.env.WAIT_RUNNING_TIMEOUT_MS || "180000", 10);
const WAIT_RUNNING_INTERVAL_MS = parseInt(process.env.WAIT_RUNNING_INTERVAL_MS || "3500", 10);

// Locks
const WAKE_LOCK_SECONDS = parseInt(process.env.WAKE_LOCK_SECONDS || "120", 10);

// Behavior
const TERMINATE_AFTER_JOB = String(process.env.TERMINATE_AFTER_JOB || "0") === "1";

// ---------------------
// Tables
// ---------------------
const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";
const VIDEO_JOBS_TABLE = "video_jobs";

// ---------------------
// Helpers
// ---------------------
function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY (set VIDEO_RUNPOD_API_KEY or RUNPOD_API_KEY)");
  return {
    Authorization: `Bearer ${RUNPOD_API_KEY}`,
    "Content-Type": "application/json",
  };
}

function workerBaseUrl(podId) {
  return `https://${podId}-${WORKER_PORT}.proxy.runpod.net`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function looksLikeGpuNotAvailable(msg) {
  const s = String(msg || "").toLowerCase();
  return (
    s.includes("gpus are no longer available") ||
    s.includes("gpu are no longer available") ||
    s.includes("no longer available") ||
    s.includes("gpu not available") ||
    s.includes("insufficient capacity") ||
    s.includes("not enough") ||
    s.includes("cannot allocate") ||
    s.includes("pod migration") ||
    s.includes("hardware has been deployed by another user")
  );
}

async function waitForWorker(podId) {
  const base = workerBaseUrl(podId);
  const url = `${base}${WORKER_HEALTH_PATH}`;
  const start = Date.now();

  while (Date.now() - start < WAIT_WORKER_TIMEOUT_MS) {
    try {
      const r = await fetch(url, { method: "GET" });
      if (r.ok) return { ok: true, url };
    } catch (_) {}
    await sleep(WAIT_WORKER_INTERVAL_MS);
  }

  return { ok: false, error: `Worker not ready after ${WAIT_WORKER_TIMEOUT_MS}ms`, url };
}

async function runpodGetPod(podId) {
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, {
    method: "GET",
    headers: runpodHeaders(),
  });
  const t = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`RunPod get pod failed (${r.status}): ${t}`);

  try {
    return JSON.parse(t);
  } catch {
    return { raw: t };
  }
}

async function runpodStartPod(podId) {
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}/start`, {
    method: "POST",
    headers: runpodHeaders(),
  });
  const t = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`RunPod start failed (${r.status}): ${t}`);
  return true;
}

async function runpodTerminatePod(podId) {
  // Intento 1: endpoint terminate
  {
    const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}/terminate`, {
      method: "POST",
      headers: runpodHeaders(),
    });
    if (r.ok) return true;
  }
  // Intento 2: DELETE (algunas variantes lo soportan)
  {
    const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, {
      method: "DELETE",
      headers: runpodHeaders(),
    });
    if (r.ok) return true;
    const t = await r.text().catch(() => "");
    throw new Error(`RunPod terminate failed: ${t}`);
  }
}

async function waitForRunning(podId) {
  const start = Date.now();
  while (Date.now() - start < WAIT_RUNNING_TIMEOUT_MS) {
    const pod = await runpodGetPod(podId);
    const status = String(
      pod?.desiredStatus || pod?.status || pod?.pod?.status || ""
    ).toUpperCase();

    // Algunos pods reportan "RUNNING" o "RUNNING (something)".
    if (status.includes("RUNNING")) return { ok: true, status };
    if (status.includes("FAILED") || status.includes("ERROR")) {
      return { ok: false, status, error: "Pod entered FAILED/ERROR" };
    }

    await sleep(WAIT_RUNNING_INTERVAL_MS);
  }
  return { ok: false, status: "TIMEOUT", error: `Pod not RUNNING after ${WAIT_RUNNING_TIMEOUT_MS}ms` };
}

async function tryAcquireLock(sb, seconds = 120) {
  const now = new Date();
  const until = new Date(now.getTime() + seconds * 1000);

  const { data: lockRow, error: lerr } = await sb
    .from(POD_LOCK_TABLE)
    .select("*")
    .eq("id", 1)
    .single();
  if (lerr) throw lerr;

  const lockedUntil = lockRow?.locked_until ? new Date(lockRow.locked_until) : null;
  if (lockedUntil && lockedUntil > now) {
    return { ok: false, reason: "lock active", locked_until: lockRow.locked_until };
  }

  const { error: uerr } = await sb
    .from(POD_LOCK_TABLE)
    .update({ locked_until: until.toISOString() })
    .eq("id", 1);

  if (uerr) throw uerr;
  return { ok: true, locked_until: until.toISOString() };
}

// ------------------------------------------------------------
// CREATE POD FROM TEMPLATE (Dynamic, with Volume + Ports)
// ------------------------------------------------------------
async function runpodCreatePodFromTemplate({ name }) {
  if (!VIDEO_RUNPOD_TEMPLATE_ID) throw new Error("Missing VIDEO_RUNPOD_TEMPLATE_ID");
  if (!VIDEO_RUNPOD_NETWORK_VOLUME_ID) throw new Error("Missing VIDEO_RUNPOD_NETWORK_VOLUME_ID");
  if (!VIDEO_VOLUME_MOUNT_PATH) throw new Error("Missing VIDEO_VOLUME_MOUNT_PATH");
  if (!RUNPOD_GPU_TYPE) throw new Error("Missing RUNPOD_GPU_TYPE (e.g. A100_SXM)");

  // ⚠️ RunPod API ha cambiado varias veces.
  // Este payload es compatible con el patrón que ustedes ya usaban (templateId + networkVolumeId + mount).
  // Si en tu cuenta el create devuelve otro formato, igual capturamos y lo imprimimos en error.
  const payload = {
    name,
    templateId: VIDEO_RUNPOD_TEMPLATE_ID,
    gpuTypeId: RUNPOD_GPU_TYPE,
    networkVolumeId: VIDEO_RUNPOD_NETWORK_VOLUME_ID,
    volumeMountPath: VIDEO_VOLUME_MOUNT_PATH,
    // fuerza puertos (además de que en tu template ya los tienes: 8000 + 8888)
    ports: [
      { containerPort: 8000, protocol: "http" },
      { containerPort: 8888, protocol: "http" },
    ],
  };

  const r = await fetch(`https://rest.runpod.io/v1/pods`, {
    method: "POST",
    headers: runpodHeaders(),
    body: JSON.stringify(payload),
  });

  const t = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`RunPod create pod failed (${r.status}): ${t}`);

  let json = null;
  try {
    json = JSON.parse(t);
  } catch {
    json = { raw: t };
  }

  const podId =
    json?.id ||
    json?.podId ||
    json?.pod?.id ||
    json?.data?.id ||
    null;

  if (!podId) {
    throw new Error(`RunPod create returned no podId. Raw: ${t}`);
  }
  return { podId, raw: json };
}

// ------------------------------------------------------------
// Ensure we have a usable pod (start or recreate if GPU lost)
// ------------------------------------------------------------
async function ensureWorkingPod(sb) {
  const nowIso = new Date().toISOString();

  const { data: podState, error: psErr } = await sb
    .from(POD_STATE_TABLE)
    .select("*")
    .eq("id", 1)
    .single();
  if (psErr) throw psErr;

  const statePodId = String(podState?.pod_id || "");
  const desiredPodId = FIXED_POD_ID ? FIXED_POD_ID : statePodId;

  // Si no hay pod_id guardado, se crea uno desde template
  if (!desiredPodId) {
    const created = await runpodCreatePodFromTemplate({
      name: `isabela-video-${Date.now()}`,
    });

    await sb.from(POD_STATE_TABLE).update({
      pod_id: created.podId,
      status: "STARTING",
      last_used_at: nowIso,
    }).eq("id", 1);

    await runpodStartPod(created.podId);
    const running = await waitForRunning(created.podId);
    if (!running.ok) throw new Error(`Pod not running after create: ${running.error || running.status}`);

    const ready = await waitForWorker(created.podId);
    if (!ready.ok) throw new Error(`Worker not ready after create: ${ready.error}`);

    await sb.from(POD_STATE_TABLE).update({
      status: "RUNNING",
      last_used_at: nowIso,
    }).eq("id", 1);

    return { podId: created.podId, action: "CREATED_AND_READY" };
  }

  // Si hay un pod_id, intentamos validar y arrancar si es necesario
  try {
    const podReal = await runpodGetPod(desiredPodId);
    const realStatus = String(
      podReal?.desiredStatus || podReal?.status || podReal?.pod?.status || ""
    ).toUpperCase();

    const shouldStart = ["STOPPED", "PAUSED", "EXITED", "SLEEPING", "NOT_RUNNING"].some((s) =>
      realStatus.includes(s)
    );

    if (shouldStart) {
      await runpodStartPod(desiredPodId);
      const running = await waitForRunning(desiredPodId);
      if (!running.ok) throw new Error(`Pod failed to reach RUNNING: ${running.error || running.status}`);
    }

    const ready = await waitForWorker(desiredPodId);
    if (!ready.ok) {
      // intento recuperación: start otra vez
      await runpodStartPod(desiredPodId);
      const running2 = await waitForRunning(desiredPodId);
      if (!running2.ok) throw new Error(`Recovery start failed: ${running2.error || running2.status}`);

      const ready2 = await waitForWorker(desiredPodId);
      if (!ready2.ok) throw new Error(`Worker still not ready: ${ready2.error}`);
    }

    await sb.from(POD_STATE_TABLE).update({
      pod_id: desiredPodId,
      status: "RUNNING",
      last_used_at: nowIso,
    }).eq("id", 1);

    return { podId: desiredPodId, action: shouldStart ? "STARTED" : "ALREADY_RUNNING" };
  } catch (e) {
    // Si el pod perdió GPU / no está disponible, creamos uno nuevo desde template
    if (looksLikeGpuNotAvailable(e?.message || e)) {
      const oldPodId = desiredPodId;

      const created = await runpodCreatePodFromTemplate({
        name: `isabela-video-${Date.now()}`,
      });

      await sb.from(POD_STATE_TABLE).update({
        pod_id: created.podId,
        status: "STARTING",
        last_used_at: nowIso,
      }).eq("id", 1);

      await runpodStartPod(created.podId);
      const running = await waitForRunning(created.podId);
      if (!running.ok) throw new Error(`New pod not RUNNING: ${running.error || running.status}`);

      const ready = await waitForWorker(created.podId);
      if (!ready.ok) throw new Error(`New worker not ready: ${ready.error}`);

      await sb.from(POD_STATE_TABLE).update({
        status: "RUNNING",
        last_used_at: nowIso,
      }).eq("id", 1);

      // IMPORTANTE: no terminamos el viejo aquí porque puede estar en estado raro.
      // Lo limpiamos en autosleep o manual, o si quieres puedes forzar:
      // await runpodTerminatePod(oldPodId).catch(()=>{});
      return { podId: created.podId, action: "RECREATED_GPU_LOST", oldPodId };
    }

    throw e;
  }
}

// ------------------------------------------------------------
// MAIN
// ------------------------------------------------------------
export default async function handler(req, res) {
  const startedAt = Date.now();

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // Auth
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    const user_id = auth.user.id;

    const {
      mode = "t2v",
      prompt,
      negative_prompt = "",
      steps = 25,
      height = 704,
      width = 1280,
      num_frames = 121,
      guidance_scale = 5.0,
      // si tu worker soporta seed u otros, los pasas aquí:
      seed = null,
    } = req.body || {};

    if (!prompt) return res.status(400).json({ ok: false, error: "Missing prompt" });

    const sb = sbAdmin();
    const job_id = crypto.randomUUID();

    // 1) Insert job
    const { error: insErr } = await sb.from(VIDEO_JOBS_TABLE).insert({
      job_id,
      user_id,
      mode,
      prompt,
      negative_prompt,
      steps,
      height,
      width,
      num_frames,
      guidance_scale,
      status: "PENDING",
    });
    if (insErr) throw insErr;

    // 2) Touch last_used_at
    await sb.from(POD_STATE_TABLE).update({ last_used_at: new Date().toISOString() }).eq("id", 1);

    // 3) Lock corto para wake (evita 2 starts al mismo tiempo)
    const lock = await tryAcquireLock(sb, WAKE_LOCK_SECONDS);
    if (!lock.ok) {
      // igual devolvemos job_id, pero avisamos que está locked
      return res.status(200).json({
        ok: true,
        job_id,
        status: "PENDING",
        wake: { ok: false, action: "LOCKED", locked_until: lock.locked_until },
      });
    }

    // 4) Ensure pod is usable (start or recreate if GPU lost)
    let podInfo = null;
    await sb.from(POD_STATE_TABLE).update({ status: "STARTING" }).eq("id", 1);
    podInfo = await ensureWorkingPod(sb);

    // 5) Dispatch job to worker (async)
    const podId = podInfo.podId;
    const base = workerBaseUrl(podId);
    const dispatchUrl = `${base}${WORKER_ASYNC_PATH}`;

    const payload = {
      job_id,
      user_id,
      mode,
      prompt,
      negative_prompt,
      steps,
      height,
      width,
      num_frames,
      guidance_scale,
      seed,
      // para que el status endpoint pueda saber si debe terminar pods:
      terminate_after_job: TERMINATE_AFTER_JOB ? 1 : 0,
    };

    let dispatch = { ok: true, url: dispatchUrl };
    try {
      const rr = await fetch(dispatchUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const tt = await rr.text().catch(() => "");
      if (!rr.ok) {
        // si esto falla, marcamos el job como FAILED para que el frontend no quede colgado
        await sb.from(VIDEO_JOBS_TABLE).update({
          status: "FAILED",
          error: `Worker dispatch failed (${rr.status}): ${tt}`,
        }).eq("job_id", job_id);

        dispatch = { ok: false, url: dispatchUrl, error: `Dispatch failed (${rr.status}): ${tt}` };
      } else {
        // opcional: marcar status en DB
        await sb.from(VIDEO_JOBS_TABLE).update({
          status: "RUNNING",
        }).eq("job_id", job_id);
      }
    } catch (e) {
      await sb.from(VIDEO_JOBS_TABLE).update({
        status: "FAILED",
        error: `Worker dispatch exception: ${String(e?.message || e)}`,
      }).eq("job_id", job_id);

      dispatch = { ok: false, url: dispatchUrl, error: String(e?.message || e) };
    }

    await sb.from(POD_STATE_TABLE).update({
      status: dispatch.ok ? "RUNNING" : "ERROR",
      last_used_at: new Date().toISOString(),
      pod_id: podId,
    }).eq("id", 1);

    return res.status(200).json({
      ok: true,
      job_id,
      status: dispatch.ok ? "RUNNING" : "FAILED",
      pod: podInfo,
      dispatch,
      ms: Date.now() - startedAt,
    });
  } catch (e) {
    console.error("[GV] fatal:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}