// api/free-template/submit.js
// Genera video gratis con Seedance 1.5 Pro (5 segundos)
// Verifica que el usuario no haya usado su video gratis antes

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const EVOLINK_API_KEY = process.env.EVOLINK_API_KEY;
const EVOLINK_BASE    = "https://api.evolink.ai/v1";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  // ── Auth ──────────────────────────────────────────────────────────────────
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ ok: false, error: "No token" });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ ok: false, error: "Unauthorized" });

  const { templateId, faceBase64, prompt, dialogLang } = req.body;

  if (!templateId || !faceBase64 || !prompt) {
    return res.status(400).json({ ok: false, error: "Missing fields" });
  }

  // ── Verificar que no haya usado su video gratis ───────────────────────────
  const { data: existing } = await supabaseAdmin
    .from("free_video_uses")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    return res.status(400).json({ ok: false, error: "Ya usaste tu video gratis. Compra Jades para continuar." });
  }

  // ── Subir imagen a Supabase Storage para obtener URL pública ─────────────
  const imgBuffer = Buffer.from(faceBase64, "base64");
  const fileName  = `free-face-${user.id}-${Date.now()}.jpg`;

  const { error: uploadErr } = await supabaseAdmin.storage
    .from("template-refs")
    .upload(fileName, imgBuffer, { contentType: "image/jpeg", upsert: true });

  if (uploadErr) {
    return res.status(500).json({ ok: false, error: "Error subiendo imagen: " + uploadErr.message });
  }

  const { data: { publicUrl } } = supabaseAdmin.storage
    .from("template-refs")
    .getPublicUrl(fileName);

  // ── Llamar a EvoLink Seedance 1.5 Pro ────────────────────────────────────
  // Seedance 1.5 Pro: modelo seedance-1.5-pro, I2V, 5 segundos, 480p
  const evoPayload = {
    model:       "seedance-1.5-pro",
    prompt:      prompt,
    image_urls:  [publicUrl],  // foto del rostro como referencia
    duration:    5,
    quality:     "480p",
    aspect_ratio: "9:16",
    audio:       true,
  };

  let evoRes;
  try {
    evoRes = await fetch(`${EVOLINK_BASE}/video/generations`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${EVOLINK_API_KEY}` },
      body:    JSON.stringify(evoPayload),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Error conectando a EvoLink: " + e.message });
  }

  const evoJson = await evoRes.json().catch(() => null);

  if (!evoRes.ok || !evoJson?.id) {
    console.error("[free-template/submit] EvoLink error:", JSON.stringify(evoJson));
    return res.status(500).json({ ok: false, error: evoJson?.error || "Error en EvoLink" });
  }

  const taskId = evoJson.id;

  // ── Registrar uso en Supabase (reservar el gratis) ───────────────────────
  await supabaseAdmin.from("free_video_uses").insert({
    user_id:     user.id,
    template_id: templateId,
    task_id:     taskId,
    status:      "pending",
    created_at:  new Date().toISOString(),
  });

  return res.status(200).json({ ok: true, taskId });
}
