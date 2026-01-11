// /api/video-status.js
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "generations";
const WORKER_TIMEOUT_MS = Number(process.env.WORKER_TIMEOUT_MS || 15 * 60 * 1000);

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function workerBaseFromJob(job) {
  if (job.worker_url) return job.worker_url.replace(/\/+$/, "");
  if (job.pod_id) return `https://${job.pod_id}-8000.proxy.runpod.net`;
  return null;
}

async function uploadVideo(sb, user_id, buffer) {
  const key = `${user_id}/${crypto.randomUUID()}.mp4`;

  const up = await sb.storage.from(SUPABASE_BUCKET).upload(key, buffer, {
    contentType: "video/mp4",
  });
  if (up.error) throw up.error;

  const signed = await sb.storage
    .from(SUPABASE_BUCKET)
    .createSignedUrl(key, 60 * 60 * 24 * 7);

  return signed.data.signedUrl;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const job_id = req.query.job_id;
    if (!job_id) return res.status(400).json({ ok: false, error: "Missing job_id" });

    const sb = sbAdmin();

    const { data: job, error } = await sb
      .from("video_jobs")
      .select("*")
      .eq("job_id", job_id)
      .single();

    if (error) throw error;

    // Si ya terminó
    if (job.status === "COMPLETED" && job.video_url) {
      return res.json({ ok: true, ...job });
    }

    // Lock del job
    const { data: locked } = await sb
      .from("video_jobs")
      .update({ status: "RUNNING" })
      .eq("job_id", job_id)
      .in("status", ["PENDING", "QUEUED"])
      .select("job_id")
      .maybeSingle();

    if (!locked) {
      return res.json({ ok: true, status: job.status });
    }

    const workerBase = workerBaseFromJob(job);
    if (!workerBase) throw new Error("No worker url or pod_id");

    const r = await fetch(`${workerBase}/api/video_async`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: job.mode,
        user_id: job.user_id,
        prompt: job.prompt,
        negative_prompt: job.negative_prompt,
        steps: job.steps,
        height: job.height,
        width: job.width,
        num_frames: job.num_frames,
        guidance_scale: job.guidance_scale,
        image_base64: job.image_base64 || null,
      }),
    });

    if (!r.ok) throw new Error(`Worker error ${r.status}`);

    const buffer = Buffer.from(await r.arrayBuffer());
    const video_url = await uploadVideo(sb, job.user_id, buffer);

    await sb
      .from("video_jobs")
      .update({ status: "COMPLETED", video_url })
      .eq("job_id", job_id);

    res.json({ ok: true, status: "COMPLETED", video_url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}