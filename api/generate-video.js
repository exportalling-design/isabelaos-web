// /api/generate-video.js
import { createClient } from "@supabase/supabase-js";

// ============================================================
// ENV
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY = process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY;

// RunPod template/infra
const VIDEO_RUNPOD_TEMPLATE_ID = process.env.VIDEO_RUNPOD_TEMPLATE_ID; // required
const VIDEO_RUNPOD_GPU_TYPE = process.env.VIDEO_RUNPOD_GPU_TYPE || ""; // optional
const VIDEO_RUNPOD_NETWORK_VOLUME_ID = process.env.VIDEO_RUNPOD_NETWORK_VOLUME_ID || ""; // optional
const TERMINATE_AFTER_JOB = String(process.env.TERMINATE_AFTER_JOB || "0") === "1";

// Lock (Supabase RPC)
const LOCK_NAME = "video-api";
const LOCK_TTL_SECONDS = parseInt(process.env.LOCK_TTL_SECONDS || "90", 10);
const LOCK_WAIT_MS = parseInt(process.env.LOCK_WAIT_MS || "45000", 10);
const LOCK_POLL_MS = parseInt(process.env.LOCK_POLL_MS || "1500", 10);
const LOCK_HEARTBEAT_MS = parseInt(process.env.LOCK_HEARTBEAT_MS || "25000", 10);

// Worker probe
const WORKER_PORT = parseInt(process.env.WORKER_PORT || "8000", 10);
const WORKER_HEALTH_PATHS = ["/health", "/api/health", "/"]; // probing
const WORKER_WAIT_MS = parseInt(process.env.WORKER_WAIT_MS || "120000", 10);
const WORKER_POLL_MS = parseInt(process.env.WORKER_POLL_MS || "2500", 10);

const WORKER_GENERATE_PATH = process.env.WORKER_GENERATE_PATH || "/api/video_async"; // or /api/video

// VERSION MARKER (para verificar en logs de Vercel)
const VERSION_MARKER = "2026-01-14__NO_PODCREATEINPUT__V1";

// ============================================================
// Helpers
// ============================================================
function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(url, opts = {}, ms = 15000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

// ============================================================
// RunPod GraphQL (NEW ONLY) - NUNCA PodCreateInput
// ============================================================
async function runpodGraphQL(query, variables) {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY / VIDEO_RUNPOD_API_KEY");

  const r = await fetch("https://api.runpod.io/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RUNPOD_API_KEY}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const data = await r.json().catch(() => ({}));

  if (!r.ok) {
    throw new Error(`RunPod API error ${r.status}: ${JSON.stringify(data)}`);
  }
  if (data?.errors?.length) {
    throw new Error(`RunPod GraphQL error: ${JSON.stringify(data.errors)}`);
  }
  return data.data;
}

// Crea pod desde template usando PodTemplateInput (el tipo que te sugiere el error)
async function runpodCreatePodFromTemplate({ name, templateId, gpuTypeId, networkVolumeId }) {
  // OJO: este script NO usa PodCreateInput. Punto.
  const query = `
    mutation CreateFromTemplate($input: PodTemplateInput!) {
      podCreateFromTemplate(input: $input) {
        id
      }
    }
  `;

  const input = {
    templateId,
    name,
    gpuTypeId: gpuTypeId || null,
    networkVolumeId: networkVolumeId || null,
  };

  const data = await runpodGraphQL(query, { input });
  const podId = data?.podCreateFromTemplate?.id;

  if (!podId) throw new Error("RunPod: podCreateFromTemplate returned no id");
  return podId;
}

async function runpodGetPod(podId) {
  const query = `
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
  const data = await runpodGraphQL(query, { id: podId });
  return data?.pod || null;
}

async function waitPodRunning(podId, timeoutMs = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const pod = await runpodGetPod(podId);
    const desired = pod?.desiredStatus || "";
    if (desired === "RUNNING") return pod;
    await sleep(2500);
  }
  throw new Error(`Timeout waiting pod RUNNING: ${podId}`);
}

function workerBaseFromPodId(podId) {
  return `https://${podId}-${WORKER_PORT}.proxy.runpod.net`;
}

async function waitWorkerReady(baseUrl) {
  const t0 = Date.now();
  while (Date.now() - t0 < WORKER_WAIT_MS) {
    for (const p of WORKER_HEALTH_PATHS) {
      try {
        const r = await fetchWithTimeout(`${baseUrl}${p}`, { method: "GET" }, 8000);
        if (r.ok) return true;
      } catch (_) {}
    }
    await sleep(WORKER_POLL_MS);
  }
  throw new Error(`Worker not ready in time: ${baseUrl}`);
}

async function terminatePod(podId) {
  const query = `
    mutation TerminatePod($podId: ID!) {
      podTerminate(input: { podId: $podId }) { id }
    }
  `;
  await runpodGraphQL(query, { podId });
  return true;
}

// ============================================================
// Supabase Lock helpers (RPC)
// ============================================================
function normalizeRpcResult(data) {
  // Soporta RPC que retorna {ok, locked_until} o [{ok, locked_until}]
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

export default async function handler(req, res) {
  console.log("[GV] VERSION=", VERSION_MARKER);

  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  // Validate env early
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(res, 500, { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
  }
  if (!RUNPOD_API_KEY) return json(res, 500, { error: "Missing RUNPOD_API_KEY / VIDEO_RUNPOD_API_KEY" });
  if (!VIDEO_RUNPOD_TEMPLATE_ID) return json(res, 500, { error: "Missing VIDEO_RUNPOD_TEMPLATE_ID" });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // payload desde front
  let body = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return json(res, 400, { error: "Invalid JSON body" });
  }

  // owner único por request
  const owner = `video-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  let heartbeat = null;
  let podId = null;
  let workerBase = null;

  const log = (...a) => console.log("[GV]", ...a);

  // ---------------- LOCK ----------------
  async function acquireLockOrWait() {
    const t0 = Date.now();
    while (Date.now() - t0 < LOCK_WAIT_MS) {
      const { data, error } = await supabase.rpc("acquire_pod_lock", {
        p_name: LOCK_NAME,
        p_owner: owner,
        p_ttl_seconds: LOCK_TTL_SECONDS,
      });

      if (error) {
        // IMPORTANTE: no lo escondemos, lo devolvemos claro
        throw new Error(`Lock RPC error: ${error.message}`);
      }

      const row = normalizeRpcResult(data);
      const ok = row?.ok === true;
      const until = row?.locked_until || null;

      if (ok) return { ok: true, until };
      await sleep(LOCK_POLL_MS);
    }
    return { ok: false };
  }

  async function startHeartbeat() {
    heartbeat = setInterval(async () => {
      try {
        const { data, error } = await supabase.rpc("refresh_pod_lock", {
          p_name: LOCK_NAME,
          p_owner: owner,
          p_ttl_seconds: LOCK_TTL_SECONDS,
        });

        if (error) log("heartbeat error:", error.message);
        const row = normalizeRpcResult(data);
        if (!row || row?.ok !== true) log("heartbeat: lost lock (will expire)");
      } catch (e) {
        log("heartbeat exception:", String(e?.message || e));
      }
    }, LOCK_HEARTBEAT_MS);
  }

  async function releaseLock() {
    try {
      await supabase.rpc("release_pod_lock", { p_name: LOCK_NAME, p_owner: owner });
    } catch (_) {}
  }

  try {
    log("step=LOCK_WAIT_BEGIN", { ttl_s: LOCK_TTL_SECONDS, wait_ms: LOCK_WAIT_MS, owner });

    const got = await acquireLockOrWait();
    if (!got.ok) {
      return json(res, 429, { error: `Timeout esperando lock (${LOCK_WAIT_MS}ms)` });
    }

    log("step=LOCK_OK", { locked_until: got.until });
    await startHeartbeat();

    // ---------------- CREATE POD (NEW ONLY) ----------------
    log("step=CREATE_POD_REQUEST");

    podId = await runpodCreatePodFromTemplate({
      name: `isabela-video-${Date.now()}`,
      templateId: VIDEO_RUNPOD_TEMPLATE_ID,
      gpuTypeId: VIDEO_RUNPOD_GPU_TYPE || null,
      networkVolumeId: VIDEO_RUNPOD_NETWORK_VOLUME_ID || null,
    });

    log("created podId=", podId);

    // ---------------- WAIT RUNNING ----------------
    log("step=WAIT_RUNNING_BEGIN", { podId });
    await waitPodRunning(podId);
    log("step=WAIT_RUNNING_OK", { podId });

    // ---------------- WAIT WORKER READY ----------------
    workerBase = workerBaseFromPodId(podId);
    log("workerBase=", workerBase);
    log("step=WAIT_WORKER_BEGIN");
    await waitWorkerReady(workerBase);
    log("step=WAIT_WORKER_OK");

    // ---------------- DISPATCH JOB ----------------
    log("step=DISPATCH_BEGIN", { path: WORKER_GENERATE_PATH });

    const wr = await fetchWithTimeout(
      `${workerBase}${WORKER_GENERATE_PATH}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      600000 // 10 min
    );

    const wtxt = await wr.text().catch(() => "");
    let wjson = null;
    try { wjson = JSON.parse(wtxt); } catch (_) {}

    if (!wr.ok) {
      throw new Error(`Worker dispatch failed (${wr.status}): ${wtxt || "no body"}`);
    }

    log("step=DISPATCH_OK");

    return json(res, 200, {
      ok: true,
      version: VERSION_MARKER,
      podId,
      workerBase,
      worker: wjson || wtxt,
    });
  } catch (e) {
    const msg = String(e?.message || e);
    console.error("[GV] fatal:", msg);
    return json(res, 500, { error: msg, version: VERSION_MARKER, podId, workerBase });
  } finally {
    if (heartbeat) clearInterval(heartbeat);

    // liberar lock SIEMPRE
    await releaseLock();

    // terminar pod opcional
    if (TERMINATE_AFTER_JOB && podId) {
      try { await terminatePod(podId); } catch (_) {}
    }
  }
}