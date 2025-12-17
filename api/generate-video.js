// /api/generate-video.js
// ============================================================
// IsabelaOS Studio - Video Generate API (Vercel Serverless Function)
//
// OBJETIVO (Opción B):
// - NO reusar pods (porque tú usas TERMINATE).
// - En cada "arranque en frío" crea un POD NUEVO via RunPod REST,
//   usando TU TEMPLATE + TU NETWORK VOLUME (persistencia).
// - Construye el endpoint público: https://<podId>-8000.proxy.runpod.net
// - Espera /health o /api/video, y luego proxy POST al worker.
// - Usa LOCK en Supabase para evitar que 2 requests creen 2 pods a la vez.
// ============================================================

import { createClient } from "@supabase/supabase-js";

// =====================
// ENV (Vercel)
// =====================

// ✅ Admin (solo backend): para escribir/leer tablas de lock/state en Supabase
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ✅ RunPod API KEY (ya la tienes)
const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY || null;

// ✅ VIDEO: datos para crear el pod nuevo desde TU TEMPLATE + TU VOLUMEN
const VIDEO_TEMPLATE_ID = process.env.VIDEO_RUNPOD_TEMPLATE_ID; // ID del template de video
const VIDEO_NETWORK_VOLUME_ID = process.env.VIDEO_RUNPOD_NETWORK_VOLUME_ID; // tu volume id (x4ppgiwpse)
const VIDEO_VOLUME_MOUNT_PATH = process.env.VIDEO_VOLUME_MOUNT_PATH || "/workspace";

// Tablas en Supabase
const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";

// Timing
const LOCK_SECONDS = 180;                 // lock para evitar colisiones
const READY_TIMEOUT_MS = 10 * 60 * 1000;  // 10 min esperando listo
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

// =====================
// Worker readiness
// =====================
async function waitForWorkerReady(workerBase, maxMs = 5 * 60 * 1000) {
  const start = Date.now();
  const base = workerBase.endsWith("/") ? workerBase.slice(0, -1) : workerBase;

  const candidates = [
    `${base}/health`,
    `${base}/api/video`,
  ];

  while (Date.now() - start < maxMs) {
    for (const url of candidates) {
      try {
        const r = await fetch(url, { method: "GET" });

        // OK => listo
        if (r.ok) return true;

        // 405 => ruta existe (server está vivo)
        if (r.status === 405) return true;

        // 401/403 también cuenta como “está arriba”
        if (r.status === 401 || r.status === 403) return true;
      } catch (e) {
        // ignora y sigue
      }
    }
    await sleep(2500);
  }

  throw new Error("Worker not ready: no respondió a /health o /api/video a tiempo.");
}

// =====================
// RunPod REST (crear pod nuevo)
// Docs: POST https://rest.runpod.io/v1/pods :contentReference[oaicite:1]{index=1}
// =====================
function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY in Vercel");
  return {
    Authorization: `Bearer ${RUNPOD_API_KEY}`,
    "Content-Type": "application/json",
  };
}

// Crea un pod usando templateId + networkVolumeId + ports
async function runpodCreatePod() {
  if (!VIDEO_TEMPLATE_ID) throw new Error("Missing VIDEO_RUNPOD_TEMPLATE_ID in Vercel");
  if (!VIDEO_NETWORK_VOLUME_ID) throw new Error("Missing VIDEO_RUNPOD_NETWORK_VOLUME_ID in Vercel");

  const payload = {
    // Lo más importante para ti:
    templateId: VIDEO_TEMPLATE_ID,
    networkVolumeId: VIDEO_NETWORK_VOLUME_ID,
    volumeMountPath: VIDEO_VOLUME_MOUNT_PATH,

    // Asegura proxy para 8000 (worker) y 8888 (jupyter)
    ports: ["8000/http", "8888/http"],

    // Recomendado para acceso proxy
    globalNetworking: true,

    // Nombre visible (opcional)
    name: `isabela-video-${Date.now()}`,
  };

  const r = await fetch("https://rest.runpod.io/v1/pods", {
    method: "POST",
    headers: runpodHeaders(),
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`RunPod create pod failed (${r.status}): ${t}`);
  }

  const pod = await r.json();
  if (!pod?.id) throw new Error("RunPod create pod: no returned pod.id");

  return pod;
}

// Construye el endpoint proxy por convención RunPod:
// https://<podId>-8000.proxy.runpod.net
function buildProxyEndpoint(podId) {
  return `https://${podId}-8000.proxy.runpod.net`;
}

// =====================
// Main: asegura worker arriba (Opción B)
// =====================
async function ensurePodRunning(sb) {
  // 1) Lock global
  const got = await acquireLock(sb);
  if (!got.ok) {
    await waitForUnlock(sb);
    return await ensurePodRunning(sb);
  }

  // 2) Crear pod nuevo SIEMPRE (porque tú usas TERMINATE)
  await setPodState(sb, { status: "CREATING", last_used_at: new Date().toISOString() });

  const pod = await runpodCreatePod();
  const podId = pod.id;

  // 3) Endpoint público por proxy
  const rpEndpoint = buildProxyEndpoint(podId);

  // 4) Guardar estado
  await setPodState(sb, {
    status: "STARTING",
    pod_id: podId,
    worker_url: rpEndpoint,
    last_used_at: new Date().toISOString(),
  });

  // 5) Esperar worker listo
  await waitForWorkerReady(rpEndpoint, READY_TIMEOUT_MS);

  await setPodState(sb, {
    status: "RUNNING",
    last_used_at: new Date().toISOString(),
  });

  return rpEndpoint;
}

// =====================
// API route
// =====================
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    const sb = sbAdmin();

    // 1) crear pod + esperar worker
    const workerBase = await ensurePodRunning(sb);

    // 2) proxy a /api/video del worker
    const base = workerBase.endsWith("/") ? workerBase.slice(0, -1) : workerBase;
    const url = `${base}/api/video`;

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });

    const data = await r.json().catch(() => ({}));

    // 3) update last_used_at
    await setPodState(sb, { last_used_at: new Date().toISOString() });

    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
