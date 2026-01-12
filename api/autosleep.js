// /api/autosleep.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY = process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY || null;

// ✅ default 5 min
const AUTOSLEEP_IDLE_MINUTES = parseInt(process.env.AUTOSLEEP_IDLE_MINUTES || "5", 10);

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

async function runpodStopPod(podId) {
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}/stop`, {
    method: "POST",
    headers: runpodHeaders(),
  });
  const t = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`RunPod stop failed (${r.status}): ${t}`);
  return true;
}

// Mini-lock: intenta tomar lock por X segundos (sin pisar un lock activo)
async function tryAcquireLock(sb, seconds = 120) {
  const now = new Date();
  const until = new Date(now.getTime() + seconds * 1000).toISOString();

  const { data: lockRow, error: lerr } = await sb.from(POD_LOCK_TABLE).select("*").eq("id", 1).single();
  if (lerr) throw lerr;

  const lockedUntil = lockRow?.locked_until ? new Date(lockRow.locked_until) : null;
  if (lockedUntil && lockedUntil > now) return { ok: false, reason: "lock active", locked_until: lockRow.locked_until };

  const { error: uerr } = await sb.from(POD_LOCK_TABLE).update({ locked_until: until }).eq("id", 1);
  if (uerr) throw uerr;

  return { ok: true, locked_until: until };
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

    const podId = podState?.pod_id || null;
    const lastUsedAt = podState?.last_used_at ? new Date(podState.last_used_at) : null;

    // ✅ TU ESQUEMA: busy boolean manda
    const busy = Boolean(podState?.busy);

    // 2) si está busy, no dormir
    if (busy) {
      return res.status(200).json({ ok: true, action: "SKIP", reason: "pod_state.busy=true" });
    }

    // 3) si hay jobs activos, no dormir
    const { data: activeJobs, error: ajErr } = await sb
      .from(VIDEO_JOBS_TABLE)
      .select("id,status,updated_at")
      .in("status", ["QUEUED", "DISPATCHED", "IN_PROGRESS", "PENDING", "RUNNING"])
      .limit(1);
    if (ajErr) throw ajErr;

    if (activeJobs && activeJobs.length > 0) {
      return res.status(200).json({ ok: true, action: "SKIP", reason: "active video job exists", sample: activeJobs[0] });
    }

    // 4) si no hay podId, nada que hacer
    if (!podId) {
      return res.status(200).json({ ok: true, action: "SKIP", reason: "no pod_id in pod_state" });
    }

    // 5) idle check
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

    // 6) toma mini-lock
    const lock = await tryAcquireLock(sb, 120);
    if (!lock.ok) {
      return res.status(200).json({ ok: true, action: "SKIP", reason: lock.reason, locked_until: lock.locked_until });
    }

    // 7) STOP pod (PAUSA)
    await runpodStopPod(podId);

    // 8) actualizar pod_state
    await sb.from(POD_STATE_TABLE).update({
      status: "SLEEPING",
      busy: false,
      last_used_at: now.toISOString(),
    }).eq("id", 1);

    return res.status(200).json({ ok: true, action: "STOPPED", podId });

  } catch (e) {
    const msg = String(e?.message || e);
    return res.status(500).json({ ok: false, error: msg });
  }
}