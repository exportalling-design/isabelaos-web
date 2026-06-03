// api/free-template/submit.js
// Genera video gratis con Seedance 1.5 Pro (5 segundos)
// Verifica que el usuario no haya usado su video gratis antes
// Usa el mismo patrón de endpoint que templates/submit-video.js

import { supabaseAdmin }           from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader }  from "../../src/lib/getUserIdFromAuth.js";

const EVOLINK_API_KEY = process.env.EVOLINK_API_KEY;

// ── Prompts reales por plantilla y género ────────────────────────────────────
const PROMPTS = {
  "free-1": {
    male: `Use the uploaded face image as the ABSOLUTE PRIMARY facial identity reference.
Preserve the exact facial features, facial structure, eyes, nose, mouth, skin tone, hairstyle, facial proportions, and identity consistency from the uploaded face image throughout the entire video.
The modern protagonist must clearly look like the person from the uploaded face image.
Ultra realistic biblical Jerusalem.
Single continuous shot.
Foreground dominates the frame: the back and shoulders of Jesus while Roman soldiers repeatedly whip Him. Visible whip strikes, moving arms, dust, motion. Respectful, non-graphic, cinematic.
Jesus remains in the foreground during the entire shot while the whipping continues.
Behind Jesus, a crowded street filled with first-century people. Some watch, some laugh, some whisper, creating a living corridor through Jerusalem.
Among the crowd, a modern man wearing contemporary clothing is already kneeling on the ground, clearly out of place, as if transported through time.
The camera focus remains locked on the modern man's face.
The protagonist occupies a large portion of the frame.
The protagonist is crying openly from the beginning of the shot. Visible tears run down his face. His expression is devastated, overwhelmed by grief and disbelief while staring toward Jesus.
The crowd continues moving around him while he remains frozen in emotional shock.
The camera slowly pushes closer to his face throughout the entire shot.
Foreground whipping remains visible during the entire video.
Ultra realistic human emotion, visible tears, dramatic cinematic lighting, shallow depth of field, authentic ancient Jerusalem architecture, premium historical film quality, emotional realism, seamless continuous camera movement.
Maintain exact facial identity from the uploaded face image until the final frame.
Duration: 5 seconds.`,
    female: `Use the uploaded face image as the ABSOLUTE PRIMARY facial identity reference.
Preserve the exact facial features, facial structure, eyes, nose, mouth, skin tone, hairstyle, facial proportions, and identity consistency from the uploaded face image throughout the entire video.
The modern protagonist must clearly look like the person from the uploaded face image.
Ultra realistic biblical Jerusalem.
Single continuous shot.
Foreground dominates the frame: the back and shoulders of Jesus while Roman soldiers repeatedly whip Him. Visible whip strikes, moving arms, dust, motion. Respectful, non-graphic, cinematic.
Jesus remains in the foreground during the entire shot while the whipping continues.
Behind Jesus, a crowded street filled with first-century people. Some watch, some laugh, some whisper, creating a living corridor through Jerusalem.
Among the crowd, a modern woman wearing contemporary clothing is already kneeling on the ground, clearly out of place, as if transported through time.
The camera focus remains locked on the modern woman's face.
The protagonist occupies a large portion of the frame.
The protagonist is crying openly from the beginning of the shot. Visible tears run down her face. Her expression is devastated, overwhelmed by grief and disbelief while staring toward Jesus.
The crowd continues moving around her while she remains frozen in emotional shock.
The camera slowly pushes closer to her face throughout the entire shot.
Foreground whipping remains visible during the entire video.
Ultra realistic human emotion, visible tears, dramatic cinematic lighting, shallow depth of field, authentic ancient Jerusalem architecture, premium historical film quality, emotional realism, seamless continuous camera movement.
Maintain exact facial identity from the uploaded face image until the final frame.
Duration: 5 seconds.`,
  },
  // Plantillas 2 y 3 — prompts genéricos hasta que Luis los genere
  "free-2": {
    male:   "Use the uploaded face image as the ABSOLUTE PRIMARY facial identity reference. Preserve exact facial features throughout. Dramatic cinematic portrait of a man with volumetric light rays, smoke, emotional expression, ultra realistic, 5 seconds.",
    female: "Use the uploaded face image as the ABSOLUTE PRIMARY facial identity reference. Preserve exact facial features throughout. Dramatic cinematic portrait of a woman with volumetric light rays, smoke, emotional expression, ultra realistic, 5 seconds.",
  },
  "free-3": {
    male:   "Use the uploaded face image as the ABSOLUTE PRIMARY facial identity reference. Preserve exact facial features throughout. Fashion editorial video of a man, luxury aesthetic, soft bokeh, elegance, cinematic lighting, ultra realistic, 5 seconds.",
    female: "Use the uploaded face image as the ABSOLUTE PRIMARY facial identity reference. Preserve exact facial features throughout. Fashion editorial video of a woman, luxury aesthetic, soft bokeh, elegance, cinematic lighting, ultra realistic, 5 seconds.",
  },
};

export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const userId = await getUserIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  const { templateId, faceBase64, gender } = body;

  if (!templateId || !faceBase64 || !gender) {
    return res.status(400).json({ ok: false, error: "Missing fields: templateId, faceBase64, gender" });
  }

  // ── Verificar que no haya usado su video gratis ───────────────────────────
  const { data: existing } = await supabaseAdmin
    .from("free_video_uses")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    return res.status(400).json({ ok: false, error: "Ya usaste tu video gratis. Obtén Jades para continuar." });
  }

  // ── Subir imagen a Supabase Storage → URL pública ─────────────────────────
  const imgBuffer = Buffer.from(faceBase64, "base64");
  const fileName  = `free-face-${userId}-${Date.now()}.jpg`;

  const { error: uploadErr } = await supabaseAdmin.storage
    .from("template-refs")
    .upload(fileName, imgBuffer, { contentType: "image/jpeg", upsert: true });

  if (uploadErr) {
    return res.status(500).json({ ok: false, error: "Error subiendo imagen: " + uploadErr.message });
  }

  const { data: { publicUrl: faceUrl } } = supabaseAdmin.storage
    .from("template-refs")
    .getPublicUrl(fileName);

  // ── Seleccionar prompt ────────────────────────────────────────────────────
  const templatePrompts = PROMPTS[templateId] || PROMPTS["free-1"];
  const prompt = gender === "female" ? templatePrompts.female : templatePrompts.male;

  // ── Llamar a EvoLink Seedance 1.5 Pro ────────────────────────────────────
  // Modelo exacto: seedance-1.5-pro
  // Endpoint idéntico al que usan las plantillas épicas: /v1/tasks
  const evoPayload = {
    model:        "seedance-1.5-pro",
    prompt,
    image_urls:   [faceUrl],   // referencia de rostro I2V
    duration:     5,
    resolution:   "480p",
    aspect_ratio: "9:16",
    with_audio:   true,
  };

  let evoRes, evoJson;
  try {
    evoRes = await fetch("https://api.evolink.ai/v1/tasks", {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${EVOLINK_API_KEY}`,
      },
      body: JSON.stringify(evoPayload),
    });
    evoJson = await evoRes.json().catch(() => null);
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Error conectando a EvoLink: " + e.message });
  }

  console.log("[free-template/submit] EvoLink response:", JSON.stringify(evoJson));

  const taskId = evoJson?.id || evoJson?.task_id || null;
  if (!evoRes.ok || !taskId) {
    return res.status(500).json({ ok: false, error: evoJson?.error || evoJson?.message || "Error en EvoLink" });
  }

  // ── Registrar en Supabase ─────────────────────────────────────────────────
  await supabaseAdmin.from("free_video_uses").insert({
    user_id:     userId,
    template_id: templateId,
    task_id:     taskId,
    status:      "pending",
    created_at:  new Date().toISOString(),
  });

  return res.status(200).json({ ok: true, taskId });
}

export const config = { runtime: "nodejs" };
