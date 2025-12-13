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
// https://xxxxxx-8000.proxy.runpod.net  <-- OJO: debe ser el PUERTO del worker, no Jupyter 8888
const RP_ENDPOINT = process.env.RP_ENDPOINT;

// Pod ID de RunPod (ej: "jjepg9cgioqlea") para poder START/STOP
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
// Importante: 3 minutos suele ser poco. Subimos a 10 min para evitar falsos timeouts.
const READY_TIMEOUT_MS = 10 * 60 * 1000; // 10 min
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

// ============================================================
// waitForWorkerReady
// - El pod puede estar RUNNING pero tu API dentro todavía NO está lista.
// - Esta función espera a que el worker responda antes de proxyear.
// - Intenta /health y si no existe, intenta /api/video como ping.
// ============================================================
async function waitForWorkerReady(workerBase, maxMs = 5 * 60 * 1000) {
  const start = Date.now();

  // Normalizamos base sin doble slash al final
  const base = workerBase.endsWith("/") ? workerBase.slice(0, -1) : workerBase;

  // Endpoints de prueba (en orden)
  const candidates = [
    `${base}/health`,      // ideal si lo implementas
    `${base}/api/health`,  // alternativa común
    `${base}/api/video`,   // ping directo (puede fallar si solo acepta POST, pero igual nos sirve para ver si está vivo)
  ];

  while (Date.now() - start < maxMs) {
    for (const url of candidates) {
      try {
        // Usamos GET; si tu /api/video solo acepta POST, puede devolver 405 y eso AUN así indica que el server está vivo.
        const r = await fetch(url, { method: "GET" });

        // Si responde 200 -> listo
        if (r.ok) return true;

        // Si responde 405 (Method Not Allowed) -> también es señal de que el worker está arriba (solo no acepta GET)
        if (r.status === 405) return true;

        // Si responde 401/403 -> también indica que está vivo, solo protegido (si fuera el caso)
        if (r.status === 401 || r.status === 403) return true;
      } catch (e) {
        // Si falla, seguimos intentando
      }
    }

    // Esperamos un poco y reintentamos
    await sleep(2500);
  }

  throw new Error("Worker not ready: no respondió a health/ping a tiempo (revisa RP_ENDPOINT y el puerto del worker)");
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
// ============================================================

function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY in Vercel");
  return { Authorization: `Bearer ${RUNPOD_API_KEY}` };
}

async function runpodGetPod(podId) {
  // GET Find a Pod by ID
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
    const status = (pod?.status || "").toUpperCase();

    if (status === "RUNNING") return pod;

    await sleep(POLL_MS);
  }

  throw new Error("Timeout: el pod no llegó a RUNNING dentro del tiempo configurado");
}

// =====================
// ensurePodRunning
// - Si no tienes RUNPOD_POD_ID/RUNPOD_API_KEY, modo “manual”
// - Si sí los tienes, puede ENCENDER el pod si estaba STOPPED
// - Luego espera a que el WORKER esté listo (no solo RUNNING)
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

  // 4) Si tenemos pod_id + api_key, aseguramos RUNNING real
  if (RUNPOD_POD_ID && RUNPOD_API_KEY) {
    const pod = await runpodGetPod(RUNPOD_POD_ID);
    const status = (pod?.status || "").toUpperCase();

    // Si no está RUNNING, encendemos
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
    // Modo manual: marcamos RUNNING (pero igual haremos health-check abajo)
    await setPodState(sb, { status: "RUNNING" });
  }

  // 5) CLAVE: esperar a que el WORKER responda (no solo pod RUNNING)
  await waitForWorkerReady(RP_ENDPOINT, 5 * 60 * 1000); // 5 min para “warm up” del servicio

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

    // 1) Asegura pod RUNNING + worker listo
    const workerBase = await ensurePodRunning(sb);

    // 2) Construye URL final del worker
    const url = workerBase.endsWith("/")
      ? `${workerBase}api/video`
      : `${workerBase}/api/video`;

    // 3) Proxy al worker (POST real para generar video)
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });

    // 4) Leemos respuesta
    const data = await r.json().catch(() => ({}));

    // 5) last_used_at para autosleep
    await setPodState(sb, { last_used_at: new Date().toISOString() });

    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
