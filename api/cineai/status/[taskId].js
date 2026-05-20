// api/cineai/status/[taskId].js — mismo routing que poll.js
import { supabaseAdmin }          from "../../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../../src/lib/getUserIdFromAuth.js";

async function pollEvolink(taskId) {
  const r = await fetch(`https://api.evolink.ai/v1/tasks/${taskId}`, {
    headers: { "Authorization": `Bearer ${process.env.EVOLINK_API_KEY}` },
  });
  const data = await r.json();
  console.error("[status] EvoLink raw:", JSON.stringify(data).slice(0, 400));
  if (!r.ok) throw new Error(data?.message || `EvoLink error ${r.status}`);
  return { done: data.status === "succeeded", failed: data.status === "failed", videoUrl: data.video_url || data.output?.video_url || null, error: data.error?.message || null, rawData: data };
}

async function pollByteplus(taskId) {
  const r = await fetch(`https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks/${taskId}`, {
    headers: { "Authorization": `Bearer ${process.env.BYTEPLUS_API_KEY}` },
  });
  const data = await r.json();
  console.error("[status] BytePlus raw:", JSON.stringify(data).slice(0, 400));
  if (!r.ok || data.error) throw new Error(data.error?.message || `BytePlus error ${r.status}`);
  let videoUrl = null;
  if (Array.isArray(data.content)) {
    for (const item of data.content) {
      if (item.type === "video_url" && item.video_url?.url) { videoUrl = item.video_url.url; break; }
      if (item.type === "video_url" && typeof item.video_url === "string") { videoUrl = item.video_url; break; }
    }
  }
  videoUrl = videoUrl || data.video_url || data.result?.video_url || null;
  return { done: data.status === "succeeded", failed: data.status === "failed", videoUrl, error: data.error?.message || data.fail_message || null, rawData: data };
}

async function saveVideoToLibrary(userId, videoUrl, taskId) {
  try {
    const res = await fetch(videoUrl);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const path = `${userId}/cineai_${(taskId || "").slice(-8)}_${Date.now()}.mp4`;
    const { error } = await supabaseAdmin.storage.from("videos").upload(path, buffer, { contentType: "video/mp4", upsert: false });
    if (error) throw new Error(error.message);
    const { data } = supabaseAdmin.storage.from("videos").getPublicUrl(path);
    return data?.publicUrl || videoUrl;
  } catch (err) {
    console.error("[status] saveVideo failed:", err.message);
    return videoUrl;
  }
}

async function cleanupTempFiles(job) {
  const imageUrl = job?.payload?.image_url;
  if (!imageUrl) return;
  try {
    const parts = new URL(imageUrl).pathname.split("/object/public/user-uploads/");
    if (parts.length >= 2 && parts[1].startsWith("cineai/"))
      await supabaseAdmin.storage.from("user-uploads").remove([parts[1]]).catch(() => {});
  } catch {}
}

export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("content-type", "application/json; charset=utf-8");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const userId = await getUserIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

  const { taskId } = req.query;
  if (!taskId) return res.status(400).json({ ok: false, error: "taskId requerido" });

  let job = null;
  const { data: j1 } = await supabaseAdmin.from("video_jobs").select("*").eq("provider_request_id", taskId).eq("user_id", userId).eq("mode", "cineai").single();
  if (j1) job = j1;
  if (!job) {
    const { data: j2 } = await supabaseAdmin.from("video_jobs").select("*").eq("id", taskId).eq("user_id", userId).eq("mode", "cineai").single();
    if (j2) job = j2;
  }
  if (!job) return res.status(404).json({ ok: false, error: "Job no encontrado" });

  if (job.status === "COMPLETED" && job.result_url)
    return res.status(200).json({ ok: true, status: "completed", videoUrl: job.result_url, jobId: job.id });
  if (job.status === "FAILED")
    return res.status(200).json({ ok: true, status: "failed", error: job.provider_error || "Error", jobId: job.id });

  const provider     = job.provider || "byteplus_seedance";
  const providerTask = job.provider_request_id || taskId;

  let result;
  try {
    result = provider === "evolink_seedance" ? await pollEvolink(providerTask) : await pollByteplus(providerTask);
  } catch (err) {
    console.error(`[status] ${provider} error:`, err.message);
    return res.status(200).json({ ok: true, status: "processing", jobId: job.id });
  }

  let newStatus = "IN_PROGRESS", finalVideoUrl = null, errorMsg = null;

  if (result.done && result.videoUrl) {
    finalVideoUrl = await saveVideoToLibrary(userId, result.videoUrl, providerTask);
    newStatus     = "COMPLETED";
    await cleanupTempFiles(job);
  } else if (result.done && !result.videoUrl) {
    console.error("[status] done sin videoUrl. raw:", JSON.stringify(result.rawData || {}).slice(0, 600));
    newStatus = "FAILED";
    errorMsg  = "Video generado pero el proveedor no devolvió la URL";
  } else if (result.failed) {
    newStatus = "FAILED";
    errorMsg  = result.error || `Error en ${provider}`;
  }

  const upd = { status: newStatus, provider_status: result.done ? "succeeded" : result.failed ? "failed" : "running", updated_at: new Date().toISOString() };
  if (finalVideoUrl)             upd.result_url     = finalVideoUrl;
  if (errorMsg)                  upd.provider_error = errorMsg;
  if (newStatus === "COMPLETED") upd.completed_at   = new Date().toISOString();
  await supabaseAdmin.from("video_jobs").update(upd).eq("id", job.id);

  return res.status(200).json({
    ok: true,
    status:   newStatus === "COMPLETED" ? "completed" : newStatus === "FAILED" ? "failed" : "processing",
    videoUrl: finalVideoUrl || null,
    error:    errorMsg      || null,
    jobId:    job.id,
  });
}

export const config = { runtime: "nodejs" };
