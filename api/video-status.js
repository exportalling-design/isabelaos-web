// /api/video-status.js
// ============================================================
// - Consulta estado del job en Supabase
// - Si sigue activo → consulta RunPod
// - Si RunPod terminó → guarda video y marca DONE
// - Devuelve estado limpio al frontend
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY = process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY;
const VIDEO_JOBS_TABLE = process.env.VIDEO_JOBS_TABLE || "video_jobs";

function sbAdmin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function runpodHeaders() {
  return {
    Authorization: `Bearer ${RUNPOD_API_KEY}`,
    "Content-Type": "application/json",
  };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Método no permitido" });
    }

    // ✅ Auth
    const auth = await requireUser(req);
    if (!auth.ok) {
      return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    }

    const user_id = auth.user.id;
    const job_id = req.query.job_id;
    if (!job_id) {
      return res.status(400).json({ ok: false, error: "Falta job_id" });
    }

    const sb = sbAdmin();

    // 1️⃣ Leer job
    const { data: job, error } = await sb
      .from(VIDEO_JOBS_TABLE)
      .select("*")
      .eq("job_id", job_id)
      .eq("user_id", user_id)
      .single();

    if (error || !job) {
      throw new Error("Job no encontrado");
    }

    // 2️⃣ Si ya terminó → devolver directo
    if (job.status === "DONE" && job.video_url) {
      return res.status(200).json({
        ok: true,
        status: "DONE",
        video_url: job.video_url,
      });
    }

    // 3️⃣ Si no hay request_id aún
    if (!job.provider_request_id) {
      return res.status(200).json({
        ok: true,
        status: job.status || "PENDING",
      });
    }

    // 4️⃣ Consultar RunPod
    const rp = await fetch(
      `https://api.runpod.ai/v2/${job.provider_request_id}`,
      { headers: runpodHeaders() }
    );

    const rpJson = await rp.json();

    const rpStatus = rpJson?.status || "UNKNOWN";

    // 5️⃣ Si sigue ejecutando
    if (
      rpStatus === "IN_QUEUE" ||
      rpStatus === "IN_PROGRESS" ||
      rpStatus === "RUNNING"
    ) {
      return res.status(200).json({
        ok: true,
        status: rpStatus,
      });
    }

    // 6️⃣ Si FALLÓ
    if (rpStatus === "FAILED") {
      await sb
        .from(VIDEO_JOBS_TABLE)
        .update({
          status: "ERROR",
          error: rpJson?.error || "RunPod failed",
          updated_at: new Date().toISOString(),
        })
        .eq("job_id", job_id);

      return res.status(200).json({
        ok: false,
        status: "ERROR",
        error: rpJson?.error || "RunPod failed",
      });
    }

    // 7️⃣ Si COMPLETÓ → extraer video
    if (rpStatus === "COMPLETED") {
      const output = rpJson?.output || {};
      const videoB64 = output.video || output.video_base64;

      if (!videoB64) {
        throw new Error("RunPod terminó pero no devolvió video");
      }

      // 👉 aquí puedes subir a S3 / R2 si quieres
      // por ahora lo devolvemos como data URL
      const videoUrl = videoB64.startsWith("data:")
        ? videoB64
        : `data:video/mp4;base64,${videoB64}`;

      await sb
        .from(VIDEO_JOBS_TABLE)
        .update({
          status: "DONE",
          video_url: videoUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("job_id", job_id);

      return res.status(200).json({
        ok: true,
        status: "DONE",
        video_url: videoUrl,
      });
    }

    // fallback
    return res.status(200).json({
      ok: true,
      status: rpStatus,
    });
  } catch (e) {
    console.error("[video-status] ERROR:", e);
    return res.status(500).json({
      ok: false,
      error: e.message || String(e),
    });
  }
}