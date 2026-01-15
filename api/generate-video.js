// /api/generate-video.js
import { createClient } from "@supabase/supabase-js";

// =====================
// ENV (Vercel)
// =====================
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// RunPod
const RUNPOD_API_KEY =
  process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY;

// Infra
const VIDEO_RUNPOD_TEMPLATE_ID = process.env.VIDEO_RUNPOD_TEMPLATE_ID; // required
const VIDEO_RUNPOD_GPU_TYPE = process.env.VIDEO_RUNPOD_GPU_TYPE || ""; // optional
const VIDEO_RUNPOD_NETWORK_VOLUME_ID =
  process.env.VIDEO_RUNPOD_NETWORK_VOLUME_ID || "";
const TERMINATE_AFTER_JOB = String(process.env.TERMINATE_AFTER_JOB || "0") === "1";

// Lock
const LOCK_NAME = "video-api";
const LOCK_TTL_SECONDS = parseInt(process.env.LOCK_TTL_SECONDS || "90", 10);
const LOCK_WAIT_MS = parseInt(process.env.LOCK_WAIT_MS || "45000", 10);
const LOCK_POLL_MS = parseInt(process.env.LOCK_POLL_MS || "1500", 10);
const LOCK_HEARTBEAT_MS = parseInt(process.env.LOCK_HEARTBEAT_MS || "25000", 10);

// Worker probe
const WORKER_PORT = parseInt(process.env.WORKER_PORT || "8000", 10);
const WORKER_HEALTH_PATHS = ["/health", "/api/health", "/"];
const WORKER_WAIT_MS = parseInt(process.env.WORKER_WAIT_MS || "120000", 10);
const WORKER_POLL_MS = parseInt(process.env.WORKER_POLL_MS || "2500", 10);

// Endpoint del worker para generar
const WORKER_GENERATE_PATH =
  process.env.WORKER_GENERATE_PATH || "/api/video_async"; // o "/api/video"

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
// RunPod GraphQL helpers
// ============================================================
async function runpodGraphQL(query, variables) {
  const r = await fetch("https://api.runpod.io/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RUNPOD_API_KEY}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.errors) {
    const errMsg =
      (data?.errors && JSON.stringify(data.errors)) ||
      JSON.stringify(data || {});
    throw new Error(`RunPod API error: ${r.status} ${errMsg}`);
  }
  return data?.data;
}

// ✅ CREATE POD (robusto):
// 1) intenta esquema NUEVO (podCreateFromTemplate / PodTemplateInput)
// 2) si falla, intenta esquema viejo (podFindAndDeployOnDemand / PodCreateInput)
async function runpodCreatePod({ name, templateId, gpuTypeId, networkVolumeId }) {
  // --- intento NUEVO ---
  const queryNew = `
    mutation CreateFromTemplate($input: PodTemplateInput!) {
      podCreateFromTemplate(input: $input) {
        id
      }
    }
  `;

  const inputNew = {
    templateId,
    name,
    // algunos tenants aceptan null, otros prefieren omitir; usamos null si vacío
    gpuTypeId: gpuTypeId || null,
    networkVolumeId: networkVolumeId || null,
    // puertos en muchos tenants van en template; si tu template no los trae,
    // el worker igual suele quedar expuesto por proxy si el template define 8000.
    // Si tu tenant acepta ports aquí, puedes agregarlo.
  };

  try {
    const data = await runpodGraphQL(queryNew, { input: inputNew });
    const id = data?.podCreateFromTemplate?.id;
    if (!id) throw new Error("RunPod: podCreateFromTemplate returned no id");
    return { id, schema: "new" };
  } catch (e) {
    // --- fallback VIEJO ---
    const queryOld = `
      mutation CreatePod($input: PodCreateInput!) {
        podFindAndDeployOnDemand(input: $input) {
          id
          desiredStatus
        }
      }
    `;

    const inputOld = {
      cloudType: "SECURE",
      templateId,
      name,
      gpuTypeId: gpuTypeId || undefined,
      networkVolumeId: networkVolumeId || undefined,
      ports: `${WORKER_PORT}/http`,
      env: {},
    };

    const data = await runpodGraphQL(queryOld, { input: inputOld });
    const id = data?.podFindAndDeployOnDemand?.id;
    if (!id) {
      // lanza el error original + fallback para que se vea claro
      throw new Error(
        `RunPod create pod failed. NewSchemaErr="${String(
          e?.message || e
        )}" OldSchemaReturnedNoId`
      );
    }
    return { id, schema: "old" };
  }
}

async function runpodGetPod(podId) {
  const query = `
    query Pod($id: ID!) {
      pod(id: $id) {
        id
        desiredStatus
        runtime {
          podId
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
  return data?.pod;
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
        const r = await fetchWithTimeout(
          `${baseUrl}${p}`,
          { method: "GET" },
          8000
        );
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
// Handler
// ============================================================
export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // payload desde front
  let body = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  } catch (e) {
    return json(res, 400, { error: "Invalid JSON body" });
  }

  // owner único por request
  const owner = `video-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  let heartbeat = null;
  let podId = null;
  let workerBase = null;

  const log = (...a) => console.log("[GV]", ...a);

  // -------------- LOCK ACQUIRE --------------
  async function acquireLockOrWait() {
    const t0 = Date.now();
    while (Date.now() - t0 < LOCK_WAIT_MS) {
      const { data, error } = await supabase.rpc("acquire_pod_lock", {
        p_name: LOCK_NAME,
        p_owner: owner,
        p_ttl_seconds: LOCK_TTL_SECONDS,
      });

      if (error) throw new Error(`Lock RPC error: ${error.message}`);

      const ok = Array.isArray(data) ? data[0]?.ok : data?.ok;
      const until = Array.isArray(data) ? data[0]?.locked_until : data?.locked_until;

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
        if (!data) log("heartbeat lost lock (auto-expire soon)");
      } catch (e) {
        log("heartbeat exception:", String(e?.message || e));
      }
    }, LOCK_HEARTBEAT_MS);
  }

  async function releaseLock() {
    try {
      await supabase.rpc("release_pod_lock", {
        p_name: LOCK_NAME,
        p_owner: owner,
      });
    } catch (_) {}
  }

  try {
    // Validaciones
    if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY / VIDEO_RUNPOD_API_KEY");
    if (!VIDEO_RUNPOD_TEMPLATE_ID) throw new Error("Missing VIDEO_RUNPOD_TEMPLATE_ID");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
      throw new Error("Missing SUPABASE env (URL or SERVICE_ROLE_KEY)");

    // LOCK
    log("step=LOCK_WAIT_BEGIN", { ttl_s: LOCK_TTL_SECONDS, wait_ms: LOCK_WAIT_MS, owner });
    const got = await acquireLockOrWait();
    if (!got.ok) return json(res, 429, { error: `Timeout esperando lock (${LOCK_WAIT_MS}ms)` });

    log("step=LOCK_OK");
    await startHeartbeat();

    // CREATE POD
    log("step=CREATE_POD_REQUEST", {
      templateId: VIDEO_RUNPOD_TEMPLATE_ID,
      gpuType: VIDEO_RUNPOD_GPU_TYPE || "(template default)",
      volume: VIDEO_RUNPOD_NETWORK_VOLUME_ID || "(none)",
    });

    const created = await runpodCreatePod({
      name: `isabela-video-${Date.now()}`,
      templateId: VIDEO_RUNPOD_TEMPLATE_ID,
      gpuTypeId: VIDEO_RUNPOD_GPU_TYPE,
      networkVolumeId: VIDEO_RUNPOD_NETWORK_VOLUME_ID,
    });

    podId = created?.id;
    if (!podId) throw new Error("RunPod did not return podId");
    log("created podId=", podId, "schema=", created.schema);

    // WAIT RUNNING
    log("step=WAIT_RUNNING_BEGIN", { podId });
    await waitPodRunning(podId);
    log("step=WAIT_RUNNING_OK", { podId });

    // WAIT WORKER
    workerBase = workerBaseFromPodId(podId);
    log("workerBase=", workerBase);
    log("step=WAIT_WORKER_BEGIN");
    await waitWorkerReady(workerBase);
    log("step=WAIT_WORKER_OK");

    // DISPATCH
    log("step=DISPATCH_BEGIN", { path: WORKER_GENERATE_PATH });

    const wr = await fetchWithTimeout(
      `${workerBase}${WORKER_GENERATE_PATH}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      600000
    );

    const wtxt = await wr.text().catch(() => "");
    let wjson = null;
    try {
      wjson = JSON.parse(wtxt);
    } catch (_) {}

    if (!wr.ok) throw new Error(`Worker dispatch failed (${wr.status}): ${wtxt || "no body"}`);

    log("step=DISPATCH_OK");

    return json(res, 200, {
      ok: true,
      podId,
      workerBase,
      worker: wjson || wtxt,
    });
  } catch (e) {
    const msg = String(e?.message || e);
    console.error("[GV] fatal:", msg);
    return json(res, 500, { error: msg, podId, workerBase });
  } finally {
    if (heartbeat) clearInterval(heartbeat);

    // liberar lock SIEMPRE
    await releaseLock();

    // terminar pod si se pidió
    if (TERMINATE_AFTER_JOB && podId) {
      try {
        await terminatePod(podId);
      } catch (_) {}
    }
  }
}