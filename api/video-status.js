// /api/video-status.js
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const VIDEO_JOBS_TABLE = "video_jobs";

// Para calcular cola (debe alinearse con worker.py)
const QUEUE_STATUSES = ["PENDING", "IN_QUEUE", "QUEUED", "DISPATCHED", "IN_PROGRESS"];

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function normStatus(s) {
  const t = String(s || "").trim().toUpperCase();
  return t || "PENDING";
}

export default async function handler(req, res) {
  try {
    const { job_id } = req.query || {};
    if (!job_id) return res.status(400).json({ ok: false, error: "Missing job_id" });

    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    const user_id = auth.user.id;

    const sb = sbAdmin();

    // 1) PK id
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

    // 2) fallback legacy job_id field
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

    const status = normStatus(job.status);

    // progress
    const progress =
      typeof job.progress === "number" ? job.progress : (job.progress ? Number(job.progress) : 0);

    // queue position (calculated live)
    let queue_position = job.queue_position ?? null;

    if (QUEUE_STATUSES.includes(status) && job.created_at) {
      // Count how many queued jobs are ahead (older) (global queue)
      // If you want per-user queue, add .eq("user_id", user_id)
      const { count, error: cErr } = await sb
        .from(VIDEO_JOBS_TABLE)
        .select("id", { count: "exact", head: true })
        .in("status", QUEUE_STATUSES)
        .lt("created_at", job.created_at);

      if (!cErr && typeof count === "number") {
        queue_position = count + 1;
      } else {
        queue_position = null;
      }
    } else if (status === "RUNNING") {
      queue_position = 0;
    }

    return res.status(200).json({
      ok: true,
      id: job.id,
      status,
      progress: Math.max(0, Math.min(100, Number(progress || 0))),
      queue_position,
      eta_seconds: job.eta_seconds ?? null,
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