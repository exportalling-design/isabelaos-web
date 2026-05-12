// api/templates/submit-video.js
import { supabaseAdmin }          from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

const JADE_COST = { "480": 30, "720": 60 };

// ── PROMPTS ────────────────────────────────────────────────────────────────
const REF_SINGLE_EN = "The PROTAGONIST's face must EXACTLY match the reference images (image1 = front face, image2 = multi-angle profile sheet). Maintain consistent identity throughout all shots.";
const REF_SINGLE_ES = "El rostro del PROTAGONISTA debe coincidir EXACTAMENTE con las imágenes de referencia (imagen1 = rostro frontal, imagen2 = hoja de perfiles). Mantener identidad consistente en todos los planos.";
const REF_BOTH_EN   = "The MAN's face must match image1 (front face) and image2 (profile sheet). The WOMAN's face must match image3 (front face) and image4 (profile sheet). Maintain consistent identity for both characters.";
const REF_BOTH_ES   = "El rostro del HOMBRE debe coincidir con imagen1 (rostro frontal) e imagen2 (hoja de perfiles). El rostro de la MUJER debe coincidir con imagen3 e imagen4. Mantener identidad consistente para ambos personajes.";

const PROMPTS = {
  divineLight: {
    male: {
      en: `[Global style: cinematic Hollywood disaster drama, hyperrealistic, ultra detailed, emotional intensity, volumetric lighting, realistic water physics, 8K, film grain, shallow depth of field, stable framing]\n${REF_SINGLE_EN}\n[0s–3s]: Wide shot — slow dolly in. A devastated man stands alone in a dark grassy field beside a violent ocean during a storm at blue hour. He screams at a glowing divine figure standing before him, crying with rage: "You abandoned me! You abandoned me when I needed you most!" Powerful wind bends the grass violently. Dramatic overcast lighting with strong heavenly rim light around God.\n[3s–6s]: Medium shot — handheld with slight natural shake. The emotional argument intensifies. The man points angrily at God while crying uncontrollably. Suddenly, a gigantic meteor blazes across the stormy sky and crashes explosively into the ocean behind them. A violent eruption of water rises into the air, creating a massive tsunami. Thunder and shockwaves shake the environment.\n[6s–9s]: Extreme close-up — camera holds fixed framing. Tears stream down the man's face as his anger breaks into deep emotional pain. His eyes tremble while reflecting the gigantic tsunami rapidly approaching behind him. Realistic skin texture, natural crying motion, emotionally devastating performance.\n[9s–12s]: Wide shot — gradual dolly out. The broken man collapses to his knees in the field. God slowly kneels and embraces him with compassion while the colossal wall of water races toward them at terrifying speed. Warm divine light contrasts against the cold storm atmosphere.\n[12s–15s]: Medium close shot — slow push-in. God holds the crying man tightly and whispers softly, "I will always be with you." The gigantic tsunami crashes over them completely. Their silhouettes vanish beneath the wave as divine light briefly shines through the darkness. Epic cinematic ending.`,
      es: `[Estilo global: drama cinematográfico de Hollywood, hiperrealista, ultra detallado, intensidad emocional, iluminación volumétrica, física de agua realista, 8K, grano de película, poca profundidad de campo, encuadre estable]\n${REF_SINGLE_ES}\n[0s–3s]: Plano general — dolly lento. Un hombre devastado está solo en un campo oscuro junto a un océano violento durante una tormenta. Le grita a una figura divina resplandeciente: "¡Me abandonaste! ¡Me abandonaste cuando más te necesitaba!" El viento dobla la hierba violentamente.\n[3s–6s]: Plano medio — cámara en mano. La discusión se intensifica. El hombre señala a Dios llorando. Un enorme meteorito choca contra el océano creando un tsunami masivo.\n[6s–9s]: Primer plano extremo. Lágrimas bajan por el rostro del hombre. Sus ojos reflejan el tsunami que se acerca. Textura de piel realista.\n[9s–12s]: Plano general — dolly hacia afuera. El hombre cae de rodillas. Dios se arrodilla y lo abraza mientras la pared de agua se acerca. Luz divina cálida contra la tormenta fría.\n[12s–15s]: Plano medio cercano. Dios sostiene al hombre y susurra: "Siempre estaré contigo." El tsunami los cubre en una pared explosiva de agua. Final cinematográfico épico.`,
    },
    female: {
      en: `[Global style: cinematic Hollywood disaster drama, hyperrealistic, ultra detailed, emotional intensity, volumetric lighting, realistic water physics, 8K, film grain, shallow depth of field, stable framing]\n${REF_SINGLE_EN}\n[0s–3s]: Wide shot — slow dolly in. A devastated woman stands alone in a dark grassy field beside a violent ocean during a storm at blue hour. She screams at a glowing divine figure standing before her, crying with rage: "You abandoned me! You abandoned me when I needed you most!" Powerful wind whips her hair and bends the grass violently. Dramatic overcast lighting with strong heavenly rim light around God.\n[3s–6s]: Medium shot — handheld with slight natural shake. The emotional argument intensifies. The woman points angrily at God while crying uncontrollably. Suddenly, a gigantic meteor blazes across the stormy sky and crashes explosively into the ocean behind them. A violent eruption of water rises into the air, creating a massive tsunami.\n[6s–9s]: Extreme close-up — camera holds fixed framing. Tears stream down the woman's face as her anger breaks into deep emotional pain. Her eyes tremble while reflecting the gigantic tsunami rapidly approaching. Realistic skin texture, natural crying motion, emotionally devastating performance.\n[9s–12s]: Wide shot — gradual dolly out. The broken woman collapses to her knees in the field. God slowly kneels and embraces her with compassion while the colossal wall of water races toward them. Warm divine light contrasts against the cold storm atmosphere.\n[12s–15s]: Medium close shot — slow push-in. God holds the crying woman tightly and whispers softly, "I will always be with you." The gigantic tsunami crashes over them completely. Their silhouettes vanish beneath the wave as divine light briefly shines through the darkness. Epic cinematic ending.`,
      es: `[Estilo global: drama cinematográfico de Hollywood, hiperrealista, ultra detallado, intensidad emocional, iluminación volumétrica, física de agua realista, 8K, grano de película, poca profundidad de campo, encuadre estable]\n${REF_SINGLE_ES}\n[0s–3s]: Plano general — dolly lento. Una mujer devastada está sola en un campo oscuro junto a un océano violento durante una tormenta. Le grita a una figura divina resplandeciente: "¡Me abandonaste! ¡Me abandonaste cuando más te necesitaba!" El viento sacude su cabello y dobla la hierba violentamente.\n[3s–6s]: Plano medio — cámara en mano. La discusión se intensifica. La mujer señala a Dios llorando. Un enorme meteorito choca contra el océano creando un tsunami masivo.\n[6s–9s]: Primer plano extremo. Lágrimas bajan por el rostro de la mujer. Sus ojos reflejan el tsunami que se acerca. Textura de piel realista.\n[9s–12s]: Plano general — dolly hacia afuera. La mujer cae de rodillas. Dios se arrodilla y la abraza mientras la pared de agua se acerca. Luz divina cálida contra la tormenta fría.\n[12s–15s]: Plano medio cercano. Dios sostiene a la mujer y susurra: "Siempre estaré contigo." El tsunami los cubre en una pared explosiva de agua. Final cinematográfico épico.`,
    },
  },

  divineHuman: {
    male: {
      en: `[Global style: emotional cinematic realism, Hollywood disaster film, hyperrealistic, natural performances, dramatic storm atmosphere, realistic ocean simulation, subtle film grain, shallow depth of field, blue-grey cinematic palette, 8K, physically accurate motion, stable framing]\n${REF_SINGLE_EN}\n[0s–4s]: Medium wide shot — slow push-in. A devastated man stands beside a stormy ocean at blue hour, screaming emotionally at God standing directly in front of him as a real human being. God has long wet dark hair, a tired compassionate face, and wears an aged dirty white robe soaked by rain and wind. The man cries uncontrollably: "You abandoned me! You abandoned me when I needed you most!"\n[4s–7s]: Medium shot — handheld. The man grabs God's robe while crying and arguing face-to-face. God listens silently with sadness in his eyes like a father watching his son suffer. A gigantic meteor suddenly crashes into the sea. A massive explosion of water erupts upward.\n[7s–10s]: Close-up — fixed framing. Tears stream down the man's trembling face as his anger collapses into heartbreak. He slowly realizes the gigantic tsunami forming behind God. Reflections of the rising wall of water appear in his wet eyes.\n[10s–13s]: Wide shot — gradual dolly out. Completely broken, the man falls to his knees. God immediately kneels with him and pulls him into a deep emotional embrace. The colossal tsunami races toward them.\n[13s–15s]: Medium close shot — slow push-in. God whispers softly: "I will always be with you." The massive wave consumes both of them completely. Their silhouettes disappear beneath the water while a faint divine light shines through the darkness.`,
      es: `[Estilo global: realismo cinematográfico emocional, película de desastre de Hollywood, hiperrealista, actuaciones naturales, atmósfera de tormenta dramática, simulación de océano realista, grano de película sutil, poca profundidad de campo, paleta cinematográfica azul-gris, 8K, movimiento físicamente preciso, encuadre estable]\n${REF_SINGLE_ES}\n[0s–4s]: Plano medio amplio — lento acercamiento. Un hombre devastado junto a un océano tormentoso grita a Dios como ser humano real frente a él. Dios tiene cabello oscuro mojado, rostro cansado y compasivo, túnica blanca vieja empapada. El hombre llora: "¡Me abandonaste! ¡Me abandonaste cuando más te necesitaba!"\n[4s–7s]: Plano medio — cámara en mano. El hombre agarra la túnica de Dios discutiendo cara a cara. Un enorme meteorito choca contra el mar. Explosión masiva de agua.\n[7s–10s]: Primer plano — cámara fija. Lágrimas bajan por el rostro tembloroso del hombre. Ve el gigantesco tsunami formándose detrás de Dios. Reflejos del agua en sus ojos mojados.\n[10s–13s]: Plano general — dolly hacia afuera. El hombre cae de rodillas. Dios lo abraza profundamente. El colosal tsunami avanza hacia ellos.\n[13s–15s]: Plano medio cercano. Dios susurra: "Siempre estaré contigo." La ola masiva los consume. Sus siluetas desaparecen bajo el agua.`,
    },
    female: {
      en: `[Global style: emotional cinematic realism, Hollywood disaster film, hyperrealistic, natural performances, dramatic storm atmosphere, realistic ocean simulation, subtle film grain, shallow depth of field, blue-grey cinematic palette, 8K, physically accurate motion, stable framing]\n${REF_SINGLE_EN}\n[0s–4s]: Medium wide shot — slow push-in. A devastated woman stands beside a stormy ocean at blue hour, screaming emotionally at God standing directly in front of her as a real human being. God has long wet dark hair, a tired compassionate face, and wears an aged dirty white robe soaked by rain and wind. The woman cries uncontrollably: "You abandoned me! You abandoned me when I needed you most!"\n[4s–7s]: Medium shot — handheld. The woman grabs God's robe while crying and arguing face-to-face. God listens silently with sadness in his eyes like a father watching his daughter suffer. A gigantic meteor suddenly crashes into the sea. A massive explosion of water erupts upward.\n[7s–10s]: Close-up — fixed framing. Tears stream down the woman's trembling face as her anger collapses into heartbreak. She slowly realizes the gigantic tsunami forming behind God. Reflections of the rising wall of water appear in her wet eyes.\n[10s–13s]: Wide shot — gradual dolly out. Completely broken, the woman falls to her knees. God immediately kneels with her and pulls her into a deep emotional embrace. The colossal tsunami races toward them.\n[13s–15s]: Medium close shot — slow push-in. God whispers softly: "I will always be with you." The massive wave consumes both of them completely. Their silhouettes disappear beneath the water while a faint divine light shines through the darkness.`,
      es: `[Estilo global: realismo cinematográfico emocional, película de desastre de Hollywood, hiperrealista, actuaciones naturales, atmósfera de tormenta dramática, simulación de océano realista, grano de película sutil, poca profundidad de campo, paleta cinematográfica azul-gris, 8K, movimiento físicamente preciso, encuadre estable]\n${REF_SINGLE_ES}\n[0s–4s]: Plano medio amplio — lento acercamiento. Una mujer devastada junto a un océano tormentoso grita a Dios como ser humano real frente a ella. Dios tiene cabello oscuro mojado, rostro cansado y compasivo, túnica blanca vieja empapada. La mujer llora: "¡Me abandonaste! ¡Me abandonaste cuando más te necesitaba!"\n[4s–7s]: Plano medio — cámara en mano. La mujer agarra la túnica de Dios discutiendo cara a cara. Dios escucha como padre mirando sufrir a su hija. Un enorme meteorito choca contra el mar. Explosión masiva de agua.\n[7s–10s]: Primer plano — cámara fija. Lágrimas bajan por el rostro tembloroso de la mujer. Ve el gigantesco tsunami formándose detrás de Dios. Reflejos del agua en sus ojos mojados.\n[10s–13s]: Plano general — dolly hacia afuera. La mujer cae de rodillas. Dios la abraza profundamente. El colosal tsunami avanza hacia ellos.\n[13s–15s]: Plano medio cercano. Dios susurra: "Siempre estaré contigo." La ola masiva los consume. Sus siluetas desaparecen bajo el agua.`,
    },
  },

  coupleDisaster: {
    female: {
      en: `[Global style: emotional cinematic realism, Hollywood disaster romance drama, hyperrealistic, intense emotional performances, realistic storm atmosphere, realistic ocean physics, blue-grey cinematic palette, shallow depth of field, film grain, 8K, stable framing, natural audio only, no background music]\n${REF_SINGLE_EN} The WOMAN matches the reference images. The MAN is a handsome AI-generated character with strong features and wet dark hair — do NOT use reference images for the man.\n[0s–4s]: Medium wide shot — slow push-in. A young couple stands at the edge of a tall coastal cliff above a violent dark ocean during a massive storm. They argue face-to-face. The woman cries screaming: "You were never there when I needed you! You always left me alone!" The man replies: "I did everything for us and it was never enough for you!"\n[4s–7s]: Wide shot — handheld. A gigantic meteor tears across the storm clouds and crashes into the ocean below the cliff. A colossal explosion erupts upward. The woman screams hysterically: "NO! I DON'T WANT TO DIE!"\n[7s–11s]: Medium close shot — fixed framing. The terrified woman collapses into the man's arms crying uncontrollably. An enormous tsunami rises rapidly behind them. The man whispers: "Look at me… calm down… everything will be okay…"\n[11s–13s]: Close-up — slow push-in. They look into each other's eyes with overwhelming fear and love. She whispers: "I'm scared…" He replies: "Me too…" They share one final emotional kiss. Lightning illuminates the wave.\n[13s–15s]: Extreme wide shot. The gigantic tsunami crashes violently over the cliff consuming the couple completely. Their silhouettes disappear beneath the massive wave. Emotionally tragic ending, no music.`,
      es: `[Estilo global: realismo cinematográfico emocional, drama romántico de desastre de Hollywood, hiperrealista, actuaciones emocionales intensas, atmósfera de tormenta realista, física de océano realista, paleta azul-gris, poca profundidad de campo, grano de película, 8K, encuadre estable, solo audio natural, sin música]\n${REF_SINGLE_ES} La MUJER coincide con las imágenes de referencia. El HOMBRE es un personaje generado por IA con rasgos fuertes y cabello oscuro mojado — NO usar referencias para el hombre.\n[0s–4s]: Plano medio amplio — lento acercamiento. Una pareja joven al borde de un acantilado costero durante una tormenta masiva. La mujer llora gritando: "¡Nunca estuviste cuando te necesitaba! ¡Siempre me dejaste sola!" El hombre: "¡Hice todo por nosotros y nunca fue suficiente para ti!"\n[4s–7s]: Plano general — cámara en mano. Un meteorito enorme choca contra el océano. Explosión colosal. La mujer grita: "¡NO! ¡NO QUIERO MORIR!"\n[7s–11s]: Plano medio cercano — cámara fija. La mujer colapsa en los brazos del hombre llorando. Un tsunami enorme sube por el horizonte. El hombre susurra: "Mírame… tranquila… todo estará bien…"\n[11s–13s]: Primer plano — lento acercamiento. Se miran con miedo y amor. "Tengo miedo…" / "Yo también…" Un último beso. Los relámpagos iluminan la ola.\n[13s–15s]: Plano general extremo. El tsunami los cubre completamente. Sus siluetas desaparecen. Final trágicamente emotivo.`,
    },
    male: {
      en: `[Global style: emotional cinematic realism, Hollywood disaster romance drama, hyperrealistic, intense emotional performances, realistic storm atmosphere, realistic ocean physics, blue-grey cinematic palette, shallow depth of field, film grain, 8K, stable framing, natural audio only, no background music]\n${REF_SINGLE_EN} The MAN matches the reference images. The WOMAN is a beautiful AI-generated character with long flowing wet hair and emotional expressive features — do NOT use reference images for the woman.\n[0s–4s]: Medium wide shot — slow push-in. A young couple stands at the edge of a tall coastal cliff above a violent dark ocean during a massive storm. They argue face-to-face. The woman cries screaming: "You were never there when I needed you! You always left me alone!" The man replies: "I did everything for us and it was never enough for you!"\n[4s–7s]: Wide shot — handheld. A gigantic meteor tears across the storm clouds and crashes into the ocean below the cliff. A colossal explosion erupts upward. The woman screams hysterically: "NO! I DON'T WANT TO DIE!"\n[7s–11s]: Medium close shot — fixed framing. The terrified woman collapses into the man's arms crying uncontrollably. An enormous tsunami rises rapidly behind them. The man whispers: "Look at me… calm down… everything will be okay…"\n[11s–13s]: Close-up — slow push-in. They look into each other's eyes with overwhelming fear and love. She whispers: "I'm scared…" He replies: "Me too…" They share one final emotional kiss. Lightning illuminates the wave.\n[13s–15s]: Extreme wide shot. The gigantic tsunami crashes violently over the cliff consuming the couple completely. Their silhouettes disappear beneath the massive wave. Emotionally tragic ending, no music.`,
      es: `[Estilo global: realismo cinematográfico emocional, drama romántico de desastre de Hollywood, hiperrealista, actuaciones emocionales intensas, atmósfera de tormenta realista, física de océano realista, paleta azul-gris, poca profundidad de campo, grano de película, 8K, encuadre estable, solo audio natural, sin música]\n${REF_SINGLE_ES} El HOMBRE coincide con las imágenes de referencia. La MUJER es un personaje generado por IA con cabello largo mojado y rasgos expresivos — NO usar referencias para la mujer.\n[0s–4s]: Plano medio amplio — lento acercamiento. Una pareja joven al borde de un acantilado costero durante una tormenta masiva. La mujer llora gritando: "¡Nunca estuviste cuando te necesitaba! ¡Siempre me dejaste sola!" El hombre: "¡Hice todo por nosotros y nunca fue suficiente para ti!"\n[4s–7s]: Plano general — cámara en mano. Un meteorito enorme choca contra el océano. Explosión colosal. La mujer grita: "¡NO! ¡NO QUIERO MORIR!"\n[7s–11s]: Plano medio cercano — cámara fija. La mujer colapsa en los brazos del hombre llorando. Un tsunami enorme sube por el horizonte. El hombre susurra: "Mírame… tranquila… todo estará bien…"\n[11s–13s]: Primer plano — lento acercamiento. Se miran con miedo y amor. "Tengo miedo…" / "Yo también…" Un último beso. Los relámpagos iluminan la ola.\n[13s–15s]: Plano general extremo. El tsunami los cubre completamente. Sus siluetas desaparecen. Final trágicamente emotivo.`,
    },
    both: {
      en: `[Global style: emotional cinematic realism, Hollywood disaster romance drama, hyperrealistic, intense emotional performances, realistic storm atmosphere, realistic ocean physics, blue-grey cinematic palette, shallow depth of field, film grain, 8K, stable framing, natural audio only, no background music]\n${REF_BOTH_EN}\n[0s–4s]: Medium wide shot — slow push-in. A young couple stands at the edge of a tall coastal cliff above a violent dark ocean during a massive storm. They argue face-to-face. The woman cries screaming: "You were never there when I needed you! You always left me alone!" The man replies: "I did everything for us and it was never enough for you!"\n[4s–7s]: Wide shot — handheld. A gigantic meteor tears across the storm clouds and crashes into the ocean below the cliff. A colossal explosion erupts upward. The woman screams hysterically: "NO! I DON'T WANT TO DIE!"\n[7s–11s]: Medium close shot — fixed framing. The terrified woman collapses into the man's arms crying uncontrollably. An enormous tsunami rises rapidly behind them. The man whispers: "Look at me… calm down… everything will be okay…"\n[11s–13s]: Close-up — slow push-in. They look into each other's eyes with overwhelming fear and love. She whispers: "I'm scared…" He replies: "Me too…" They share one final emotional kiss. Lightning illuminates the wave.\n[13s–15s]: Extreme wide shot. The gigantic tsunami crashes violently over the cliff consuming the couple completely. Their silhouettes disappear beneath the massive wave. Emotionally tragic ending, no music.`,
      es: `[Estilo global: realismo cinematográfico emocional, drama romántico de desastre de Hollywood, hiperrealista, actuaciones emocionales intensas, atmósfera de tormenta realista, física de océano realista, paleta azul-gris, poca profundidad de campo, grano de película, 8K, encuadre estable, solo audio natural, sin música]\n${REF_BOTH_ES}\n[0s–4s]: Plano medio amplio — lento acercamiento. Una pareja joven al borde de un acantilado costero durante una tormenta masiva. La mujer llora gritando: "¡Nunca estuviste cuando te necesitaba! ¡Siempre me dejaste sola!" El hombre: "¡Hice todo por nosotros y nunca fue suficiente para ti!"\n[4s–7s]: Plano general — cámara en mano. Un meteorito enorme choca contra el océano. Explosión colosal. La mujer grita: "¡NO! ¡NO QUIERO MORIR!"\n[7s–11s]: Plano medio cercano — cámara fija. La mujer colapsa en los brazos del hombre llorando. Un tsunami enorme sube por el horizonte. El hombre susurra: "Mírame… tranquila… todo estará bien…"\n[11s–13s]: Primer plano. Se miran con miedo y amor. "Tengo miedo…" / "Yo también…" Un último beso.\n[13s–15s]: Plano general extremo. El tsunami los cubre completamente. Sus siluetas desaparecen. Final trágicamente emotivo.`,
    },
  },

  victoriasSecret: {
    female: {
      en: `[Global style: ultra luxury swimwear fashion campaign, Victoria's Secret inspired aesthetic, cinematic beauty commercial, hyperrealistic, glamorous tropical atmosphere, golden sunlight, luxury resort energy, soft glowing skin, shallow depth of field, smooth motion, glossy fashion cinematography, elegant sensuality, high-end magazine aesthetic, 8K]\n${REF_SINGLE_EN} The MODEL is a woman matching the reference images.\n[0s–3s]: Wide cinematic shot — slow motion tracking shot. A stunning supermodel walks barefoot along the shoreline of a luxurious tropical beach during golden hour. She wears an elegant white luxury swimsuit with flowing translucent fabric moving naturally in the ocean breeze. Confident runway energy, graceful posture, cinematic lens flare.\n[3s–6s]: Medium close-up — slow push-in. Wet hair moves softly in the warm wind while golden sunlight reflects across her skin. She looks directly toward the camera with calm confidence and subtle sensuality. Tropical palm trees and turquoise ocean blur softly in the background.\n[6s–9s]: Full body tracking shot — smooth side camera movement. The model walks beside an infinity pool overlooking the ocean at a luxury resort. Flowing fabric trails behind her dramatically while sunlight sparkles across the water.\n[9s–12s]: Close-up — camera holds steady. The model slowly adjusts oversized luxury sunglasses while smiling subtly. Wind lifts her hair naturally as sunlight illuminates her face with a soft golden glow. Elegant jewelry sparkles gently.\n[12s–15s]: Wide sunset shot — slow cinematic dolly out. The model stands at the edge of the beach facing the glowing sunset horizon while ocean waves wash softly around her feet. Flowing fabric moves elegantly behind her in the wind. Luxury cinematic ending.`,
      es: `[Estilo global: campaña de moda de trajes de baño ultra lujo, estética inspirada en Victoria's Secret, comercial de belleza cinematográfico, hiperrealista, atmósfera tropical glamorosa, luz dorada del sol, energía de resort de lujo, piel brillante suave, poca profundidad de campo, movimiento suave, cinematografía de moda brillante, sensualidad elegante, 8K]\n${REF_SINGLE_ES} La MODELO es una mujer que coincide con las imágenes de referencia.\n[0s–3s]: Plano cinematográfico amplio — toma de seguimiento en cámara lenta. Una impresionante supermodelo camina descalza por la orilla de una lujosa playa tropical durante la hora dorada. Viste un elegante traje de baño blanco de lujo con tela translúcida fluyendo en la brisa del océano.\n[3s–6s]: Primer plano medio — lento acercamiento. El cabello mojado se mueve suavemente en el viento cálido. Mira directamente hacia la cámara con confianza tranquila y sensualidad sutil. Palmeras tropicales y océano turquesa se desdibujan en el fondo.\n[6s–9s]: Toma de cuerpo completo — movimiento lateral suave. La modelo camina junto a una piscina infinita con vista al océano en un resort de lujo. Tela fluida se arrastra detrás de ella dramáticamente.\n[9s–12s]: Primer plano — cámara estable. La modelo ajusta sus lentes de sol de lujo mientras sonríe sutilmente. Luz dorada suave ilumina su rostro. Joyas elegantes brillan.\n[12s–15s]: Plano amplio al atardecer — dolly lento. La modelo está al borde de la playa mirando el horizonte del atardecer. Tela fluida se mueve elegantemente. Final cinematográfico de lujo atemporal.`,
    },
  },
};

function getPrompt(templateId, genderVariant, lang) {
  const p = PROMPTS[templateId]?.[genderVariant]?.[lang]
         || PROMPTS[templateId]?.[genderVariant]?.["en"];
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
    faceBase64, faceMime,
    profileBase64, profileMime,
    face2Base64, face2Mime,
    profile2Base64, profile2Mime,
    bodyBase64, bodyMime,
  } = body;

  if (!templateId || !genderVariant || !faceBase64 || !profileBase64) {
    return res.status(400).json({ ok: false, error: "Missing required fields" });
  }

  const jadeCost = JADE_COST[quality];
  if (!jadeCost) return res.status(400).json({ ok: false, error: "Invalid quality" });

  const ref = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

  // ── Descontar Jades ──────────────────────────────────────────
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
    // ── Build references array ───────────────────────────────
    const references = [
      { url: `data:${faceMime};base64,${faceBase64}`, tag: "character" },
      { url: `data:${profileMime};base64,${profileBase64}`, tag: "character" },
    ];

    // Second person for "both" variant
    if (face2Base64 && face2Mime) {
      references.push({ url: `data:${face2Mime};base64,${face2Base64}`, tag: "character" });
    }
    if (profile2Base64 && profile2Mime) {
      references.push({ url: `data:${profile2Mime};base64,${profile2Base64}`, tag: "character" });
    }

    // Body reference
    let promptText = getPrompt(templateId, genderVariant, lang);
    if (bodyBase64 && bodyMime) {
      references.push({ url: `data:${bodyMime};base64,${bodyBase64}`, tag: "style" });
      promptText += "\n\n[BODY REFERENCE: Use ONLY for body proportions. Do NOT copy the clothing — use completely different scene-appropriate clothing.]";
    }

    // ── Submit to PiAPI ──────────────────────────────────────
    const piRes = await fetch("https://api.piapi.ai/api/v1/task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.PIAPI_KEY,
      },
      body: JSON.stringify({
        model: "kling",
        task_type: "video_generation",
        input: {
          prompt: promptText,
          mode: "omni_reference",
          references,
          duration: 15,
          aspect_ratio: "9:16",
          quality: quality === "720" ? "high" : "standard",
        },
      }),
    });

    const piData = await piRes.json();
    if (!piRes.ok || (piData.code && piData.code !== 200)) {
      throw new Error(piData.message || `PiAPI error ${piRes.status}`);
    }

    const taskId = piData.data?.task_id || piData.task_id;
    if (!taskId) throw new Error("PiAPI no devolvió task_id");

    // ── Save job ─────────────────────────────────────────────
    const jobId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

    await supabaseAdmin.from("video_jobs").insert({
      id: jobId,
      user_id: userId,
      status: "IN_PROGRESS",
      mode: "template",
      prompt: promptText,
      provider: "piapi_kling",
      provider_request_id: taskId,
      provider_status: "pending",
      started_at: new Date().toISOString(),
      payload: {
        task_id: taskId,
        template_id: templateId,
        gender_variant: genderVariant,
        quality,
        jade_cost: jadeCost,
        ref,
      },
    });

    console.log("[submit-video] OK", { userId, jobId, taskId, templateId, genderVariant, jadeCost });

    return res.status(200).json({ ok: true, jobId, taskId, jadeCost });

  } catch (err) {
    // Reembolsar Jades
    try {
      await supabaseAdmin.rpc("spend_jades", {
        p_user_id: userId, p_amount: -jadeCost,
        p_reason: "template_refund_error", p_ref: ref,
      });
    } catch {}
    console.error("[submit-video] error:", err.message);
    return res.status(500).json({ ok: false, error: "Error generando video. Jades reembolsados." });
  }
}

export const config = { runtime: "nodejs" };
