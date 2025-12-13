// /api/generate_video.js
// ============================================================
// IsabelaOS Studio - Video Generate API (Vercel Serverless Function)
//
// Qué hace este endpoint:
// 1) Evita colisiones (lock) para que 2 requests no “choquen” usando el mismo pod.
// 2) Valida que exista el RP_ENDPOINT (URL pública del worker/pod).
// 3) Guarda/actualiza en Supabase el estado del pod:
//    - status: RUNNING
//    - worker_url: RP_ENDPOINT
//    - pod_id: (opcional) RUNPOD_POD_ID (para poder hacer STOP por API)
//    - last_used_at: timestamp para autosleep
// 4) Proxy: reenvía el payload al worker (/api/video) y devuelve su respuesta.
// ============================================================

import { createClient } from "@supabase/supabase-js";

// =====================
// ENV (Vercel)
// =====================
// Supabase (admin/service role SOLO backend)
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// RunPod worker URL (pod proxy pública)
const RP_ENDPOINT = process.env.RP_ENDPOINT;

// IMPORTANTE:
// Para poder apagar un POD desde autosleep, necesitas conocer su pod_id.
// Este env es opcional, pero RECOMENDADO si quieres autosleep real.
const RUNPOD_POD_ID = process.env.RUNPOD_POD_ID || null;

// =====================
// Supabase Tables
// =====================
// Deben existir con un row id=1
const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";

// =====================
// Lock settings
// =====================
const LOCK_SECONDS = 90;

// =====================
// Helpers
// =====================
function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL (o VITE_SUPABASE_URL)");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (backend only)");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// =====================
// SUPABASE LOCK
// Evita que 2 usuarios a la vez actualicen estado y usen el pod en paralelo
// =====================
async function acquireLock(sb) {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + LOCK_SECONDS * 1000).toISOString();

  // Lee el lock actual
  const { data: row, error: readErr } = await sb
    .from(POD_LOCK_TABLE)
    .select("*")
    .eq("id", 1)
    .single();

  if (readErr) throw new Error("No existe pod_lock id=1 (crea row en Supabase)");

  const current = row.locked_until ? new Date(row.locked_until) : null;

  // Si el lock no ha expirado, no podemos tomarlo
  if (current && current > now) {
    return { ok: false, locked_until: row.locked_until };
  }

  // Intentamos tomar el lock
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
// POD STATE
// Guarda worker_url, status, last_used_at, pod_id
// =====================
async function setPodState(sb, patch) {
  const { error } = await sb.from(POD_STATE_TABLE).update(patch).eq("id", 1);
  if (error) throw error;
}

// =====================
// ensurePodRunning (modo “manual”)
// Por ahora NO encendemos pods por API.
// Solo validamos RP_ENDPOINT y actualizamos estado.
// =====================
async function ensurePodRunning(sb) {
  // 1) Lock anti-colisiones
  const got = await acquireLock(sb);
  if (!got.ok) {
    await waitForUnlock(sb);
    return await ensurePodRunning(sb);
  }

  // 2) Validación de worker URL
  if (!RP_ENDPOINT) {
    await setPodState(sb, { status: "ERROR" });
    throw new Error("Falta RP_ENDPOINT en Vercel (URL pública del pod/worker)");
  }

  // 3) Persistimos estado para autosleep/observabilidad
  await setPodState(sb, {
    status: "RUNNING",
    worker_url: RP_ENDPOINT,
    pod_id: RUNPOD_POD_ID, // opcional, pero clave para apagar
    last_used_at: new Date().toISOString(),
  });

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

    // 1) Marca que el pod se está usando ahora
    const workerBase = await ensurePodRunning(sb);

    // 2) Proxy hacia el worker
    // Tu worker debe exponer POST /api/video
    const url = workerBase.endsWith("/")
      ? `${workerBase}api/video`
      : `${workerBase}/api/video`;

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });

    const data = await r.json().catch(() => ({}));

    // 3) Actualiza último uso (para autosleep)
    await setPodState(sb, { last_used_at: new Date().toISOString() });

    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
