// /api/video-status.js
// ============================================================
// - Consulta estado real en RunPod Serverless
// - Sincroniza status con tabla video_jobs
// - Guarda video_url cuando termina
// - Maneja COMPLETED / FAILED / IN_PROGRESS
// - Compatible con generate-video.js actual
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

// --------------------
// ENV
// --------------------
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY =
  process.env.VIDEO_RUNPOD_API_KEY ||
  process.env.RUNPOD_API_KEY ||
  null;

const VIDEO_RUNPOD_ENDPOINT_ID =
  process.env.VIDEO_RUNPOD_ENDPOINT_ID || null;

const VIDEO_JOBS_TABLE = process.env.VIDEO_JOBS_TABLE || "video_jobs";

// --------------------
// Supabase admin
// --------------------
function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Falta SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY)
    throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY");

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// --------------------
// RunPod status fetch
// --------------------
async function fetchRunpodStatus(requestId) {
  if (!RUNPOD_API_KEY) throw new Error("Falta RUNPOD_API_KEY");
  if (!VIDEO_RUNPOD_ENDPOINT_ID)
    throw new Error("Falta VIDEO_RUNPOD_ENDPOINT_ID");

  const url = `https://api.runpod.ai/v2/${VIDEO_RUNPOD_ENDPOINT_ID}/status/${requestId}`;

  const r = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${RUNPOD_API_KEY}`,
    },
  });

  const j = await r.json().catch(() => null);
  if (!r.ok || !j)
    throw new Error(j?.error || `RunPod status error (${r.status})`);

  return j;
}

// ============================================================
// HANDLER
// ============================================================
export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res
        .status(405)
        .json({ ok: false, error: "Método no permitido" });
    }

    // --------------------
    // Auth
    // --------------------
    const auth = await requireUser(req);
    if (!auth.ok)
      return res.status(auth.code || 401).json({
        ok: false,
        error: auth.error,
      });

    const user_id = auth.user.id;

    const { job_id } = req.query;
    if (!job_id)
      return res
        .status(400)
        .json({ ok: false, error: "Falta job_id" });

    const sb = sbAdmin();

    // --------------------
    // Obtener job
    // --------------------
    const { data: job, error } = await sb
      .from(VIDEO_JOBS_TABLE)
      .select("*")
      .eq("job_id", job_id)
      .single();

    if (error || !job) {
      return res
        .status(404)
        .json({ ok: false, error: "Job no encontrado" });
    }

    // Seguridad básica: solo dueño
    if (job.user_id !== user_id) {
      return res
        .status(403)
        .json({ ok: false, error: "No autorizado" });
    }

    // Si ya terminó, no golpear RunPod
    if (job.status === "COMPLETED" && job.video_url) {
      return res.json({
        ok: true,
        status: "COMPLETED",
        video_url: job.video_url,
        job,
      });
    }

    if (!job.provider_request_id) {
      return res.json({
        ok: true,
        status: job.status,
        progress: job.progress ?? 0,
      });
    }

    // --------------------
    // Consultar RunPod
    // --------------------
    const rp = await fetchRunpodStatus(job.provider_request_id);

    const rpStatus = rp.status; // QUEUED | RUNNING | COMPLETED | FAILED

    // --------------------
    // RUNNING / QUEUED
    // --------------------
    if (rpStatus === "IN_PROGRESS" || rpStatus === "RUNNING" || rpStatus === "QUEUED") {
      await sb
        .from(VIDEO_JOBS_TABLE)
        .update({
          status: "IN_PROGRESS",
          progress: rp.progress ?? job.progress ?? 0,
          updated_at: new Date().toISOString(),
        })
        .eq("job_id", job_id);

      return res.json({
        ok: true,
        status: "IN_PROGRESS",
        progress: rp.progress ?? null,
      });
    }

    // --------------------
    // COMPLETED
    // --------------------
    if (rpStatus === "COMPLETED") {
      const output = rp.output || {};

      // 🔴 AJUSTA AQUÍ si tu worker devuelve otra key
      const video_url =
        output.video_url ||
        output.videoUrl ||
        output.url ||
        null;

      if (!video_url) {
        throw new Error(
          "RunPod terminó pero no devolvió video_url"
        );
      }

      await sb
        .from(VIDEO_JOBS_TABLE)
        .update({
          status: "COMPLETED",
          progress: 100,
          video_url,
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("job_id", job_id);

      return res.json({
        ok: true,
        status: "COMPLETED",
        video_url,
      });
    }

    // --------------------
    // FAILED
    // --------------------
    if (rpStatus === "FAILED") {
      await sb
        .from(VIDEO_JOBS_TABLE)
        .update({
          status: "FAILED",
          error: rp.error || "RunPod FAILED",
          updated_at: new Date().toISOString(),
        })
        .eq("job_id", job_id);

      return res.status(500).json({
        ok: false,
        status: "FAILED",
        error: rp.error || "RunPod FAILED",
      });
    }

    // --------------------
    // Fallback
    // --------------------
    return res.json({
      ok: true,
      status: job.status,
    });
  } catch (e) {
    console.error("[video-status] fatal:", e);
    return res.status(500).json({
      ok: false,
      error: String(e?.message || e),
    });
  }
}