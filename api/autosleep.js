import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const POD_STATE_TABLE = "pod_state";
const IDLE_MINUTES = 3;

function sbAdmin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

// ⛔ aquí también debes pegar tu runpodStopPod real
async function runpodStopPod(pod_id) {
  throw new Error("runpodStopPod() no implementado: pega tu llamada RunPod STOP aquí");
}

export default async function handler(req, res) {
  try {
    const sb = sbAdmin();

    const { data: state, error } = await sb.from(POD_STATE_TABLE).select("*").eq("id", 1).single();
    if (error) throw error;

    if (!state?.pod_id) return res.status(200).json({ ok: true, msg: "No pod_id" });
    if (state.status !== "RUNNING") return res.status(200).json({ ok: true, msg: "Pod no está RUNNING" });
    if (!state.last_used_at) return res.status(200).json({ ok: true, msg: "No last_used_at" });

    const last = new Date(state.last_used_at).getTime();
    const now = Date.now();
    const idleMs = now - last;
    const idleMin = idleMs / 60000;

    if (idleMin < IDLE_MINUTES) {
      return res.status(200).json({ ok: true, msg: `Aún activo (${idleMin.toFixed(2)} min)` });
    }

    // apagar
    await runpodStopPod(state.pod_id);

    await sb.from(POD_STATE_TABLE).update({ status: "STOPPED" }).eq("id", 1);

    return res.status(200).json({ ok: true, msg: "Pod apagado por inactividad" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
