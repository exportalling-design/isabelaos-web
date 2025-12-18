// /api/autosleep.js
// ============================================================
// IsabelaOS Studio - AutoSleep (Vercel Cron)
//
// Qué hace:
// 1) Lee pod_state.last_used_at en Supabase
// 2) Si el pod lleva X minutos sin uso:
//    - Hace STOP del pod (NO terminate, para no borrar)
//    - Actualiza pod_state.status = "STOPPED"
//
// Requisitos:
// - Env Vars en Vercel: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// - Env Vars en Vercel: RUNPOD_API_KEY
// - En Supabase: tabla pod_state con row id=1 y campo pod_id
// - En Supabase: pod_state.pod_id debe tener el ID real (ej jjepg9cgioqlea)
// ============================================================

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;

// Minutos sin uso antes de dormir
const IDLE_MINUTES = Number(process.env.POD_IDLE_MINUTES || 10);

const POD_STATE_TABLE = "pod_state";

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL (o VITE_SUPABASE_URL)");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY in Vercel");
  return { Authorization: `Bearer ${RUNPOD_API_KEY}` };
}

async function runpodStopPod(podId) {
  // STOP (no terminate)
  // Doc: POST https://rest.runpod.io/v1/pods/{podId}/stop 
  const url = `https://rest.runpod.io/v1/pods/${podId}/stop`;

  const r = await fetch(url, { method: "POST", headers: runpodHeaders() });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`RunPod STOP failed (${r.status}): ${t}`);
  }

  return true;
}

export default async function handler(req, res) {
  try {
    const sb = sbAdmin();

    const { data: state, error } = await sb.from(POD_STATE_TABLE).select("*").eq("id", 1).single();
    if (error) throw error;

    // Si no hay pod_id, no podemos apagar por API
    if (!state?.pod_id) {
      return res.json({ ok: true, action: "noop", reason: "pod_state.pod_id vacío" });
    }

    // Si nunca se usó, no apagues
    if (!state.last_used_at) {
      return res.json({ ok: true, action: "noop", reason: "no last_used_at" });
    }

    const last = new Date(state.last_used_at);
    const now = new Date();
    const idleMinutes = (now.getTime() - last.getTime()) / 60000;

    if (idleMinutes < IDLE_MINUTES) {
      return res.json({ ok: true, action: "noop", idleMinutes });
    }

    // Apaga por inactividad
    await runpodStopPod(state.pod_id);

    // Marca estado STOPPED
    await sb.from(POD_STATE_TABLE).update({ status: "STOPPED" }).eq("id", 1);

    return res.json({ ok: true, action: "stopped", idleMinutes });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
