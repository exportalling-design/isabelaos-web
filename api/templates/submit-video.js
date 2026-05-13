// api/templates/submit-video.js
// Recibe URLs públicas de Supabase Storage (subidas desde el frontend)
// y las envía a Kling Omni Reference — no recibe base64, payload pequeño
import { supabaseAdmin }          from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

const JADE_COST = { "480": 30, "720": 60 };

// ── REFERENCE NOTES ────────────────────────────────────────────────────────
const R1_EN = "The main character's face and appearance must EXACTLY match the provided reference images (image1 = front face, image2 = side profile). Preserve exact skin tone, eye shape, nose, lips, hair and all facial features. Maintain consistent identity throughout all shots.";
const R1_ES = "El rostro del personaje principal debe coincidir EXACTAMENTE con las imágenes de referencia (imagen1 = rostro frontal, imagen2 = perfil lateral). Preservar tono de piel, forma de ojos, nariz, labios, cabello y todos los rasgos faciales. Mantener identidad consistente en todos los planos.";
const R2_EN = "The MAN's face must match image1 (front) and image2 (side profile). The WOMAN's face must match image3 (front) and image4 (side profile). Maintain consistent identity for both characters throughout all shots.";
const R2_ES = "El rostro del HOMBRE debe coincidir con imagen1 (frontal) e imagen2 (perfil lateral). El rostro de la MUJER debe coincidir con imagen3 e imagen4. Mantener identidad consistente para ambos personajes en todos los planos.";

// ── PROMPTS ────────────────────────────────────────────────────────────────
const PROMPTS = {
  divineLight: {
    male: {
      en: `[Global style: cinematic Hollywood disaster drama, hyperrealistic, ultra detailed, emotional intensity, volumetric lighting, realistic water physics, 8K, film grain, shallow depth of field, stable framing]\n${R1_EN}\n[0s–3s]: Wide shot — slow dolly in. A devastated man stands alone in a dark grassy field beside a violent ocean during a storm at blue hour. He screams at a glowing divine figure standing before him, crying with rage: "You abandoned me! You abandoned me when I needed you most!" Powerful wind bends the grass violently. Dramatic overcast lighting with strong heavenly rim light around God.\n[3s–6s]: Medium shot — handheld with slight natural shake. The emotional argument intensifies. The man points angrily at God while crying uncontrollably. Suddenly, a gigantic meteor blazes across the stormy sky and crashes explosively into the ocean behind them. A violent eruption of water rises into the air, creating a massive tsunami. Thunder and shockwaves shake the environment.\n[6s–9s]: Extreme close-up — camera holds fixed framing. Tears stream down the man's face as his anger breaks into deep emotional pain. His eyes tremble while reflecting the gigantic tsunami rapidly approaching behind him. Realistic skin texture, natural crying motion, emotionally devastating performance.\n[9s–12s]: Wide shot — gradual dolly out. The broken man collapses to his knees in the field. God slowly kneels and embraces him with compassion while the colossal wall of water races toward them at terrifying speed. Warm divine light contrasts against the cold storm atmosphere. Wind and water particles whip violently around them.\n[12s–15s]: Medium close shot — slow push-in. God holds the crying man tightly and whispers softly, "I will always be with you." The gigantic tsunami crashes over them completely in an explosive wall of water and mist. Their silhouettes vanish beneath the wave as divine light briefly shines through the darkness. Epic cinematic ending, emotionally overwhelming, realistic water simulation, smooth motion, stable framing.`,
      es: `[Estilo global: drama cinematográfico de Hollywood, hiperrealista, ultra detallado, intensidad emocional, iluminación volumétrica, física de agua realista, 8K, grano de película, poca profundidad de campo, encuadre estable]\n${R1_ES}\n[0s–3s]: Plano general — dolly lento. Un hombre devastado está solo en un campo oscuro junto a un océano violento durante una tormenta. Le grita a una figura divina resplandeciente: "¡Me abandonaste! ¡Me abandonaste cuando más te necesitaba!" El viento fuerte dobla violentamente la hierba.\n[3s–6s]: Plano medio — cámara en mano. La discusión se intensifica. El hombre señala a Dios llorando. Un enorme meteorito choca explosivamente contra el océano creando un tsunami masivo. Truenos y ondas de choque sacuden el entorno.\n[6s–9s]: Primer plano extremo — cámara fija. Lágrimas bajan por el rostro del hombre mientras su ira se convierte en dolor profundo. Sus ojos tiemblan reflejando el tsunami que se acerca. Textura de piel realista, llanto natural.\n[9s–12s]: Plano general — dolly hacia afuera. El hombre quebrantado cae de rodillas. Dios se arrodilla y lo abraza con compasión mientras la colosal pared de agua se acerca. Luz divina cálida contrasta con la fría tormenta.\n[12s–15s]: Plano medio cercano. Dios sostiene al hombre y susurra: "Siempre estaré contigo." El tsunami los cubre en una pared explosiva de agua. Final cinematográfico épico.`,
    },
    female: {
      en: `[Global style: cinematic Hollywood disaster drama, hyperrealistic, ultra detailed, emotional intensity, volumetric lighting, realistic water physics, 8K, film grain, shallow depth of field, stable framing]\n${R1_EN}\n[0s–3s]: Wide shot — slow dolly in. A devastated woman stands alone in a dark grassy field beside a violent ocean during a storm at blue hour. She screams at a glowing divine figure standing before her, crying with rage: "You abandoned me! You abandoned me when I needed you most!" Powerful wind whips her hair and bends the grass violently. Dramatic overcast lighting with strong heavenly rim light around God.\n[3s–6s]: Medium shot — handheld with slight natural shake. The emotional argument intensifies. The woman points angrily at God while crying uncontrollably. Suddenly, a gigantic meteor blazes across the stormy sky and crashes explosively into the ocean behind them. A violent eruption of water rises into the air, creating a massive tsunami.\n[6s–9s]: Extreme close-up — camera holds fixed framing. Tears stream down the woman's face as her anger breaks into deep emotional pain. Her eyes tremble while reflecting the gigantic tsunami rapidly approaching. Realistic skin texture, natural crying motion, emotionally devastating performance.\n[9s–12s]: Wide shot — gradual dolly out. The broken woman collapses to her knees. God slowly kneels and embraces her with compassion while the colossal wall of water races toward them. Warm divine light contrasts against the cold storm atmosphere.\n[12s–15s]: Medium close shot — slow push-in. God holds the crying woman tightly and whispers softly, "I will always be with you." The gigantic tsunami crashes over them completely. Their silhouettes vanish beneath the wave as divine light briefly shines through the darkness. Epic cinematic ending.`,
      es: `[Estilo global: drama cinematográfico de Hollywood, hiperrealista, intensidad emocional, iluminación volumétrica, física de agua realista, 8K, grano de película]\n${R1_ES}\n[0s–3s]: Plano general — dolly lento. Una mujer devastada grita a una figura divina resplandeciente: "¡Me abandonaste! ¡Me abandonaste cuando más te necesitaba!" El viento sacude su cabello violentamente.\n[3s–6s]: Plano medio — cámara en mano. La discusión se intensifica. Un enorme meteorito crea un tsunami masivo.\n[6s–9s]: Primer plano extremo. Lágrimas bajan por el rostro de la mujer. Sus ojos reflejan el tsunami que se acerca.\n[9s–12s]: Plano general. La mujer cae de rodillas. Dios la abraza mientras la pared de agua se acerca.\n[12s–15s]: Dios susurra: "Siempre estaré contigo." El tsunami los cubre. Final épico.`,
    },
  },
  divineHuman: {
    male: {
      en: `[Global style: emotional cinematic realism, Hollywood disaster film, hyperrealistic, natural performances, dramatic storm atmosphere, realistic ocean simulation, blue-grey cinematic palette, 8K, stable framing]\n${R1_EN}\n[0s–4s]: Medium wide shot — slow push-in. A devastated man stands beside a stormy ocean at blue hour, screaming emotionally at God standing directly in front of him as a real human being. God has long wet dark hair, a tired compassionate face, and wears an aged dirty white robe soaked by rain and wind. The man cries uncontrollably: "You abandoned me! You abandoned me when I needed you most!"\n[4s–7s]: Medium shot — handheld. The man grabs God's robe while arguing face-to-face. God listens silently with sadness like a father watching his son suffer. A gigantic meteor crashes violently into the sea. A massive explosion of water erupts upward.\n[7s–10s]: Close-up — fixed framing. Tears stream down the man's trembling face as anger collapses into heartbreak. He realizes the gigantic tsunami forming behind God. Reflections of the water in his wet eyes.\n[10s–13s]: Wide shot — dolly out. The man falls to his knees. God immediately pulls him into a deep emotional embrace. The colossal tsunami races toward them. The white robe moves violently in wind and rain.\n[13s–15s]: Medium close shot. God whispers: "I will always be with you." The massive wave consumes both completely. Their silhouettes disappear while a faint divine light shines through the darkness.`,
      es: `[Estilo global: realismo cinematográfico emocional, película de desastre de Hollywood, hiperrealista, paleta azul-gris, 8K]\n${R1_ES}\n[0s–4s]: Plano medio amplio. Un hombre devastado grita a Dios como ser humano real. Dios tiene cabello oscuro mojado, túnica blanca vieja empapada. El hombre llora: "¡Me abandonaste! ¡Me abandonaste cuando más te necesitaba!"\n[4s–7s]: Plano medio — cámara en mano. El hombre agarra la túnica de Dios. Un enorme meteorito choca contra el mar.\n[7s–10s]: Primer plano. Lágrimas bajan por el rostro tembloroso. Ve el tsunami formándose detrás de Dios.\n[10s–13s]: Plano general. El hombre cae de rodillas. Dios lo abraza profundamente.\n[13s–15s]: Dios susurra: "Siempre estaré contigo." La ola masiva los consume.`,
    },
    female: {
      en: `[Global style: emotional cinematic realism, Hollywood disaster film, hyperrealistic, natural performances, dramatic storm atmosphere, realistic ocean simulation, blue-grey cinematic palette, 8K, stable framing]\n${R1_EN}\n[0s–4s]: Medium wide shot — slow push-in. A devastated woman stands beside a stormy ocean at blue hour, screaming emotionally at God standing directly in front of her as a real human being. God has long wet dark hair, a tired compassionate face, and wears an aged dirty white robe soaked by rain and wind. The woman cries uncontrollably: "You abandoned me! You abandoned me when I needed you most!"\n[4s–7s]: Medium shot — handheld. The woman grabs God's robe while arguing face-to-face. God listens silently with sadness like a father watching his daughter suffer. A gigantic meteor crashes into the sea.\n[7s–10s]: Close-up — fixed framing. Tears stream down the woman's trembling face as anger collapses into heartbreak. She realizes the gigantic tsunami forming behind God.\n[10s–13s]: Wide shot — dolly out. The woman falls to her knees. God immediately pulls her into a deep emotional embrace. The colossal tsunami races toward them.\n[13s–15s]: Medium close shot. God whispers: "I will always be with you." The massive wave consumes both completely. Their silhouettes disappear while a faint divine light shines through.`,
      es: `[Estilo global: realismo cinematográfico emocional, hiperrealista, paleta azul-gris, 8K]\n${R1_ES}\n[0s–4s]: Una mujer devastada grita a Dios como ser humano real con túnica blanca mojada: "¡Me abandonaste! ¡Me abandonaste cuando más te necesitaba!"\n[4s–7s]: La mujer agarra la túnica de Dios. Un enorme meteorito choca contra el mar.\n[7s–10s]: Lágrimas bajan por el rostro tembloroso. Ve el tsunami formándose.\n[10s–13s]: La mujer cae de rodillas. Dios la abraza profundamente.\n[13s–15s]: Dios susurra: "Siempre estaré contigo." La ola masiva los consume.`,
    },
  },
  coupleDisaster: {
    female: {
      en: `[Global style: emotional cinematic realism, Hollywood disaster romance drama, hyperrealistic, blue-grey palette, 8K, natural audio only, no music]\n${R1_EN} The WOMAN is the character matching the reference images. The MAN is a handsome AI-generated character with strong features and wet dark hair.\n[0s–4s]: Medium wide shot. A young couple on a tall coastal cliff above violent ocean during massive storm. The woman screams: "You were never there when I needed you! You always left me alone!" The man replies: "I did everything for us and it was never enough!"\n[4s–7s]: Wide shot — handheld. A gigantic meteor crashes into the ocean below. Colossal explosion. The woman screams: "NO! I DON'T WANT TO DIE!"\n[7s–11s]: Medium close shot. The terrified woman collapses into the man's arms. An enormous tsunami rises rapidly. The man whispers: "Look at me… calm down… everything will be okay…"\n[11s–13s]: Close-up. They look into each other's eyes with fear and love. "I'm scared…" / "Me too…" Final emotional kiss.\n[13s–15s]: Extreme wide shot. The tsunami crashes violently consuming both. Emotionally tragic ending, no music.`,
      es: `[Estilo global: realismo cinematográfico emocional, drama romántico de desastre, hiperrealista, paleta azul-gris, 8K, solo audio natural]\n${R1_ES} La MUJER coincide con las imágenes de referencia. El HOMBRE es generado por IA con rasgos fuertes y cabello oscuro mojado.\n[0s–4s]: Pareja en acantilado costero. La mujer grita: "¡Nunca estuviste cuando te necesitaba! ¡Siempre me dejaste sola!" El hombre: "¡Hice todo por nosotros!"\n[4s–7s]: Meteorito enorme choca contra el océano. La mujer grita: "¡NO! ¡NO QUIERO MORIR!"\n[7s–11s]: La mujer colapsa en los brazos del hombre. Tsunami enorme. El hombre susurra: "Mírame… tranquila… todo estará bien…"\n[11s–13s]: Último beso con miedo y amor.\n[13s–15s]: El tsunami los cubre. Final trágicamente emotivo.`,
    },
    male: {
      en: `[Global style: emotional cinematic realism, Hollywood disaster romance drama, hyperrealistic, blue-grey palette, 8K, natural audio only, no music]\n${R1_EN} The MAN is the character matching the reference images. The WOMAN is a beautiful AI-generated character with long flowing wet hair.\n[0s–4s]: Medium wide shot. A young couple on a tall coastal cliff above violent ocean during massive storm. The woman screams: "You were never there when I needed you! You always left me alone!" The man replies: "I did everything for us and it was never enough!"\n[4s–7s]: Wide shot. A gigantic meteor crashes into the ocean. The woman screams: "NO! I DON'T WANT TO DIE!"\n[7s–11s]: Medium close shot. The woman collapses into the man's arms. Enormous tsunami rises. The man whispers: "Look at me… calm down… everything will be okay…"\n[11s–13s]: Close-up. Final emotional kiss with fear and love.\n[13s–15s]: The tsunami crashes consuming both. Emotionally tragic ending, no music.`,
      es: `[Estilo global: realismo cinematográfico emocional, drama romántico de desastre, hiperrealista, paleta azul-gris, 8K, solo audio natural]\n${R1_ES} El HOMBRE coincide con las imágenes de referencia. La MUJER es generada por IA con cabello largo mojado.\n[0s–4s]: Pareja en acantilado costero. La mujer grita: "¡Nunca estuviste!" El hombre: "¡Hice todo por nosotros!"\n[4s–7s]: Meteorito enorme. La mujer grita: "¡NO QUIERO MORIR!"\n[7s–11s]: La mujer colapsa en los brazos del hombre. "Mírame… tranquila…"\n[11s–13s]: Último beso.\n[13s–15s]: El tsunami los cubre. Final trágicamente emotivo.`,
    },
    both: {
      en: `[Global style: emotional cinematic realism, Hollywood disaster romance drama, hyperrealistic, blue-grey palette, 8K, natural audio only, no music]\n${R2_EN}\n[0s–4s]: A young couple on a tall coastal cliff during massive storm. The woman screams: "You were never there when I needed you!" The man replies: "I did everything for us and it was never enough!"\n[4s–7s]: A gigantic meteor crashes into the ocean. The woman screams: "NO! I DON'T WANT TO DIE!"\n[7s–11s]: The woman collapses into the man's arms. Enormous tsunami rises. "Look at me… everything will be okay…"\n[11s–13s]: Final emotional kiss with fear and love.\n[13s–15s]: The tsunami crashes consuming both. Emotionally tragic ending.`,
      es: `[Estilo global: realismo cinematográfico emocional, drama romántico de desastre, hiperrealista, paleta azul-gris, 8K, solo audio natural]\n${R2_ES}\n[0s–4s]: Pareja en acantilado. La mujer grita: "¡Nunca estuviste!" El hombre: "¡Hice todo por nosotros!"\n[4s–7s]: Meteorito enorme. La mujer grita: "¡NO QUIERO MORIR!"\n[7s–11s]: La mujer colapsa. "Mírame… todo estará bien…"\n[11s–13s]: Último beso.\n[13s–15s]: El tsunami los cubre.`,
    },
  },
  victoriasSecret: {
    female: {
      en: `[Global style: ultra luxury swimwear fashion campaign, Victoria's Secret aesthetic, cinematic beauty commercial, hyperrealistic, golden sunlight, luxury resort, soft glowing skin, 8K]\n${R1_EN} The MODEL is a woman matching the reference images.\n[0s–3s]: Wide cinematic slow motion. A stunning supermodel walks barefoot along a luxurious tropical beach during golden hour. Elegant white luxury swimsuit with flowing translucent fabric. Confident runway energy, cinematic lens flare.\n[3s–6s]: Medium close-up. Wet hair moves softly in warm wind. Golden sunlight reflects across her skin. She looks at the camera with calm confidence. Turquoise ocean blurs in the background.\n[6s–9s]: Full body tracking shot. The model walks beside an infinity pool at a luxury resort. Flowing fabric trails dramatically.\n[9s–12s]: Close-up. The model adjusts oversized luxury sunglasses while smiling subtly. Wind lifts her hair. Elegant jewelry sparkles.\n[12s–15s]: Wide sunset shot — slow dolly out. The model faces the glowing sunset horizon. Flowing fabric moves elegantly. Luxury cinematic ending.`,
      es: `[Estilo global: campaña de moda ultra lujo, estética Victoria's Secret, comercial cinematográfico, hiperrealista, luz dorada, resort de lujo, 8K]\n${R1_ES} La MODELO es una mujer que coincide con las imágenes de referencia.\n[0s–3s]: Plano amplio en cámara lenta. Supermodelo camina descalza en playa tropical durante la hora dorada. Elegante traje de baño blanco de lujo con tela translúcida fluyendo en la brisa.\n[3s–6s]: Primer plano medio. Cabello mojado moviéndose suavemente. Luz dorada en su piel. Mira a la cámara con confianza.\n[6s–9s]: Toma de cuerpo completo. Camina junto a piscina infinita con vista al océano.\n[9s–12s]: Primer plano. Ajusta lentes de sol de lujo mientras sonríe. Joyas elegantes brillan.\n[12s–15s]: Plano amplio al atardecer. La modelo frente al horizonte. Final cinematográfico de lujo.`,
    },
  },
};

function getPrompt(templateId, genderVariant, lang) {
  const p = PROMPTS[templateId]?.[genderVariant]?.[lang] || PROMPTS[templateId]?.[genderVariant]?.["en"];
  if (!p) throw new Error(`No prompt for ${templateId}/${genderVariant}/${lang}`);
  return p;
}

export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("content-type", "application/json; charset=utf-8");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const userId = await getUserIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  const {
    templateId, lang = "es", quality = "480", genderVariant,
    // Recibe URLs públicas — las imágenes ya están en Supabase Storage
    faceUrl, profileUrl,
    face2Url, profile2Url,
    bodyUrl,
  } = body;

  if (!templateId || !genderVariant || !faceUrl) {
    return res.status(400).json({ ok: false, error: "Missing required fields" });
  }

  const jadeCost = JADE_COST[quality];
  if (!jadeCost) return res.status(400).json({ ok: false, error: "Invalid quality" });

  const ref = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

  // ── Descontar Jades ────────────────────────────────────────────────────────
  const { error: spendErr } = await supabaseAdmin.rpc("spend_jades", {
    p_user_id: userId, p_amount: jadeCost,
    p_reason: "template_generate", p_ref: ref,
  });
  if (spendErr) {
    if ((spendErr.message || "").includes("INSUFFICIENT_JADES"))
      return res.status(402).json({ ok: false, error: "INSUFFICIENT_JADES", detail: `Necesitas ${jadeCost} Jades.` });
    return res.status(400).json({ ok: false, error: spendErr.message });
  }

  try {
    // ── Construir referencias con URLs ─────────────────────────────────────
    const references = [{ url: faceUrl, tag: "character" }];
    if (profileUrl) references.push({ url: profileUrl, tag: "character" });
    if (face2Url)   references.push({ url: face2Url,   tag: "character" });
    if (profile2Url) references.push({ url: profile2Url, tag: "character" });

    let promptText = getPrompt(templateId, genderVariant, lang);
    if (bodyUrl) {
      references.push({ url: bodyUrl, tag: "style" });
      promptText += "\n\n[BODY REFERENCE: Use ONLY for body proportions. Do NOT copy the clothing — use completely different scene-appropriate clothing.]";
    }

    console.log(`[submit-video] user=${userId} template=${templateId} refs=${references.length}`);

    // ── Kling Omni Reference ───────────────────────────────────────────────
    const piRes = await fetch("https://api.piapi.ai/api/v1/task", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.PIAPI_KEY },
      body: JSON.stringify({
        model:     "kling",
        task_type: "video_generation",
        input: {
          prompt:       promptText,
          mode:         "omni_reference",
          references,
          duration:     10,
          aspect_ratio: "9:16",
          quality:      quality === "720" ? "high" : "standard",
        },
      }),
    });

    const piData = await piRes.json();
    console.log(`[submit-video] Kling response:`, JSON.stringify(piData).slice(0, 200));

    if (!piRes.ok || (piData.code && piData.code !== 200)) {
      throw new Error(piData.message || `PiAPI error ${piRes.status}`);
    }

    const taskId = piData.data?.task_id || piData.task_id;
    if (!taskId) throw new Error("PiAPI no devolvió task_id");

    // ── Guardar job ────────────────────────────────────────────────────────
    const jobId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    await supabaseAdmin.from("video_jobs").insert({
      id: jobId, user_id: userId,
      status: "IN_PROGRESS", mode: "template",
      prompt: promptText.slice(0, 500),
      provider: "piapi_kling_omni",
      provider_request_id: taskId,
      provider_status: "pending",
      started_at: new Date().toISOString(),
      payload: { task_id: taskId, template_id: templateId, gender_variant: genderVariant, quality, jade_cost: jadeCost, ref },
    });

    console.log(`[submit-video] OK jobId=${jobId} taskId=${taskId}`);
    return res.status(200).json({ ok: true, jobId, taskId, jadeCost });

  } catch (err) {
    try { await supabaseAdmin.rpc("spend_jades", { p_user_id: userId, p_amount: -jadeCost, p_reason: "template_refund_error", p_ref: ref }); } catch {}
    console.error("[submit-video] error:", err.message);
    return res.status(500).json({ ok: false, error: "Error generando video. Jades reembolsados." });
  }
}

export const config = { runtime: "nodejs" };
