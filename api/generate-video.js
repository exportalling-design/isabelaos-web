// /api/generate-video.js
// ============================================================
// IsabelaOS Studio - Video Generate API (Vercel Serverless)
// - Lock robusto (auto-recovery) para evitar "Timeout esperando lock"
// - Crea/Resume Pod (RunPod) y manda job al worker (/api/video_async)
// - NO espera el render (eso lo hace el worker runner via Supabase)
// ============================================================

import { createClient } from "@supabase/supabase-js";

// ---------------------
// ENV
// ---------------------
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY = process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY;
const RUNPOD_TEMPLATE_ID = process.env.VIDEO_RUNPOD_TEMPLATE_ID; // tu template para video
const RUNPOD_GPU_TYPE = process.env.VIDEO_RUNPOD_GPU_TYPE || null; // opcional
const RUNPOD_ENDPOINT_PORT = parseInt(process.env.VIDEO_RUNPOD_PORT || "8000", 10);

const RUNPOD_REGION = process.env.VIDEO_RUNPOD_REGION || null;
const RUNPOD_NETWORK_VOLUME_ID = process.env.VIDEO_RUNPOD_NETWORK_VOLUME_ID || null;
const RUNPOD_VOLUME_MOUNT_PATH = process.env.VIDEO_RUNPOD_VOLUME_MOUNT_PATH || "/workspace";

const TERMINATE_AFTER_JOB = (process.env.TERMINATE_AFTER_JOB || "0") === "1";

// Lock tuning
const LOCK_TTL_S = parseInt(process.env.POD_LOCK_TTL_S || "60", 10); // TTL real en DB
const LOCK_WAIT_MS = parseInt(process.env.POD_LOCK_WAIT_MS || "45000", 10);
const LOCK_INTERVAL_MS = parseInt(process.env.POD_LOCK_INTERVAL_MS || "1200", 10);
const LOCK_FORCE_EXPIRE_IF_STALE = (process.env.LOCK_FORCE_EXPIRE_IF_STALE || "1") === "1";

// Worker health wait
const WORKER_WAIT_MS = parseInt(process.env.WORKER_WAIT_MS || "120000", 10);
const WORKER_INTERVAL_MS = parseInt(process.env.WORKER_INTERVAL_MS || "1500", 10);

// Tables
const POD_LOCK_TABLE = process.env.POD_LOCK_TABLE || "pod_lock";

// ---------------------
// Helpers
// ---------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(...args) {
  console.log("[GV]", ...args);
}

function requireEnv(name, val) {
  if (!val) throw new Error(`Missing env: ${name}`);
}

function nowIso() {
  return new Date().toISOString();
}

function toMsUntil(iso) {
  try {
    const t = new Date(iso).getTime();
    return t - Date.now();
  } catch {
    return 0;
  }
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// ---------------------
// Supabase
// ---------------------
function sbAdmin() {
  requireEnv("SUPABASE_URL", SUPABASE_URL);
  requireEnv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY);
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// ---------------------
// RunPod REST
// ---------------------
async function runpodFetch(path, body) {
  requireEnv("RUNPOD_API_KEY", RUNPOD_API_KEY);
  const res = await fetch(`https://api.runpod.io/graphql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RUNPOD_API_KEY}`,
    },
    body: JSON.stringify({ query: path, variables: body || {} }),
  });

  const text = await res.text();
  const json = safeJson(text);
  if (!res.ok) throw new Error(`RunPod HTTP ${res.status}: ${text}`);
  if (json?.errors?.length) throw new Error(`RunPod GQL error: ${JSON.stringify(json.errors)}`);
  return json?.data;
}

// --- Create Pod using template (GraphQL)
async function createPodFromTemplate() {
  requireEnv("RUNPOD_TEMPLATE_ID", RUNPOD_TEMPLATE_ID);

  // Nota: Ajusta campos según tu template.
  // Este mutation está hecho para templates típicos "podTemplateId".
  const mutation = `
    mutation CreatePod($input: PodCreateInput!) {
      podCreate(input: $input) {
        id
      }
    }
  `;

  const input = {
    // template
    podTemplateId: RUNPOD_TEMPLATE_ID,

    // opcionales
    gpuTypeId: RUNPOD_GPU_TYPE || undefined,
    cloudType: "SECURE",
    name: `isabela-video-${Date.now()}`,

    // volumen (si usas Network Volume)
    volumeInGb: undefined,
    networkVolumeId: RUNPOD_NETWORK_VOLUME_ID || undefined,
    containerDiskInGb: undefined,

    // montura típica
    volumeMountPath: RUNPOD_VOLUME_MOUNT_PATH || "/workspace",

    // región
    dataCenterId: RUNPOD_REGION || undefined,
  };

  const data = await runpodFetch(mutation, { input });
  const podId = data?.podCreate?.id;
  if (!podId) throw new Error("RunPod: failed to create pod (no id)");
  return podId;
}

async function getPod(podId) {
  const q = `
    query Pod($id: ID!) {
      pod(id: $id) {
        id
        desiredStatus
        runtime {
          uptimeInSeconds
          ports {
            ip
            isIpPublic
            privatePort
            publicPort
            type
          }
        }
      }
    }
  `;
  const data = await runpodFetch(q, { id: podId });
  return data?.pod || null;
}

async function stopPod(podId) {
  const m = `
    mutation Stop($id: ID!) { podStop(input: { podId: $id }) { id } }
  `;
  await runpodFetch(m, { id: podId });
}

async function terminatePod(podId) {
  const m = `
    mutation Terminate($id: ID!) { podTerminate(input: { podId: $id }) }
  `;
  await runpodFetch(m, { id: podId });
}

function buildWorkerBase(podId) {
  // proxy público de runpod
  // https://{podId}-8000.proxy.runpod.net
  return `https://${podId}-${RUNPOD_ENDPOINT_PORT}.proxy.runpod.net`;
}

async function waitUntilRunning(podId, timeoutMs = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const pod = await getPod(podId);
    // desiredStatus puede venir RUNNING cuando ya está listo
    if (pod?.desiredStatus === "RUNNING") return pod;
    await sleep(2000);
  }
  throw new Error(`Timeout waiting pod RUNNING (${timeoutMs}ms) podId=${podId}`);
}

async function waitWorkerReady(workerBase, timeoutMs, intervalMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${workerBase}/health`, { method: "GET" });
      if (r.ok) return true;
    } catch {}
    await sleep(intervalMs);
  }
  throw new Error(`Timeout waiting worker /health (${timeoutMs}ms)`);
}

// ---------------------
// LOCK (ROBUSTO)
// ---------------------
async function readLockRow(sb) {
  const { data, error } = await sb.from(POD_LOCK_TABLE).select("*").eq("id", 1).single();
  if (error) throw error;
  return data;
}

async function forceExpireLock(sb) {
  // Si tienes un RPC, lo intenta primero:
  try {
    const { data, error } = await sb.rpc("force_expire_pod_lock");
    if (!error) return data;
  } catch {}

  // Fallback: update directo (service role)
  const { error } = await sb
    .from(POD_LOCK_TABLE)
    .update({ locked_until: nowIso() })
    .eq("id", 1);

  if (error) throw error;
  return { ok: true };
}

async function releaseLock(sb) {
  // Si tienes release rpc, úsalo
  try {
    const { data, error } = await sb.rpc("release_pod_lock");
    if (!error) return data;
  } catch {}

  // fallback: expira a "ya"
  return forceExpireLock(sb);
}

async function acquireLockOnce(sb, ttlSeconds) {
  const { data, error } = await sb.rpc("acquire_pod_lock", { p_seconds: ttlSeconds });
  if (error) throw error;
  // data viene como array: [{ ok, locked_until }]
  const row = Array.isArray(data) ? data[0] : data;
  return row || { ok: false };
}

async function acquireLockWait(sb, { ttl_s, wait_ms, interval_ms }) {
  log("step=LOCK_WAIT_BEGIN", { ttl_s, wait_ms, interval_ms });

  const t0 = Date.now();
  let last = null;

  while (Date.now() - t0 < wait_ms) {
    const r = await acquireLockOnce(sb, ttl_s);
    last = r;
    if (r?.ok) {
      log("step=LOCK_OK", r);
      return { ok: true, locked_until: r.locked_until };
    }
    await sleep(interval_ms);
  }

  // Timeout -> Recovery automático
  log("step=LOCK_WAIT_TIMEOUT", { last });

  // Leemos el lock real
  let lockRow = null;
  try {
    lockRow = await readLockRow(sb);
  } catch (e) {
    // si ni leer se puede, devolvemos timeout directo
    return { ok: false, error: `Timeout esperando lock (${wait_ms}ms)` };
  }

  const lockedUntil = lockRow?.locked_until || null;
  const msLeft = lockedUntil ? toMsUntil(lockedUntil) : 0;

  // Si el lock YA venció pero la función no lo deja agarrar -> lo forzamos a expirar
  if (LOCK_FORCE_EXPIRE_IF_STALE && lockedUntil && msLeft <= 0) {
    log("step=LOCK_STALE_DETECTED_FORCE_EXPIRE", { lockedUntil });
    try {
      await forceExpireLock(sb);
    } catch (e) {
      return { ok: false, error: `Timeout esperando lock (${wait_ms}ms) (force-expire failed: ${String(e)})` };
    }

    // reintento rápido
    const retry = await acquireLockOnce(sb, ttl_s);
    if (retry?.ok) {
      log("step=LOCK_OK_AFTER_FORCE_EXPIRE", retry);
      return { ok: true, locked_until: retry.locked_until };
    }
  }

  // Si sigue vigente, devolvemos "busy" con ETA (no 503)
  return {
    ok: false,
    error: `Timeout esperando lock (${wait_ms}ms)`,
    locked_until: lockedUntil,
    ms_left: msLeft,
  };
}

// ---------------------
// MAIN HANDLER
// ---------------------
export default async function handler(req, res) {
  const sb = sbAdmin();

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // payload desde tu UI
    const {
      user_id,
      prompt,
      negative_prompt = "",
      steps = 22,
      mode = "t2v",
      height,
      width,
      num_frames,
      fps,
      guidance_scale,
      image_base64,
    } = req.body || {};

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ ok: false, error: "Missing prompt" });
    }

    // 1) Asegurar que el lock NO queda pegado por errores previos
    //    (No es obligatorio pero ayuda si quedó algo raro)
    log("step=LOCK_RELEASED");
    await releaseLock(sb);

    // 2) Obtener lock con auto-recovery
    const lock = await acquireLockWait(sb, {
      ttl_s: LOCK_TTL_S,
      wait_ms: LOCK_WAIT_MS,
      interval_ms: LOCK_INTERVAL_MS,
    });

    if (!lock.ok) {
      // 👇 aquí ya NO matamos con 503
      // devolvemos "busy" con locked_until para reintentar
      return res.status(409).json({
        ok: false,
        error: lock.error,
        locked_until: lock.locked_until || null,
        ms_left: typeof lock.ms_left === "number" ? lock.ms_left : null,
      });
    }

    // Desde aquí: SIEMPRE liberar lock aunque truene algo
    let podId = null;
    let workerBase = null;

    try {
      // 3) Crear Pod nuevo por job (tu MODO B)
      log("step=CREATE_POD_REQUEST");
      podId = await createPodFromTemplate();
      log("step=CREATE_POD_OK", { podId });

      // 4) Esperar RUNNING
      log("step=WAIT_RUNNING_BEGIN", { podId });
      await waitUntilRunning(podId, 240000);
      log("step=WAIT_RUNNING_OK", { podId });

      // 5) Esperar worker /health
      workerBase = buildWorkerBase(podId);
      log("step=WAIT_WORKER_BEGIN", { workerBase });
      await waitWorkerReady(workerBase, WORKER_WAIT_MS, WORKER_INTERVAL_MS);
      log("step=WAIT_WORKER_OK", { workerBase });

      // 6) Dispatch async al worker (esto mete el job en Supabase desde el worker)
      log("step=DISPATCH_BEGIN");
      const wr = await fetch(`${workerBase}/api/video_async`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        }),
      });

      const wtxt = await wr.text();
      const wjson = safeJson(wtxt);

      if (!wr.ok) {
        throw new Error(`Worker dispatch failed ${wr.status}: ${wtxt}`);
      }

      const job_id = wjson?.job_id || wjson?.jobId || null;
      if (!job_id) {
        throw new Error(`Worker did not return job_id: ${wtxt}`);
      }

      log("step=DISPATCH_OK", { job_id });

      // 7) Responder rápido al front (no esperamos render)
      return res.status(200).json({
        ok: true,
        pod_id: podId,
        worker_base: workerBase,
        job_id,
      });

    } finally {
      // 🔥 LIBERA LOCK SIEMPRE (aquí está lo definitivo)
      try {
        log("step=LOCK_RELEASE_ALWAYS");
        await releaseLock(sb);
      } catch (e) {
        log("warn=LOCK_RELEASE_FAILED", String(e));
      }

      // si estás en modo terminar pod al final (opcional)
      if (TERMINATE_AFTER_JOB && podId) {
        try {
          log("step=TERMINATE_POD", { podId });
          await terminatePod(podId);
        } catch (e) {
          log("warn=TERMINATE_FAILED", String(e));
        }
      }
    }
  } catch (e) {
    const msg = String(e?.message || e);
    log("ERROR", msg);
    return res.status(503).json({ ok: false, error: msg });
  }
}