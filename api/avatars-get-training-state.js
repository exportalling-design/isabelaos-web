// /api/avatars-get-training-state.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Normaliza estados para frontend
function normalizeStatus(raw) {
  const s = String(raw || "").toUpperCase();

  if (!s) return "—";
  if (["IN_QUEUE", "QUEUED", "QUEUE", "PENDING"].includes(s)) return "IN_QUEUE";
  if (["IN_PROGRESS", "RUNNING", "PROCESSING", "STARTED", "TRAINING"].includes(s)) return "IN_PROGRESS";
  if (["COMPLETED", "SUCCEEDED", "SUCCESS", "DONE", "FINISHED", "READY"].includes(s)) return "SUCCEEDED";
  if (["FAILED", "ERROR", "CANCELLED", "CANCELED", "TIMED_OUT", "TIMEOUT"].includes(s)) return "FAILED";

  return s;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const { avatar_id, user_id } = req.body || {};

    if (!avatar_id) {
      return res.status(400).json({ ok: false, error: "Missing avatar_id" });
    }

    // Traer avatar
    const { data: avatar, error: avErr } = await supabase
      .from("avatars")
      .select("id, user_id, name, trigger, status, lora_path, last_error, train_error, train_job_id, train_job_db_id")
      .eq("id", avatar_id)
      .single();

    if (avErr || !avatar) {
      return res.status(404).json({ ok: false, error: "Avatar not found" });
    }

    // Validación opcional de dueño
    if (user_id && avatar.user_id !== user_id) {
      return res.status(403).json({ ok: false, error: "Not your avatar" });
    }

    let latestJob = null;

    // Si tiene train_job_db_id, usamos ese primero
    if (avatar.train_job_db_id) {
      const { data: jobByDbId } = await supabase
        .from("avatar_jobs")
        .select("id, avatar_id, job_id, status, error, progress, result_json, created_at")
        .eq("id", avatar.train_job_db_id)
        .single();

      if (jobByDbId) latestJob = jobByDbId;
    }

    // Si no encontró, buscamos el más reciente del avatar
    if (!latestJob) {
      const { data: recentJobs } = await supabase
        .from("avatar_jobs")
        .select("id, avatar_id, job_id, status, error, progress, result_json, created_at")
        .eq("avatar_id", avatar_id)
        .order("created_at", { ascending: false })
        .limit(1);

      if (recentJobs?.length) latestJob = recentJobs[0];
    }

    const avatarOut = {
      id: avatar.id,
      name: avatar.name || null,
      trigger: avatar.trigger || null,
      status: avatar.status || "—",
      lora_path: avatar.lora_path || null,
      train_job_id: avatar.train_job_id || null,
      train_job_db_id: avatar.train_job_db_id || null,
      train_error: avatar.train_error || avatar.last_error || null,
    };

    const jobOut = latestJob
      ? {
          id: latestJob.job_id || null,
          status: normalizeStatus(latestJob.status || avatar.status),
          provider: "runpod",
          error: latestJob.error || avatarOut.train_error || null,
          db_id: latestJob.id,
          progress: latestJob.progress ?? null,
        }
      : avatar.train_job_id
      ? {
          id: avatar.train_job_id,
          status: normalizeStatus(avatar.status),
          provider: "runpod",
          error: avatarOut.train_error || null,
          db_id: avatar.train_job_db_id || null,
          progress: null,
        }
      : null;

    return res.json({
      ok: true,
      avatar: avatarOut,
      job: jobOut,
    });
  } catch (err) {
    console.error("[avatars-get-training-state]", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "SERVER_ERROR",
    });
  }
}
