// /api/video-status.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

export default async function handler(req, res) {
  try {
    const { job_id } = req.query || {};
    if (!job_id) {
      return res.status(400).json({ ok: false, error: "Missing job_id" });
    }

    const sb = sbAdmin();

    const { data: job, error } = await sb
      .from("video_jobs")
      .select("*")
      .eq("job_id", job_id)
      .single();

    if (error || !job) {
      return res.status(404).json({ ok: false, error: "Job not found" });
    }

    // ✅ SI AÚN NO HAY WORKER → NO ES ERROR
    if (!job.worker_url && !job.pod_id) {
      return res.status(200).json({
        ok: true,
        status: job.status || "PENDING",
      });
    }

    // ✅ CUANDO YA EXISTA WORKER, AQUÍ IRÁ EL PROXY (luego)
    return res.status(200).json({
      ok: true,
      status: job.status || "IN_PROGRESS",
      video_url: job.video_url || null,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      ok: false,
      error: String(e.message || e),
    });
  }
}