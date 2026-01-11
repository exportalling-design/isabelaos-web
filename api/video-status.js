// /api/video-status.js
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    const user_id = auth.user.id;

    const job_id = req.query?.job_id;
    if (!job_id) return res.status(400).json({ ok: false, error: "Missing job_id" });

    const sb = sbAdmin();

    const { data: job, error } = await sb
      .from("video_jobs")
      .select("job_id,user_id,status,video_url,error,created_at,updated_at")
      .eq("job_id", job_id)
      .single();

    if (error || !job) return res.status(404).json({ ok: false, error: "Job not found" });

    // Seguridad: el job debe ser del usuario logueado
    if (job.user_id !== user_id) {
      return res.status(403).json({ ok: false, error: "FORBIDDEN" });
    }

    return res.status(200).json({
      ok: true,
      job_id: job.job_id,
      status: job.status || "PENDING",
      video_url: job.video_url || null,
      error: job.error || null,
      updated_at: job.updated_at || null,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}