// api/cineai/status/[taskId].js
// ─────────────────────────────────────────────────────────────
// Polling del estado de un job de CineAI en BytePlus ModelArk.
//
// Proveedor: BytePlus ModelArk (API oficial de ByteDance)
// Endpoint status: GET /contents/generations/tasks/{taskId}
// Auth: Authorization: Bearer BYTEPLUS_API_KEY
//
// Estados de BytePlus:
//   "running"   → en proceso (equivale a IN_PROGRESS)
//   "succeeded" → completado con éxito
//   "failed"    → error
//
// Cuando el job completa (succeeded):
//   1. Extrae la URL del video de la respuesta de BytePlus
//      La URL está en: content[].video_url.url
//   2. Descarga el video como buffer
//   3. Lo sube al bucket "videos" de Supabase Storage
//      → así aparece automáticamente en la biblioteca
//   4. Actualiza video_jobs con result_url
//   5. Borra archivos temporales de cineai/ en user-uploads
//
// NOTA: Las URLs de BytePlus expiran en 24 horas.
//   Por eso es crítico descargar y subir a Supabase Storage inmediatamente.
// ─────────────────────────────────────────────────────────────
import { supabaseAdmin }          from "../../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../../src/lib/getUserIdFromAuth.js";

const BYTEPLUS_BASE = "https://ark.ap-southeast.bytepluses.com/api/v3";

// ── Consulta el estado del job en BytePlus ────────────────────
async function fetchFromByteplus(taskId) {
  const res = await fetch(`${BYTEPLUS_BASE}/contents/generations/tasks/${taskId}`, {
    headers: {
      "Authorization": `Bearer ${process.env.BYTEPLUS_API_KEY}`,
    },
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || data.message || `BytePlus status error ${res.status}`);
  }
  return data;
}

// ── Extrae la URL del video del response de BytePlus ──────────
// BytePlus devuelve el video en: content array, tipo "video_url"
// Estructura: { content: [ { type: "video_url", video_url: { url: "..." } } ] }
function extractVideoUrl(taskData) {
  if (!taskData) return null;

  // Buscar en el array content el elemento de tipo video_url
  if (Array.isArray(taskData.content)) {
    for (const item of taskData.content) {
      if (item.type === "video_url" && item.video_url?.url) {
        return item.video_url.url;
      }
    }
  }

  // Fallbacks por si la estructura cambia
  if (taskData.video_url) return taskData.video_url;
  if (taskData.output?.video_url) return taskData.output.video_url;
  if (taskData.output?.video) return taskData.output.video;
  if (taskData.result?.url) return taskData.result.url;

  return null;
}

// ── Descarga el video de BytePlus y lo sube al bucket "videos" ─
// CRÍTICO: las URLs de BytePlus expiran en 24 horas.
// Hay que descargar y persistir en Supabase Storage inmediatamente.
async function saveVideoToLibrary(userId, byteplusVideoUrl, taskId) {
  try {
    // 1. Descargar el video desde BytePlus como buffer
    const videoRes = await fetch(byteplusVideoUrl);
    if (!videoRes.ok) {
      throw new Error(`No se pudo descargar el video: ${videoRes.status}`);
    }

    const arrayBuffer = await videoRes.arrayBuffer();
    const buffer      = Buffer.from(arrayBuffer);

    // 2. Nombre del archivo: cineai_taskId_timestamp.mp4
    const filename = `cineai_${taskId.slice(0, 8)}_${Date.now()}.mp4`;
    const path     = `${userId}/${filename}`;

    // 3. Subir al bucket "videos" — este es el que lee la biblioteca
    const { error: uploadErr } = await supabaseAdmin.storage
      .from("videos")
      .upload(path, buffer, {
        contentType: "video/mp4",
        upsert:      false,
      });

    if (uploadErr) {
      throw new Error(`Error subiendo al bucket videos: ${uploadErr.message}`);
    }

    // 4. Obtener URL pública permanente en Supabase Storage
    const { data: pubData } = supabaseAdmin.storage
      .from("videos")
      .getPublicUrl(path);

    console.error("[cineai/status] video saved to library:", path);
    return pubData?.publicUrl || byteplusVideoUrl;

  } catch (err) {
    // Si falla la subida, devolver la URL de BytePlus como fallback
    // (expira en 24h pero el usuario puede verlo de momento)
    console.error("[cineai/status] saveVideoToLibrary failed:", err.message);
    return byteplusVideoUrl;
  }
}

// ── Borra archivos temporales de cineai/ en user-uploads ──────
async function cleanupTempFiles(job) {
  const payload  = job?.payload || {};
  const imageUrl = payload.image_url;
  if (!imageUrl) return;

  try {
    const urlObj    = new URL(imageUrl);
    const pathParts = urlObj.pathname.split("/object/public/user-uploads/");
    if (pathParts.length < 2) return;

    const filePath = pathParts[1];

    // Solo borrar archivos de carpetas temporales de cineai
    if (
      !filePath.startsWith("cineai/faces/")  &&
      !filePath.startsWith("cineai/refs/")   &&
      !filePath.startsWith("cineai/frames/") &&
      !filePath.startsWith("cineai/audio/")
    ) return;

    const { error } = await supabaseAdmin.storage
      .from("user-uploads")
      .remove([filePath]);

    if (error) console.error("[cineai/status] cleanup error:", error.message);
    else       console.error("[cineai/status] cleaned up temp file:", filePath);

  } catch (err) {
    console.error("[cineai/status] cleanup exception:", err.message);
  }
}

export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin",  "*");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("content-type",                 "application/json; charset=utf-8");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET")
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  // ── Auth ──────────────────────────────────────────────────
  const userId = await getUserIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

  const { taskId } = req.query;
  if (!taskId) return res.status(400).json({ ok: false, error: "taskId requerido" });

  // ── Buscar job en video_jobs ──────────────────────────────
  // Busca por provider_request_id = taskId, mode = "cineai"
  const { data: job, error: findErr } = await supabaseAdmin
    .from("video_jobs")
    .select("*")
    .eq("provider_request_id", taskId)
    .eq("user_id", userId)
    .eq("mode", "cineai")
    .single();

  if (findErr || !job) {
    console.error("[cineai/status] job not found:", taskId, findErr?.message);
    return res.status(404).json({ ok: false, error: "Job no encontrado" });
  }

  // ── Si ya terminó, devolver resultado cacheado ────────────
  if (job.status === "COMPLETED" && job.result_url) {
    return res.status(200).json({
      ok:       true,
      status:   "completed",
      videoUrl: job.result_url,
      jobId:    job.id,
    });
  }

  if (job.status === "FAILED") {
    return res.status(200).json({
      ok:     true,
      status: "failed",
      error:  job.provider_error || "Error desconocido",
      jobId:  job.id,
    });
  }

  // ── Consultar BytePlus ────────────────────────────────────
  let taskData;
  try {
    taskData = await fetchFromByteplus(taskId);
  } catch (err) {
    console.error("[cineai/status] BytePlus poll error:", err.message);
    // Devolver processing para que el frontend siga intentando
    return res.status(200).json({ ok: true, status: "processing", jobId: job.id });
  }

  console.error("[cineai/status] BytePlus status:", taskData?.status, "id:", taskId);

  // ── Mapear status de BytePlus a status interno ────────────
  // BytePlus usa: "running" | "succeeded" | "failed"
  const providerStatus = taskData?.status;
  let newStatus     = "IN_PROGRESS";
  let finalVideoUrl = null;
  let errorMsg      = null;

  if (providerStatus === "succeeded") {
    const byteplusVideoUrl = extractVideoUrl(taskData);

    if (byteplusVideoUrl) {
      // Descargar y subir al bucket "videos" (URL de BytePlus expira en 24h)
      finalVideoUrl = await saveVideoToLibrary(userId, byteplusVideoUrl, taskId);
      newStatus     = "COMPLETED";
      // Limpiar archivos temporales del usuario
      await cleanupTempFiles(job);
    } else {
      console.error("[cineai/status] succeeded but no videoUrl. Full response:", JSON.stringify(taskData));
      newStatus = "FAILED";
      errorMsg  = "El video se generó pero BytePlus no devolvió la URL";
    }

  } else if (providerStatus === "failed") {
    newStatus = "FAILED";
    errorMsg  = taskData?.error?.message || taskData?.fail_message || "Error en BytePlus";

  } else {
    // "running" u otro → seguir esperando
    newStatus = "IN_PROGRESS";
  }

  // ── Actualizar video_jobs ─────────────────────────────────
  const updateData = {
    status:          newStatus,
    provider_status: providerStatus || "unknown",
    updated_at:      new Date().toISOString(),
  };

  if (finalVideoUrl) updateData.result_url     = finalVideoUrl;
  if (errorMsg)      updateData.provider_error = errorMsg;
  if (newStatus === "COMPLETED") updateData.completed_at = new Date().toISOString();

  await supabaseAdmin
    .from("video_jobs")
    .update(updateData)
    .eq("id", job.id);

  // ── Responder al frontend ─────────────────────────────────
  return res.status(200).json({
    ok:       true,
    status:   newStatus === "COMPLETED" ? "completed"
            : newStatus === "FAILED"    ? "failed"
            : "processing",
    videoUrl: finalVideoUrl || null,
    error:    errorMsg      || null,
    jobId:    job.id,
  });
}

export const config = { runtime: "nodejs" };
