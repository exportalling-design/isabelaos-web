// api/free-template/submit.js
// Genera video gratis con Seedance 1.5 Pro (5 segundos)
// Verifica que el usuario no haya usado su video gratis antes

import { supabaseAdmin }           from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader }  from "../../src/lib/getUserIdFromAuth.js";

const EVOLINK_API_KEY = process.env.EVOLINK_API_KEY;

// ── Prompts por plantilla y género ───────────────────────────────────────────
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

  "free-2": {
    male: `Use the uploaded face image as the ABSOLUTE PRIMARY facial identity reference.
Preserve exact facial structure, eyes, nose, mouth, skin tone, hairstyle, facial proportions, and identity consistency throughout the entire video.
The protagonist must clearly look like the person from the uploaded face image.
Ultra realistic cinematic power awakening scene.
Single continuous shot.
The protagonist stands in an open rocky landscape at sunset.
The camera begins in a close-up on the protagonist's face.
The protagonist occupies most of the frame.
Strong focus on facial identity.
The protagonist stares forward with determination.
Small glowing energy particles begin appearing around the body.
Wind gradually increases.
Hair and clothing move naturally.
The camera performs a subtle cinematic orbit around the protagonist.
The energy rapidly intensifies.
Dust rises from the ground.
The air becomes distorted by power.
A massive golden energy aura erupts around the protagonist.
The protagonist remains fully recognizable.
Eyes begin glowing with intense energy.
Powerful shockwave expands outward.
Epic cinematic lighting.
Ultra realistic visual effects.
Premium blockbuster superhero realism.
Maintain exact facial identity from the uploaded face image until the final frame.
Duration: 5 seconds.`,
    female: `Use the uploaded face image as the ABSOLUTE PRIMARY facial identity reference.
Preserve exact facial structure, eyes, nose, mouth, skin tone, hairstyle, facial proportions, and identity consistency throughout the entire video.
The protagonist must clearly look like the person from the uploaded face image.
Ultra realistic cinematic power awakening scene.
Single continuous shot.
The protagonist stands in an open rocky landscape at sunset.
The camera begins in a close-up on the protagonist's face.
The protagonist occupies most of the frame.
Strong focus on facial identity.
The protagonist stares forward with determination.
Small glowing energy particles begin appearing around the body.
Wind gradually increases.
Hair and clothing move naturally.
The camera performs a subtle cinematic orbit around the protagonist.
The energy rapidly intensifies.
Dust rises from the ground.
The air becomes distorted by power.
A massive golden energy aura erupts around the protagonist.
The protagonist remains fully recognizable.
Eyes begin glowing with intense energy.
Powerful shockwave expands outward.
Epic cinematic lighting.
Ultra realistic visual effects.
Premium blockbuster superhero realism.
Maintain exact facial identity from the uploaded face image until the final frame.
Duration: 5 seconds.`,
  },

  "free-3": {
    male: `Ultra realistic cinematic sci-fi scene.
Single continuous shot.
A futuristic megacity filled with massive skyscrapers, holographic displays, flying vehicles, and thousands of pedestrians.
The protagonist stands completely still in the center of a crowded plaza.
Everyone around them moves with urgency through the city.
The protagonist occupies a large portion of the frame.
The camera performs a smooth cinematic orbit around the protagonist.
The protagonist remains calm and motionless while the crowd moves around them.
Small glowing particles begin appearing in the air.
The city atmosphere becomes increasingly mysterious.
A powerful beam of light descends from the sky onto the protagonist.
Floating particles spiral around the protagonist.
The surrounding crowd gradually stops and turns their attention toward the protagonist.
The camera slowly pushes closer.
The protagonist raises their gaze with confidence and determination.
Epic cinematic lighting.
Ultra realistic visual effects.
Premium blockbuster science-fiction realism.
Powerful visual storytelling.
Cinematic depth of field.
Seamless camera movement.
Duration: 5 seconds.`,
    female: `Use the uploaded image as the main character reference.
Maintain character consistency throughout the video.
Preserve facial appearance, hairstyle, and overall character identity.
Ultra realistic cinematic sci-fi scene.
Single continuous shot.
A futuristic megacity filled with massive skyscrapers, holographic displays, flying vehicles, and thousands of pedestrians.
The protagonist stands completely still in the center of a crowded plaza.
Everyone around them moves with urgency through the city.
The protagonist occupies a large portion of the frame.
The camera performs a smooth cinematic orbit around the protagonist.
The protagonist remains calm and motionless while the crowd moves around them.
Small glowing particles begin appearing in the air.
The city atmosphere becomes increasingly mysterious.
A powerful beam of light descends from the sky onto the protagonist.
Floating particles spiral around the protagonist.
The surrounding crowd gradually stops and turns their attention toward the protagonist.
The camera slowly pushes closer.
The protagonist raises their gaze with confidence and determination.
Epic cinematic lighting.
Ultra realistic visual effects.
Premium blockbuster science-fiction realism.
Powerful visual storytelling.
Cinematic depth of field.
Seamless camera movement.
Maintain character consistency until the final frame.
Duration: 5 seconds.`,
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

  // ── Subir imagen a Supabase Storage ──────────────────────────────────────
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

  // ── Llamar a EvoLink Seedance 1.5 Pro ─────────────────────────────────────
  const evoPayload = {
    model:          "seedance-1.5-pro",
    prompt,
    image_urls:     [faceUrl],
    duration:       5,
    aspect_ratio:   "9:16",
    quality:        "480p",
    generate_audio: true,
  };

  let evoRes, evoJson;
  try {
    evoRes = await fetch("https://api.evolink.ai/v1/videos/generations", {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${EVOLINK_API_KEY}` },
      body:    JSON.stringify(evoPayload),
    });
    evoJson = await evoRes.json().catch(() => null);
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Error conectando a EvoLink: " + e.message });
  }

  console.log("[free-template/submit] EvoLink response:", JSON.stringify(evoJson));

  if (!evoRes.ok || evoJson?.error) {
    console.error("[free-template/submit] EvoLink error:", JSON.stringify(evoJson).slice(0,300));
    return res.status(500).json({ ok: false, error: evoJson?.error?.message || evoJson?.message || `EvoLink error ${evoRes.status}` });
  }

  const taskId = evoJson?.id || evoJson?.task_id || null;
  if (!taskId) {
    return res.status(500).json({ ok: false, error: "EvoLink no devolvió task id" });
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
