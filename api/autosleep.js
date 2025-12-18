// /api/autosleep.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// usa el key de video si existe
const RUNPOD_API_KEY = process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY;

const POD_STATE_TABLE = "pod_state";

// 3 minutos por defecto
const IDLE_MINUTES = Number(process.env.POD_IDLE_MINUTES || 3);

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL (o VITE_SUPABASE_URL)");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY / VIDEO_RUNPOD_API_KEY");
  return {
    Authorization: `Bearer ${RUNPOD_API_KEY}`,
    "Content-Type": "application/json",
  };
}

function isBusyStatus(statusRaw) {
  const s = String(statusRaw || "").toUpperCase();
  return s === "CREATING" || s === "STARTING" || s === "BUSY" || s === "TERMINATING";
}

async function runpodTerminatePod(podId) {
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, {
    method: "DELETE",
    headers: runpodHeaders(),
  });
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

    if (!state?.pod_id) {
      return res.json({ ok: true, action: "noop", reason: "pod_state.pod_id vacío" });
    }

    if (!state.last_used_at) {
      return res.json({ ok: true, action: "noop", reason: "no last_used_at" });
    }

    const last = new Date(state.last_used_at);
    const now = new Date();
    const idleMinutes = (now.getTime() - last.getTime()) / 60000;

    if (idleMinutes < IDLE_MINUTES) {
      return res.json({ ok: true, action: "noop", idleMinutes });
    }

    // NO matar si está trabajando
    if (isBusyStatus(state.status)) {
      return res.json({
        ok: true,
        action: "noop",
        reason: `busy_by_state:${state.status}`,
        idleMinutes,
      });
    }

    // Terminar pod por inactividad
    await sb.from(POD_STATE_TABLE).update({ status: "TERMINATING" }).eq("id", 1);

    await runpodTerminatePod(state.pod_id);

    await sb
      .from(POD_STATE_TABLE)
      .update({
        status: "TERMINATED",
        pod_id: null,
        worker_url: null,
        last_used_at: new Date().toISOString(),
      })
      .eq("id", 1);

    return res.json({ ok: true, action: "terminated", idleMinutes });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
