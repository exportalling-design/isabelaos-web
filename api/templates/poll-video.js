// api/templates/poll-video.js
// Polling EvoLink → cuando completa descarga video → sube a Supabase Storage
// → guarda video_url en video_jobs → frontend lo muestra
// Mismo patrón que video-status.js para garantizar que el video llega al frontend
import { supabaseAdmin }          from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

const EVOLINK_API_KEY = process.env.EVOLINK_API_KEY;
const VIDEO_BUCKET    = "videos";

// Descarga video desde URL externa → buffer
async function fetchToBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// Sube buffer a Supabase Storage → retorna URL pública permanente
async function uploadToStorage(buf, userId, jobId) {
  const filePath = `${userId}/template_${jobId}_${Date.now()}.mp4`;
  const { error } = await supabaseAdmin.storage
    .from(VIDEO_BUCKET)
    .upload(filePath, buf, { contentType: "video/mp4", upsert: true });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  const { data } = supabaseAdmin.storage.from(VIDEO_BUCKET).getPublicUrl(filePath);
  if (!data?.publicUrl) throw new Error("No public URL returned");
  return data.publicUrl;
}

// Extrae video URL de la respuesta de EvoLink
// EvoLink devuelve results como array de strings directos: ["https://files.evolink.ai/...mp4"]
function extractEvoLinkVideoUrl(data) {
  // results es array de strings — el primero es la URL del video
  if (Array.isArray(data?.results) && data.results.length > 0) {
    const first = data.results[0];
    if (typeof first === "string" && first.startsWith("http")) return first;
    if (typeof first === "object") return first?.url || first?.video_url || null;
  }
  return (
    data?.result?.url              ||
    data?.result?.video_url        ||
    data?.output?.video_url        ||
    data?.video_url                ||
    null
  );
}

export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("content-type", "application/json; charset=utf-8");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const userId = await getUserIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

  const body   = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  const { taskId } = body;
  if (!taskId) return res.status(400).json({ ok: false, error: "Missing taskId" });

  try {
    // ── 1. Buscar el job en Supabase ────────────────────────────
    const { data: job } = await supabaseAdmin
      .from("video_jobs")
      .select("id, user_id, status, video_url, provider_request_id")
      .eq("provider_request_id", taskId)
      .eq("user_id", userId)
      .single();

    // Si ya tiene video guardado — devolver directo sin llamar a EvoLink
    if (job?.video_url) {
      console.log(`[poll-video] already done — returning cached video_url`);
      return res.status(200).json({ ok: true, status: "completed", videoUrl: job.video_url });
    }

    const jobId = job?.id || taskId;

    // ── 2. Consultar EvoLink ────────────────────────────────────
    const evolinkRes = await fetch(`https://api.evolink.ai/v1/tasks/${taskId}`, {
      headers: { "Authorization": `Bearer ${EVOLINK_API_KEY}` },
    });

    const data = await evolinkRes.json();
    const status = data.status || "pending";
    console.log(`[poll-video] EvoLink taskId=${taskId} status=${status} progress=${data.progress}`);

    // Si EvoLink devuelve error HTTP
    if (!evolinkRes.ok) {
      console.error(`[poll-video] EvoLink HTTP error ${evolinkRes.status}:`, JSON.stringify(data).slice(0, 300));
      return res.status(200).json({ ok: true, status: "processing" }); // retry
    }

    // ── 3. Si falló ─────────────────────────────────────────────
    if (status === "failed" || status === "error") {
      const errMsg = data.error?.message || data.message || "EvoLink generation failed";
      console.error(`[poll-video] EvoLink FAILED:`, errMsg);
      await supabaseAdmin
        .from("video_jobs")
        .update({ status: "FAILED", provider_status: "failed", error: errMsg })
        .eq("provider_request_id", taskId);
      return res.status(200).json({ ok: true, status: "failed", error: errMsg });
    }

    // ── 4. Si todavía procesando ────────────────────────────────
    if (status !== "completed" && status !== "succeed") {
      return res.status(200).json({ ok: true, status: "processing", progress: data.progress || 0 });
    }

    // ── 5. Completado — extraer URL del video ───────────────────
    const evolinkVideoUrl = extractEvoLinkVideoUrl(data);
    console.log(`[poll-video] evolinkVideoUrl=${evolinkVideoUrl}`);

    if (!evolinkVideoUrl) {
      // Log completo para debuggear la estructura de respuesta
      console.error(`[poll-video] NO VIDEO URL found in response:`, JSON.stringify(data));
      return res.status(200).json({ ok: true, status: "processing" }); // retry
    }

    // ── 6. Descargar video → subir a Supabase Storage ──────────
    // Las URLs de EvoLink expiran en 24h — necesitamos guardarlas en nuestro Storage
    console.log(`[poll-video] Downloading video from EvoLink...`);
    const videoBuf    = await fetchToBuffer(evolinkVideoUrl);
    const permanentUrl = await uploadToStorage(videoBuf, userId, jobId);
    console.log(`[poll-video] Saved to Storage: ${permanentUrl.slice(0, 60)}`);

    // ── 7. Guardar en video_jobs ────────────────────────────────
    await supabaseAdmin
      .from("video_jobs")
      .update({
        status:          "DONE",
        provider_status: "completed",
        video_url:       permanentUrl,
        result_url:      evolinkVideoUrl,
        output_url:      permanentUrl,
      })
      .eq("provider_request_id", taskId);

    return res.status(200).json({ ok: true, status: "completed", videoUrl: permanentUrl });

  } catch (err) {
    console.error("[poll-video] error:", err.message);
    return res.status(500).json({ ok: false, error: "Error polling video status" });
  }
}

export const config = { runtime: "nodejs" };
