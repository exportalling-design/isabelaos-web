// api/cineai/poll.js
// ─────────────────────────────────────────────────────────────
// Polling del estado de un job de CineAI en BytePlus ModelArk.
// Sin ruta dinámica — recibe taskId como query param:
//   GET /api/cineai/poll?taskId=cgt-xxx
// Esto evita el problema de Vercel con rutas dinámicas [taskId]
// cuando hay un rewrite catch-all en vercel.json.
// ─────────────────────────────────────────────────────────────
import { supabaseAdmin }          from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

const BYTEPLUS_BASE = "https://ark.ap-southeast.bytepluses.com/api/v3";

async function fetchFromByteplus(taskId) {
  const res = await fetch(`${BYTEPLUS_BASE}/contents/generations/tasks/${taskId}`, {
    headers: { "Authorization": `Bearer ${process.env.BYTEPLUS_API_KEY}` },
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || data.message || `BytePlus error ${res.status}`);
  }
  return data;
}

function extractVideoUrl(taskData) {
  if (!taskData) return null;
  if (Array.isArray(taskData.content)) {
    for (const item of taskData.content) {
      if (item.type === "video_url" && item.video_url?.url) return item.video_url.url;
    }
  }
  return taskData.video_url || taskData.output?.video_url || taskData.output?.video || taskData.result?.url || null;
}

async function saveVideoToLibrary(userId, videoUrl, taskId) {
  try {
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) throw new Error(`Download failed: ${videoRes.status}`);
    const buffer = Buffer.from(await videoRes.arrayBuffer());
    const path   = `${userId}/cineai_${taskId.slice(0, 8)}_${Date.now()}.mp4`;
    const { error: uploadErr } = await supabaseAdmin.storage
      .from("videos").upload(path, buffer, { contentType: "video/mp4", upsert: false });
    if (uploadErr) throw new Error(uploadErr.message);
    const { data: pubData } = supabaseAdmin.storage.from("videos").getPublicUrl(path);
    console.error("[cineai/poll] saved:", path);
    return pubData?.publicUrl || videoUrl;
  } catch (err) {
    console.error("[cineai/poll] saveVideoToLibrary failed:", err.message);
    return videoUrl;
  }
}

async function cleanupTempFiles(job) {
  const imageUrl = job?.payload?.image_url;
  if (!imageUrl) return;
  try {
    const pathParts = new URL(imageUrl).pathname.split("/object/public/user-uploads/");
    if (pathParts.length < 2) return;
    const filePath = pathParts[1];
    if (!filePath.startsWith("cineai/")) return;
    await supabaseAdmin.storage.from("user-uploads").remove([filePath]);
  } catch {}
}

export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin",  "*");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("content-type",                 "application/json; charset=utf-8");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET")
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const userId = await getUserIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

  // taskId viene como query param: /api/cineai/poll?taskId=cgt-xxx
  const taskId = req.query.taskId;
  if (!taskId) return res.status(400).json({ ok: false, error: "taskId requerido" });

  // Buscar job en video_jobs
  const { data: job, error: findErr } = await supabaseAdmin
    .from("video_jobs")
    .select("*")
    .eq("provider_request_id", taskId)
    .eq("user_id", userId)
    .eq("mode", "cineai")
    .single();

  if (findErr || !job) {
    console.error("[cineai/poll] job not found:", taskId, findErr?.message);
    return res.status(404).json({ ok: false, error: "Job no encontrado" });
  }

  // Si ya terminó, devolver resultado cacheado
  if (job.status === "COMPLETED" && job.result_url) {
    return res.status(200).json({ ok: true, status: "completed", videoUrl: job.result_url, jobId: job.id });
  }
  if (job.status === "FAILED") {
    return res.status(200).json({ ok: true, status: "failed", error: job.provider_error || "Error", jobId: job.id });
  }

  // Consultar BytePlus
  let taskData;
  try {
    taskData = await fetchFromByteplus(taskId);
  } catch (err) {
    console.error("[cineai/poll] BytePlus error:", err.message);
    return res.status(200).json({ ok: true, status: "processing", jobId: job.id });
  }

  console.error("[cineai/poll] BytePlus status:", taskData?.status, taskId);

  const providerStatus = taskData?.status;
  let newStatus     = "IN_PROGRESS";
  let finalVideoUrl = null;
  let errorMsg      = null;

  if (providerStatus === "succeeded") {
    const raw = extractVideoUrl(taskData);
    if (raw) {
      finalVideoUrl = await saveVideoToLibrary(userId, raw, taskId);
      newStatus     = "COMPLETED";
      await cleanupTempFiles(job);
    } else {
      console.error("[cineai/poll] succeeded but no URL:", JSON.stringify(taskData));
      newStatus = "FAILED";
      errorMsg  = "Video generado pero BytePlus no devolvió la URL";
    }
  } else if (providerStatus === "failed") {
    newStatus = "FAILED";
    errorMsg  = taskData?.error?.message || taskData?.fail_message || "Error en BytePlus";
  }

  const updateData = {
    status:          newStatus,
    provider_status: providerStatus || "unknown",
    updated_at:      new Date().toISOString(),
  };
  if (finalVideoUrl) updateData.result_url     = finalVideoUrl;
  if (errorMsg)      updateData.provider_error = errorMsg;
  if (newStatus === "COMPLETED") updateData.completed_at = new Date().toISOString();

  await supabaseAdmin.from("video_jobs").update(updateData).eq("id", job.id);

  return res.status(200).json({
    ok:       true,
    status:   newStatus === "COMPLETED" ? "completed" : newStatus === "FAILED" ? "failed" : "processing",
    videoUrl: finalVideoUrl || null,
    error:    errorMsg      || null,
    jobId:    job.id,
  });
}

export const config = { runtime: "nodejs" };
