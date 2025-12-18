// /api/autosleep.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY = process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY || null;

// ✅ más tiempo (default 60 min)
const AUTOSLEEP_IDLE_MINUTES = parseInt(process.env.AUTOSLEEP_IDLE_MINUTES || "60", 10);

// Tablas
const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";
const VIDEO_JOBS_TABLE = "video_jobs";

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY");
  return {
    Authorization: `Bearer ${RUNPOD_API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function runpodTerminatePod(podId) {
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, {
    method: "DELETE",
    headers: runpodHeaders(),
  });
  const t = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`RunPod terminate failed (${r.status}): ${t}`);
  return true;
}

export default async function handler(req, res) {
  try {
    const sb = sbAdmin();

    // 1) leer pod_state
    const { data: podState, error: psErr } = await sb
      .from(POD_STATE_TABLE)
      .select("*")
      .eq("id", 1)
      .single();

    if (psErr) throw psErr;

    const status = String(podState?.status || "").toUpperCase();
    const podId = podState?.pod_id || null;
    const lastUsedAt = podState?.last_used_at ? new Date(podState.last_used_at) : null;

    // 2) si está BUSY/RUNNING, no dormir
    if (status === "BUSY" || status === "RUNNING" || status === "STARTING" || status === "CREATING") {
      return res.status(200).json({ ok: true, action: "SKIP", reason: `pod_state.status=${status}` });
    }

    // 3) si el lock está activo, no dormir
    const { data: lockRow } = await sb.from(POD_LOCK_TABLE).select("*").eq("id", 1).single();
    const lockedUntil = lockRow?.locked_until ? new Date(lockRow.locked_until) : null;
    if (lockedUntil && lockedUntil > new Date()) {
      return res.status(200).json({ ok: true, action: "SKIP", reason: "lock active", locked_until: lockRow.locked_until });
    }

    // 4) si hay jobs activos, no dormir
    const { data: activeJobs, error: ajErr } = await sb
      .from(VIDEO_JOBS_TABLE)
      .select("job_id,status,updated_at")
      .in("status", ["QUEUED", "DISPATCHED", "IN_PROGRESS"])
      .limit(1);

    if (ajErr) throw ajErr;

    if (activeJobs && activeJobs.length > 0) {
      return res.status(200).json({ ok: true, action: "SKIP", reason: "active video job exists", sample: activeJobs[0] });
    }

    // 5) si no hay podId, nada que hacer
    if (!podId) {
      return res.status(200).json({ ok: true, action: "SKIP", reason: "no pod_id in pod_state" });
    }

    // 6) idle check
    const now = new Date();
    const idleMs = lastUsedAt ? (now - lastUsedAt) : Number.POSITIVE_INFINITY;
    const idleMin = idleMs / 60000;

    if (idleMin < AUTOSLEEP_IDLE_MINUTES) {
      return res.status(200).json({
        ok: true,
        action: "SKIP",
        reason: "not idle enough",
        idle_minutes: idleMin,
        threshold_minutes: AUTOSLEEP_IDLE_MINUTES,
      });
    }

    // 7) terminar pod
    await runpodTerminatePod(podId);

    // 8) actualizar pod_state
    await sb.from(POD_STATE_TABLE).update({
      status: "SLEEPING",
      last_used_at: now.toISOString(),
    }).eq("id", 1);

    return res.status(200).json({ ok: true, action: "TERMINATED", podId });

  } catch (e) {
    const msg = String(e?.message || e);
    return res.status(500).json({ ok: false, error: msg });
  }
}
