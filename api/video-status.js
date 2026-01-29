// /api/video-status.js
import { getSupabaseAdmin } from "../src/lib/supabaseAdmin";

function getRunpodConfig() {
  return {
    apiKey: process.env.RUNPOD_API_KEY,
    endpointId: process.env.RUNPOD_ENDPOINT_ID,
    baseUrl: process.env.RUNPOD_BASE_URL || "https://api.runpod.ai/v2",
  };
}

async function uploadToSupabaseVideoBucket({ supabaseAdmin, bucket, jobId, buffer }) {
  const path = `${jobId}.mp4`;

  const { error: upErr } = await supabaseAdmin.storage.from(bucket).upload(path, buffer, {
    contentType: "video/mp4",
    upsert: true,
  });
  if (upErr) throw new Error(`storage upload failed: ${upErr.message}`);

  const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl || null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { apiKey, endpointId, baseUrl } = getRunpodConfig();

    const job_id = req.query.job_id;
    if (!job_id) return res.status(400).json({ ok: false, error: "Missing job_id" });

    const { data: job, error: jobErr } = await supabaseAdmin
      .from("video_jobs")
      .select("id,status,provider_request_id,video_url,provider_status,provider_raw")
      .eq("id", job_id)
      .single();

    if (jobErr || !job) return res.status(404).json({ ok: false, error: "video_jobs row not found" });

    if (job.status === "DONE" && job.video_url) {
      return res.status(200).json({ ok: true, status: "DONE", video_url: job.video_url });
    }

    if (!job.provider_request_id) {
      return res.status(200).json({ ok: true, status: job.status || "QUEUED" });
    }

    const statusUrl = `${baseUrl}/${endpointId}/status/${job.provider_request_id}`;
    const rp = await fetch(statusUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const rpJson = await rp.json().catch(() => null);

    if (!rp.ok) {
      console.log("❌ runpod status failed:", rp.status, rpJson);
      return res.status(200).json({ ok: true, status: job.status || "RUNNING", provider: rpJson });
    }

    const rpStatus = rpJson?.status || "RUNNING";

    if (rpStatus === "FAILED") {
      await supabaseAdmin
        .from("video_jobs")
        .update({
          status: "FAILED",
          provider_status: "FAILED",
          provider_reply: rpJson,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      return res.status(200).json({ ok: true, status: "FAILED" });
    }

    if (rpStatus !== "COMPLETED") {
      await supabaseAdmin
        .from("video_jobs")
        .update({
          status: "RUNNING",
          provider_status: rpStatus,
          provider_reply: rpJson,
        })
        .eq("id", job.id);

      return res.status(200).json({ ok: true, status: "RUNNING", provider_status: rpStatus });
    }

    const out = rpJson?.output;
    const remoteUrl =
      (typeof out === "string" && out) ||
      out?.video_url ||
      out?.url ||
      out?.result?.video_url ||
      null;

    if (!remoteUrl) {
      await supabaseAdmin
        .from("video_jobs")
        .update({
          status: "FAILED",
          provider_status: "FAILED",
          provider_reply: rpJson,
          error: "no_video_url_in_provider_output",
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      return res.status(200).json({ ok: true, status: "FAILED", error: "no_video_url_in_provider_output" });
    }

    const bucket = process.env.VIDEO_BUCKET || "videos";

    const vidResp = await fetch(remoteUrl);
    if (!vidResp.ok) {
      await supabaseAdmin
        .from("video_jobs")
        .update({
          status: "FAILED",
          provider_status: "FAILED",
          provider_reply: rpJson,
          error: "failed_to_download_video",
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      return res.status(200).json({ ok: true, status: "FAILED", error: "failed_to_download_video" });
    }

    const arrayBuffer = await vidResp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const publicUrl = await uploadToSupabaseVideoBucket({ supabaseAdmin, bucket, jobId: job.id, buffer });

    await supabaseAdmin
      .from("video_jobs")
      .update({
        status: "DONE",
        provider_status: "COMPLETED",
        provider_reply: rpJson,
        video_url: publicUrl,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    return res.status(200).json({ ok: true, status: "DONE", video_url: publicUrl });
  } catch (e) {
    console.log("❌ video-status fatal:", e);
    return res.status(500).json({ ok: false, error: e?.message || "server_error" });
  }
}