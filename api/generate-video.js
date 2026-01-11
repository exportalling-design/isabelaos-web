// /api/generate-video.js
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const {
      user_id,
      mode = "t2v",
      prompt,
      negative_prompt = "",
      steps = 25,
      height = 704,
      width = 1280,
      num_frames = 121,
      guidance_scale = 5.0,
    } = req.body || {};

    if (!user_id) {
      return res.status(400).json({ ok: false, error: "Missing user_id" });
    }

    if (!prompt) {
      return res.status(400).json({ ok: false, error: "Missing prompt" });
    }

    const sb = sbAdmin();
    const job_id = crypto.randomUUID();

    // ✅ INSERT SOLO COLUMNAS QUE EXISTEN
    const { error } = await sb.from("video_jobs").insert({
      job_id,
      user_id,
      mode,
      prompt,
      negative_prompt,
      steps,
      height,
      width,
      num_frames,
      guidance_scale,
      status: "PENDING",
    });

    if (error) throw error;

    return res.status(200).json({
      ok: true,
      job_id,
      status: "PENDING",
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      ok: false,
      error: String(e.message || e),
    });
  }
}