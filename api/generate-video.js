// /api/generate-video.js
import { createClient } from "@supabase/supabase-js";

/**
 * Este endpoint vive en Vercel y hace 3 cosas:
 * 1) Usa un LOCK en Supabase para evitar requests simultáneos.
 * 2) (Opcional) Enciende/espera el pod por RunPod REST si hay POD_ID + API_KEY.
 * 3) Proxy: reenvía el POST al worker FastAPI en RunPod:  RP_ENDPOINT + /api/video
 */

// =====================
// ENV (Vercel)
// =====================

// URL del proyecto Supabase (ej: https://xxxx.supabase.co)
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;

// Service role key (SOLO backend; nunca en frontend)
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// URL pública del worker (puerto 8000 proxy). EJ:
// https://8vay2rng2rejch-8000.proxy.runpod.net
// (IMPORTANTE: SIN /api/video al final)
const RP_ENDPOINT = process.env.RP_ENDPOINT;

// Si quieres auto-start/auto-resume del pod:
const RUNPOD_POD_ID = process.env.RUNPOD_POD_ID || null;
const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY || null;

// Tablas en Supabase
const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";

const LOCK_SECONDS = 180;        // lock por 3 min
const READY_TIMEOUT_MS = 10 * 60 * 1000; // 10 min
const POLL_MS = 3000;

// =====================
// Supabase Admin client
// =====================
function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL (o VITE_SUPABASE_URL)");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (backend only)");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setPodState(sb, patch) {
  const { error } = await sb.from(POD_STATE_TABLE).update(patch).eq("id", 1);
  if (error) throw error;
}

// =====================
// Worker readiness check
// =====================
async function waitForWorkerReady(workerBase, maxMs = 5 * 60 * 1000) {
  const start = Date.now();
  const base = workerBase.endsWith("/") ? workerBase.slice(0, -1) : workerBase;

  // Rutas típicas de FastAPI (seguras para “ping”)
  const candidates = [
    `${base}/health`,        // si la implementas
    `${base}/docs`,          // FastAPI Swagger
    `${base}/openapi.json`,  // FastAPI OpenAPI
    `${base}/api/video`,     // si devuelve 405 en GET, también sirve
  ];

  while (Date.now() - start < maxMs) {
    for (const url of candidates) {
      try {
        const r = await fetch(url, { method: "GET" });

        // 200 OK => listo
        if (r.ok) return true;

        // 405 Method Not Allowed => existe endpoint pero requiere POST => listo
        if (r.status === 405) return true;

        // 401/403 => endpoint protegido pero respondió => listo
        if (r.status === 401 || r.status === 403) return true;
      } catch (e) {}
    }
    await sleep(2500);
  }

  throw new Error("Worker not ready: no respondió a tiempo. Revisa RP_ENDPOINT + puerto 8000.");
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
// RunPod REST helpers
// =====================
function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY in Vercel");
  return { Authorization: `Bearer ${RUNPOD_API_KEY}` };
}

async function runpodGetPod(podId) {
  const url = `https://rest.runpod.io/v1/pods/${podId}`;
  const r = await fetch(url, { headers: runpodHeaders() });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`RunPod GET pod failed (${r.status}): ${t}`);
  }
  return await r.json();
}

async function runpodStartOrResumePod(podId) {
  const candidates = [
    `https://rest.runpod.io/v1/pods/${podId}/start`,
    `https://rest.runpod.io/v1/pods/${podId}/resume`,
  ];

  let lastErr = null;
  for (const url of candidates) {
    const r = await fetch(url, { method: "POST", headers: runpodHeaders() });
    if (r.ok) return true;

    const t = await r.text().catch(() => "");
    lastErr = new Error(`RunPod start/resume failed (${r.status}) at ${url}: ${t}`);
  }
  throw lastErr || new Error("RunPod start/resume failed");
}

async function waitUntilRunning(podId) {
  const start = Date.now();
  while (Date.now() - start < READY_TIMEOUT_MS) {
    const pod = await runpodGetPod(podId);
    const status = (pod?.status || "").toUpperCase();
    if (status === "RUNNING") return pod;
    await sleep(POLL_MS);
  }
  throw new Error("Timeout: el pod no llegó a RUNNING dentro del tiempo configurado");
}

async function ensurePodRunning(sb) {
  // lock global para no encender/consultar pod duplicado
  const got = await acquireLock(sb);
  if (!got.ok) {
    await waitForUnlock(sb);
    return await ensurePodRunning(sb);
  }

  if (!RP_ENDPOINT) {
    await setPodState(sb, { status: "ERROR" });
    throw new Error("Falta RP_ENDPOINT en Vercel (URL pública del worker en puerto 8000)");
  }

  // guarda referencia en DB
  await setPodState(sb, {
    worker_url: RP_ENDPOINT,
    pod_id: RUNPOD_POD_ID,
    last_used_at: new Date().toISOString(),
  });

  // Si hay Pod ID + API Key => auto-start
  if (RUNPOD_POD_ID && RUNPOD_API_KEY) {
    const pod = await runpodGetPod(RUNPOD_POD_ID);
    const status = (pod?.status || "").toUpperCase();

    if (status !== "RUNNING") {
      await setPodState(sb, { status: "STARTING" });
      await runpodStartOrResumePod(RUNPOD_POD_ID);
      await waitUntilRunning(RUNPOD_POD_ID);
      await setPodState(sb, { status: "RUNNING", last_used_at: new Date().toISOString() });
    } else {
      await setPodState(sb, { status: "RUNNING" });
    }
  } else {
    // modo manual: asume que el pod ya está encendido
    await setPodState(sb, { status: "RUNNING" });
  }

  // espera a que el worker responda
  await waitForWorkerReady(RP_ENDPOINT, 5 * 60 * 1000);
  return RP_ENDPOINT;
}
