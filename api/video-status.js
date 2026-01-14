// /api/video-status.js
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const VIDEO_JOBS_TABLE = "video_jobs";

// Para fallback si queue_position no está guardado (calcula vivo)
const QUEUE_STATUSES = ["PENDING", "IN_QUEUE", "QUEUED", "DISPATCHED", "IN_PROGRESS"];

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function normStatus(s) {
  const t = String(s || "").trim();
  if (!t) return "PENDING";
  return t.toUpperCase();
}

export default async function handler(req, res) {
  try {
    const jobId =
      (req.query?.jobId || req.query?.job_id || req.query?.jobID || req.query?.id || "").toString();

    if (!jobId) return res.status(400).json({ ok: false, error: "Missing jobId" });

    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    const user_id = auth.user.id;

    const sb = sbAdmin();

    // 1) Buscar por PK uuid (id)
    const { data: job, error } = await sb
      .from(VIDEO_JOBS_TABLE)
      .select("*")
      .eq("id", jobId)
      .eq("user_id", user_id)
      .single();

    if (error || !job) return res.status(404).json({ ok: false, error: "Job not found" });

    const status = normStatus(job.status);

    const progress =
      typeof job.progress === "number"
        ? job.progress
        : (job.progress ? Number(job.progress) : 0);

    let queue_position =
      typeof job.queue_position === "number"
        ? job.queue_position
        : (job.queue_position != null ? Number(job.queue_position) : null);

    let eta_seconds =
      typeof job.eta_seconds === "number"
        ? job.eta_seconds
        : (job.eta_seconds != null ? Number(job.eta_seconds) : null);

    // Fallback: si no está guardado queue_position, lo calculamos en vivo
    if ((queue_position == null || Number.isNaN(queue_position)) && QUEUE_STATUSES.includes(status) && job.created_at) {
      const { count } = await sb
        .from(VIDEO_JOBS_TABLE)
        .select("id", { count: "exact", head: true })
        .in("status", QUEUE_STATUSES)
        .lt("created_at", job.created_at);

      if (typeof count === "number") queue_position = count + 1;
    }

    // RUNNING => cola 0
    if (status === "RUNNING") queue_position = 0;

    return res.status(200).json({
      ok: true,
      id: job.id,
      status,
      progress: Math.max(0, Math.min(100, Number(progress || 0))),
      queue_position: queue_position != null ? Math.max(0, Number(queue_position)) : null,
      eta_seconds: eta_seconds != null ? Math.max(0, Number(eta_seconds)) : null,
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