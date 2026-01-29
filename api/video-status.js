// api/video-status.js
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";

function getRunpodConfig() {
  const apiKey = process.env.RUNPOD_API_KEY;
  const endpointId = process.env.RUNPOD_ENDPOINT_ID;
  const baseUrl = process.env.RUNPOD_BASE_URL || "https://api.runpod.ai/v2";
  if (!apiKey) throw new Error("RUNPOD_API_KEY missing");
  if (!endpointId) throw new Error("RUNPOD_ENDPOINT_ID missing");
  return { apiKey, endpointId, baseUrl };
}

async function uploadToSupabaseVideoBucket({ supabaseAdmin, bucket, jobId, buffer }) {
  const path = `${jobId}.mp4`;

  const { error } = await supabaseAdmin.storage.from(bucket).upload(path, buffer, {
    contentType: "video/mp4",
    upsert: true,
  });
  if (error) throw new Error(error.message);

  const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

function b64ToBuffer(b64) {
  let s = String(b64 || "").trim();
  // por si viniera DataURL
  if (s.startsWith("data:") && s.includes(",")) s = s.split(",", 2)[1];
  return Buffer.from(s, "base64");
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
      .select("*")
      .eq("id", job_id)
      .single();

    if (jobErr || !job) return res.status(404).json({ ok: false, error: "Job not found" });

    // si ya está listo
    if (job.status === "DONE" && job.video_url) {
      return res.status(200).json({ ok: true, status: "DONE", video_url: job.video_url });
    }

    if (!job.provider_request_id) {
      return res.status(200).json({ ok: true, status: job.status || "QUEUED" });
    }

    // consultar runpod
    const statusUrl = `${baseUrl}/${endpointId}/status/${job.provider_request_id}`;
    const rp = await fetch(statusUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const rpJson = await rp.json().catch(() => null);
    const rpStatus = rpJson?.status || "UNKNOWN";

    // si aún no termina
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

    // COMPLETED: tu worker devuelve output.video_b64 (mp4)
    const out = rpJson?.output || {};
    const videoB64 = out?.video_b64 || null;
    const videoUrlRemote = out?.video_url || out?.url || (typeof out === "string" ? out : null);

    let buffer = null;

    if (videoB64) {
      buffer = b64ToBuffer(videoB64);
    } else if (videoUrlRemote) {
      const vidResp = await fetch(videoUrlRemote);
      const arrayBuffer = await vidResp.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } else {
      throw new Error("No video_b64/video_url in provider output");
    }

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
    return res.status(500).json({ ok: false, error: err?.message || "server_error" });
  }
}