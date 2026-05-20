// api/cineai/status/[taskId].js
// GET /api/cineai/status/:taskId
// ─────────────────────────────────────────────────────────────
// Polling del estado de un job de CineAI.
// DOS proveedores:
//   evolink_seedance  → con foto (EvoLink Seedance 2.0)
//   byteplus_seedance → sin foto (BytePlus Seedance 2.0)
//
// Cuando completa:
//   1. Descarga el video del proveedor
//   2. Lo sube a Supabase Storage bucket "videos" (permanente)
//   3. Actualiza video_jobs con result_url
//   4. Borra archivos temporales de cineai/
// ─────────────────────────────────────────────────────────────
import { supabaseAdmin }          from "../../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../../src/lib/getUserIdFromAuth.js";

// ── EvoLink ───────────────────────────────────────────────────
async function fetchFromEvolink(taskId) {
  const r = await fetch(`https://api.evolink.ai/v1/videos/generations/${taskId}`, {
    headers: { "Authorization": `Bearer ${process.env.EVOLINK_API_KEY}` },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.message || `EvoLink error ${r.status}`);

  // EvoLink status: "pending" | "processing" | "succeeded" | "failed"
  const videoUrl = data.video_url || data.output?.video_url || data.url || null;
  return {
    status:   data.status,
    videoUrl,
    error:    data.error?.message || data.error || null,
  };
}

// ── BytePlus ──────────────────────────────────────────────────
async function fetchFromByteplus(taskId) {
  const r = await fetch(
    `https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks/${taskId}`,
    { headers: { "Authorization": `Bearer ${process.env.BYTEPLUS_API_KEY}` } }
  );
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error?.message || `BytePlus error ${r.status}`);

  // Extraer URL — estructura: content[].type="video_url", content[].video_url.url
  let videoUrl = null;
  if (Array.isArray(data.content)) {
    for (const item of data.content) {
      if (item.type === "video_url" && item.video_url?.url) { videoUrl = item.video_url.url; break; }
      if (item.type === "video_url" && typeof item.video_url === "string") { videoUrl = item.video_url; break; }
      if (item.url) { videoUrl = item.url; break; }
    }
  }
  videoUrl = videoUrl || data.video_url || data.result?.video_url || data.output?.video_url || null;

  return {
    status:   data.status, // "running" | "succeeded" | "failed"
    videoUrl,
    error:    data.error?.message || data.fail_message || null,
  };
}

// ── Guardar video permanentemente en Supabase Storage ─────────
async function saveVideoToLibrary(userId, videoUrl, taskId) {
  try {
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) throw new Error(`Download failed: ${videoRes.status}`);
    const buffer   = Buffer.from(await videoRes.arrayBuffer());
    const filename = `cineai_${taskId.slice(0, 8)}_${Date.now()}.mp4`;
    const path     = `${userId}/${filename}`;

    const { error: uploadErr } = await supabaseAdmin.storage
      .from("videos")
      .upload(path, buffer, { contentType: "video/mp4", upsert: false });
    if (uploadErr) throw new Error(uploadErr.message);

    const { data: pubData } = supabaseAdmin.storage.from("videos").getPublicUrl(path);
    console.error("[cineai/status] video saved:", path);
    return pubData?.publicUrl || videoUrl;
  } catch (err) {
    console.error("[cineai/status] saveVideoToLibrary failed:", err.message);
    return videoUrl; // fallback: URL del proveedor (expira en 24h)
  }
}

// ── Limpiar archivos temporales ───────────────────────────────
async function cleanupTempFiles(job) {
  const imageUrl = job?.payload?.image_url;
  if (!imageUrl) return;
  try {
    const parts = new URL(imageUrl).pathname.split("/object/public/user-uploads/");
    if (parts.length >= 2 && parts[1].startsWith("cineai/")) {
      await supabaseAdmin.storage.from("user-uploads").remove([parts[1]]).catch(() => {});
    }
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

  const { taskId } = req.query;
  if (!taskId) return res.status(400).json({ ok: false, error: "taskId requerido" });

  // ── Buscar job ────────────────────────────────────────────
  let job = null;

  const { data: j1 } = await supabaseAdmin
    .from("video_jobs").select("*")
    .eq("provider_request_id", taskId)
    .eq("user_id", userId).eq("mode", "cineai").single();
  if (j1) job = j1;

  if (!job) {
    const { data: j2 } = await supabaseAdmin
      .from("video_jobs").select("*")
      .eq("id", taskId)
      .eq("user_id", userId).eq("mode", "cineai").single();
    if (j2) job = j2;
  }

  if (!job) {
    console.error("[cineai/status] job not found:", taskId);
    return res.status(404).json({ ok: false, error: "Job no encontrado" });
  }

  // ── Resultado cacheado ────────────────────────────────────
  if (job.status === "COMPLETED" && job.result_url)
    return res.status(200).json({ ok: true, status: "completed", videoUrl: job.result_url, jobId: job.id });
  if (job.status === "FAILED")
    return res.status(200).json({ ok: true, status: "failed", error: job.provider_error || "Error", jobId: job.id });

  // ── Consultar proveedor ───────────────────────────────────
  const provider     = job.provider || "byteplus_seedance";
  const providerTask = job.provider_request_id || taskId;

  let providerData;
  try {
    if (provider === "evolink_seedance") {
      providerData = await fetchFromEvolink(providerTask);
    } else {
      providerData = await fetchFromByteplus(providerTask);
    }
  } catch (err) {
    console.error(`[cineai/status] ${provider} error:`, err.message);
    return res.status(200).json({ ok: true, status: "processing", jobId: job.id });
  }

  console.error(`[cineai/status] provider:${provider} status:${providerData.status} video:${providerData.videoUrl ? "yes" : "no"}`);

  // ── Normalizar status ─────────────────────────────────────
  // EvoLink: succeeded | failed | processing/pending
  // BytePlus: succeeded | failed | running
  const isDone   = providerData.status === "succeeded";
  const isFailed = providerData.status === "failed";

  let newStatus     = "IN_PROGRESS";
  let finalVideoUrl = null;
  let errorMsg      = null;

  if (isDone && providerData.videoUrl) {
    finalVideoUrl = await saveVideoToLibrary(userId, providerData.videoUrl, providerTask);
    newStatus     = "COMPLETED";
    await cleanupTempFiles(job);

  } else if (isDone && !providerData.videoUrl) {
    console.error(`[cineai/status] succeeded but no videoUrl. provider:${provider}`);
    newStatus = "FAILED";
    errorMsg  = "Video generado pero el proveedor no devolvió la URL";

  } else if (isFailed) {
    newStatus = "FAILED";
    errorMsg  = providerData.error || `Error en ${provider}`;
  }

  // ── Actualizar DB ─────────────────────────────────────────
  const upd = {
    status:          newStatus,
    provider_status: providerData.status,
    updated_at:      new Date().toISOString(),
  };
  if (finalVideoUrl)             upd.result_url     = finalVideoUrl;
  if (errorMsg)                  upd.provider_error = errorMsg;
  if (newStatus === "COMPLETED") upd.completed_at   = new Date().toISOString();

  await supabaseAdmin.from("video_jobs").update(upd).eq("id", job.id);

  return res.status(200).json({
    ok:       true,
    status:   newStatus === "COMPLETED" ? "completed" : newStatus === "FAILED" ? "failed" : "processing",
    videoUrl: finalVideoUrl || null,
    error:    errorMsg      || null,
    jobId:    job.id,
  });
}

export const config = { runtime: "nodejs" };
