// ============================================================
// /api/video-status.js
// IsabelaOS Studio
// Endpoint para consultar el estado REAL de un video async
// - Ahora consulta RunPod Serverless (status)
// - Si RunPod ya terminó, sube MP4 a Supabase Storage y actualiza video_jobs
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const VIDEO_JOBS_TABLE = process.env.VIDEO_JOBS_TABLE || "video_jobs";

// ✅ Bucket donde guardas videos (ajusta si el tuyo se llama distinto)
const VIDEO_BUCKET = process.env.VIDEO_BUCKET || "videos";

// ✅ RunPod Serverless
const RUNPOD_API_KEY =
  process.env.RUNPOD_SLS_API_KEY ||
  process.env.VIDEO_RUNPOD_API_KEY ||
  process.env.RUNPOD_API_KEY ||
  null;

// Si tienes endpoint distinto para T2V/I2V, puedes mapear por mode.
// Si usas uno solo, con este basta.
const RUNPOD_WAN22_ENDPOINT_ID =
  process.env.RUNPOD_WAN22_T2V_ENDPOINT_ID ||
  process.env.RUNPOD_WAN22_I2V_ENDPOINT_ID ||
  null;

// Estados que indican que el job sigue en cola
const QUEUE_STATUSES = ["PENDING", "IN_QUEUE", "QUEUED", "DISPATCHED", "IN_PROGRESS"];
const ACTIVE_STATUSES = [...QUEUE_STATUSES, "RUNNING"];

// ------------------------------------------------------------
// Cliente admin de Supabase (sin sesión persistente)
// ------------------------------------------------------------
function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function normStatus(s) {
  return String(s || "PENDING").toUpperCase();
}

function shape(job) {
  const status = normStatus(job.status);

  let queue_position = job.queue_position ?? null;
  let eta_seconds = job.eta_seconds ?? null;

  if (status === "RUNNING") queue_position = 0;

  return {
    ok: true,
    id: job.id ?? null,
    job_id: job.job_id ?? null,
    status,
    progress: Math.max(0, Math.min(100, Number(job.progress || 0))),
    queue_position,
    eta_seconds,
    video_url: job.video_url || null,
    error: job.error || null,
    created_at: job.created_at,
    updated_at: job.updated_at,
    mode: job.mode || job.payload?.mode || null,
    provider: job.provider || null,
    provider_request_id: job.provider_request_id || null,
  };
}

// ------------------------------------------------------------
// RunPod: GET status/{requestId}
// ------------------------------------------------------------
async function runpodGetStatus({ endpointId, apiKey, requestId }) {
  if (!endpointId) throw new Error("Missing RunPod endpointId");
  if (!apiKey) throw new Error("Missing RunPod apiKey");
  if (!requestId) throw new Error("Missing RunPod requestId");

  const url = `https://api.runpod.ai/v2/${endpointId}/status/${requestId}`;
  const r = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  const txt = await r.text();
  let data = null;
  try {
    data = JSON.parse(txt);
  } catch {
    data = { raw: txt };
  }

  if (!r.ok) {
    throw new Error(`RunPod status HTTP ${r.status}: ${txt?.slice(0, 300)}`);
  }
  return data;
}

// ------------------------------------------------------------
// Guarda MP4 (base64) en Supabase Storage y retorna public URL
// ------------------------------------------------------------
async function saveVideoToStorage({ sb, userId, jobId, videoB64 }) {
  if (!videoB64) throw new Error("Missing video_b64");

  // Buffer MP4
  const buf = Buffer.from(String(videoB64), "base64");

  // path estable (puedes cambiar)
  const filename = `${jobId || "job"}-${Date.now()}.mp4`;
  const path = `${userId}/${filename}`;

  const { error: upErr } = await sb.storage
    .from(VIDEO_BUCKET)
    .upload(path, buf, {
      contentType: "video/mp4",
      upsert: true,
    });

  if (upErr) throw upErr;

  // Public URL (si tu bucket es privado, aquí cambia a signed URL)
  const { data } = sb.storage.from(VIDEO_BUCKET).getPublicUrl(path);

  return data?.publicUrl || null;
}

// ------------------------------------------------------------
// Si el job está activo y tiene provider_request_id,
// consulta RunPod y si está listo, actualiza DB.
// ------------------------------------------------------------
async function maybeSyncFromRunPod({ sb, userId, job }) {
  const status = normStatus(job.status);

  // Si ya está listo o ya tiene URL, no hacemos nada
  if (status === "COMPLETED" || status === "FAILED" || job.video_url) return job;

  // Debe tener request id del proveedor
  const requestId = job.provider_request_id;
  if (!requestId) return job;

  // Necesitamos credenciales RunPod
  if (!RUNPOD_API_KEY || !RUNPOD_WAN22_ENDPOINT_ID) return job;

  // Preguntar a RunPod
  const rp = await runpodGetStatus({
    endpointId: RUNPOD_WAN22_ENDPOINT_ID,
    apiKey: RUNPOD_API_KEY,
    requestId,
  });

  // Formatos típicos:
  // rp.status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED"
  const rpStatus = normStatus(rp?.status);

  // Guardar raw (opcional, pero útil)
  const providerRaw = rp;

  // Si sigue corriendo: actualizar status/progress si quieres (simple)
  if (ACTIVE_STATUSES.includes(rpStatus)) {
    const patch = {
      status: rpStatus, // opcional: refleja el real
      provider_status: rpStatus,
      provider_raw: providerRaw,
      updated_at: new Date().toISOString(),
    };

    await sb.from(VIDEO_JOBS_TABLE).update(patch).eq("id", job.id);
    return { ...job, ...patch };
  }

  // Si falló:
  if (rpStatus === "FAILED") {
    const errMsg =
      rp?.error ||
      rp?.output?.error ||
      rp?.output?.message ||
      rp?.message ||
      "RunPod FAILED";

    const patch = {
      status: "FAILED",
      provider_status: rpStatus,
      provider_raw: providerRaw,
      error: String(errMsg).slice(0, 900),
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    };

    await sb.from(VIDEO_JOBS_TABLE).update(patch).eq("id", job.id);
    return { ...job, ...patch };
  }

  // Si completó: buscar video_b64
  if (rpStatus === "COMPLETED") {
    const videoB64 =
      rp?.output?.video_b64 ||
      rp?.output?.video ||
      rp?.output?.mp4_b64 ||
      null;

    if (!videoB64) {
      // Completó pero no trajo output esperado → marca error claro
      const patch = {
        status: "FAILED",
        provider_status: rpStatus,
        provider_raw: providerRaw,
        error: "COMPLETED_BUT_NO_VIDEO_B64",
        updated_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      };
      await sb.from(VIDEO_JOBS_TABLE).update(patch).eq("id", job.id);
      return { ...job, ...patch };
    }

    // Subir a Storage
    const url = await saveVideoToStorage({
      sb,
      userId,
      jobId: job.job_id || job.id,
      videoB64,
    });

    const patch = {
      status: "COMPLETED",
      provider_status: rpStatus,
      provider_raw: providerRaw,
      video_url: url,
      progress: 100,
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      error: null,
    };

    await sb.from(VIDEO_JOBS_TABLE).update(patch).eq("id", job.id);
    return { ...job, ...patch };
  }

  // Cualquier otro caso raro: no tocar
  return job;
}

// ============================================================
// HANDLER PRINCIPAL
// ============================================================
export default async function handler(req, res) {
  try {
    // 1) Verificar usuario autenticado
    const auth = await requireUser(req);
    if (!auth.ok) {
      return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    }

    const user_id = auth.user.id;
    const sb = sbAdmin();

    const jobId = String(req.query?.job_id || req.query?.jobId || req.query?.id || "").trim();
    const mode = String(req.query?.mode || "").trim() || null;

    // --------------------------------------------------------
    // CASO A: NO viene job_id → devolver job activo más reciente
    // --------------------------------------------------------
    if (!jobId) {
      let q = sb
        .from(VIDEO_JOBS_TABLE)
        .select("*")
        .eq("user_id", user_id)
        .in("status", ACTIVE_STATUSES)
        .order("created_at", { ascending: false })
        .limit(1);

      if (mode) q = q.eq("mode", mode);

      const { data, error } = await q;
      if (error) throw error;

      let job = data?.[0];

      if (!job) {
        return res.status(200).json({
          ok: true,
          status: "IDLE",
          progress: 0,
          queue_position: null,
          eta_seconds: null,
          video_url: null,
          error: null,
        });
      }

      // ✅ NEW: sincronizar con RunPod si aplica
      job = await maybeSyncFromRunPod({ sb, userId: user_id, job });

      return res.status(200).json(shape(job));
    }

    // --------------------------------------------------------
    // CASO B: viene job_id → buscar ese job
    // --------------------------------------------------------
    const { data: job0, error } = await sb
      .from(VIDEO_JOBS_TABLE)
      .select("*")
      .eq("job_id", jobId)
      .eq("user_id", user_id)
      .maybeSingle();

    if (error) throw error;
    if (!job0) {
      return res.status(404).json({ ok: false, error: "Job not found" });
    }

    let job = job0;

    // Fallback: calcular posición en cola si no existe
    if (job.queue_position == null && QUEUE_STATUSES.includes(normStatus(job.status))) {
      const { count } = await sb
        .from(VIDEO_JOBS_TABLE)
        .select("id", { count: "exact", head: true })
        .in("status", QUEUE_STATUSES)
        .lt("created_at", job.created_at);

      if (typeof count === "number") {
        job.queue_position = count + 1;
      }
    }

    // ✅ NEW: sincronizar con RunPod si aplica
    job = await maybeSyncFromRunPod({ sb, userId: user_id, job });

    return res.status(200).json(shape(job));
  } catch (e) {
    console.error("[video-status]", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
