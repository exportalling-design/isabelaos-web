// /api/dispatch-video.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// TU POD FIJO
const POD_BASE = "https://2dz3jc4mbgcyq3-8000.proxy.runpod.net";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  try {
    // 1. Tomar un job pendiente
    const { data: job } = await sb
      .from("video_jobs")
      .select("*")
      .eq("status", "PENDING")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!job) {
      return res.json({ ok: true, message: "No hay jobs pendientes" });
    }

    // 2. Bloquearlo
    await sb
      .from("video_jobs")
      .update({ status: "RUNNING" })
      .eq("job_id", job.job_id);

    // 3. Enviar el job al pod (FIRE & FORGET)
    fetch(`${POD_BASE}/api/video_async`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job),
    }).catch(() => {});

    return res.json({
      ok: true,
      dispatched: job.job_id,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}