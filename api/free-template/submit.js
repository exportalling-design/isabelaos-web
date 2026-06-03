// api/free-template/submit.js
// Genera video gratis con Seedance 1.5 Pro (5 segundos)
// Mismo patron de imports que submit-video.js y poll-video.js
import { supabaseAdmin }           from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader }  from "../../src/lib/getUserIdFromAuth.js";

const EVOLINK_API_KEY = process.env.EVOLINK_API_KEY;

// Prompts como objetos simples sin template literals anidados
const PROMPT_FREE1_MALE = "Use the uploaded face image as the ABSOLUTE PRIMARY facial identity reference. Preserve exact facial features, skin tone, hairstyle and identity throughout the entire video. Hyperrealistic, ultra detailed, 8K cinematic quality. Ultra realistic biblical Jerusalem street scene. Single continuous shot. A crowded ancient Jerusalem marketplace at golden hour. Roman soldiers and first-century people fill the street. Jesus walks slowly through the crowd carrying the cross, wearing a white robe, divine golden light surrounding him. Among the crowd, a modern man wearing contemporary clothing stands frozen, clearly out of place, as if transported through time. The camera is locked on the modern man face. He occupies most of the frame. He watches Jesus with overwhelming emotion — tears streaming down his face, devastated expression, trembling lips. The camera slowly pushes closer to his face. Volumetric cinematic lighting, shallow depth of field, authentic ancient architecture, premium film quality, realistic emotional performance. Maintain exact facial identity from the uploaded face image until the final frame. Duration 5 seconds.";

const PROMPT_FREE1_FEMALE = "Use the uploaded face image as the ABSOLUTE PRIMARY facial identity reference. Preserve exact facial features, skin tone, hairstyle and identity throughout the entire video. Hyperrealistic, ultra detailed, 8K cinematic quality. Ultra realistic biblical Jerusalem street scene. Single continuous shot. A crowded ancient Jerusalem marketplace at golden hour. Roman soldiers and first-century people fill the street. Jesus walks slowly through the crowd carrying the cross, wearing a white robe, divine golden light surrounding him. Among the crowd, a modern woman wearing contemporary clothing stands frozen, clearly out of place, as if transported through time. The camera is locked on the modern woman face. She occupies most of the frame. She watches Jesus with overwhelming emotion — tears streaming down her face, devastated expression, trembling lips. The camera slowly pushes closer to her face. Volumetric cinematic lighting, shallow depth of field, authentic ancient architecture, premium film quality, realistic emotional performance. Maintain exact facial identity from the uploaded face image until the final frame. Duration 5 seconds.";

const PROMPT_FREE2_MALE = "Use the uploaded face image as the ABSOLUTE PRIMARY facial identity reference. Preserve exact facial features, skin tone, hairstyle and identity throughout the entire video. Hyperrealistic, ultra detailed, 8K cinematic quality, premium blockbuster visual effects. Ultra realistic cinematic power awakening scene. Single continuous shot. The protagonist stands in an open rocky landscape at epic sunset. Close-up on the protagonist face — strong facial identity focus. The protagonist stares forward with determination and power. Small glowing golden energy particles appear around the body. Wind increases dramatically, hair and clothing move naturally. The camera performs a smooth cinematic orbit. Energy rapidly intensifies. Dust rises from the ground. Massive golden energy aura erupts around the protagonist. Eyes glow with intense energy. Powerful shockwave expands outward. Epic cinematic lighting, volumetric god rays, photorealistic skin texture. Maintain exact facial identity until the final frame. Duration 5 seconds.";

const PROMPT_FREE2_FEMALE = "Use the uploaded face image as the ABSOLUTE PRIMARY facial identity reference. Preserve exact facial features, skin tone, hairstyle and identity throughout the entire video. Hyperrealistic, ultra detailed, 8K cinematic quality, premium blockbuster visual effects. Ultra realistic cinematic power awakening scene. Single continuous shot. The protagonist stands in an open rocky landscape at epic sunset. Close-up on the protagonist face — strong facial identity focus. The protagonist stares forward with determination and power. Small glowing golden energy particles appear around the body. Wind increases dramatically, hair and clothing move naturally. The camera performs a smooth cinematic orbit. Energy rapidly intensifies. Dust rises from the ground. Massive golden energy aura erupts around the protagonist. Eyes glow with intense energy. Powerful shockwave expands outward. Epic cinematic lighting, volumetric god rays, photorealistic skin texture. Maintain exact facial identity until the final frame. Duration 5 seconds.";

const PROMPT_FREE3_MALE = "Use the uploaded face image as the ABSOLUTE PRIMARY facial identity reference. Preserve exact facial features, skin tone, hairstyle and identity throughout the entire video. Hyperrealistic, ultra detailed, 8K cinematic quality, premium blockbuster sci-fi realism. Ultra realistic futuristic megacity scene. Single continuous shot. The protagonist stands completely still in the center of a crowded futuristic plaza surrounded by massive holographic skyscrapers and flying vehicles. The protagonist occupies most of the frame — strong facial identity focus. The camera performs a smooth cinematic orbit. Glowing particles appear in the air. A powerful beam of divine light descends from the sky onto the protagonist. The surrounding crowd stops and stares. The protagonist raises their gaze with confidence and power. Volumetric cinematic lighting, photorealistic skin texture, cinematic depth of field, seamless camera movement. Maintain exact facial identity until the final frame. Duration 5 seconds.";

const PROMPT_FREE3_FEMALE = "Use the uploaded image as the main character reference. Maintain character consistency, preserve facial appearance, hairstyle and overall identity throughout the video. Hyperrealistic, ultra detailed, 8K cinematic quality, premium blockbuster sci-fi realism. Ultra realistic futuristic megacity scene. Single continuous shot. The protagonist stands completely still in the center of a crowded futuristic plaza surrounded by massive holographic skyscrapers and flying vehicles. The protagonist occupies most of the frame — strong facial identity focus. The camera performs a smooth cinematic orbit. Glowing particles appear in the air. A powerful beam of divine light descends from the sky onto the protagonist. The surrounding crowd stops and stares. The protagonist raises their gaze with confidence and power. Volumetric cinematic lighting, photorealistic skin texture, cinematic depth of field, seamless camera movement. Maintain character consistency until the final frame. Duration 5 seconds.";

const PROMPTS = {
  "free-1": { male: PROMPT_FREE1_MALE, female: PROMPT_FREE1_FEMALE },
  "free-2": { male: PROMPT_FREE2_MALE, female: PROMPT_FREE2_FEMALE },
  "free-3": { male: PROMPT_FREE3_MALE, female: PROMPT_FREE3_FEMALE },
};

export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("content-type", "application/json; charset=utf-8");

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
  const fileName  = "free-face-" + userId + "-" + Date.now() + ".jpg";

  const { error: uploadErr } = await supabaseAdmin.storage
    .from("template-refs")
    .upload(fileName, imgBuffer, { contentType: "image/jpeg", upsert: true });

  if (uploadErr) {
    return res.status(500).json({ ok: false, error: "Error subiendo imagen: " + uploadErr.message });
  }

  const { data: urlData } = supabaseAdmin.storage
    .from("template-refs")
    .getPublicUrl(fileName);

  const faceUrl = urlData?.publicUrl;
  if (!faceUrl) {
    return res.status(500).json({ ok: false, error: "No se pudo obtener URL publica de la imagen" });
  }

  // ── Seleccionar prompt ────────────────────────────────────────────────────
  const templatePrompts = PROMPTS[templateId] || PROMPTS["free-1"];
  const prompt = gender === "female" ? templatePrompts.female : templatePrompts.male;

  // ── Llamar a EvoLink — mismo patron que submit-video.js ──────────────────
  const evoPayload = {
    model:          "seedance-1.5-pro",
    prompt:         prompt,
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
      headers: {
        "Content-Type":  "application/json",
        "Authorization": "Bearer " + EVOLINK_API_KEY,
      },
      body: JSON.stringify(evoPayload),
    });
    evoJson = await evoRes.json().catch(() => null);
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Error conectando a EvoLink: " + e.message });
  }

  console.log("[free-template/submit] EvoLink status=" + evoRes.status + " response=" + JSON.stringify(evoJson).slice(0, 200));

  if (!evoRes.ok || evoJson?.error) {
    return res.status(500).json({ ok: false, error: evoJson?.error?.message || evoJson?.message || "EvoLink error " + evoRes.status });
  }

  const taskId = evoJson?.id || evoJson?.task_id || null;
  if (!taskId) {
    return res.status(500).json({ ok: false, error: "EvoLink no devolvio task id" });
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
