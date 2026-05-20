// api/cineai/poll.js
// GET /api/cineai/poll?taskId=xxx
// ─────────────────────────────────────────────────────────────
// DOS proveedores únicamente:
//   evolink_seedance  → con foto de persona (EvoLink)
//   byteplus_seedance → sin foto, IA pura (BytePlus)
//
// Sin fal.ai. Sin PiAPI. Solo EvoLink y BytePlus.
// ─────────────────────────────────────────────────────────────
import { supabaseAdmin }          from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

// ── EvoLink polling ───────────────────────────────────────────
async function pollEvolink(taskId) {
  const r = await fetch(`https://api.evolink.ai/v1/videos/generations/${taskId}`, {
    headers: { "Authorization": `Bearer ${process.env.EVOLINK_API_KEY}` },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.message || `EvoLink error ${r.status}`);

  // EvoLink status: "pending" | "processing" | "succeeded" | "failed"
  const status   = data.status;
  const videoUrl = data.video_url || data.output?.video_url || data.url || null;
  const error    = data.error?.message || data.error || null;

  console.error(`[poll] EvoLink status:${status} video:${videoUrl ? "yes" : "no"} id:${taskId}`);

  return {
    done:   status === "succeeded",
    failed: status === "failed",
    videoUrl,
    error,
  };
}

// ── BytePlus polling ──────────────────────────────────────────
async function pollByteplus(taskId) {
  const r = await fetch(
    `https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks/${taskId}`,
    { headers: { "Authorization": `Bearer ${process.env.BYTEPLUS_API_KEY}` } }
  );
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error?.message || `BytePlus error ${r.status}`);

  // BytePlus status: "running" | "succeeded" | "failed"
  const status = data.status;

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

  console.error(`[poll] BytePlus status:${status} video:${videoUrl ? "yes" : "no"} id:${taskId}`);

  return {
    done:   status === "succeeded",
    failed: status === "failed",
    videoUrl,
    error:  data.error?.message || data.fail_message || null,
  };
}

// ── Guardar video en Supabase Storage (permanente) ────────────
async function saveVideo(userId, videoUrl, taskId) {
  try {
    const res = await fetch(videoUrl);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const path   = `${userId}/cineai_${(taskId || "").slice(0, 8)}_${Date.now()}.mp4`;
    const { error } = await supabaseAdmin.storage
      .from("videos")
      .upload(path, buffer, { contentType: "video/mp4", upsert: false });
    if (error) throw new Error(error.message);
    const { data } = supabaseAdmin.storage.from("videos").getPublicUrl(path);
    console.error("[poll] video saved:", path);
    return data?.publicUrl || videoUrl;
  } catch (err) {
    console.error("[poll] saveVideo failed:", err.message);
    return videoUrl; // fallback: URL original (expira pero el usuario la ve ahora)
  }
}

// ── Limpiar archivos temporales ───────────────────────────────
async function cleanup(job) {
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

  const taskId = req.query.taskId;
  if (!taskId) return res.status(400).json({ ok: false, error: "taskId requerido" });

  // ── Buscar job ────────────────────────────────────────────
  let job = null;

  // 1. Por provider_request_id (taskId real del proveedor)
  const { data: j1 } = await supabaseAdmin
    .from("video_jobs").select("*")
    .eq("provider_request_id", taskId)
    .eq("user_id", userId).eq("mode", "cineai").single();
  if (j1) job = j1;

  // 2. Por id del job (jobId como fallback)
  if (!job) {
    const { data: j2 } = await supabaseAdmin
      .from("video_jobs").select("*")
      .eq("id", taskId)
      .eq("user_id", userId).eq("mode", "cineai").single();
    if (j2) job = j2;
  }

  if (!job) {
    console.error("[poll] job not found:", taskId);
    return res.status(404).json({ ok: false, error: "Job no encontrado" });
  }

  // ── Resultado cacheado ────────────────────────────────────
  if (job.status === "COMPLETED" && job.result_url)
    return res.status(200).json({ ok: true, status: "completed", videoUrl: job.result_url, jobId: job.id });
  if (job.status === "FAILED")
    return res.status(200).json({ ok: true, status: "failed", error: job.provider_error || "Error", jobId: job.id });

  // ── Polling según proveedor ───────────────────────────────
  const provider     = job.provider || "byteplus_seedance";
  const providerTask = job.provider_request_id || taskId;

  let result;
  try {
    if (provider === "evolink_seedance") {
      result = await pollEvolink(providerTask);
    } else {
      // byteplus_seedance — default
      result = await pollByteplus(providerTask);
    }
  } catch (err) {
    console.error(`[poll] ${provider} error:`, err.message);
    // No fallar — seguir intentando en el próximo poll
    return res.status(200).json({ ok: true, status: "processing", jobId: job.id });
  }

  // ── Procesar resultado ────────────────────────────────────
  let newStatus     = "IN_PROGRESS";
  let finalVideoUrl = null;
  let errorMsg      = null;

  if (result.done && result.videoUrl) {
    // Video listo — guardar permanentemente en Supabase Storage
    finalVideoUrl = await saveVideo(userId, result.videoUrl, providerTask);
    newStatus     = "COMPLETED";
    await cleanup(job);

  } else if (result.done && !result.videoUrl) {
    // El proveedor dice done pero sin URL — error
    console.error(`[poll] done=true but no videoUrl. provider:${provider} taskId:${providerTask}`);
    newStatus = "FAILED";
    errorMsg  = "Video generado pero el proveedor no devolvió la URL";

  } else if (result.failed) {
    newStatus = "FAILED";
    errorMsg  = result.error || `Error en ${provider}`;
  }
  // else: sigue procesando

  // ── Actualizar DB ─────────────────────────────────────────
  const upd = {
    status:          newStatus,
    provider_status: result.done ? "succeeded" : result.failed ? "failed" : "running",
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
