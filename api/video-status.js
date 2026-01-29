// pages/api/video-status.js

export const runtime = "nodejs"; // ⛔️ SIN ESTO VERCEL MUERE

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

function getRunpodConfig() {
  return {
    apiKey: process.env.RUNPOD_API_KEY,
    endpointId: process.env.RUNPOD_ENDPOINT_ID,
    baseUrl: process.env.RUNPOD_BASE_URL || "https://api.runpod.ai/v2",
  };
}

async function uploadToSupabaseVideoBucket({ supabaseAdmin, bucket, jobId, buffer }) {
  const path = `${jobId}.mp4`;

  const { error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(path, buffer, {
      contentType: "video/mp4",
      upsert: true,
    });

  if (error) {
    throw new Error(error.message);
  }

  const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { apiKey, endpointId, baseUrl } = getRunpodConfig();

    const job_id = req.query.job_id;
    if (!job_id) {
      return res.status(400).json({ ok: false, error: "Missing job_id" });
    }

    const { data: job, error: jobErr } = await supabaseAdmin
      .from("video_jobs")
      .select("*")
      .eq("id", job_id)
      .single();

    if (jobErr || !job) {
      return res.status(404).json({ ok: false, error: "Job not found" });
    }

    if (job.status === "DONE" && job.video_url) {
      return res.status(200).json({ ok: true, status: "DONE", video_url: job.video_url });
    }

    if (!job.provider_request_id) {
      return res.status(200).json({ ok: true, status: job.status });
    }

    const statusUrl = `${baseUrl}/${endpointId}/status/${job.provider_request_id}`;
    const rp = await fetch(statusUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const rpJson = await rp.json();
    const rpStatus = rpJson.status;

    if (rpStatus !== "COMPLETED") {
      await supabaseAdmin
        .from("video_jobs")
        .update({
          status: "RUNNING",
          provider_status: rpStatus,
          provider_reply: rpJson,
        })
        .eq("id", job.id);

      return res.status(200).json({ ok: true, status: rpStatus });
    }

    const remoteUrl =
      rpJson.output?.video_url ||
      rpJson.output?.url ||
      (typeof rpJson.output === "string" ? rpJson.output : null);

    if (!remoteUrl) {
      throw new Error("No video URL in provider output");
    }

    const vidResp = await fetch(remoteUrl);
    const arrayBuffer = await vidResp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const bucket = process.env.VIDEO_BUCKET || "videos";
    const publicUrl = await uploadToSupabaseVideoBucket({
      supabaseAdmin,
      bucket,
      jobId: job.id,
      buffer,
    });

    await supabaseAdmin
      .from("video_jobs")
      .update({
        status: "DONE",
        provider_status: "COMPLETED",
        video_url: publicUrl,
        provider_reply: rpJson,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    return res.status(200).json({ ok: true, status: "DONE", video_url: publicUrl });
  } catch (err) {
    console.error("❌ video-status fatal:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "server_error",
    });
  }
}