// /api/video-status.js
// ------------------------------------------------------------
// Devuelve estado del job y, cuando RunPod termina, baja el MP4,
// lo sube a Supabase Storage y actualiza video_jobs.video_url.
// ------------------------------------------------------------

export const config = { runtime: "nodejs" };

import { sbAdmin } from "../lib/supabaseAdmin.js";

function getRunpodConfig() {
  const apiKey = process.env.RUNPOD_API_KEY || process.env.VIDEO_RUNPOD_API_KEY || null;
  const endpointId = process.env.RUNPOD_ENDPOINT_ID || null;
  const baseUrl = process.env.RUNPOD_BASE_URL || "https://api.runpod.ai/v2";

  if (!apiKey) throw new Error("Missing RUNPOD_API_KEY");
  if (!endpointId) throw new Error("Missing RUNPOD_ENDPOINT_ID");

  return { apiKey, endpointId, baseUrl };
}

// Sube buffer mp4 a Supabase Storage y devuelve public URL
async function uploadToSupabaseVideoBucket({ supabaseAdmin, bucket, jobId, buffer }) {
  const path = `${jobId}.mp4`;

  const { error: upErr } = await supabaseAdmin.storage.from(bucket).upload(path, buffer, {
    contentType: "video/mp4",
    upsert: true,
  });
  if (upErr) throw new Error(`storage upload failed: ${upErr.message}`);

  // Bucket debe ser PUBLIC para getPublicUrl
  const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl || null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const supabaseAdmin = sbAdmin();
    const { apiKey, endpointId, baseUrl } = getRunpodConfig();

    const job_id = req.query.job_id;
    if (!job_id) return res.status(400).json({ ok: false, error: "Missing job_id" });

    // 1) Leer job desde DB
    const { data: job, error: jobErr } = await supabaseAdmin
      .from("video_jobs")
      .select("id,status,provider_request_id,video_url,provider_status,provider_raw,provider_reply")
      .eq("id", job_id)
      .single();

    if (jobErr || !job) {
      return res.status(404).json({ ok: false, error: "video_jobs row not found" });
    }

    // 2) Si ya está listo y tiene URL
    if ((job.status === "DONE" || job.status === "COMPLETED" || job.status === "SUCCESS") && job.video_url) {
      return res.status(200).json({ ok: true, status: "DONE", video_url: job.video_url });
    }

    // 3) Si aún no tenemos request_id, devolvemos estado local
    if (!job.provider_request_id) {
      return res.status(200).json({ ok: true, status: job.status || "QUEUED" });
    }

    // 4) Consultar estado en RunPod
    const statusUrl = `${baseUrl}/${endpointId}/status/${job.provider_request_id}`;
    const rp = await fetch(statusUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const rpJson = await rp.json().catch(() => null);

    // Si RunPod falla la consulta, devolvemos estado local sin romper
    if (!rp.ok) {
      console.log("❌ runpod status failed:", rp.status, rpJson);
      return res.status(200).json({
        ok: true,
        status: job.status || "RUNNING",
        provider_status: job.provider_status || "UNKNOWN",
      });
    }

    const rpStatus = rpJson?.status || "RUNNING";

    // 5) FAILED
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

      return res.status(200).json({ ok: true, status: "FAILED", error: "provider_failed" });
    }

    // 6) Aún no terminó
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

    // 7) COMPLETED -> sacar URL del output
    // Tu worker debe devolver algo como:
    // rpJson.output = { video_url: "https://..." }  o  { url: "https://..." }
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

    // 8) Descargar MP4
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

    // 9) Subir a Supabase Storage
    const bucket = process.env.VIDEO_BUCKET || "videos";
    const publicUrl = await uploadToSupabaseVideoBucket({ supabaseAdmin, bucket, jobId: job.id, buffer });

    if (!publicUrl) {
      await supabaseAdmin
        .from("video_jobs")
        .update({
          status: "FAILED",
          provider_status: "FAILED",
          provider_reply: rpJson,
          error: "storage_public_url_missing",
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      return res.status(200).json({ ok: true, status: "FAILED", error: "storage_public_url_missing" });
    }

    // 10) Guardar video_url final en DB
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