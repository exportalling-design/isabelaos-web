// api/free-template/poll.js
// Polling idéntico a api/templates/poll-video.js — mismo patrón probado
// EvoLink → descarga video → sube a Supabase Storage → retorna URL permanente

import { supabaseAdmin }           from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader }  from "../../src/lib/getUserIdFromAuth.js";

const EVOLINK_API_KEY = process.env.EVOLINK_API_KEY;
const VIDEO_BUCKET    = "free-videos"; // bucket separado para videos gratis

// Descarga video desde URL externa → buffer
async function fetchToBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// Sube buffer a Supabase Storage → retorna URL pública permanente
async function uploadToStorage(buf, userId, taskId) {
  const filePath = `${userId}/free_${taskId}_${Date.now()}.mp4`;
  const { error } = await supabaseAdmin.storage
    .from(VIDEO_BUCKET)
    .upload(filePath, buf, { contentType: "video/mp4", upsert: true });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  const { data } = supabaseAdmin.storage.from(VIDEO_BUCKET).getPublicUrl(filePath);
  if (!data?.publicUrl) throw new Error("No public URL returned");
  return data.publicUrl;
}

// Extrae video URL — idéntico al extractEvoLinkVideoUrl de poll-video.js
function extractEvoLinkVideoUrl(data) {
  if (Array.isArray(data?.results) && data.results.length > 0) {
    const first = data.results[0];
    if (typeof first === "string" && first.startsWith("http")) return first;
    if (typeof first === "object") return first?.url || first?.video_url || null;
  }
  return (
    data?.result?.url       ||
    data?.result?.video_url ||
    data?.output?.video_url ||
    data?.video_url         ||
    null
  );
}

export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const userId = await getUserIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  const { taskId } = body;
  if (!taskId) return res.status(400).json({ ok: false, error: "Missing taskId" });

  try {
    // ── 1. Buscar en Supabase — si ya completó, retornar directo ─────────────
    const { data: job } = await supabaseAdmin
      .from("free_video_uses")
      .select("status, video_url")
      .eq("task_id", taskId)
      .eq("user_id", userId)
      .maybeSingle();

    if (job?.status === "completed" && job?.video_url) {
      console.log("[free-poll] already done — returning cached video_url");
      return res.status(200).json({ ok: true, status: "completed", videoUrl: job.video_url });
    }

    // ── 2. Consultar EvoLink — idéntico a poll-video.js ───────────────────────
    const evolinkRes = await fetch(`https://api.evolink.ai/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${EVOLINK_API_KEY}` },
    });

    const data   = await evolinkRes.json();
    const status = data.status || "pending";
    console.log(`[free-poll] EvoLink taskId=${taskId} status=${status} progress=${data.progress}`);

    if (!evolinkRes.ok) {
      console.error(`[free-poll] EvoLink HTTP error ${evolinkRes.status}:`, JSON.stringify(data).slice(0, 300));
      return res.status(200).json({ ok: true, status: "processing" }); // retry
    }

    // ── 3. Si falló ───────────────────────────────────────────────────────────
    if (status === "failed" || status === "error") {
      const errMsg = data.error?.message || data.message || "EvoLink generation failed";
      console.error("[free-poll] EvoLink FAILED:", errMsg);
      await supabaseAdmin
        .from("free_video_uses")
        .update({ status: "failed" })
        .eq("task_id", taskId);
      return res.status(200).json({ ok: true, status: "failed", error: errMsg });
    }

    // ── 4. Todavía procesando ────────────────────────────────────────────────
    if (status !== "completed" && status !== "succeed") {
      return res.status(200).json({ ok: true, status: "processing", progress: data.progress || 0 });
    }

    // ── 5. Completado — extraer URL ───────────────────────────────────────────
    const evolinkVideoUrl = extractEvoLinkVideoUrl(data);
    console.log(`[free-poll] evolinkVideoUrl=${evolinkVideoUrl}`);

    if (!evolinkVideoUrl) {
      console.error("[free-poll] NO VIDEO URL found in response:", JSON.stringify(data));
      return res.status(200).json({ ok: true, status: "processing" }); // retry
    }

    // ── 6. Descargar → subir a Supabase Storage ───────────────────────────────
    console.log("[free-poll] Downloading video from EvoLink...");
    const videoBuf     = await fetchToBuffer(evolinkVideoUrl);
    const permanentUrl = await uploadToStorage(videoBuf, userId, taskId);
    console.log(`[free-poll] Saved to Storage: ${permanentUrl.slice(0, 60)}`);

    // ── 7. Actualizar free_video_uses ─────────────────────────────────────────
    await supabaseAdmin
      .from("free_video_uses")
      .update({ status: "completed", video_url: permanentUrl })
      .eq("task_id", taskId);

    return res.status(200).json({ ok: true, status: "completed", videoUrl: permanentUrl });

  } catch (err) {
    console.error("[free-poll] error:", err.message);
    return res.status(500).json({ ok: false, error: "Error polling video status" });
  }
}

export const config = { runtime: "nodejs" };
