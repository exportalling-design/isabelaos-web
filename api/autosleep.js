// /api/autosleep.js
import { createClient } from "@supabase/supabase-js";

// -------------------- ENV: Supabase --------------------
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// -------------------- ENV: RunPod --------------------
const RUNPOD_API_KEY =
  process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY || null;

// ✅ default 5 min (tu regla)
const AUTOSLEEP_IDLE_MINUTES = parseInt(process.env.AUTOSLEEP_IDLE_MINUTES || "5", 10);

// ✅ si hay job “activo” pero no se actualiza en X min → zombi
const STALE_JOB_MINUTES = parseInt(process.env.STALE_JOB_MINUTES || "15", 10);

// ✅ lock seconds (corto)
const AUTOSLEEP_LOCK_SECONDS = parseInt(process.env.AUTOSLEEP_LOCK_SECONDS || "90", 10);

// ✅ opcional: limpiar pods huérfanos
const CLEANUP_ORPHAN_PODS = (process.env.CLEANUP_ORPHAN_PODS || "0") === "1";
const ORPHAN_POD_NAME_PREFIX = process.env.ORPHAN_POD_NAME_PREFIX || "isabela-video-";

// -------------------- Tablas --------------------
const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";
const VIDEO_JOBS_TABLE = "video_jobs";

// “Activos” = si hay alguno fresco, NO dormimos.
const ACTIVE_STATUSES = ["QUEUED", "DISPATCHED", "IN_PROGRESS", "PENDING", "RUNNING"];

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY");
  return {
    Authorization: `Bearer ${RUNPOD_API_KEY}`,
    "Content-Type": "application/json",
  };
}

function minutesBetween(a, b) {
  return Math.abs(a.getTime() - b.getTime()) / 60000;
}

// -------------------- RunPod stop/list (REST) --------------------
async function runpodStopPod(podId) {
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}/stop`, {
    method: "POST",
    headers: runpodHeaders(),
  });
  const t = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`RunPod stop failed (${r.status}): ${t}`);
  return true;
}

async function runpodListPods(limit = 50) {
  const r = await fetch(`https://rest.runpod.io/v1/pods?limit=${limit}`, {
    method: "GET",
    headers: runpodHeaders(),
  });
  const t = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`RunPod list pods failed (${r.status}): ${t}`);
  try {
    return JSON.parse(t);
  } catch {
    return { raw: t };
  }
}

// -------------------- Lock (pod_lock.id=1) --------------------
async function ensureLockRow(sb) {
  const { data, error } = await sb.from(POD_LOCK_TABLE).select("id").eq("id", 1).maybeSingle();
  if (error) throw error;
  if (data) return true;

  const { error: insErr } = await sb.from(POD_LOCK_TABLE).insert([
    { id: 1, locked_until: new Date(0).toISOString() },
  ]);

  if (insErr) {
    const msg = String(insErr?.message || insErr);
    if (!msg.toLowerCase().includes("duplicate")) throw insErr;
  }
  return true;
}

async function tryAcquireLock(sb, seconds = 90) {
  await ensureLockRow(sb);

  const nowIso = new Date().toISOString();
  const untilIso = new Date(Date.now() + seconds * 1000).toISOString();

  const { data, error } = await sb
    .from(POD_LOCK_TABLE)
    .update({ locked_until: untilIso })
    .eq("id", 1)
    .lte("locked_until", nowIso)
    .select("locked_until")
    .maybeSingle();

  if (error) throw error;
  if (!data) return { ok: false, reason: "lock active" };

  return { ok: true, locked_until: data.locked_until };
}

async function releaseLock(sb) {
  const pastIso = new Date(Date.now() - 1000).toISOString();
  const { error } = await sb.from(POD_LOCK_TABLE).update({ locked_until: pastIso }).eq("id", 1);
  if (error) throw error;
}

// -------------------- Main --------------------
export default async function handler(req, res) {
  let sb = null;
  let lockAcquired = false;

  try {
    sb = sbAdmin();

    // 0) lock para que no choque con ensureWorkingPod()
    const lock = await tryAcquireLock(sb, AUTOSLEEP_LOCK_SECONDS);
    if (!lock.ok) {
      return res.status(200).json({ ok: true, action: "SKIP", reason: "lock active" });
    }
    lockAcquired = true;

    // 1) leer pod_state (fila id=1)
    const { data: podState, error: psErr } = await sb
      .from(POD_STATE_TABLE)
      .select("*")
      .eq("id", 1)
      .single();
    if (psErr) throw psErr;

    const podId = podState?.pod_id || null;
    const lastUsedAt = podState?.last_used_at ? new Date(podState.last_used_at) : null;

    const busy = Boolean(podState?.busy);
    const status = String(podState?.status || "").toUpperCase();

    // 2) si el pod está marcado busy => no dormir
    if (busy || status === "BUSY") {
      return res.status(200).json({ ok: true, action: "SKIP", reason: "pod busy" });
    }

    // 3) jobs activos recientes vs zombis
    const { data: activeJobs, error: ajErr } = await sb
      .from(VIDEO_JOBS_TABLE)
      .select("id,job_id,status,updated_at,created_at,error")
      .in("status", ACTIVE_STATUSES)
      .order("updated_at", { ascending: false })
      .limit(10);
    if (ajErr) throw ajErr;

    const now = new Date();

    const freshActive = (activeJobs || []).filter((j) => {
      const u = j?.updated_at ? new Date(j.updated_at) : null;
      // si no hay updated_at, lo tratamos como activo para no matar algo raro
      if (!u) return true;
      return minutesBetween(now, u) <= STALE_JOB_MINUTES;
    });

    const staleActive = (activeJobs || []).filter((j) => !freshActive.includes(j));

    // ✅ si hay activos frescos, no dormir
    if (freshActive.length > 0) {
      return res.status(200).json({
        ok: true,
        action: "SKIP",
        reason: "hay jobs activos (frescos)",
        stale_detected: staleActive.length,
      });
    }

    // ✅ si hay zombis, marcarlos ERROR para liberar el sistema
    let staleCleaned = 0;
    if (staleActive.length > 0) {
      const ids = staleActive.map((j) => j.id).filter(Boolean);
      if (ids.length > 0) {
        const { error: updErr } = await sb
          .from(VIDEO_JOBS_TABLE)
          .update({
            status: "ERROR",
            error: `STALE_JOB_AUTOSLEEP (${STALE_JOB_MINUTES}m)`,
            updated_at: new Date().toISOString(),
          })
          .in("id", ids);

        if (!updErr) staleCleaned = ids.length;
      }
    }

    // 4) si no hay podId, nada que hacer
    if (!podId) {
      return res.status(200).json({
        ok: true,
        action: "SKIP",
        reason: "pod_state sin pod_id",
        stale_cleaned: staleCleaned,
      });
    }

    // 5) idle check
    const idleMin = lastUsedAt ? minutesBetween(now, lastUsedAt) : Number.POSITIVE_INFINITY;

    if (idleMin < AUTOSLEEP_IDLE_MINUTES) {
      return res.status(200).json({
        ok: true,
        action: "SKIP",
        reason: "aún no está idle",
        idle_minutes: idleMin,
        threshold_minutes: AUTOSLEEP_IDLE_MINUTES,
        stale_cleaned: staleCleaned,
      });
    }

    // 6) STOP pod principal
    await runpodStopPod(podId);

    // 7) actualizar pod_state
    await sb
      .from(POD_STATE_TABLE)
      .update({
        status: "SLEEPING",
        busy: false,
        last_used_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", 1);

    // 8) cleanup huérfanos (opcional)
    let orphanStopped = [];
    if (CLEANUP_ORPHAN_PODS) {
      const list = await runpodListPods(50);
      const pods =
        list?.pods ||
        list?.data ||
        list?.items ||
        (Array.isArray(list) ? list : []);

      for (const p of pods) {
        const id = p?.id || p?.podId || p?.pod?.id;
        const name = p?.name || p?.pod?.name || "";
        if (!id || !name) continue;
        if (id === podId) continue;

        if (String(name).startsWith(ORPHAN_POD_NAME_PREFIX)) {
          try {
            await runpodStopPod(id);
            orphanStopped.push({ id, name });
          } catch (_) {}
        }
      }
    }

    return res.status(200).json({
      ok: true,
      action: "STOPPED",
      podId,
      idle_minutes: idleMin,
      stale_cleaned: staleCleaned,
      orphanStopped,
    });
  } catch (e) {
    const msg = String(e?.message || e);
    return res.status(500).json({ ok: false, error: msg });
  } finally {
    if (lockAcquired && sb) {
      try {
        await releaseLock(sb);
      } catch (_) {}
    }
  }
}