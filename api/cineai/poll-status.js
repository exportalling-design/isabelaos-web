// api/cineai/poll-status.js
// POST — igual que api/templates/poll-video.js que SÍ funciona
// Copia exacta del patrón de Templates, solo cambia el mode filter
import { supabaseAdmin }          from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

async function fetchToBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function uploadToStorage(buf, userId, jobId) {
  const filePath = `${userId}/cineai_${jobId}_${Date.now()}.mp4`;
  const { error } = await supabaseAdmin.storage
    .from("videos")
    .upload(filePath, buf, { contentType: "video/mp4", upsert: true });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  const { data } = supabaseAdmin.storage.from("videos").getPublicUrl(filePath);
  if (!data?.publicUrl) throw new Error("No public URL returned");
  return data.publicUrl;
}

function extractEvoLinkVideoUrl(data) {
  if (Array.isArray(data?.results) && data.results.length > 0) {
    const first = data.results[0];
    if (typeof first === "string" && first.startsWith("http")) return first;
    if (typeof first === "object") return first?.url || first?.video_url || null;
  }
  return data?.result?.url || data?.result?.video_url || data?.video_url || null;
}

export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("content-type", "application/json; charset=utf-8");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const userId = await getUserIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  const { taskId } = body;
  if (!taskId) return res.status(400).json({ ok: false, error: "Missing taskId" });

  try {
    // Buscar job — igual que poll-video.js
    const { data: job } = await supabaseAdmin
      .from("video_jobs")
      .select("id, user_id, status, result_url, video_url, provider_request_id, payload")
      .eq("provider_request_id", taskId)
      .eq("user_id", userId)
      .single();

    // Ya tiene video guardado — devolver directo
    if (job?.result_url) {
      console.log(`[cineai-poll] cached — returning result_url`);
      return res.status(200).json({ ok: true, status: "completed", videoUrl: job.result_url });
    }
    if (job?.video_url) {
      console.log(`[cineai-poll] cached — returning video_url`);
      return res.status(200).json({ ok: true, status: "completed", videoUrl: job.video_url });
    }

    const jobId = job?.id || taskId;

    // Consultar EvoLink — igual que poll-video.js
    const evolinkRes = await fetch(`https://api.evolink.ai/v1/tasks/${taskId}`, {
      headers: { "Authorization": `Bearer ${process.env.EVOLINK_API_KEY}` },
    });

    const data = await evolinkRes.json();
    const status = data.status || "pending";
    console.log(`[cineai-poll] EvoLink taskId=${taskId} status=${status} progress=${data.progress}`);

    if (!evolinkRes.ok) {
      return res.status(200).json({ ok: true, status: "processing" });
    }

    if (status === "failed" || status === "error") {
      const errMsg = data.error?.message || data.message || "EvoLink generation failed";
      await supabaseAdmin.from("video_jobs")
        .update({ status: "FAILED", provider_status: "failed", provider_error: errMsg })
        .eq("provider_request_id", taskId);
      return res.status(200).json({ ok: true, status: "failed", error: errMsg });
    }

    if (status !== "completed") {
      return res.status(200).json({ ok: true, status: "processing", progress: data.progress || 0 });
    }

    // Completado — extraer URL igual que poll-video.js
    const evolinkVideoUrl = extractEvoLinkVideoUrl(data);
    console.log(`[cineai-poll] evolinkVideoUrl=${evolinkVideoUrl}`);

    if (!evolinkVideoUrl) {
      console.error(`[cineai-poll] NO VIDEO URL:`, JSON.stringify(data));
      return res.status(200).json({ ok: true, status: "processing" });
    }

    // Descargar y subir a Storage — igual que poll-video.js
    const buf = await fetchToBuffer(evolinkVideoUrl);
    const permanentUrl = await uploadToStorage(buf, userId, jobId);
    console.log(`[cineai-poll] Saved: ${permanentUrl.slice(0, 60)}`);

    await supabaseAdmin.from("video_jobs").update({
      status: "COMPLETED", provider_status: "completed",
      result_url: permanentUrl, video_url: permanentUrl, output_url: permanentUrl,
    }).eq("provider_request_id", taskId);

    return res.status(200).json({ ok: true, status: "completed", videoUrl: permanentUrl });

  } catch (err) {
    console.error("[cineai-poll] error:", err.message);
    return res.status(500).json({ ok: false, error: "Error polling" });
  }
}

export const config = { runtime: "nodejs" };
