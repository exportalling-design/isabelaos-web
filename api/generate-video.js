// /api/generate-video.js
// ============================================================
// IsabelaOS Studio — API de Generación de Video (COLA + WAKE)
// ============================================================
// Diseñado para 50+ usuarios sin timeouts en Vercel:
//
// 1) SIEMPRE encola un job en Supabase (status=PENDING) y responde inmediato.
// 2) Luego intenta "WAKE" del pod (rápido):
//    - Si pod_state.pod_id existe: intenta START.
//    - Si el pod murió / no existe / perdió GPU: crea NUEVO pod desde TEMPLATE
//      con Network Volume + puertos 8000/8888, guarda pod_state.pod_id,
//      y TERMINA el pod viejo.
// 3) NO espera render, NO espera /health (eso lo hace el worker dentro del pod).
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

// ---------------------
// ENV
// ---------------------
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY =
  process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY || null;

const VIDEO_RUNPOD_TEMPLATE_ID = process.env.VIDEO_RUNPOD_TEMPLATE_ID || null;
const VIDEO_RUNPOD_NETWORK_VOLUME_ID = process.env.VIDEO_RUNPOD_NETWORK_VOLUME_ID || null;
const VIDEO_VOLUME_MOUNT_PATH = process.env.VIDEO_VOLUME_MOUNT_PATH || "/workspace";
const RUNPOD_GPU_TYPE = process.env.RUNPOD_GPU_TYPE || "A100_SXM";

// Puertos
const WORKER_PORT = parseInt(process.env.WORKER_PORT || "8000", 10);

// Tablas
const VIDEO_JOBS_TABLE = "video_jobs";
const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";

// Config
const COSTO_JADES_VIDEO = 10;

// Lock solo para WAKE/CREATE
const WAKE_LOCK_SECONDS = parseInt(process.env.WAKE_LOCK_SECONDS || "120", 10);

// ---------------------
// Helpers
// ---------------------
function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Falta SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Falta RUNPOD_API_KEY");
  return {
    Authorization: `Bearer ${RUNPOD_API_KEY}`,
    "Content-Type": "application/json",
  };
}

function nowIso() {
  return new Date().toISOString();
}

function workerBaseUrl(podId) {
  return `https://${podId}-${WORKER_PORT}.proxy.runpod.net`;
}

// ---------------------
// RunPod REST (v1)
// ---------------------
async function runpodGetPod(podId) {
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, {
    method: "GET",
    headers: runpodHeaders(),
  });
  const t = await r.text().catch(() => "");
  if (!r.ok) {
    const err = new Error(`RunPod get pod failed (${r.status}): ${t}`);
    err.status = r.status;
    throw err;
  }
  try {
    return JSON.parse(t);
  } catch {
    return { raw: t };
  }
}

async function runpodStartPod(podId) {
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}/start`, {
    method: "POST",
    headers: runpodHeaders(),
  });
  const t = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`RunPod start failed (${r.status}): ${t}`);
  return true;
}

async function runpodTerminatePod(podId) {
  // Intento 1
  {
    const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}/terminate`, {
      method: "POST",
      headers: runpodHeaders(),
    });
    if (r.ok) return true;
  }
  // Intento 2
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

async function runpodCreatePodFromTemplate({ name }) {
  if (!VIDEO_RUNPOD_TEMPLATE_ID) throw new Error("Falta VIDEO_RUNPOD_TEMPLATE_ID");
  if (!VIDEO_RUNPOD_NETWORK_VOLUME_ID) throw new Error("Falta VIDEO_RUNPOD_NETWORK_VOLUME_ID");
  if (!VIDEO_VOLUME_MOUNT_PATH) throw new Error("Falta VIDEO_VOLUME_MOUNT_PATH");
  if (!RUNPOD_GPU_TYPE) throw new Error("Falta RUNPOD_GPU_TYPE");

  const payload = {
    name,
    templateId: VIDEO_RUNPOD_TEMPLATE_ID,
    gpuTypeId: RUNPOD_GPU_TYPE,
    networkVolumeId: VIDEO_RUNPOD_NETWORK_VOLUME_ID,
    volumeMountPath: VIDEO_VOLUME_MOUNT_PATH,
    ports: [
      { containerPort: 8000, protocol: "http" },
      { containerPort: 8888, protocol: "http" },
    ],
  };

  const r = await fetch(`https://rest.runpod.io/v1/pods`, {
    method: "POST",
    headers: runpodHeaders(),
    body: JSON.stringify(payload),
  });

  const t = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`RunPod create pod failed (${r.status}): ${t}`);

  let json = null;
  try {
    json = JSON.parse(t);
  } catch {
    json = { raw: t };
  }

  const podId = json?.id || json?.podId || json?.pod?.id || json?.data?.id || null;
  if (!podId) throw new Error(`RunPod create returned no podId. Raw: ${t}`);

  return { podId, raw: json };
}

function podPareceInusable(podJson) {
  const s = String(podJson?.desiredStatus || podJson?.status || podJson?.pod?.status || "").toUpperCase();
  if (
    s.includes("TERMINAT") ||
    s.includes("EXIT") ||
    s.includes("DELET") ||
    s.includes("ERROR") ||
    s.includes("FAIL")
  ) return true;
  return false;
}

// ---------------------
// Lock WAKE/CREATE
// ---------------------
async function ensureLockRow(sb) {
  const { data } = await sb.from(POD_LOCK_TABLE).select("id").eq("id", 1).maybeSingle();
  if (!data) {
    await sb.from(POD_LOCK_TABLE).insert([{ id: 1, locked_until: new Date(0).toISOString() }]);
  }
}

async function tryAcquireWakeLock(sb, seconds, log) {
  await ensureLockRow(sb);

  const now = new Date();
  const until = new Date(now.getTime() + seconds * 1000).toISOString();
  const nowIso = now.toISOString();

  const { data, error } = await sb
    .from(POD_LOCK_TABLE)
    .update({ locked_until: until })
    .eq("id", 1)
    .or(`locked_until.is.null,locked_until.lte.${nowIso}`)
    .select("id,locked_until");

  if (error) throw error;

  if (!data || data.length === 0) {
    const { data: row } = await sb.from(POD_LOCK_TABLE).select("locked_until").eq("id", 1).single();
    return { ok: false, reason: "LOCK_ACTIVO", locked_until: row?.locked_until || null };
  }

  log("wake_lock_ok", { locked_until: until });
  return { ok: true, locked_until: until };
}

async function releaseWakeLock(sb) {
  await ensureLockRow(sb);
  const pastIso = new Date(Date.now() - 1000).toISOString();
  await sb.from(POD_LOCK_TABLE).update({ locked_until: pastIso }).eq("id", 1);
}

// ---------------------
// WAKE / RECREATE (rápido)
// ---------------------
async function wakeOrRecreatePod(sb, log) {
  const now = nowIso();

  const { data: podState, error: psErr } = await sb
    .from(POD_STATE_TABLE)
    .select("*")
    .eq("id", 1)
    .single();
  if (psErr) throw psErr;

  const currentPodId = podState?.pod_id ? String(podState.pod_id) : "";
  const busy = Boolean(podState?.busy);

  if (busy && currentPodId) {
    return { ok: true, action: "SKIP_BUSY", pod_id: currentPodId };
  }

  if (!currentPodId) {
    log("no_hay_pod => creo nuevo pod");
    const created = await runpodCreatePodFromTemplate({ name: `isabela-video-${Date.now()}` });

    await sb.from(POD_STATE_TABLE).update({
      pod_id: created.podId,
      status: "STARTING",
      busy: false,
      last_used_at: now,
    }).eq("id", 1);

    await runpodStartPod(created.podId).catch((e) => {
      log("warn_start_new_pod", String(e?.message || e));
    });

    return { ok: true, action: "CREATED", pod_id: created.podId };
  }

  try {
    const podReal = await runpodGetPod(currentPodId);
    if (podPareceInusable(podReal)) throw new Error("Pod inusable por status");

    await sb.from(POD_STATE_TABLE).update({
      status: "STARTING",
      last_used_at: now,
      pod_id: currentPodId,
    }).eq("id", 1);

    await runpodStartPod(currentPodId);
    return { ok: true, action: "STARTED_OR_RESUMED", pod_id: currentPodId };
  } catch (e) {
    log("pod_actual_fallo => recreo", String(e?.message || e));

    const oldPodId = currentPodId;
    const created = await runpodCreatePodFromTemplate({ name: `isabela-video-${Date.now()}` });

    await sb.from(POD_STATE_TABLE).update({
      pod_id: created.podId,
      status: "STARTING",
      busy: false,
      last_used_at: now,
    }).eq("id", 1);

    await runpodStartPod(created.podId).catch((err) => {
      log("warn_start_created", String(err?.message || err));
    });

    await runpodTerminatePod(oldPodId).catch((err) => {
      log("warn_terminate_old", String(err?.message || err));
    });

    return {
      ok: true,
      action: "RECREATED_AND_TERMINATED_OLD",
      pod_id: created.podId,
      old_pod_id: oldPodId,
    };
  }
}

// ============================================================
// HANDLER
// ============================================================
export default async function handler(req, res) {
  const log = (...a) => console.log("[GV]", ...a);

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Método no permitido" });
    }

    // Auth
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    const user_id = auth.user.id;

    const sb = sbAdmin();

    // 1) ENCOLAR
    const {
      mode = "t2v",
      prompt,
      negative_prompt = "",
      steps = 25,
      height = 704,
      width = 1280,
      num_frames = 121,
      fps = 24,
      guidance_scale = 5.0,
      image_base64 = null,
    } = req.body || {};

    if (!prompt) return res.status(400).json({ ok: false, error: "Falta prompt" });

    const { data: job, error: insErr } = await sb
      .from(VIDEO_JOBS_TABLE)
      .insert([{
        user_id,
        mode,
        prompt,
        negative_prompt,
        steps,
        height,
        width,
        num_frames,
        fps,
        guidance_scale,
        image_base64,
        status: "PENDING",
        created_at: nowIso(),
        updated_at: nowIso(),
      }])
      .select("*")
      .single();

    if (insErr) throw insErr;

    // 2) WAKE (con lock)
    let wake = { attempted: true, ok: false, action: "NOT_RUN" };

    try {
      const lock = await tryAcquireWakeLock(sb, WAKE_LOCK_SECONDS, log);
      if (!lock.ok) {
        wake = { attempted: true, ok: true, action: "SKIP_WAKE_LOCKED", locked_until: lock.locked_until };
      } else {
        try {
          wake = await wakeOrRecreatePod(sb, log);
          wake.attempted = true;
        } finally {
          await releaseWakeLock(sb).catch(() => {});
        }
      }
    } catch (e) {
      wake = { attempted: true, ok: false, action: "WAKE_ERROR", error: String(e?.message || e) };
    }

    // ✅ FIX AQUÍ: NO usar .catch() sobre el builder. Se hace con await + error.
    try {
      const { error: touchErr } = await sb
        .from(POD_STATE_TABLE)
        .update({ last_used_at: nowIso() })
        .eq("id", 1);

      if (touchErr) log("warn_touch_last_used_at", String(touchErr?.message || touchErr));
    } catch (e) {
      log("warn_touch_last_used_at_try", String(e?.message || e));
    }

    return res.status(200).json({
      ok: true,
      job_id: job.id,          // ✅ PK
      status: job.status,
      costo_jades: COSTO_JADES_VIDEO,
      wake,
      mensaje: "Job en cola. Pod reanudado/creado si era necesario. Revisa estado en /api/video-status?job_id=...",
    });

  } catch (e) {
    console.error("[GV] fatal:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}