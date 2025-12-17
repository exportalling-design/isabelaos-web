// /api/generate-video.js
// ============================================================
// IsabelaOS Studio - Video Generate API (Vercel Serverless Function)
//
// Flujo:
// 1) Usa un LOCK en Supabase (pod_lock) para evitar requests simultáneos.
// 2) Asegura estado del pod y worker URL en Supabase (pod_state).
// 3) (Opcional) Si hay RUNPOD_POD_ID + RUNPOD_API_KEY, intenta START/RESUME y espera RUNNING.
// 4) Verifica que el worker responda (GET /health o 405 en /api/video).
// 5) Proxy: reenvía el POST al worker (/api/video) y devuelve su respuesta.
// ============================================================

import { createClient } from "@supabase/supabase-js";

// =====================
// ENV (Vercel)
// =====================
// Nota: SUPABASE_URL puede venir como SUPABASE_URL o como VITE_SUPABASE_URL.
// (El segundo es común si lo dejaste también para frontend; aquí solo lo reutilizamos)
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;

// Service role KEY: SOLO backend. Nunca debe estar expuesta al frontend.
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// URL público del worker (puerto 8000) tipo:
// https://xxxxxx-8000.proxy.runpod.net
const RP_ENDPOINT = process.env.RP_ENDPOINT;

// Opcionales: si quieres encender/apagar pod automático desde Vercel
const RUNPOD_POD_ID = process.env.RUNPOD_POD_ID || null;
const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY || null;

// Tablas en Supabase
const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";

// Ajustes
const LOCK_SECONDS = 180;               // tiempo de lock
const READY_TIMEOUT_MS = 10 * 60 * 1000;// timeout esperando RUNNING
const POLL_MS = 3000;                   // polling runpod status

// =====================
// Supabase Admin client
// =====================
function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL (o VITE_SUPABASE_URL)");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (backend only)");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

// helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// =====================
// Pod State update
// =====================
// Espera que exista row id=1 en pod_state
async function setPodState(sb, patch) {
  const { error } = await sb.from(POD_STATE_TABLE).update(patch).eq("id", 1);
  if (error) throw error;
}

// =====================
// Worker readiness check
// =====================
// - Si /health devuelve 200 => listo
// - Si /api/video devuelve 405 (Method Not Allowed) => listo (significa que existe pero es POST)
// - Si devuelve 401/403 => listo (existe pero está protegido)
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
        if (r.ok) return true;
        if (r.status === 405) return true;
        if (r.status === 401 || r.status === 403) return true;
      } catch (e) {
        // sigue intentando
      }
    }
    await sleep(2500);
  }

  throw new Error("Worker not ready: no respondió a /health a tiempo (revisa RP_ENDPOINT puerto 8000)");
}

// =====================
// Lock (Supabase)
// =====================
// IMPORTANTE:
// - Debe existir pod_lock con id=1
// - Este lock es "best-effort". Evita la mayoría de colisiones.
//   (Si quieres lock 100% atómico, lo hacemos con RPC/SQL; por ahora sirve.)
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

// =====================
// Ensure pod + worker ready
// =====================
async function ensurePodRunning(sb) {
  // 1) Lock global
  const got = await acquireLock(sb);
  if (!got.ok) {
    await waitForUnlock(sb);
    return await ensurePodRunning(sb);
  }

  // 2) Validar endpoint del worker
  if (!RP_ENDPOINT) {
    await setPodState(sb, { status: "ERROR" });
    throw new Error("Falta RP_ENDPOINT en Vercel (URL pública del worker en puerto 8000)");
  }

  // 3) Guardar estado base
  await setPodState(sb, {
    worker_url: RP_ENDPOINT,
    pod_id: RUNPOD_POD_ID,
    last_used_at: new Date().toISOString(),
  });

  // 4) Si tengo credenciales RunPod, intento encender
  //    Si NO, asumo que el pod ya está activo (modo manual)
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
    await setPodState(sb, { status: "RUNNING" });
  }

  // 5) Confirmar que el worker responde
  await waitForWorkerReady(RP_ENDPOINT, 5 * 60 * 1000);
  return RP_ENDPOINT;
}

// =====================
// API route (Vercel)
// =====================
export default async function handler(req, res) {
  // Solo POST
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    const sb = sbAdmin();

    // 1) Asegurar pod + worker listos
    const workerBase = await ensurePodRunning(sb);

    // 2) Proxy: reenviar el payload tal cual al worker
    const base = workerBase.endsWith("/") ? workerBase.slice(0, -1) : workerBase;
    const url = `${base}/api/video`;

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });

    // 3) Respuesta del worker
    const data = await r.json().catch(() => ({}));

    // 4) Actualizar last_used_at
    await setPodState(sb, { last_used_at: new Date().toISOString() });

    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
