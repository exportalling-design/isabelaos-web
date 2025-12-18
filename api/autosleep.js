// /api/autosleep.js
// ============================================================
// IsabelaOS Studio - AutoSleep (Vercel Cron)
//
// Qué hace:
// 1) Lee pod_state.last_used_at y pod_state.busy en Supabase
// 2) Si el pod lleva X minutos sin uso y NO está busy:
//    - TERMINATE del pod (para no cobrar)
//    - Actualiza pod_state.status = "TERMINATED", pod_id=null, worker_url=null
//
// Requisitos:
// - Env Vars en Vercel: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// - Env Vars en Vercel: RUNPOD_API_KEY
// - En Supabase: tabla pod_state con row id=1 y campo pod_id
// - pod_state.busy (boolean) recomendado
// ============================================================

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;

// Minutos sin uso antes de TERMINATE (tu pedido: 3)
const IDLE_MINUTES = Number(process.env.POD_IDLE_MINUTES || 3);

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

async function runpodTerminatePod(podId) {
  const url = `https://rest.runpod.io/v1/pods/${podId}`;
  const r = await fetch(url, { method: "DELETE", headers: runpodHeaders() });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`RunPod TERMINATE failed (${r.status}): ${t}`);
  }
  return true;
}

export default async function handler(req, res) {
  try {
    const sb = sbAdmin();

    const { data: state, error } = await sb
      .from(POD_STATE_TABLE)
      .select("*")
      .eq("id", 1)
      .single();

    if (error) throw error;

    // Si no hay pod_id no hay nada que matar
    if (!state?.pod_id) {
      return res.json({ ok: true, action: "noop", reason: "pod_state.pod_id vacío" });
    }

    // Si está busy, NO TERMINAR
    if (state?.busy === true) {
      return res.json({ ok: true, action: "noop", reason: "busy=true (pod trabajando)" });
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

    // TERMINATE por inactividad
    await runpodTerminatePod(state.pod_id);

    // Limpia estado
    await sb
      .from(POD_STATE_TABLE)
      .update({
        status: "TERMINATED",
        pod_id: null,
        worker_url: null,
        busy: false,
      })
      .eq("id", 1);

    return res.json({ ok: true, action: "terminated", idleMinutes });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
