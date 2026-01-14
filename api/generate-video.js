// /api/generate-video.js
// ============================================================
// IsabelaOS Studio — API de Generación de Video (Vercel Function)
// MODO: COLA REAL (FIFO)
// - Crea job en Supabase con status=QUEUED
// - (Opcional) intenta asegurar pod RUNNING (warm) con lock
// - NO renderiza aquí, NO espera video aquí
// ============================================================

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { requireUser } from "./_auth.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY =
  process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY || null;

const VIDEO_RUNPOD_TEMPLATE_ID = process.env.VIDEO_RUNPOD_TEMPLATE_ID || null;
const VIDEO_RUNPOD_NETWORK_VOLUME_ID = process.env.VIDEO_RUNPOD_NETWORK_VOLUME_ID || null;
const VIDEO_VOLUME_MOUNT_PATH = process.env.VIDEO_VOLUME_MOUNT_PATH || "/workspace";

const WORKER_PORT = parseInt(process.env.WORKER_PORT || "8000", 10);
const WORKER_HEALTH_PATH = process.env.WORKER_HEALTH_PATH || "/health";

const WAIT_WORKER_TIMEOUT_MS = parseInt(process.env.WAIT_WORKER_TIMEOUT_MS || "180000", 10);
const WAIT_WORKER_INTERVAL_MS = parseInt(process.env.WAIT_WORKER_INTERVAL_MS || "2500", 10);

const WAIT_RUNNING_TIMEOUT_MS = parseInt(process.env.WAIT_RUNNING_TIMEOUT_MS || "240000", 10);
const WAIT_RUNNING_INTERVAL_MS = parseInt(process.env.WAIT_RUNNING_INTERVAL_MS || "3500", 10);

const WAKE_LOCK_SECONDS = parseInt(process.env.WAKE_LOCK_SECONDS || "90", 10);

const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";
const VIDEO_JOBS_TABLE = "video_jobs";

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

// ---------------------------
// RunPod REST helpers
// ---------------------------
async function runpodGetPod(podId) {
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, {
    method: "GET",
    headers: runpodHeaders(),
  });
  const t = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`RunPod get pod falló (${r.status}): ${t}`);
  return JSON.parse(t);
}

async function runpodListPods(limit = 10) {
  const r = await fetch(`https://rest.runpod.io/v1/pods?limit=${limit}`, {
    method: "GET",
    headers: runpodHeaders(),
  });
  const t = await r.text().catch(() => "");
  if (!r.ok) return { ok: false, raw: t };
  try {
    return { ok: true, data: JSON.parse(t) };
  } catch {
    return { ok: true, data: { raw: t } };
  }
}

async function runpodStartPod(podId) {
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}/start`, {
    method: "POST",
    headers: runpodHeaders(),
  });
  const t = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`RunPod start falló (${r.status}): ${t}`);
  return true;
}

async function runpodTerminatePod(podId) {
  {
    const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}/terminate`, {
      method: "POST",
      headers: runpodHeaders(),
    });
    if (r.ok) return true;
  }
  {
    const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, {
      method: "DELETE",
      headers: runpodHeaders(),
    });
    if (r.ok) return true;
    const t = await r.text().catch(() => "");
    throw new Error(`RunPod terminate falló: ${t}`);
  }
}

async function waitForRunning(podId) {
  const start = Date.now();
  while (Date.now() - start < WAIT_RUNNING_TIMEOUT_MS) {
    const pod = await runpodGetPod(podId);
    const status = String(pod?.desiredStatus || pod?.status || pod?.pod?.status || "").toUpperCase();
    if (status.includes("RUNNING")) return { ok: true, status };
    if (status.includes("FAILED") || status.includes("ERROR")) {
      return { ok: false, status, error: "Pod entró en FAILED/ERROR" };
    }
    await sleep(WAIT_RUNNING_INTERVAL_MS);
  }
  return { ok: false, status: "TIMEOUT", error: `Pod no llegó a RUNNING en ${WAIT_RUNNING_TIMEOUT_MS}ms` };
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
  return { ok: false, error: `Worker no respondió tras ${WAIT_WORKER_TIMEOUT_MS}ms`, url };
}

// ---------------------------
// LOCK supabase (solo para asegurar pod)
// ---------------------------
async function tryAcquireLock(sb, seconds = 90) {
  const now = new Date();
  const until = new Date(now.getTime() + seconds * 1000);

  const { data: lockRow, error: lerr } = await sb.from(POD_LOCK_TABLE).select("*").eq("id", 1).single();
  if (lerr) throw lerr;

  const lockedUntil = lockRow?.locked_until ? new Date(lockRow.locked_until) : null;
  if (lockedUntil && lockedUntil > now) {
    return { ok: false, reason: "lock active", locked_until: lockRow.locked_until };
  }

  const { error: uerr } = await sb.from(POD_LOCK_TABLE).update({ locked_until: until.toISOString() }).eq("id", 1);
  if (uerr) throw uerr;

  return { ok: true, locked_until: until.toISOString() };
}

async function releaseLock(sb) {
  const pastIso = new Date(Date.now() - 1000).toISOString();
  const { error } = await sb.from(POD_LOCK_TABLE).update({ locked_until: pastIso }).eq("id", 1);
  if (error) throw error;
}

// ---------------------------
// Crear pod desde template + verify anti pod fantasma
// ---------------------------
async function runpodCreatePodFromTemplate({ name, log }) {
  if (!VIDEO_RUNPOD_TEMPLATE_ID) throw new Error("Falta VIDEO_RUNPOD_TEMPLATE_ID");
  if (!VIDEO_RUNPOD_NETWORK_VOLUME_ID) throw new Error("Falta VIDEO_RUNPOD_NETWORK_VOLUME_ID");

  const payload = {
    name,
    templateId: VIDEO_RUNPOD_TEMPLATE_ID,
    networkVolumeId: VIDEO_RUNPOD_NETWORK_VOLUME_ID,
    volumeMountPath: VIDEO_VOLUME_MOUNT_PATH,
    ports: ["8000/http", "8888/http"],
  };

  const r = await fetch(`https://rest.runpod.io/v1/pods`, {
    method: "POST",
    headers: runpodHeaders(),
    body: JSON.stringify(payload),
  });

  const t = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`RunPod create failed (${r.status}): ${t}`);

  const json = JSON.parse(t);
  const podId = json?.id || json?.podId || json?.pod?.id || json?.data?.id || null;
  if (!podId) throw new Error(`RunPod create no devolvió podId. Respuesta: ${t}`);

  const verifyStart = Date.now();
  let verified = false;
  let lastErr = null;

  while (Date.now() - verifyStart < 30000) {
    try {
      await runpodGetPod(podId);
      verified = true;
      break;
    } catch (e) {
      lastErr = e;
      await sleep(1500);
    }
  }

  if (!verified) {
    const list = await runpodListPods(10);
    log?.("RunPod debug listPods", list?.ok ? "OK" : "FAIL", list?.data || list?.raw || null);
    throw new Error(`Pod creado pero NO verificable por GET. podId=${podId}. Ultimo error: ${String(lastErr?.message || lastErr)}`);
  }

  return { podId, raw: json };
}

// ---------------------------
// Ensure pod warm
// ---------------------------
async function ensureWorkingPod(sb, log) {
  const nowIso = new Date().toISOString();
  const { data: podState, error: psErr } = await sb.from(POD_STATE_TABLE).select("*").eq("id", 1).single();
  if (psErr) throw psErr;

  const statePodId = String(podState?.pod_id || "");

  if (!statePodId) {
    const created = await runpodCreatePodFromTemplate({ name: `isabela-video-${Date.now()}`, log });

    await sb.from(POD_STATE_TABLE).update({
      pod_id: created.podId,
      status: "STARTING",
      last_used_at: nowIso,
      busy: false,
    }).eq("id", 1);

    await runpodStartPod(created.podId);
    const running = await waitForRunning(created.podId);
    if (!running.ok) throw new Error(`Pod nuevo no RUNNING: ${running.error || running.status}`);

    const ready = await waitForWorker(created.podId);
    if (!ready.ok) throw new Error(`Worker no listo: ${ready.error}`);

    await sb.from(POD_STATE_TABLE).update({ status: "RUNNING", last_used_at: nowIso, busy: false }).eq("id", 1);
    return { podId: created.podId, action: "CREADO_Y_LISTO", cold_start: true };
  }

  try {
    await runpodGetPod(statePodId);
    await runpodStartPod(statePodId).catch(() => {});
    const running = await waitForRunning(statePodId);
    if (!running.ok) throw new Error(`Pod no RUNNING: ${running.error || running.status}`);

    const ready = await waitForWorker(statePodId);
    if (!ready.ok) throw new Error(`Worker no respondió: ${ready.error}`);

    await sb.from(POD_STATE_TABLE).update({ status: "RUNNING", last_used_at: nowIso, busy: false }).eq("id", 1);
    return { podId: statePodId, action: "REUSADO", cold_start: false };
  } catch (e) {
    log("ensureWorkingPod: recreo", String(e?.message || e));
    const oldPodId = statePodId;
    const created = await runpodCreatePodFromTemplate({ name: `isabela-video-${Date.now()}`, log });

    await sb.from(POD_STATE_TABLE).update({
      pod_id: created.podId,
      status: "STARTING",
      last_used_at: nowIso,
      busy: false,
    }).eq("id", 1);

    await runpodStartPod(created.podId);
    const running = await waitForRunning(created.podId);
    if (!running.ok) throw new Error(`Pod nuevo no RUNNING: ${running.error || running.status}`);

    const ready = await waitForWorker(created.podId);
    if (!ready.ok) throw new Error(`Worker no listo tras recrear: ${ready.error}`);

    await sb.from(POD_STATE_TABLE).update({ status: "RUNNING", last_used_at: nowIso, busy: false }).eq("id", 1);
    await runpodTerminatePod(oldPodId).catch(() => {});
    return { podId: created.podId, action: "RECREADO", oldPodId, cold_start: true };
  }
}

// ---------------------------
// Handler principal
// ---------------------------
export default async function handler(req, res) {
  const log = (...args) => console.log("[GV]", ...args);
  let lockAcquired = false;

  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });

    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    const user_id = auth.user.id;

    const {
      mode = "t2v",
      prompt,
      negative_prompt = "",
      steps = 20,
      height = 704,
      width = 1280,
      num_frames = 81,
      fps = 24,
      guidance_scale = 5.0,
      image_base64 = null,
    } = req.body || {};

    if (!prompt) return res.status(400).json({ ok: false, error: "Falta prompt" });

    const sb = sbAdmin();
    const nowIso = new Date().toISOString();

    // 1) Insert job QUEUED (cola real)
    const client_job_id = crypto.randomUUID(); // por si querés rastrear (no PK)
    const { data: inserted, error: insErr } = await sb
      .from(VIDEO_JOBS_TABLE)
      .insert({
        user_id,
        mode,
        prompt,
        negative_prompt,
        steps,
        height,
        width,
        num_frames,
        fps,
        guidance_scale,
        image_base64,
        status: "QUEUED",
        progress: 0,
        phase: "queued",
        queue_position: null,
        eta_seconds: null,
        worker_id: null,
        job_id: client_job_id,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select("*")
      .single();
    if (insErr) throw insErr;

    // 2) calcula queue_position (RPC)
    let queue_position = null;
    try {
      const { data: qp, error: qperr } = await sb.rpc("get_queue_position", { p_job_id: inserted.id });
      if (!qperr) queue_position = qp;
      await sb.from(VIDEO_JOBS_TABLE).update({ queue_position }).eq("id", inserted.id);
    } catch {}

    // 3) Intentar asegurar POD warm con lock (pero NUNCA fallar al usuario)
    let podInfo = null;
    let cold_start = null;
    try {
      const lock = await tryAcquireLock(sb, WAKE_LOCK_SECONDS);
      if (lock.ok) {
        lockAcquired = true;
        podInfo = await ensureWorkingPod(sb, log);
        cold_start = !!podInfo?.cold_start;
      } else {
        // lock ocupado => el job ya quedó en cola, frontend muestra "en cola"
      }
    } catch (e) {
      log("warn ensure pod:", String(e?.message || e));
    }

    return res.status(200).json({
      ok: true,
      status: "QUEUED",
      job_id: inserted.id,
      queue_position: queue_position ?? null,
      cold_start: cold_start ?? null,
      pod: podInfo,
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
}