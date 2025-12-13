// /api/generate-video.js
// ============================================================
// IsabelaOS Studio - Video Generate API (Vercel Serverless Function)
//
// Qué hace este endpoint:
// 1) Usa un LOCK en Supabase para evitar 2 requests simultáneos que intenten
//    encender/usar el mismo pod a la vez.
// 2) Si existe RUNPOD_POD_ID + RUNPOD_API_KEY, puede:
//    - consultar el estado del pod
//    - encenderlo (START/RESUME) si está STOPPED
//    - esperar hasta que esté RUNNING
// 3) Valida RP_ENDPOINT (URL pública del worker/pod proxy).
// 4) Guarda/actualiza en Supabase el estado del pod:
//    - status, worker_url, pod_id, last_used_at
// 5) Proxy: reenvía el payload al worker (/api/video) y devuelve su respuesta.
// ============================================================

import { createClient } from "@supabase/supabase-js";

// =====================
// ENV (Vercel)
// =====================
// Supabase (SERVICE ROLE SOLO backend)
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Worker URL pública del pod (proxy), ejemplo:
// https://xxxxxx-8888.proxy.runpod.net
const RP_ENDPOINT = process.env.RP_ENDPOINT;

// Pod ID de RunPod (tu ejemplo: "jjepg9cgioqlea") para poder START/STOP
const RUNPOD_POD_ID = process.env.RUNPOD_POD_ID || null;

// API Key de RunPod (Bearer token)
const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY || null;

// =====================
// Supabase Tables (row id=1)
// =====================
const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";

// =====================
// Lock settings
// =====================
const LOCK_SECONDS = 90;

// =====================
// Start polling settings
// =====================
const READY_TIMEOUT_MS = 180000; // 3 min
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
  const { error } = await sb.from(POD_STATE_TABLE).update(patch).eq("id", 1);
  if (error) throw error;
}

// =====================
// SUPABASE LOCK
// Evita colisiones: 2 requests no deben encender/usar el pod a la vez
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

  // Si el lock sigue activo, no lo podemos tomar
  if (current && current > now) {
    return { ok: false, locked_until: row.locked_until };
  }

  // Tomar lock
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

// ============================================================
// RUNPOD REST HELPERS
// Docs: STOP endpoint confirmado:
// POST https://rest.runpod.io/v1/pods/{podId}/stop 
//
// Para START/RESUME, RunPod tiene endpoint “Start or resume a Pod” en el mismo
// API Reference. En la práctica algunos entornos usan /start y otros /resume.
// Para no romper nada, intentamos ambos.
// ============================================================

function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY in Vercel");
  return { Authorization: `Bearer ${RUNPOD_API_KEY}` };
}

async function runpodGetPod(podId) {
  // GET Find a Pod by ID (misma base REST)
  const url = `https://rest.runpod.io/v1/pods/${podId}`;
  const r = await fetch(url, { headers: runpodHeaders() });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`RunPod GET pod failed (${r.status}): ${t}`);
  }
  return await r.json();
}

async function runpodStartOrResumePod(podId) {
  // Intentamos /start y /resume (según versión del API)
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

    // Nota: RunPod retorna varios campos; lo más común es status.
    // Si tu JSON trae otro nombre (ej: desiredStatus), lo ajustamos luego.
    const status = (pod?.status || "").toUpperCase();

    if (status === "RUNNING") return pod;

    await sleep(POLL_MS);
  }

  throw new Error("Timeout: el pod no llegó a RUNNING en 3 min");
}

// =====================
// ensurePodRunning
// - Si no tienes RUNPOD_POD_ID/RUNPOD_API_KEY, se queda en modo “manual”
// - Si sí los tienes, puede ENCENDER el pod si estaba STOPPED
// =====================
async function ensurePodRunning(sb) {
  // 1) Lock global
  const got = await acquireLock(sb);
  if (!got.ok) {
    await waitForUnlock(sb);
    return await ensurePodRunning(sb);
  }

  // 2) Validación RP_ENDPOINT (necesario para proxyear)
  if (!RP_ENDPOINT) {
    await setPodState(sb, { status: "ERROR" });
    throw new Error("Falta RP_ENDPOINT en Vercel (URL pública del pod/worker)");
  }

  // 3) Guardamos estado base (observabilidad)
  await setPodState(sb, {
    worker_url: RP_ENDPOINT,
    pod_id: RUNPOD_POD_ID,
    last_used_at: new Date().toISOString(),
  });

  // 4) Si tenemos pod_id + api_key, intentamos asegurar RUNNING de verdad
  if (RUNPOD_POD_ID && RUNPOD_API_KEY) {
    const pod = await runpodGetPod(RUNPOD_POD_ID);
    const status = (pod?.status || "").toUpperCase();

    // Si está STOPPED (o no RUNNING), intentamos encender
    if (status !== "RUNNING") {
      await setPodState(sb, { status: "STARTING" });

      await runpodStartOrResumePod(RUNPOD_POD_ID);
      await waitUntilRunning(RUNPOD_POD_ID);

      await setPodState(sb, {
        status: "RUNNING",
        last_used_at: new Date().toISOString(),
      });
    } else {
      await setPodState(sb, { status: "RUNNING" });
    }
  } else {
    // Modo manual: asumimos que el pod ya está encendido si RP_ENDPOINT responde
    await setPodState(sb, { status: "RUNNING" });
  }

  return RP_ENDPOINT;
}

// =====================
// API ROUTE
// =====================
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    const sb = sbAdmin();

    // 1) Asegura pod RUNNING (real si hay pod_id + api_key)
    const workerBase = await ensurePodRunning(sb);

    // 2) Proxy al worker
    const url = workerBase.endsWith("/")
      ? `${workerBase}api/video`
      : `${workerBase}/api/video`;

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });

    const data = await r.json().catch(() => ({}));

    // 3) last_used_at para autosleep
    await setPodState(sb, { last_used_at: new Date().toISOString() });

    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
