// api/cineai/poll.js
// GET /api/cineai/poll?taskId=xxx
// Soporta 3 proveedores: piapi_seedance | fal_seedance | byteplus_seedance
import { supabaseAdmin }          from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

const BYTEPLUS_BASE = "https://ark.ap-southeast.bytepluses.com/api/v3";

// ── PiAPI polling ─────────────────────────────────────────────
async function pollPiapi(taskId) {
  const r = await fetch(`https://api.piapi.ai/api/v1/task/${taskId}`, {
    headers: { "x-api-key": process.env.PIAPI_KEY },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.message || `PiAPI error ${r.status}`);

  const status   = data?.data?.status;
  const videoUrl = data?.data?.output?.video || data?.data?.output?.video_url || data?.data?.output?.url || null;
  const error    = data?.data?.error?.message || null;

  return {
    done:     status === "completed",
    failed:   status === "failed",
    videoUrl,
    error,
  };
}

// ── fal.ai polling ────────────────────────────────────────────
async function pollFal(requestId, endpoint) {
  const ep = endpoint || "bytedance/seedance-2.0/fast/reference-to-video";

  const r = await fetch(`https://queue.fal.run/${ep}/requests/${requestId}/status`, {
    headers: { "Authorization": `Key ${process.env.FAL_KEY}` },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.detail || `fal.ai status error ${r.status}`);

  const status = data.status;

  if (status === "COMPLETED") {
    const rr = await fetch(`https://queue.fal.run/${ep}/requests/${requestId}`, {
      headers: { "Authorization": `Key ${process.env.FAL_KEY}` },
    });
    const result = await rr.json();
    const videoUrl = result?.video?.url || result?.data?.video?.url || null;
    return { done: true, failed: false, videoUrl, error: null };
  }

  if (status === "FAILED") {
    return { done: false, failed: true, videoUrl: null, error: data?.error || "fal.ai failed" };
  }

  return { done: false, failed: false, videoUrl: null, error: null };
}

// ── BytePlus polling ──────────────────────────────────────────
async function pollByteplus(taskId) {
  const r = await fetch(`${BYTEPLUS_BASE}/contents/generations/tasks/${taskId}`, {
    headers: { "Authorization": `Bearer ${process.env.BYTEPLUS_API_KEY}` },
  });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error?.message || `BytePlus error ${r.status}`);

  const status   = data.status;
  const videoUrl = data.content?.video_url || null;

  return {
    done:     status === "succeeded",
    failed:   status === "failed",
    videoUrl,
    error:    data.error?.message || data.fail_message || null,
  };
}

// ── Guardar video en Supabase Storage ────────────────────────
async function saveVideoToLibrary(userId, videoUrl, taskId) {
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
    console.error("[cineai/poll] saved:", path);
    return data?.publicUrl || videoUrl;
  } catch (err) {
    console.error("[cineai/poll] saveVideoToLibrary failed:", err.message);
    return videoUrl;
  }
}

// ── Limpiar archivos temporales ───────────────────────────────
async function cleanupTempFiles(job) {
  const toDelete = [];
  const imageUrl = job?.payload?.image_url;
  if (imageUrl) {
    try {
      const parts = new URL(imageUrl).pathname.split("/object/public/user-uploads/");
      if (parts.length >= 2 && parts[1].startsWith("cineai/")) toDelete.push(parts[1]);
    } catch {}
  }
  if (toDelete.length) {
    await supabaseAdmin.storage.from("user-uploads").remove(toDelete).catch(() => {});
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

  const userId = await getUserIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

  const taskId = req.query.taskId;
  if (!taskId) return res.status(400).json({ ok: false, error: "taskId requerido" });

  // ── Buscar job ────────────────────────────────────────────
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

  // ── Resultado cacheado ────────────────────────────────────
  if (job.status === "COMPLETED" && job.result_url)
    return res.status(200).json({ ok: true, status: "completed", videoUrl: job.result_url, jobId: job.id });
  if (job.status === "FAILED")
    return res.status(200).json({ ok: true, status: "failed", error: job.provider_error || "Error", jobId: job.id });

  // ── Detectar proveedor ────────────────────────────────────
  const provider = job.provider || "byteplus_seedance";

  // ── Polling ───────────────────────────────────────────────
  let pollResult;
  try {
    if (provider === "piapi_seedance") {
      pollResult = await pollPiapi(taskId);
    } else if (provider === "fal_seedance") {
      const falEndpoint = job.payload?.fal_endpoint || "bytedance/seedance-2.0/fast/reference-to-video";
      pollResult = await pollFal(taskId, falEndpoint);
    } else {
      pollResult = await pollByteplus(taskId);
    }
  } catch (err) {
    console.error(`[cineai/poll] ${provider} error:`, err.message);
    return res.status(200).json({ ok: true, status: "processing", jobId: job.id });
  }

  console.error(`[cineai/poll] ${provider} done:${pollResult.done} failed:${pollResult.failed} taskId:${taskId}`);

  // ── Procesar resultado ────────────────────────────────────
  let newStatus     = "IN_PROGRESS";
  let finalVideoUrl = null;
  let errorMsg      = null;

  if (pollResult.done && pollResult.videoUrl) {
    let rawVideoUrl    = pollResult.videoUrl;
    const pendingAudio = job?.payload?.audio_url;
    const jobMode      = job?.payload?.cineai_mode;

    // Si era lipsync con audio → sync-lipsync para sincronización perfecta de labios
    if (pendingAudio && jobMode === "lipsync") {
      try {
        console.error("[cineai/poll] aplicando lipsync con sync-lipsync...");

        // PASO 1: enviar a fal-ai/sync-lipsync (async)
        const syncRes = await fetch("https://fal.run/fal-ai/sync-lipsync", {
          method:  "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Key ${process.env.FAL_KEY}` },
          body: JSON.stringify({
            video_url: rawVideoUrl,
            audio_url: pendingAudio,
            sync_mode: "loop", // si audio > video, repite el video
          }),
        });
        const syncData = await syncRes.json();

        // sync-lipsync puede devolver request_id (async) o video directo
        const requestId = syncData?.request_id || syncData?.requestId;
        const directUrl = syncData?.video?.url || syncData?.data?.video?.url;

        if (directUrl) {
          rawVideoUrl = directUrl;
          console.error("[cineai/poll] lipsync OK directo");
        } else if (requestId) {
          // Polling del lipsync
          const deadline = Date.now() + 3 * 60 * 1000;
          while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 5000));
            const sr = await fetch(`https://queue.fal.run/fal-ai/sync-lipsync/requests/${requestId}`, {
              headers: { "Authorization": `Key ${process.env.FAL_KEY}` },
            });
            const sd = await sr.json();
            if (sd.status === "COMPLETED") {
              const syncedUrl = sd?.output?.video?.url || sd?.video?.url || null;
              if (syncedUrl) { rawVideoUrl = syncedUrl; console.error("[cineai/poll] lipsync OK"); }
              break;
            }
            if (sd.status === "FAILED") { console.error("[cineai/poll] lipsync falló, usando video mudo"); break; }
          }
        } else {
          console.error("[cineai/poll] sync-lipsync sin URL:", JSON.stringify(syncData));
        }
      } catch (e) {
        console.error("[cineai/poll] lipsync falló, video mudo:", e.message);
      }
    }

    finalVideoUrl = await saveVideoToLibrary(userId, rawVideoUrl, taskId);
    newStatus     = "COMPLETED";
    await cleanupTempFiles(job);
  } else if (pollResult.done && !pollResult.videoUrl) {
    newStatus = "FAILED";
    errorMsg  = "Video generado pero el proveedor no devolvió la URL";
  } else if (pollResult.failed) {
    newStatus = "FAILED";
    errorMsg  = pollResult.error || "Error en el proveedor";
  }

  // ── Actualizar video_jobs ─────────────────────────────────
  const update = {
    status:          newStatus,
    provider_status: pollResult.done ? "succeeded" : pollResult.failed ? "failed" : "running",
    updated_at:      new Date().toISOString(),
  };
  if (finalVideoUrl) update.result_url     = finalVideoUrl;
  if (errorMsg)      update.provider_error = errorMsg;
  if (newStatus === "COMPLETED") update.completed_at = new Date().toISOString();

  await supabaseAdmin.from("video_jobs").update(update).eq("id", job.id);

  return res.status(200).json({
    ok:       true,
    status:   newStatus === "COMPLETED" ? "completed" : newStatus === "FAILED" ? "failed" : "processing",
    videoUrl: finalVideoUrl || null,
    error:    errorMsg      || null,
    jobId:    job.id,
  });
}

export const config = { runtime: "nodejs" };
