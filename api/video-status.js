import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

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

    // ✅ Auth (recomendado)
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    const user_id = auth.user.id;

    const sb = sbAdmin();

    const { data: job, error } = await sb
      .from("video_jobs")
      .select("*")
      // ✅ FIX REAL: en tu tabla el id del job es "id" (uuid), NO "job_id"
      .eq("id", job_id)
      .eq("user_id", user_id) // ✅ evita que alguien consulte jobs de otro usuario
      .single();

    if (error || !job) {
      return res.status(404).json({ ok: false, error: "Job not found" });
    }

    // ✅ Si aún no hay worker_url/pod_id → NO es error
    if (!job.worker_url && !job.pod_id) {
      return res.status(200).json({
        ok: true,
        status: job.status || "PENDING",
      });
    }

    // ✅ Cuando ya exista video_url, lo devolvemos
    return res.status(200).json({
      ok: true,
      status: job.status || "IN_PROGRESS",
      video_url: job.video_url || null,
      error: job.error || null,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      ok: false,
      error: String(e.message || e),
    });
  }
}