// api/free-template/submit.js
// Genera video gratis con Seedance 2.0 Fast Reference-to-Video (5 segundos)
// Mismo patron de imports que submit-video.js y poll-video.js
import { supabaseAdmin }           from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader }  from "../../src/lib/getUserIdFromAuth.js";

const EVOLINK_API_KEY = process.env.EVOLINK_API_KEY;

// Prompts estilo divineLight/luchaTitanes — [Global style] + shots temporales [Xs–Ys]
const PROMPT_FREE1_MALE = "Use the uploaded face image as the ABSOLUTE PRIMARY facial identity reference for the modern man. Preserve exact facial features, skin tone, hairstyle and identity throughout the entire video. [Global style: cinematic Hollywood biblical drama, hyperrealistic, ultra detailed, emotional intensity, volumetric golden-hour lighting, authentic ancient architecture, 8K, film grain, shallow depth of field, stable framing] [0s–2s]: Wide shot — slow dolly in. A crowded ancient Jerusalem marketplace at golden hour, Roman soldiers and first-century townspeople fill the street, dust hanging in warm light. [2s–3.5s]: Medium shot — camera follows. Jesus walks slowly through the crowd carrying the cross, wearing a white robe, divine golden rim light surrounding him. [3.5s–5s]: Close-up — camera pushes in on the modern man's face, frozen among the crowd in contemporary clothing, clearly out of place and transported through time. Tears stream down his face, devastated expression, trembling lips, eyes fixed on Jesus. Maintain exact facial identity from the uploaded face image until the final frame. ABSOLUTELY NO text, NO subtitles, NO watermarks, NO logos. Duration 5 seconds.";

const PROMPT_FREE1_FEMALE = "Use the uploaded face image as the ABSOLUTE PRIMARY facial identity reference for the modern woman. Preserve exact facial features, skin tone, hairstyle and identity throughout the entire video. [Global style: cinematic Hollywood biblical drama, hyperrealistic, ultra detailed, emotional intensity, volumetric golden-hour lighting, authentic ancient architecture, 8K, film grain, shallow depth of field, stable framing] [0s–2s]: Wide shot — slow dolly in. A crowded ancient Jerusalem marketplace at golden hour, Roman soldiers and first-century townspeople fill the street, dust hanging in warm light. [2s–3.5s]: Medium shot — camera follows. Jesus walks slowly through the crowd carrying the cross, wearing a white robe, divine golden rim light surrounding him. [3.5s–5s]: Close-up — camera pushes in on the modern woman's face, frozen among the crowd in contemporary clothing, clearly out of place and transported through time. Tears stream down her face, devastated expression, trembling lips, eyes fixed on Jesus. Maintain exact facial identity from the uploaded face image until the final frame. ABSOLUTELY NO text, NO subtitles, NO watermarks, NO logos. Duration 5 seconds.";

const PROMPT_FREE2_MALE = "Use the uploaded face image as the ABSOLUTE PRIMARY facial identity reference for the protagonist. Preserve exact facial features, skin tone, hairstyle and identity throughout the entire video. [Global style: cinematic blockbuster power-awakening sequence, hyperrealistic, ultra detailed, premium visual effects, volumetric god rays, golden particle effects, 8K, film grain, shallow depth of field] [0s–2s]: Medium close-up — camera holds steady. The man stands in an open rocky landscape at epic sunset, staring forward with quiet determination, small glowing golden energy particles beginning to swirl around his body. [2s–3.5s]: Wide shot — slow cinematic orbit. Wind intensifies dramatically, his hair and clothing whip naturally, dust rises from the ground as energy rapidly builds. [3.5s–5s]: Close-up — camera pushes in. A massive golden energy aura erupts around him, his eyes glowing with intense light, a powerful shockwave expanding outward across the landscape. Maintain exact facial identity until the final frame. ABSOLUTELY NO text, NO subtitles, NO watermarks, NO logos. Duration 5 seconds.";

const PROMPT_FREE2_FEMALE = "Use the uploaded face image as the ABSOLUTE PRIMARY facial identity reference for the protagonist. Preserve exact facial features, skin tone, hairstyle and identity throughout the entire video. [Global style: cinematic blockbuster power-awakening sequence, hyperrealistic, ultra detailed, premium visual effects, volumetric god rays, golden particle effects, 8K, film grain, shallow depth of field] [0s–2s]: Medium close-up — camera holds steady. The woman stands in an open rocky landscape at epic sunset, staring forward with quiet determination, small glowing golden energy particles beginning to swirl around her body. [2s–3.5s]: Wide shot — slow cinematic orbit. Wind intensifies dramatically, her hair and clothing whip naturally, dust rises from the ground as energy rapidly builds. [3.5s–5s]: Close-up — camera pushes in. A massive golden energy aura erupts around her, her eyes glowing with intense light, a powerful shockwave expanding outward across the landscape. Maintain exact facial identity until the final frame. ABSOLUTELY NO text, NO subtitles, NO watermarks, NO logos. Duration 5 seconds.";

const PROMPT_FREE3_MALE = "Use the uploaded face image as the ABSOLUTE PRIMARY facial identity reference for the protagonist. Preserve exact facial features, skin tone, hairstyle and identity throughout the entire video. [Global style: ultra-cinematic sci-fi realism, epic scale, hyperrealistic, holographic megacity atmosphere, volumetric divine light beam, 8K, film grain, shallow depth of field] [0s–2s]: Extreme wide shot — slow cinematic orbit. The man stands completely still in the center of a crowded futuristic plaza, massive holographic skyscrapers and flying vehicles surrounding him. [2s–3.5s]: Medium shot — camera continues the orbit. Glowing particles appear in the air, a powerful beam of divine light descends from the sky directly onto him. [3.5s–5s]: Close-up — camera pushes in on his face. The surrounding crowd stops and stares in awe as he raises his gaze with quiet confidence and power. Maintain exact facial identity until the final frame. ABSOLUTELY NO text, NO subtitles, NO watermarks, NO logos. Duration 5 seconds.";

const PROMPT_FREE3_FEMALE = "Use the uploaded face image as the ABSOLUTE PRIMARY facial identity reference for the protagonist. Preserve exact facial features, skin tone, hairstyle and identity throughout the entire video. [Global style: ultra-cinematic sci-fi realism, epic scale, hyperrealistic, holographic megacity atmosphere, volumetric divine light beam, 8K, film grain, shallow depth of field] [0s–2s]: Extreme wide shot — slow cinematic orbit. The woman stands completely still in the center of a crowded futuristic plaza, massive holographic skyscrapers and flying vehicles surrounding her. [2s–3.5s]: Medium shot — camera continues the orbit. Glowing particles appear in the air, a powerful beam of divine light descends from the sky directly onto her. [3.5s–5s]: Close-up — camera pushes in on her face. The surrounding crowd stops and stares in awe as she raises her gaze with quiet confidence and power. Maintain exact facial identity until the final frame. ABSOLUTELY NO text, NO subtitles, NO watermarks, NO logos. Duration 5 seconds.";

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
    model:          "seedance-2.0-fast-reference-to-video",
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
