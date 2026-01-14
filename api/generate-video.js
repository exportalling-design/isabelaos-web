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
//
// IMPORTANTE:
// - No rompemos el async real: el worker/runner consume la cola.
// - Evitamos abrir pods “a lo loco”: SOLO 1 pod activo guardado en pod_state.
// - Para evitar carreras (2 users generando al mismo tiempo): usamos pod_lock (id=1)
//   solo para la parte WAKE/CREATE, no para encolar.
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
const RUNPOD_GPU_TYPE = process.env.RUNPOD_GPU_TYPE || "A100_SXM"; // tu caso: A100 siempre

// Puertos que vos necesitás (8000 para worker, 8888 opcional)
const WORKER_PORT = parseInt(process.env.WORKER_PORT || "8000", 10);

// Tablas
const VIDEO_JOBS_TABLE = "video_jobs";
const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";

// Config
const COSTO_JADES_VIDEO = 10;

// Lock solo para WAKE/CREATE (no para la cola)
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
  // Proxy RunPod
  return `https://${podId}-${WORKER_PORT}.proxy.runpod.net`;
}

// ---------------------
// RunPod REST (v1) - tus scripts ya usaban rest.runpod.io
// ---------------------
async function runpodGetPod(podId) {
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, {
    method: "GET",
    headers: runpodHeaders(),
  });
  const t = await r.text().catch(() => "");
  if (!r.ok) {
    // 404 típico cuando el pod ya no existe
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

// Crear pod desde template (con volumen + puertos)
// NOTA: RunPod API puede variar. Este payload te lo dejo con tus parámetros CLAVE.
async function runpodCreatePodFromTemplate({ name }) {
  if (!VIDEO_RUNPOD_TEMPLATE_ID) throw new Error("Falta VIDEO_RUNPOD_TEMPLATE_ID");
  if (!VIDEO_RUNPOD_NETWORK_VOLUME_ID) throw new Error("Falta VIDEO_RUNPOD_NETWORK_VOLUME_ID");
  if (!VIDEO_VOLUME_MOUNT_PATH) throw new Error("Falta VIDEO_VOLUME_MOUNT_PATH");
  if (!RUNPOD_GPU_TYPE) throw new Error("Falta RUNPOD_GPU_TYPE (A100_SXM)");

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

// Heurística: detectar “pod roto / sin GPU / muerto”
function podPareceInusable(podJson) {
  const s = String(podJson?.desiredStatus || podJson?.status || podJson?.pod?.status || "").toUpperCase();
  // si está TERMINATED/EXITED/DELETED/etc => inusable
  if (s.includes("TERMINAT") || s.includes("EXIT") || s.includes("DELET") || s.includes("ERROR") || s.includes("FAIL")) return true;
  return false;
}

// ---------------------
// Lock para WAKE/CREATE (tabla pod_lock con id=1, locked_until)
// ---------------------
async function tryAcquireWakeLock(sb, seconds, log) {
  const now = new Date();
  const until = new Date(now.getTime() + seconds * 1000).toISOString();

  // Asegura que exista fila id=1 (si no existe, la crea)
  // Esto evita el “lock ocupado” fantasma por fila inexistente.
  {
    const { data } = await sb.from(POD_LOCK_TABLE).select("id").eq("id", 1).maybeSingle();
    if (!data) {
      await sb.from(POD_LOCK_TABLE).insert([{ id: 1, locked_until: new Date(0).toISOString() }]);
    }
  }

  // Intento de lock "condicional"
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
  const pastIso = new Date(Date.now() - 1000).toISOString();
  await sb.from(POD_LOCK_TABLE).update({ locked_until: pastIso }).eq("id", 1);
}

// ---------------------
// WAKE / RECREATE (rápido, sin esperar health)
// ---------------------
async function wakeOrRecreatePod(sb, log) {
  const now = nowIso();

  // leer pod_state
  const { data: podState, error: psErr } = await sb
    .from(POD_STATE_TABLE)
    .select("*")
    .eq("id", 1)
    .single();
  if (psErr) throw psErr;

  const currentPodId = podState?.pod_id ? String(podState.pod_id) : "";
  const busy = Boolean(podState?.busy);

  // Si está busy, NO hacemos nada (ya hay worker trabajando)
  if (busy && currentPodId) {
    return { ok: true, action: "SKIP_BUSY", pod_id: currentPodId };
  }

  // Si no hay pod, crear
  if (!currentPodId) {
    log("no_hay_pod_state_pod_id => creo nuevo pod");
    const created = await runpodCreatePodFromTemplate({ name: `isabela-video-${Date.now()}` });

    await sb.from(POD_STATE_TABLE).update({
      pod_id: created.podId,
      status: "STARTING",
      busy: false,
      last_used_at: now,
    }).eq("id", 1);

    // start (rápido)
    await runpodStartPod(created.podId).catch((e) => {
      log("warn_start_new_pod", String(e?.message || e));
    });

    return { ok: true, action: "CREATED", pod_id: created.podId };
  }

  // Hay pod: validar rápido
  try {
    const podReal = await runpodGetPod(currentPodId);

    if (podPareceInusable(podReal)) {
      throw new Error("Pod parece inusable (status error/terminated/etc)");
    }

    // Intentar start SIEMPRE es seguro: si ya está running no pasa nada grave.
    await sb.from(POD_STATE_TABLE).update({
      status: "STARTING",
      last_used_at: now,
      pod_id: currentPodId,
    }).eq("id", 1);

    await runpodStartPod(currentPodId);

    return { ok: true, action: "STARTED_OR_RESUMED", pod_id: currentPodId };
  } catch (e) {
    // Si el pod no existe / falló / perdió GPU: crear nuevo y terminar el viejo
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

    // Terminar viejo (best effort)
    await runpodTerminatePod(oldPodId).catch((err) => {
      log("warn_terminate_old", String(err?.message || err));
    });

    return { ok: true, action: "RECREATED_AND_TERMINATED_OLD", pod_id: created.podId, old_pod_id: oldPodId };
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

    // Auth real (tu sistema)
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    const user_id = auth.user.id;

    const sb = sbAdmin();

    // 1) ENCOLAR job (esto SIEMPRE pasa)
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

    // 2) Responder INMEDIATO (async real, sin timeout)
    //    Nota: el WAKE lo intentamos después, pero NO bloquea la respuesta si se demora.
    //    Igual te devuelvo info del wake en respuesta para debug.
    let wake = { attempted: true, ok: false, action: "NOT_RUN" };

    // 3) WAKE con lock corto (evita 10 users creando pods a la vez)
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

    // Touch last_used_at para autosleep
    await sb.from(POD_STATE_TABLE).update({ last_used_at: nowIso() }).eq("id", 1).catch(() => {});

    return res.status(200).json({
      ok: true,
      job_id: job.id,          // ✅ PK id (esto es lo que debe usar video-status)
      status: job.status,
      costo_jades: COSTO_JADES_VIDEO,
      wake,
      mensaje: "Job en cola. El pod se reanudó/creó si era necesario. Revisa estado en /api/video-status?job_id=...",
    });

  } catch (e) {
    console.error("[GV] fatal:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}