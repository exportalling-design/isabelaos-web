// /api/generate-video.js
// ============================================================
// IsabelaOS Studio - Video Generate API (Vercel Serverless Function)
//
// MODO B (correcto para pods efímeros TERMINATE):
// - NO usa VIDEO_RP_ENDPOINT fijo.
// - Usa RunPod SERVERLESS ENDPOINT (RUNPOD_ENDPOINT_ID) => URL estable.
// - RunPod se encarga de crear/usar pods por detrás.
// - Tú solo haces proxy a RunPod.
// ============================================================

import { createClient } from "@supabase/supabase-js";

// =====================
// ENV (Vercel)
// =====================
// Admin (backend) para lock/state en Supabase
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// RunPod (Serverless)
const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY || process.env.RP_API_KEY || null;
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID || null;

// Tablas en Supabase
const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";

// Timing
const LOCK_SECONDS = 180;

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
    await sleep(1200);
  }
}

// =====================
// RunPod Serverless call
// =====================
function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY in Vercel");
  return {
    Authorization: `Bearer ${RUNPOD_API_KEY}`,
    "Content-Type": "application/json",
  };
}

// NOTA:
// En RunPod serverless, normalmente el endpoint es:
// POST https://api.runpod.ai/v2/{ENDPOINT_ID}/run
// (Dependiendo de tu configuración puede variar, pero este es el patrón típico.)
async function runServerless(payload) {
  if (!RUNPOD_ENDPOINT_ID) throw new Error("Missing RUNPOD_ENDPOINT_ID in Vercel");

  const url = `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/run`;
  const r = await fetch(url, {
    method: "POST",
    headers: runpodHeaders(),
    body: JSON.stringify({ input: payload }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`RunPod serverless /run failed (${r.status}): ${JSON.stringify(data)}`);
  }
  return data;
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

    // Lock global
    const got = await acquireLock(sb);
    if (!got.ok) {
      await waitForUnlock(sb);
      // reintenta una vez
      return handler(req, res);
    }

    // Marcar estado
    await setPodState(sb, {
      status: "QUEUED",
      last_used_at: new Date().toISOString(),
      // En serverless no hay pod_id fijo ni worker_url fijo
      pod_id: null,
      worker_url: null,
    });

    // Llamar a RunPod serverless
    await setPodState(sb, { status: "RUNNING" });

    const rp = await runServerless(req.body);

    await setPodState(sb, { last_used_at: new Date().toISOString(), status: "DONE" });

    // rp normalmente trae { id, status, ... } y luego haces poll /status si tu worker es async.
    return res.status(200).json({ ok: true, runpod: rp });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
