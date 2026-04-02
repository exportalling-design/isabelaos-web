// api/cineai/status/[taskId].js
// ─────────────────────────────────────────────────────────────
// Polling del estado de un job de CineAI en PiAPI.
//
// FIX: PiAPI devuelve la URL en output.video (no output.video_url)
// Se revisan todos los campos posibles para no perder el video.
//
// Al completar:
//   - Guarda result_url en video_jobs → aparece en biblioteca
//   - Devuelve videoUrl al frontend
// ─────────────────────────────────────────────────────────────
import { supabaseAdmin }           from "../../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader }  from "../../../src/lib/getUserIdFromAuth.js";

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

// Extrae la URL del video del output de PiAPI
// PiAPI puede devolver la URL en distintos campos según la versión
function extractVideoUrl(output) {
  if (!output) return null;
  return (
    output.video        ||  // ← campo real según Task Detail de PiAPI
    output.video_url    ||
    output.url          ||
    output.videoUrl     ||
    (Array.isArray(output) ? output[0]?.url : null) ||
    output[0]?.video    ||
    null
  );
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
    // No fallar — devolver processing para que el frontend siga intentando
    return res.status(200).json({
      ok:     true,
      status: "processing",
      jobId:  job.id,
    });
  }

  console.error("[cineai/status] PiAPI response:", JSON.stringify({
    taskId,
    status: taskData?.status,
    output: taskData?.output,
  }));

  // ── Mapear status ─────────────────────────────────────────
  const providerStatus = taskData?.status;
  let newStatus = "IN_PROGRESS";
  let videoUrl  = null;
  let errorMsg  = null;

  if (providerStatus === "completed") {
    newStatus = "COMPLETED";
    videoUrl  = extractVideoUrl(taskData?.output);

    if (!videoUrl) {
      // Si no hay URL a pesar de completed, loguear todo el output para debug
      console.error("[cineai/status] completed but no videoUrl. Full output:", JSON.stringify(taskData?.output));
    }
  } else if (providerStatus === "failed" || providerStatus === "error") {
    newStatus = "FAILED";
    errorMsg  = taskData?.error?.message || taskData?.meta?.error || "Error en PiAPI";
  } else if (providerStatus === "processing" || providerStatus === "running") {
    newStatus = "IN_PROGRESS";
  }

  // ── Actualizar video_jobs ─────────────────────────────────
  const updateData = {
    status:          newStatus,
    provider_status: providerStatus || "unknown",
    updated_at:      new Date().toISOString(),
  };

  if (videoUrl)  updateData.result_url     = videoUrl;
  if (errorMsg)  updateData.provider_error = errorMsg;
  if (newStatus === "COMPLETED") updateData.completed_at = new Date().toISOString();

  const { error: updErr } = await supabaseAdmin
    .from("video_jobs")
    .update(updateData)
    .eq("id", job.id);

  if (updErr) {
    console.error("[cineai/status] video_jobs update failed:", updErr.message);
  }

  return res.status(200).json({
    ok:       true,
    status:   newStatus === "COMPLETED" ? "completed"
            : newStatus === "FAILED"    ? "failed"
            : "processing",
    videoUrl: videoUrl || null,
    error:    errorMsg || null,
    jobId:    job.id,
  });
}

export const config = { runtime: "nodejs" };
