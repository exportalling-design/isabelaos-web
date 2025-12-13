// /api/autosleep.js
// ============================================================
// IsabelaOS Studio - AutoSleep
// - Corre por cron en Vercel
// - Revisa pod_state.last_used_at
// - Si pasó el umbral (ej 10 min) → STOP pod (no terminate)
// ============================================================

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// RunPod API key (ya la tienes en Vercel)
const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;

// Umbral para dormir (minutos sin uso)
const IDLE_MINUTES = Number(process.env.POD_IDLE_MINUTES || 10);

const POD_STATE_TABLE = "pod_state";

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL (o VITE_SUPABASE_URL)");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * STOP Pod (no terminate).
 * IMPORTANTE:
 * - RunPod tiene endpoints distintos según tu tipo de recurso.
 * - Aquí dejamos la función lista y solo tienes que pegar TU llamada real.
 */
async function runpodStopPod(pod_id) {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY in Vercel");

  // ✅ Pega aquí TU implementación real para detener pod por pod_id
  // (Como ya tienes RUNPOD_API_KEY, solo falta el endpoint exacto que estés usando.)
  // Por ahora, levantamos error para que NO haga nada por accidente:
  throw new Error(`runpodStopPod() no implementado. Necesito tu endpoint/forma actual de STOP para pod_id=${pod_id}`);
}

export default async function handler(req, res) {
  try {
    const sb = sbAdmin();

    const { data: state, error } = await sb.from(POD_STATE_TABLE).select("*").eq("id", 1).single();
    if (error) throw error;

    const last = state.last_used_at ? new Date(state.last_used_at) : null;
    const now = new Date();

    // Si nunca se ha usado o no hay timestamp, no apagues
    if (!last) {
      return res.json({ ok: true, action: "noop", reason: "no last_used_at" });
    }

    const idleMinutes = (now.getTime() - last.getTime()) / 60000;

    // Si no hay pod_id, todavía estás en modo manual: no hacemos stop por API
    if (!state.pod_id) {
      return res.json({
        ok: true,
        action: "noop",
        reason: "no pod_id in pod_state (modo manual)",
        idleMinutes,
      });
    }

    if (idleMinutes < IDLE_MINUTES) {
      return res.json({ ok: true, action: "noop", idleMinutes });
    }

    // Si está idle: apaga
    await runpodStopPod(state.pod_id);

    // Marca estado
    await sb.from(POD_STATE_TABLE).update({ status: "STOPPED" }).eq("id", 1);

    return res.json({ ok: true, action: "stopped", idleMinutes });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
