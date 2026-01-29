// ---------------------------------------------------------
// API: Estado del Video
// Consulta Supabase + RunPod
// ---------------------------------------------------------

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY =
  process.env.RUNPOD_API_KEY || process.env.VIDEO_RUNPOD_API_KEY;

const RUNPOD_ENDPOINT_ID =
  process.env.RUNPOD_ENDPOINT_ID;

// ---------------------------------------------------------
export default async function handler(req, res) {
  try {
    // job_id puede venir por query o body
    const jobId =
      req.query.job_id ||
      req.body?.job_id;

    if (!jobId) {
      return res.status(400).json({
        ok: false,
        error: "Missing job_id",
      });
    }

    // Cliente Supabase (service role)
    const supabase = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );

    // -----------------------------------------------------
    // 1) LEER JOB DESDE SUPABASE
    // -----------------------------------------------------
    const { data: job, error } = await supabase
      .from("video_jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (error || !job) {
      return res.status(404).json({
        ok: false,
        error: "video_jobs row not found",
      });
    }

    // Si ya terminó, devolvemos directo
    if (
      job.status === "COMPLETED" ||
      job.status === "FAILED"
    ) {
      return res.status(200).json({
        ok: true,
        job,
      });
    }

    // Si aún no hay request_id → RunPod no arrancó
    if (!job.runpod_request_id) {
      return res.status(200).json({
        ok: true,
        job,
      });
    }

    // -----------------------------------------------------
    // 2) CONSULTAR ESTADO EN RUNPOD
    // -----------------------------------------------------
    const statusUrl = `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/status/${job.runpod_request_id}`;

    const runpodRes = await fetch(statusUrl, {
      headers: {
        Authorization: `Bearer ${RUNPOD_API_KEY}`,
      },
    });

    const runpodJson = await runpodRes.json().catch(() => null);

    // -----------------------------------------------------
    // 3) ACTUALIZAR ESTADO SEGÚN RUNPOD
    // -----------------------------------------------------
    if (runpodJson?.status === "COMPLETED") {
      await supabase
        .from("video_jobs")
        .update({
          status: "COMPLETED",
          output: runpodJson.output || null,
        })
        .eq("id", jobId);
    }

    if (runpodJson?.status === "FAILED") {
      await supabase
        .from("video_jobs")
        .update({
          status: "FAILED",
          error: runpodJson.error || "RunPod failed",
          output: runpodJson.output || null,
        })
        .eq("id", jobId);
    }

    // Leer job actualizado
    const { data: updatedJob } = await supabase
      .from("video_jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    return res.status(200).json({
      ok: true,
      job: updatedJob || job,
      runpod: runpodJson,
    });

  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || "Unknown error",
    });
  }
}