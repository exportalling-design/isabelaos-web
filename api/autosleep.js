// /api/autosleep.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY = process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY || null;

const VIDEO_TEMPLATE_ID =
  process.env.VIDEO_RUNPOD_TEMPLATE_ID || process.env.RUNPOD_TEMPLATE_ID || null;

// ✅ default 5 min
const AUTOSLEEP_IDLE_MINUTES = parseInt(process.env.AUTOSLEEP_IDLE_MINUTES || "5", 10);

// timeouts
const WORKER_HEALTH_TIMEOUT_MS = parseInt(process.env.WORKER_HEALTH_TIMEOUT_MS || "45000", 10);
const POD_START_TIMEOUT_MS = parseInt(process.env.POD_START_TIMEOUT_MS || "120000", 10);
const POLL_MS = parseInt(process.env.AUTOSLEEP_POLL_MS || "3000", 10);

const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";
const VIDEO_JOBS_TABLE = "video_jobs";

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY");
  return {
    Authorization: `Bearer ${RUNPOD_API_KEY}`,
    "Content-Type": "application/json",
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function workerBaseFromPodId(podId) {
  return `https://${podId}-8000.proxy.runpod.net`;
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    return r;
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------
// RunPod helpers (probamos varias rutas)
// ---------------------------------------------------------
async function runpodStopPod(podId) {
  // stop (pausa)
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}/stop`, {
    method: "POST",
    headers: runpodHeaders(),
  });
  const t = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`RunPod stop failed (${r.status}): ${t}`);
  return true;
}

async function runpodStartPod(podId) {
  // start/resume (depende del endpoint; probamos varios)
  const candidates = [
    `https://rest.runpod.io/v1/pods/${podId}/start`,
    `https://rest.runpod.io/v1/pods/${podId}/resume`,
    `https://rest.runpod.io/v1/pods/${podId}/unpause`,
  ];

  let lastErr = null;
  for (const url of candidates) {
    try {
      const r = await fetch(url, { method: "POST", headers: runpodHeaders() });
      if (r.ok) return true;
      const t = await r.text().catch(() => "");
      lastErr = new Error(`start endpoint failed ${url} (${r.status}): ${t}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("RunPod start failed (no endpoint worked)");
}

async function runpodTerminatePod(podId) {
  // Intento API v2 delete (como en tu generate-video viejo)
  try {
    const r = await fetch(`https://api.runpod.io/v2/pods/${podId}`, {
      method: "DELETE",
      headers: runpodHeaders(),
    });
    if (r.ok) return true;
  } catch {}

  // Fallback rest terminate/delete
  {
    const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}/terminate`, {
      method: "POST",
      headers: runpodHeaders(),
    });
    if (r.ok) return true;
  }
  {
    const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, {
      method: "DELETE",
      headers: runpodHeaders(),
    });
    const t = await r.text().catch(() => "");
    if (!r.ok) throw new Error(`RunPod terminate failed (${r.status}): ${t}`);
    return true;
  }
}

async function runpodCreatePodFromTemplate() {
  if (!VIDEO_TEMPLATE_ID) throw new Error("Missing VIDEO_RUNPOD_TEMPLATE_ID / RUNPOD_TEMPLATE_ID");

  const r = await fetch(`https://api.runpod.io/v2/pods`, {
    method: "POST",
    headers: runpodHeaders(),
    body: JSON.stringify({ templateId: VIDEO_TEMPLATE_ID }),
  });
  const t = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`RunPod create pod failed (${r.status}): ${t}`);

  let j = null;
  try { j = t ? JSON.parse(t) : null; } catch { j = { raw: t }; }

  const podId = j?.id || j?.podId || j?.data?.id || j?.data?.podId || null;
  if (!podId) throw new Error(`Could not parse podId from create response: ${t}`);
  return podId;
}

async function waitWorkerHealthy(podId) {
  const base = workerBaseFromPodId(podId);
  const deadline = Date.now() + WORKER_HEALTH_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const r = await fetchWithTimeout(`${base}/health`, { method: "GET" }, 8000);
      if (r.ok) return { ok: true, base };
    } catch {}
    await sleep(POLL_MS);
  }
  return { ok: false, base, error: "worker health timeout" };
}

// ---------------------------------------------------------
// Lock atómico simple (sin RPC)
// ---------------------------------------------------------
async function tryAcquireLockAtomic(sb, seconds = 120) {
  const nowIso = new Date().toISOString();
  const untilIso = new Date(Date.now() + seconds * 1000).toISOString();

  // update ... where locked_until is null OR locked_until <= now
  const { data, error } = await sb
    .from(POD_LOCK_TABLE)
    .update({ locked_until: untilIso })
    .eq("id", 1)
    .or(`locked_until.is.null,locked_until.lte.${nowIso}`)
    .select("id,locked_until");

  if (error) throw error;
  if (!data || data.length === 0) return { ok: false, reason: "lock active" };
  return { ok: true, locked_until: untilIso };
}

// ---------------------------------------------------------
// Job checks
// ---------------------------------------------------------
async function hasActiveOrPendingJobs(sb) {
  // Estados que realmente significan “hay trabajo”
  const statuses = ["PENDING", "DISPATCHED", "RUNNING", "QUEUED", "IN_PROGRESS", "CREANDO_POD", "EN_PROCESO"];

  const { data, error } = await sb
    .from(VIDEO_JOBS_TABLE)
    .select("id,status,created_at,updated_at")
    .in("status", statuses)
    .limit(1);

  if (error) throw error;
  return data && data.length > 0 ? { ok: true, exists: true, sample: data[0] } : { ok: true, exists: false };
}

// ---------------------------------------------------------
// Main
// ---------------------------------------------------------
export default async function handler(req, res) {
  const log = (...a) => console.log("[AUTOSLEEP]", ...a);

  try {
    const sb = sbAdmin();

    // mini lock para que no corran 2 autosleeps a la vez
    const lock = await tryAcquireLockAtomic(sb, 120);
    if (!lock.ok) {
      return res.status(200).json({ ok: true, action: "SKIP", reason: lock.reason });
    }

    // 1) leer pod_state
    const { data: podState, error: psErr } = await sb
      .from(POD_STATE_TABLE)
      .select("*")
      .eq("id", 1)
      .single();
    if (psErr) throw psErr;

    let podId = podState?.pod_id || null;
    const lastUsedAt = podState?.last_used_at ? new Date(podState.last_used_at) : null;
    const busy = Boolean(podState?.busy);
    const status = String(podState?.status || "");

    // 2) ¿hay jobs?
    const jobs = await hasActiveOrPendingJobs(sb);

    // -------------------------------------------------------
    // A) Si hay trabajo: asegurar pod RUNNING + worker healthy
    // -------------------------------------------------------
    if (jobs.exists) {
      log("jobs exist, ensure pod", jobs.sample);

      // Si worker está ocupado, no tocamos (evita cortar render)
      if (busy) {
        return res.status(200).json({ ok: true, action: "SKIP", reason: "pod_state.busy=true" });
      }

      // Si no hay pod, crear uno nuevo
      if (!podId) {
        log("no podId -> create new pod from template");
        const newPodId = await runpodCreatePodFromTemplate();

        await sb.from(POD_STATE_TABLE).update({
          pod_id: newPodId,
          status: "RUNNING",
          busy: false,
          last_used_at: new Date().toISOString(),
        }).eq("id", 1);

        const health = await waitWorkerHealthy(newPodId);
        if (!health.ok) {
          // si ni nuevo responde, lo terminamos para no quemar dinero
          await runpodTerminatePod(newPodId).catch(() => {});
          throw new Error("New pod created but worker health failed");
        }

        return res.status(200).json({ ok: true, action: "CREATED_POD", podId: newPodId, workerBase: health.base });
      }

      // Si hay podId: intenta health directo
      let health = await waitWorkerHealthy(podId);
      if (health.ok) {
        // todo bien: solo tocar last_used_at para evitar autosleep agresivo
        await sb.from(POD_STATE_TABLE).update({
          status: "RUNNING",
          busy: false,
          last_used_at: new Date().toISOString(),
        }).eq("id", 1);

        return res.status(200).json({ ok: true, action: "OK", podId, workerBase: health.base });
      }

      // Si health falla, intentamos start/resume (por si está pausado)
      log("health failed, try start/resume pod", { podId, status });

      try {
        await runpodStartPod(podId);
        // esperar un poco a que levante proxy/worker
        await sleep(2000);
        health = await waitWorkerHealthy(podId);
        if (health.ok) {
          await sb.from(POD_STATE_TABLE).update({
            status: "RUNNING",
            busy: false,
            last_used_at: new Date().toISOString(),
          }).eq("id", 1);

          return res.status(200).json({ ok: true, action: "RESUMED", podId, workerBase: health.base });
        }
      } catch (e) {
        log("start/resume failed", String(e?.message || e));
      }

      // Si reanudar no sirve, entonces GPU/worker/proxy están muertos → crear nuevo y terminar viejo
      log("pod unhealthy after resume -> rotate pod (create new, terminate old)", { oldPodId: podId });

      const oldPodId = podId;
      const newPodId = await runpodCreatePodFromTemplate();

      await sb.from(POD_STATE_TABLE).update({
        pod_id: newPodId,
        status: "RUNNING",
        busy: false,
        last_used_at: new Date().toISOString(),
      }).eq("id", 1);

      const newHealth = await waitWorkerHealthy(newPodId);
      if (!newHealth.ok) {
        // si el nuevo tampoco responde, terminamos ambos para no quemar dinero
        await runpodTerminatePod(newPodId).catch(() => {});
        throw new Error("Rotated pod created but worker health failed");
      }

      // terminar viejo al final
      await runpodTerminatePod(oldPodId).catch(() => {});

      return res.status(200).json({
        ok: true,
        action: "ROTATED",
        oldPodId,
        podId: newPodId,
        workerBase: newHealth.base
      });
    }

    // -------------------------------------------------------
    // B) Si NO hay trabajo: autosleep si idle y no busy
    // -------------------------------------------------------
    if (busy) {
      return res.status(200).json({ ok: true, action: "SKIP", reason: "busy=true (but no jobs found)" });
    }

    if (!podId) {
      return res.status(200).json({ ok: true, action: "SKIP", reason: "no pod_id in pod_state" });
    }

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

    // STOP pod
    await runpodStopPod(podId);

    await sb.from(POD_STATE_TABLE).update({
      status: "SLEEPING",
      busy: false,
      last_used_at: now.toISOString(),
    }).eq("id", 1);

    return res.status(200).json({ ok: true, action: "STOPPED", podId });

  } catch (e) {
    const msg = String(e?.message || e);
    console.error("[AUTOSLEEP] fatal:", msg);
    return res.status(500).json({ ok: false, error: msg });
  }
}