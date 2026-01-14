// /api/video-current.js
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const VIDEO_JOBS_TABLE = "video_jobs";
const ACTIVE_STATUSES = ["PENDING", "IN_QUEUE", "QUEUED", "DISPATCHED", "IN_PROGRESS", "RUNNING"];

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

export default async function handler(req, res) {
  try {
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    const user_id = auth.user.id;

    const sb = sbAdmin();

    const { data, error } = await sb
      .from(VIDEO_JOBS_TABLE)
      .select("id,status,progress,eta_seconds,queue_position,video_url,error,created_at,updated_at")
      .eq("user_id", user_id)
      .in("status", ACTIVE_STATUSES)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) throw error;

    const job = data?.[0] || null;
    return res.status(200).json({ ok: true, job });
  } catch (e) {
    console.error("[video-current] fatal:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}