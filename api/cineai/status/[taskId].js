// ─────────────────────────────────────────────────────────────────────────────
// api/cineai/status/[taskId].js
// GET /api/cineai/status/:taskId
//
// Consulta el estado de un job de generación de video.
// El frontend hace polling cada 4 segundos hasta que el status sea
// "completed" o "failed".
//
// Cuando fal.ai lance Seedance 2.0, solo cambia fetchStatus() aquí.
// El frontend y la tabla de Supabase no necesitan cambios.
// ─────────────────────────────────────────────────────────────────────────────

import { requireUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const PIAPI_KEY = process.env.PIAPI_KEY;

// ── Consulta el estado del job en PiAPI ──────────────────────────────────────
async function fetchStatusFromPiAPI(taskId) {
  const res = await fetch(`https://api.piapi.ai/api/v1/task/${taskId}`, {
    headers: { "x-api-key": PIAPI_KEY },
  });
  const data = await res.json();
  if (!res.ok || data.code !== 200) {
    throw new Error("PiAPI status fetch error");
  }
  return data.data;
}

// ── Swap futuro: cuando fal.ai lance Seedance 2.0 ────────────────────────────
// async function fetchStatusFromFalAI(taskId) {
//   const res = await fetch(`https://fal.ai/api/queue/requests/${taskId}/status`, {
//     headers: { "Authorization": `Key ${process.env.FAL_KEY}` },
//   });
//   const data = await res.json();
//   return data;
// }

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  // ── Auth ─────────────────────────────────────────────────────────────────
  let user;
  try {
    user = await requireUser(req);
  } catch {
    return res.status(401).json({ error: "No autorizado" });
  }

  const { taskId } = req.query;
  if (!taskId) return res.status(400).json({ error: "taskId requerido" });

  const sb = getSupabaseAdmin();

  // ── Verificar que el job pertenece al usuario ─────────────────────────────
  const { data: job } = await sb
    .from("cineai_jobs")
    .select("*")
    .eq("task_id", taskId)
    .eq("user_id", user.id)
    .single();

  if (!job) return res.status(404).json({ error: "Job no encontrado" });

  // ── Si ya está terminado, devolver resultado cacheado de Supabase ─────────
  // Evita llamadas innecesarias a PiAPI cuando el job ya terminó
  if (job.status === "completed" || job.status === "failed") {
    return res.status(200).json({
      status: job.status,
      videoUrl: job.video_url || null,
      error: job.error_message || null,
    });
  }

  // ── Consultar estado en PiAPI ─────────────────────────────────────────────
  let taskData;
  try {
    // Elegir provider según lo que se guardó en el job
    taskData = await fetchStatusFromPiAPI(taskId);
    // En el futuro: if (job.provider === "falai") taskData = await fetchStatusFromFalAI(taskId);
  } catch (err) {
    console.error("[CineAI status] Poll error:", err.message);
    return res.status(500).json({ error: "Error consultando estado" });
  }

  // ── Mapear status de PiAPI a nuestro sistema ──────────────────────────────
  const providerStatus = taskData?.status;
  let newStatus = "pending";
  let videoUrl = null;
  let errorMessage = null;

  if (providerStatus === "completed") {
    newStatus = "completed";
    // PiAPI puede devolver la URL en distintos campos según la versión
    videoUrl =
      taskData?.output?.video_url ||
      taskData?.output?.url ||
      taskData?.output?.[0]?.url ||
      null;
  } else if (providerStatus === "failed" || providerStatus === "error") {
    newStatus = "failed";
    errorMessage = taskData?.error?.message || "Error desconocido en PiAPI";
  } else if (providerStatus === "processing" || providerStatus === "running") {
    newStatus = "processing";
  }

  // ── Actualizar Supabase con el nuevo estado ───────────────────────────────
  await sb
    .from("cineai_jobs")
    .update({
      status: newStatus,
      video_url: videoUrl,
      error_message: errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq("task_id", taskId);

  return res.status(200).json({
    status: newStatus,
    videoUrl,
    error: errorMessage,
  });
}
