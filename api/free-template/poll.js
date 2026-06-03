// api/free-template/poll.js
// Polling del video gratis — igual que poll-video.js de templates
// Cuando completa, sube a Supabase Storage y actualiza free_video_uses

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const EVOLINK_API_KEY = process.env.EVOLINK_API_KEY;
const EVOLINK_BASE    = "https://api.evolink.ai/v1";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ ok: false, error: "No token" });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ ok: false, error: "Unauthorized" });

  const { taskId, templateId } = req.body;
  if (!taskId) return res.status(400).json({ ok: false, error: "Missing taskId" });

  // ── Verificar si ya está en Supabase (completado previamente) ─────────────
  const { data: existing } = await supabaseAdmin
    .from("free_video_uses")
    .select("status, video_url")
    .eq("task_id", taskId)
    .maybeSingle();

  if (existing?.status === "completed" && existing?.video_url) {
    return res.status(200).json({ ok: true, status: "completed", videoUrl: existing.video_url });
  }

  // ── Consultar EvoLink ─────────────────────────────────────────────────────
  let evoRes;
  try {
    evoRes = await fetch(`${EVOLINK_BASE}/video/generations/${taskId}`, {
      headers: { Authorization: `Bearer ${EVOLINK_API_KEY}` },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Error conectando a EvoLink: " + e.message });
  }

  const raw = await evoRes.json().catch(() => null);
  console.log("[free-template/poll] EvoLink raw:", JSON.stringify(raw));

  const status = raw?.status || "pending";

  if (status === "failed" || status === "error") {
    await supabaseAdmin.from("free_video_uses").update({ status: "failed" }).eq("task_id", taskId);
    return res.status(200).json({ ok: true, status: "failed", error: raw?.error || "Generation failed" });
  }

  if (status !== "completed" && status !== "succeed") {
    return res.status(200).json({ ok: true, status: "processing" });
  }

  // ── Completado — extraer URL del video ────────────────────────────────────
  const rawVideoUrl =
    raw?.results?.[0] ||
    raw?.data?.results?.[0] ||
    raw?.video_url ||
    raw?.data?.video_url ||
    null;

  if (!rawVideoUrl) {
    // EvoLink terminó pero URL aún no disponible — seguir esperando
    return res.status(200).json({ ok: true, status: "processing" });
  }

  // ── Descargar video y subir a Supabase Storage ────────────────────────────
  try {
    const videoResponse = await fetch(rawVideoUrl);
    if (!videoResponse.ok) throw new Error("Error descargando video de EvoLink");

    const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
    const fileName    = `free-${user.id}-${Date.now()}.mp4`;

    const { error: upErr } = await supabaseAdmin.storage
      .from("free-videos")
      .upload(fileName, videoBuffer, { contentType: "video/mp4", upsert: false });

    if (upErr) throw new Error("Error subiendo video: " + upErr.message);

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from("free-videos")
      .getPublicUrl(fileName);

    // ── Actualizar registro en Supabase ───────────────────────────────────
    await supabaseAdmin.from("free_video_uses").update({
      status:     "completed",
      video_url:  publicUrl,
    }).eq("task_id", taskId);

    return res.status(200).json({ ok: true, status: "completed", videoUrl: publicUrl });

  } catch (e) {
    console.error("[free-template/poll] Storage error:", e.message);
    // Retornar URL directa de EvoLink como fallback
    await supabaseAdmin.from("free_video_uses").update({
      status:    "completed",
      video_url: rawVideoUrl,
    }).eq("task_id", taskId);

    return res.status(200).json({ ok: true, status: "completed", videoUrl: rawVideoUrl });
  }
}
