// /api/generate_video.js
// ============================================================
// IsabelaOS Studio - Video Generate API
// - Asegura orden/lock en Supabase para evitar 2 requests a la vez
// - Verifica que el worker (RunPod Pod) esté accesible vía RP_ENDPOINT
// - Proxy: manda el payload al worker y devuelve la respuesta
// - Actualiza last_used_at en Supabase para el autosleep
// ============================================================

import { createClient } from "@supabase/supabase-js";

// =====================
// ENV (Vercel)
// =====================
// NOTA: Estas variables se configuran en:
// Vercel Project → Settings → Environment Variables
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// RunPod
// RP_ENDPOINT: URL base pública a tu worker (pod) (ej: https://xxxx.proxy.runpod.net)
const RP_ENDPOINT = process.env.RP_ENDPOINT;

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
// Evita que 2 usuarios en paralelo “choquen” al encender/usar el pod
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

  // Si el lock aún no expira, no podemos tomarlo
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
// Guarda último uso, status, y worker_url (RP_ENDPOINT)
// =====================
async function getPodState(sb) {
  const { data, error } = await sb.from(POD_STATE_TABLE).select("*").eq("id", 1).single();
  if (error) throw new Error("No existe pod_state id=1 (crea row en Supabase)");
  return data;
}

async function setPodState(sb, patch) {
  const { error } = await sb.from(POD_STATE_TABLE).update(patch).eq("id", 1);
  if (error) throw error;
}

// =====================
// ensurePodRunning (versión simple)
// Como hoy NO estamos creando pods automáticos,
// solo validamos que exista RP_ENDPOINT y lo guardamos.
// =====================
async function ensurePodRunning(sb) {
  // 1) Lock global (anti-colisiones)
  const got = await acquireLock(sb);
  if (!got.ok) {
    await waitForUnlock(sb);
    return await ensurePodRunning(sb);
  }

  // 2) Si tienes RP_ENDPOINT en Vercel, es tu fuente de verdad
  if (!RP_ENDPOINT) {
    await setPodState(sb, { status: "ERROR" });
    throw new Error("Falta RP_ENDPOINT en Vercel (URL pública del pod/worker)");
  }

  // 3) Guardamos estado y último uso
  await setPodState(sb, {
    status: "RUNNING",
    worker_url: RP_ENDPOINT,
    last_used_at: new Date().toISOString(),
  });

  return RP_ENDPOINT;
}

// =====================
// API ROUTE
// =====================
export default async function handler(req, res) {
  // Solo POST
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    const sb = sbAdmin();

    // 1) Asegura worker URL (RunPod pod) y marca last_used_at
    const workerBase = await ensurePodRunning(sb);

    // 2) Construye URL al endpoint del worker
    // En tu pod debes tener un server que atienda /api/video
    const url = workerBase.endsWith("/")
      ? `${workerBase}api/video`
      : `${workerBase}/api/video`;

    // 3) Proxy request → RunPod worker
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });

    const data = await r.json().catch(() => ({}));

    // 4) Actualiza last_used_at
    await setPodState(sb, { last_used_at: new Date().toISOString() });

    // Devuelve el status real del worker
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
