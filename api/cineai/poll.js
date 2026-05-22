// api/cineai/poll.js
// Copia exacta del patrón que funciona en api/templates/poll-video.js
// EvoLink docs: status = "completed" | "failed" | "pending" | "processing"
// EvoLink docs: video URL en data.results[0] (array de strings)
import { supabaseAdmin }          from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

// Descarga video desde URL EvoLink → buffer (igual que poll-video.js)
async function fetchToBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// Sube buffer a Supabase Storage → URL pública permanente (igual que poll-video.js)
async function uploadToStorage(buf, userId, jobId) {
  const filePath = `${userId}/cineai_${jobId}_${Date.now()}.mp4`;
  const { error } = await supabaseAdmin.storage
    .from("videos")
    .upload(filePath, buf, { contentType: "video/mp4", upsert: true });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  const { data } = supabaseAdmin.storage.from("videos").getPublicUrl(filePath);
  if (!data?.publicUrl) throw new Error("No public URL returned");
  return data.publicUrl;
}

// Extrae URL del video de respuesta EvoLink (igual que poll-video.js)
// EvoLink docs: results es array de strings — results[0] es la URL
function extractEvoLinkVideoUrl(data) {
  if (Array.isArray(data?.results) && data.results.length > 0) {
    const first = data.results[0];
    if (typeof first === "string" && first.startsWith("http")) return first;
    if (typeof first === "object") return first?.url || first?.video_url || null;
  }
  return data?.result?.url || data?.result?.video_url || data?.video_url || null;
}

async function cleanup(job) {
  const imageUrl = job?.payload?.image_url;
  if (!imageUrl) return;
  try {
    const parts = new URL(imageUrl).pathname.split("/object/public/user-uploads/");
    if (parts.length >= 2 && parts[1].startsWith("cineai/"))
      await supabaseAdmin.storage.from("user-uploads").remove([parts[1]]).catch(() => {});
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

  // Buscar job en DB
  let job = null;
  const { data: j1 } = await supabaseAdmin.from("video_jobs").select("*")
    .eq("provider_request_id", taskId).eq("user_id", userId).eq("mode", "cineai").single();
  if (j1) job = j1;
  if (!job) {
    const { data: j2 } = await supabaseAdmin.from("video_jobs").select("*")
      .eq("id", taskId).eq("user_id", userId).eq("mode", "cineai").single();
    if (j2) job = j2;
  }
  if (!job) return res.status(404).json({ ok: false, error: "Job no encontrado" });

  // Ya completado — devolver URL cacheada
  if (job.status === "COMPLETED" && job.result_url)
    return res.status(200).json({ ok: true, status: "completed", videoUrl: job.result_url, jobId: job.id });
  if (job.status === "FAILED")
    return res.status(200).json({ ok: true, status: "failed", error: job.provider_error || "Error", jobId: job.id });

  const providerTask = job.provider_request_id || taskId;

  // ── Consultar EvoLink (igual que poll-video.js) ─────────────
  const evolinkRes = await fetch(`https://api.evolink.ai/v1/tasks/${providerTask}`, {
    headers: { "Authorization": `Bearer ${process.env.EVOLINK_API_KEY}` },
  });

  const data = await evolinkRes.json();
  const evoStatus = data.status || "pending";
  console.error(`[poll] EvoLink taskId=${providerTask} status=${evoStatus} progress=${data.progress}`);

  if (!evolinkRes.ok) {
    console.error(`[poll] EvoLink HTTP error ${evolinkRes.status}:`, JSON.stringify(data).slice(0, 300));
    return res.status(200).json({ ok: true, status: "processing", jobId: job.id });
  }

  // Falló en EvoLink
  if (evoStatus === "failed" || evoStatus === "error") {
    const errMsg = data.error?.message || data.message || "EvoLink generation failed";
    console.error(`[poll] EvoLink FAILED:`, errMsg);
    await supabaseAdmin.from("video_jobs").update({
      status: "FAILED", provider_status: "failed",
      provider_error: errMsg, updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    return res.status(200).json({ ok: true, status: "failed", error: errMsg, jobId: job.id });
  }

  // Todavía procesando
  if (evoStatus !== "completed") {
    return res.status(200).json({ ok: true, status: "processing", progress: data.progress || 0, jobId: job.id });
  }

  // ── Completado — extraer URL (igual que poll-video.js) ──────
  const evolinkVideoUrl = extractEvoLinkVideoUrl(data);
  console.error(`[poll] evolinkVideoUrl=${evolinkVideoUrl}`);

  if (!evolinkVideoUrl) {
    console.error(`[poll] NO VIDEO URL found:`, JSON.stringify(data));
    // Retry — a veces EvoLink marca completed pero la URL tarda un tick
    return res.status(200).json({ ok: true, status: "processing", jobId: job.id });
  }

  // ── Descargar y subir a Supabase Storage (igual que poll-video.js) ──
  let permanentUrl;
  try {
    console.error(`[poll] Downloading from EvoLink...`);
    const buf = await fetchToBuffer(evolinkVideoUrl);
    permanentUrl = await uploadToStorage(buf, userId, job.id);
    console.error(`[poll] Saved to Storage: ${permanentUrl.slice(0, 60)}`);
  } catch (err) {
    console.error(`[poll] Storage upload failed, using EvoLink URL as fallback:`, err.message);
    permanentUrl = evolinkVideoUrl; // fallback a URL temporal si falla el storage
  }

  // Guardar en DB
  await supabaseAdmin.from("video_jobs").update({
    status:          "COMPLETED",
    provider_status: "completed",
    result_url:      permanentUrl,
    video_url:       permanentUrl,
    output_url:      permanentUrl,
    completed_at:    new Date().toISOString(),
    updated_at:      new Date().toISOString(),
  }).eq("id", job.id);

  await cleanup(job);

  return res.status(200).json({
    ok: true, status: "completed", videoUrl: permanentUrl, jobId: job.id,
  });
}

export const config = { runtime: "nodejs" };
