// api/cineai/status/[taskId].js
// ─────────────────────────────────────────────────────────────
// Polling del estado de un job de CineAI en PiAPI.
//
// Cuando el job completa:
//   1. Extrae la URL del video de PiAPI (output.video)
//   2. Descarga el video como buffer
//   3. Lo sube al bucket "videos" del usuario en Supabase Storage
//      → así aparece automáticamente en la biblioteca
//   4. Actualiza video_jobs con result_url
//   5. Borra la foto temporal de cineai/faces del bucket user-uploads
//      para no llenar el disco
//
// La biblioteca (LibraryView) lee del bucket "videos" via
// listUserVideosFromStorage() en src/lib/generations.ts
// ─────────────────────────────────────────────────────────────
import { supabaseAdmin }          from "../../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../../src/lib/getUserIdFromAuth.js";

// ── Consulta el estado del job en PiAPI ──────────────────────
async function fetchFromPiAPI(taskId) {
  const res = await fetch(`https://api.piapi.ai/api/v1/task/${taskId}`, {
    headers: { "x-api-key": process.env.PIAPI_KEY },
  });
  const data = await res.json();
  if (!res.ok || data.code !== 200) {
    throw new Error(`PiAPI status error: ${data.message || res.status}`);
  }
  return data.data;
}

// ── Extrae la URL del video del output de PiAPI ───────────────
// PiAPI devuelve la URL en output.video según Task Detail
function extractVideoUrl(output) {
  if (!output) return null;
  return (
    output.video     ||
    output.video_url ||
    output.url       ||
    output.videoUrl  ||
    (Array.isArray(output) ? output[0]?.url || output[0]?.video : null) ||
    null
  );
}

// ── Descarga el video de PiAPI y lo sube al bucket "videos" ──
// Esto hace que aparezca en la biblioteca del usuario
async function saveVideoToLibrary(userId, piApiVideoUrl, taskId) {
  try {
    // 1. Descargar el video desde PiAPI como buffer
    const videoRes = await fetch(piApiVideoUrl);
    if (!videoRes.ok) {
      throw new Error(`No se pudo descargar el video: ${videoRes.status}`);
    }

    const arrayBuffer = await videoRes.arrayBuffer();
    const buffer      = Buffer.from(arrayBuffer);

    // 2. Nombre del archivo: cineai_taskId_timestamp.mp4
    const filename = `cineai_${taskId.slice(0, 8)}_${Date.now()}.mp4`;
    const path     = `${userId}/${filename}`;

    // 3. Subir al bucket "videos" del usuario
    // Este es el bucket que lee la biblioteca (listUserVideosFromStorage)
    const { error: uploadErr } = await supabaseAdmin.storage
      .from("videos")
      .upload(path, buffer, {
        contentType: "video/mp4",
        upsert:      false,
      });

    if (uploadErr) {
      throw new Error(`Error subiendo al bucket videos: ${uploadErr.message}`);
    }

    // 4. Obtener URL pública del video en Storage
    const { data: pubData } = supabaseAdmin.storage
      .from("videos")
      .getPublicUrl(path);

    console.error("[cineai/status] video saved to library:", path);
    return pubData?.publicUrl || piApiVideoUrl;

  } catch (err) {
    // Si falla la subida a Storage, devolver la URL de PiAPI como fallback
    // El video se puede ver pero no aparecerá en la biblioteca
    console.error("[cineai/status] saveVideoToLibrary failed:", err.message);
    return piApiVideoUrl;
  }
}

// ── Borra archivos temporales de cineai/faces ─────────────────
// Las fotos que sube el usuario para que el modelo las use
// se deben borrar después para no llenar el disco
async function cleanupTempFiles(job) {
  const payload = job?.payload || {};
  const imageUrl = payload.image_url;

  if (!imageUrl) return;

  try {
    // Extraer el path del archivo desde la URL pública de Supabase Storage
    // URL format: https://xxx.supabase.co/storage/v1/object/public/user-uploads/cineai/faces/xxx.jpg
    const urlObj = new URL(imageUrl);
    const pathParts = urlObj.pathname.split("/object/public/user-uploads/");
    if (pathParts.length < 2) return;

    const filePath = pathParts[1]; // "cineai/faces/xxx.jpg"

    // Solo borrar archivos de cineai/faces y cineai/refs, no otras carpetas
    if (!filePath.startsWith("cineai/faces/") && !filePath.startsWith("cineai/refs/")) return;

    const { error } = await supabaseAdmin.storage
      .from("user-uploads")
      .remove([filePath]);

    if (error) {
      console.error("[cineai/status] cleanup error:", error.message);
    } else {
      console.error("[cineai/status] cleaned up temp file:", filePath);
    }
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

  // ── Consultar PiAPI ───────────────────────────────────────
  let taskData;
  try {
    taskData = await fetchFromPiAPI(taskId);
  } catch (err) {
    console.error("[cineai/status] PiAPI poll error:", err.message);
    // Devolver processing para que el frontend siga intentando
    return res.status(200).json({
      ok:     true,
      status: "processing",
      jobId:  job.id,
    });
  }

  console.error("[cineai/status] PiAPI status:", taskData?.status, "output:", JSON.stringify(taskData?.output));

  // ── Mapear status ─────────────────────────────────────────
  const providerStatus = taskData?.status;
  let newStatus = "IN_PROGRESS";
  let finalVideoUrl = null;
  let errorMsg = null;

  if (providerStatus === "completed") {
    const piApiVideoUrl = extractVideoUrl(taskData?.output);

    if (piApiVideoUrl) {
      // Descargar y subir al bucket "videos" para que aparezca en biblioteca
      finalVideoUrl = await saveVideoToLibrary(userId, piApiVideoUrl, taskId);
      newStatus = "COMPLETED";

      // Borrar archivos temporales (fotos del usuario)
      await cleanupTempFiles(job);

    } else {
      // Completed pero sin URL — tratar como fallido
      console.error("[cineai/status] completed but no videoUrl. Full output:", JSON.stringify(taskData?.output));
      newStatus = "FAILED";
      errorMsg  = "El video se generó pero PiAPI no devolvió la URL";
    }

  } else if (providerStatus === "failed" || providerStatus === "error") {
    newStatus = "FAILED";
    errorMsg  = taskData?.error?.message || taskData?.meta?.error || "Error en PiAPI";

  } else {
    // pending, processing, running, queued → seguir esperando
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

  return res.status(200).json({
    ok:       true,
    status:   newStatus === "COMPLETED" ? "completed"
            : newStatus === "FAILED"    ? "failed"
            : "processing",
    videoUrl: finalVideoUrl || null,
    error:    errorMsg || null,
    jobId:    job.id,
  });
}

export const config = { runtime: "nodejs" };
