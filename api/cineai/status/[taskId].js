// api/cineai/status/[taskId].js
// ─────────────────────────────────────────────────────────────
// Polling del estado de un job de CineAI en PiAPI.
// El frontend llama cada 4s hasta que status = completed | failed.
// Al completar guarda la video_url en video_jobs para que
// aparezca en la biblioteca igual que los demás videos.
//
// Cuando fal.ai lance Seedance 2.0, solo cambia fetchFromPiAPI()
// por fetchFromFalAI() aquí. El frontend no necesita cambios.
// ─────────────────────────────────────────────────────────────
import { supabaseAdmin }           from "../../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader }  from "../../../src/lib/getUserIdFromAuth.js";

// ── Consulta el estado del job en PiAPI ──────────────────────
async function fetchFromPiAPI(taskId) {
  const res = await fetch(`https://api.piapi.ai/api/v1/task/${taskId}`, {
    headers: { "x-api-key": process.env.PIAPI_KEY },
  });
  const data = await res.json();
  if (!res.ok || data.code !== 200) throw new Error("PiAPI status error");
  return data.data;
}

// ── Swap futuro a fal.ai cuando lancen Seedance 2.0 ──────────
// async function fetchFromFalAI(taskId) { ... }

export default async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────
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

  // taskId viene del path /api/cineai/status/[taskId]
  const { taskId } = req.query;
  if (!taskId) return res.status(400).json({ ok: false, error: "taskId requerido" });

  // ── Buscar job en video_jobs y verificar que pertenece al usuario ──
  const { data: job, error: findErr } = await supabaseAdmin
    .from("video_jobs")
    .select("*")
    .eq("provider_request_id", taskId)
    .eq("user_id", userId)
    .eq("mode", "cineai")
    .single();

  if (findErr || !job) {
    return res.status(404).json({ ok: false, error: "Job no encontrado" });
  }

  // ── Si ya está terminado, devolver resultado cacheado ─────
  // Evita llamadas innecesarias a PiAPI
  if (job.status === "COMPLETED") {
    return res.status(200).json({
      ok:       true,
      status:   "completed",
      videoUrl: job.result_url || null,
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

  // ── Consultar estado actual en PiAPI ─────────────────────
  let taskData;
  try {
    taskData = await fetchFromPiAPI(taskId);
    // Futuro: if (job.payload?.provider === "falai") taskData = await fetchFromFalAI(taskId);
  } catch (err) {
    console.error("[cineai/status] PiAPI poll error:", err.message);
    return res.status(500).json({ ok: false, error: "Error consultando estado" });
  }

  // ── Mapear status de PiAPI al nuestro ────────────────────
  const providerStatus = taskData?.status;
  let newStatus   = "IN_PROGRESS";
  let videoUrl    = null;
  let errorMsg    = null;

  if (providerStatus === "completed") {
    newStatus = "COMPLETED";
    // PiAPI puede devolver la URL en distintos campos
    videoUrl =
      taskData?.output?.video_url ||
      taskData?.output?.url       ||
      taskData?.output?.[0]?.url  ||
      null;
  } else if (providerStatus === "failed" || providerStatus === "error") {
    newStatus = "FAILED";
    errorMsg  = taskData?.error?.message || "Error en PiAPI";
  } else if (providerStatus === "processing" || providerStatus === "running") {
    newStatus = "IN_PROGRESS";
  }

  // ── Actualizar video_jobs con el nuevo estado ─────────────
  const updateData = {
    status:          newStatus,
    provider_status: providerStatus || "unknown",
    updated_at:      new Date().toISOString(),
  };

  if (videoUrl)  updateData.result_url      = videoUrl;
  if (errorMsg)  updateData.provider_error  = errorMsg;
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
    videoUrl,
    error:    errorMsg,
    jobId:    job.id,
  });
}

export const config = { runtime: "nodejs" };
