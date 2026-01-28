// ============================================================
// /api/video-status.js
// IsabelaOS Studio
// Endpoint para consultar estado REAL de un video async
//
// FIXES:
// ✅ Si hay provider_request_id => consulta RunPod status real
// ✅ Si COMPLETED con output.video_b64 => sube a Supabase Storage y guarda video_url
// ✅ Si FAILED => status=ERROR + error real
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY =
  process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY || null;

const VIDEO_RUNPOD_ENDPOINT_ID = process.env.VIDEO_RUNPOD_ENDPOINT_ID || null;

const VIDEO_JOBS_TABLE = process.env.VIDEO_JOBS_TABLE || "video_jobs";
const VIDEO_BUCKET = process.env.VIDEO_BUCKET || "videos";

const QUEUE_STATUSES = ["PENDING", "IN_QUEUE", "QUEUED", "DISPATCHED", "IN_PROGRESS"];
const ACTIVE_STATUSES = [...QUEUE_STATUSES, "RUNNING"];

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
    provider_request_id: job.provider_request_id || null,
  };
}

function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Falta RUNPOD_API_KEY");
  return {
    Authorization: `Bearer ${RUNPOD_API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function runpodGetStatus({ endpointId, requestId }) {
  if (!endpointId) throw new Error("Falta VIDEO_RUNPOD_ENDPOINT_ID");
  if (!requestId) throw new Error("Falta requestId");

  const url = `https://api.runpod.ai/v2/${endpointId}/status/${requestId}`;

  const r = await fetch(url, { method: "GET", headers: runpodHeaders() });

  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch {}

  if (!r.ok) {
    throw new Error(`RunPod /status ${r.status}: ${j?.error || text || "sin detalle"}`);
  }
  return j || {};
}

function b64ToBytes(b64) {
  // limpia dataurl si viniera
  let s = String(b64 || "").trim();
  if (s.startsWith("data:") && s.includes(",")) s = s.split(",", 2)[1];
  return Buffer.from(s, "base64");
}

async function uploadMp4ToStorage(sb, { user_id, job_id, video_b64 }) {
  const bytes = b64ToBytes(video_b64);
  if (!bytes?.length) throw new Error("video_b64 vacío (no bytes)");

  const path = `users/${user_id}/videos/${job_id}.mp4`;

  const { error: upErr } = await sb.storage
    .from(VIDEO_BUCKET)
    .upload(path, bytes, {
      contentType: "video/mp4",
      upsert: true,
    });

  if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

  // URL pública (si tu bucket es public). Si es private, cambia a signed URL en el front.
  const { data } = sb.storage.from(VIDEO_BUCKET).getPublicUrl(path);
  const publicUrl = data?.publicUrl || null;
  if (!publicUrl) throw new Error("No pude obtener publicUrl del video");

  return { path, publicUrl };
}

export default async function handler(req, res) {
  try {
    // 1) Auth user
    const auth = await requireUser(req);
    if (!auth.ok) {
      return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    }

    const user_id = auth.user.id;
    const sb = sbAdmin();

    // job_id opcional
    const jobId = String(req.query?.job_id || req.query?.jobId || req.query?.id || "").trim();
    const mode = String(req.query?.mode || "").trim() || null;

    // ----------------------------------------
    // CASO A: sin job_id => job activo más reciente
    // ----------------------------------------
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

      const job = data?.[0];
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

      // ✅ Sync con RunPod si hay requestId
      const updated = await maybeSyncWithRunpod(sb, { user_id, job });
      return res.status(200).json(shape(updated));
    }

    // ----------------------------------------
    // CASO B: con job_id => busca ese job
    // ----------------------------------------
    const { data: job, error } = await sb
      .from(VIDEO_JOBS_TABLE)
      .select("*")
      .eq("job_id", jobId)
      .eq("user_id", user_id)
      .maybeSingle();

    if (error) throw error;
    if (!job) return res.status(404).json({ ok: false, error: "Job not found" });

    // Fallback queue_position si aplica
    if (job.queue_position == null && QUEUE_STATUSES.includes(normStatus(job.status))) {
      const { count } = await sb
        .from(VIDEO_JOBS_TABLE)
        .select("id", { count: "exact", head: true })
        .in("status", QUEUE_STATUSES)
        .lt("created_at", job.created_at);

      if (typeof count === "number") job.queue_position = count + 1;
    }

    // ✅ Sync con RunPod si hay requestId
    const updated = await maybeSyncWithRunpod(sb, { user_id, job });
    return res.status(200).json(shape(updated));
  } catch (e) {
    console.error("[video-status]", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}

// ============================================================
// Sync helper
// ============================================================
async function maybeSyncWithRunpod(sb, { user_id, job }) {
  const status = normStatus(job.status);

  // Si ya tiene video_url o ya terminó, no hacemos nada
  if (job.video_url) return job;
  if (["COMPLETED", "DONE", "SUCCESS", "ERROR", "FAILED", "CANCELED"].includes(status)) return job;

  const requestId = job.provider_request_id;
  if (!requestId) return job;

  // Consulta RunPod real
  let rp;
  try {
    rp = await runpodGetStatus({ endpointId: VIDEO_RUNPOD_ENDPOINT_ID, requestId });
  } catch (e) {
    // Si status endpoint falla, NO rompemos; solo guardamos nota suave
    const msg = String(e?.message || e);
    await sb.from(process.env.VIDEO_JOBS_TABLE || "video_jobs")
      .update({
        // mantenemos status actual pero guardamos error auxiliar (sin pisar si ya hay)
        error: job.error || `RUNPOD_STATUS_FAILED: ${msg}`,
        updated_at: new Date().toISOString(),
      })
      .eq("job_id", job.job_id);
    return job;
  }

  const rpStatus = String(rp?.status || "").toUpperCase();

  // Map simple a tus statuses
  if (rpStatus === "IN_PROGRESS" || rpStatus === "RUNNING") {
    const { data } = await sb
      .from(process.env.VIDEO_JOBS_TABLE || "video_jobs")
      .update({
        status: "RUNNING",
        updated_at: new Date().toISOString(),
      })
      .eq("job_id", job.job_id)
      .select("*")
      .maybeSingle();
    return data || job;
  }

  if (rpStatus === "FAILED") {
    const errMsg =
      rp?.error ||
      rp?.output?.error ||
      rp?.output?.message ||
      "RunPod FAILED sin detalle";
    const { data } = await sb
      .from(process.env.VIDEO_JOBS_TABLE || "video_jobs")
      .update({
        status: "ERROR",
        error: `RUNPOD_FAILED: ${String(errMsg)}`,
        updated_at: new Date().toISOString(),
      })
      .eq("job_id", job.job_id)
      .select("*")
      .maybeSingle();
    return data || job;
  }

  if (rpStatus === "COMPLETED") {
    // Esperamos output.video_b64 (como tu worker retorna)
    const video_b64 =
      rp?.output?.video_b64 ||
      rp?.output?.videoB64 ||
      null;

    if (!video_b64) {
      const { data } = await sb
        .from(process.env.VIDEO_JOBS_TABLE || "video_jobs")
        .update({
          status: "ERROR",
          error: "RUNPOD_COMPLETED_BUT_NO_VIDEO_B64",
          updated_at: new Date().toISOString(),
        })
        .eq("job_id", job.job_id)
        .select("*")
        .maybeSingle();
      return data || job;
    }

    // Subir mp4 a storage
    let uploaded;
    try {
      uploaded = await uploadMp4ToStorage(sb, {
        user_id,
        job_id: job.job_id,
        video_b64,
      });
    } catch (e) {
      const { data } = await sb
        .from(process.env.VIDEO_JOBS_TABLE || "video_jobs")
        .update({
          status: "ERROR",
          error: `UPLOAD_FAILED: ${String(e?.message || e)}`,
          updated_at: new Date().toISOString(),
        })
        .eq("job_id", job.job_id)
        .select("*")
        .maybeSingle();
      return data || job;
    }

    const { data } = await sb
      .from(process.env.VIDEO_JOBS_TABLE || "video_jobs")
      .update({
        status: "COMPLETED",
        progress: 100,
        video_url: uploaded.publicUrl,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("job_id", job.job_id)
      .select("*")
      .maybeSingle();

    return data || job;
  }

  // Otros estados: QUEUED, etc.
  return job;
}