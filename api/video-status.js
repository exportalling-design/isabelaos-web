// /api/video-status.js
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

// ============================================================
// IsabelaOS Studio — Video Status
// - Busca job por id (PK) (y fallback por job_id si existiera)
// - Devuelve status + video_url + error
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const VIDEO_JOBS_TABLE = "video_jobs";

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

export default async function handler(req, res) {
  try {
    const { job_id } = req.query || {};
    if (!job_id) return res.status(400).json({ ok: false, error: "Missing job_id" });

    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    const user_id = auth.user.id;

    const sb = sbAdmin();

    // 1) Primero intenta por PK id (lo que devuelve generate-video)
    let job = null;
    {
      const { data, error } = await sb
        .from(VIDEO_JOBS_TABLE)
        .select("*")
        .eq("id", job_id)
        .eq("user_id", user_id)
        .single();

      if (!error && data) job = data;
    }

    // 2) Fallback por job_id (si algún día usás otro identificador)
    if (!job) {
      const { data, error } = await sb
        .from(VIDEO_JOBS_TABLE)
        .select("*")
        .eq("job_id", job_id)
        .eq("user_id", user_id)
        .single();

      if (!error && data) job = data;
    }

    if (!job) return res.status(404).json({ ok: false, error: "Job not found" });

    return res.status(200).json({
      ok: true,
      id: job.id,
      status: job.status || "PENDING",
      video_url: job.video_url || null,
      error: job.error || null,
      created_at: job.created_at || null,
      updated_at: job.updated_at || null,
    });
  } catch (e) {
    console.error("[video-status] fatal:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}