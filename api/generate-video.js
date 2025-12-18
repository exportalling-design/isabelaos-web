// /api/generate-video.js
// ============================================================
// IsabelaOS Studio - Video Generate API (Vercel Serverless)
//
// Objetivo:
// - NO hay un VIDEO_RP_ENDPOINT fijo porque el pod se TERMINA y cambia.
// - Cada request crea un pod nuevo desde un TEMPLATE (on-demand) en RunPod.
// - Forzamos GPU específica (A100 SXM) con gpuTypeId para que NO abra A6000.
// - Luego armamos la URL proxy del worker (puerto 8000) y hacemos proxy a /api/video.
// - Lock en Supabase para evitar dos generaciones simultáneas.
// ============================================================

import { createClient } from "@supabase/supabase-js";

// =====================
// ENV (Vercel)
// =====================

// Supabase admin (solo backend)
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// RunPod
const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;

// Tu template de video (ya lo tienes creado)
const VIDEO_RUNPOD_TEMPLATE_ID = process.env.VIDEO_RUNPOD_TEMPLATE_ID;

// Tu Network Volume (ya lo tienes creado)
const VIDEO_RUNPOD_NETWORK_VOLUME_ID = process.env.VIDEO_RUNPOD_NETWORK_VOLUME_ID;

// Opcional (solo por si quieres guardarlo en logs/estado)
const VIDEO_VOLUME_MOUNT_PATH = process.env.VIDEO_VOLUME_MOUNT_PATH || "/workspace";

// ✅ GPU obligatoria (para evitar que abra A6000)
// Pon aquí el gpuTypeId REAL que exige RunPod GraphQL.
// Si aún no lo tienes, lo podemos sacar de RunPod, pero el error actual es porque falta este dato.
const VIDEO_RUNPOD_GPU_TYPE_ID =
  process.env.VIDEO_RUNPOD_GPU_TYPE_ID || null;

// Tablas Supabase
const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";

// Timing
const LOCK_SECONDS = 240;                 // lock 4 min
const WORKER_READY_TIMEOUT_MS = 8 * 60 * 1000; // 8 min
const POLL_MS = 3000;

// =====================
// Helpers
// =====================
function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL (o VITE_SUPABASE_URL)");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (backend only)");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setPodState(sb, patch) {
  // Requiere row id=1 en pod_state
  const { error } = await sb.from(POD_STATE_TABLE).update(patch).eq("id", 1);
  if (error) throw error;
}

// ---------------------
// Lock (Supabase)
// ---------------------
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

// ---------------------
// RunPod GraphQL
// ---------------------
function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY en Vercel");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${RUNPOD_API_KEY}`,
  };
}

async function runpodGraphQL(query, variables) {
  const r = await fetch("https://api.runpod.io/graphql", {
    method: "POST",
    headers: runpodHeaders(),
    body: JSON.stringify({ query, variables }),
  });

  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`RunPod GraphQL HTTP ${r.status}: ${JSON.stringify(json)}`);
  }
  if (json.errors) {
    throw new Error(`RunPod GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

// Crea pod on-demand desde TEMPLATE + NETWORK VOLUME + GPU_TYPE_ID
async function createVideoPodOnDemand() {
  if (!VIDEO_RUNPOD_TEMPLATE_ID) throw new Error("Falta VIDEO_RUNPOD_TEMPLATE_ID en Vercel");
  if (!VIDEO_RUNPOD_NETWORK_VOLUME_ID) throw new Error("Falta VIDEO_RUNPOD_NETWORK_VOLUME_ID en Vercel");

  // ✅ Este es EXACTAMENTE el error que te salió:
  // gpuTypeId is required
  // así que aquí lo hacemos obligatorio
  if (!VIDEO_RUNPOD_GPU_TYPE_ID) {
    throw new Error(
      "Falta VIDEO_RUNPOD_GPU_TYPE_ID en Vercel (RunPod exige gpuTypeId para podFindAndDeployOnDemand)"
    );
  }

  const query = `
    mutation PodFindAndDeployOnDemand(
      $templateId: String!
      $gpuTypeId: String!
      $networkVolumeId: String!
    ) {
      podFindAndDeployOnDemand(
        input: {
          templateId: $templateId
          gpuTypeId: $gpuTypeId
          networkVolumeId: $networkVolumeId
        }
      ) {
        id
      }
    }
  `;

  const data = await runpodGraphQL(query, {
    templateId: VIDEO_RUNPOD_TEMPLATE_ID,
    gpuTypeId: VIDEO_RUNPOD_GPU_TYPE_ID,
    networkVolumeId: VIDEO_RUNPOD_NETWORK_VOLUME_ID,
  });

  const podId = data?.podFindAndDeployOnDemand?.id;
  if (!podId) throw new Error("RunPod no devolvió podId al crear el pod on-demand");

  return podId;
}

// Construye la URL pública del worker (proxy) en puerto 8000 para ESTE pod
function buildWorkerUrl(podId) {
  // Formato típico de RunPod proxy:
  // https://<POD_ID>-8000.proxy.runpod.net
  // Si tu RunPod usa otro formato, se cambia aquí.
  return `https://${podId}-8000.proxy.runpod.net`;
}

// Espera que el worker esté vivo (GET /health o GET /api/video -> 405 vale)
async function waitForWorkerReady(workerBase) {
  const start = Date.now();
  const base = workerBase.endsWith("/") ? workerBase.slice(0, -1) : workerBase;

  const candidates = [`${base}/health`, `${base}/api/video`];

  while (Date.now() - start < WORKER_READY_TIMEOUT_MS) {
    for (const url of candidates) {
      try {
        const r = await fetch(url, { method: "GET" });

        if (r.ok) return true;
        if (r.status === 405) return true; // ruta existe, server arriba
        if (r.status === 401 || r.status === 403) return true;
      } catch (e) {
        // sigue intentando
      }
    }
    await sleep(2500);
  }

  throw new Error("Worker no respondió a tiempo (revisa que el template exponga puerto 8000 y el server corra)");
}

// Proxy request al worker /api/video
async function proxyToWorker(workerBase, body) {
  const base = workerBase.endsWith("/") ? workerBase.slice(0, -1) : workerBase;
  const url = `${base}/api/video`;

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

// =====================
// Main: handler
// =====================
export default async function handler(req, res) {
  // Solo POST
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    const sb = sbAdmin();

    // 1) Lock para evitar 2 videos simultáneos
    const got = await acquireLock(sb);
    if (!got.ok) {
      await waitForUnlock(sb);
      // reintenta una vez que se liberó
      return handler(req, res);
    }

    // 2) Guardar estado inicial
    await setPodState(sb, {
      status: "CREATING",
      last_used_at: new Date().toISOString(),
      volume_mount_path: VIDEO_VOLUME_MOUNT_PATH,
    });

    // 3) Crear pod nuevo (on-demand) ✅ (aquí estaba el error gpuTypeId)
    const podId = await createVideoPodOnDemand();

    // 4) Construir endpoint del worker para ESTE pod
    const workerUrl = buildWorkerUrl(podId);

    await setPodState(sb, {
      status: "STARTING",
      pod_id: podId,
      worker_url: workerUrl,
      last_used_at: new Date().toISOString(),
    });

    // 5) Esperar que el worker esté listo
    await waitForWorkerReady(workerUrl);

    await setPodState(sb, {
      status: "RUNNING",
      last_used_at: new Date().toISOString(),
    });

    // 6) Proxy al worker
    const { status, data } = await proxyToWorker(workerUrl, req.body);

    // 7) Guardar última actividad
    await setPodState(sb, { last_used_at: new Date().toISOString() });

    // 8) Responder
    return res.status(status).json({
      ok: status >= 200 && status < 300,
      pod_id: podId,
      worker_url: workerUrl,
      result: data,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
