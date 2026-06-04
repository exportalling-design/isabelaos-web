// api/templates/submit-video.js
// Modelo: Seedance 2 Fast — Omni Reference — 15 segundos con audio
// Recibe URLs públicas de Supabase Storage (subidas desde el frontend)
import { supabaseAdmin }          from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

const JADE_COST = { "480": 30, "720": 60 };

const R1_EN = "@image1 is the front face reference of the main character. The character's face must EXACTLY match this reference — preserve exact skin tone, eye shape, nose, lips, hair and all facial features throughout all shots.";
const R1_ES = "@image1 es la foto frontal de referencia del personaje principal. El rostro del personaje debe coincidir EXACTAMENTE con esta referencia — preservar tono de piel, forma de ojos, nariz, labios, cabello y todos los rasgos faciales en todos los planos.";
const R2_EN = "@image1 is the front face of the MAN. @image2 is the front face of the WOMAN. Maintain consistent identity for both characters throughout all shots.";
const R2_ES = "@image1 es el rostro frontal del HOMBRE. @image2 es el rostro frontal de la MUJER. Mantener identidad consistente para ambos personajes en todos los planos.";

const PROMPTS = {

  divineLight: {
    male: {
      en: `[CRITICAL ACTING DIRECTION: The character in @image1 MUST perform intense emotional acting throughout the entire video. Generate EXTREME facial expressions: real tears streaming down the face, trembling lips, contorted face in anguish, red eyes from crying, jaw clenched in rage. The character is NOT neutral — they are in the most painful emotional moment of their life. Force maximum emotional performance. This is a Hollywood drama. NO static face. NO neutral expression. FULL emotional breakdown throughout.]
[Global style: cinematic Hollywood disaster drama, hyperrealistic, ultra detailed, emotional intensity, volumetric lighting, realistic water physics, 8K, film grain, shallow depth of field, stable framing]
${R1_EN}
[0s–3s]: Wide shot — slow dolly in. A devastated man stands alone in a dark grassy field beside a violent ocean during a storm at blue hour. He screams at a glowing divine figure standing before him, crying with rage: "You abandoned me! You abandoned me when I needed you most!" Powerful wind bends the grass violently. Dramatic overcast lighting with strong heavenly rim light around God.
[3s–6s]: Medium shot — handheld with slight natural shake. The emotional argument intensifies. The man points angrily at God while crying uncontrollably. Suddenly, a gigantic meteor blazes across the stormy sky and crashes explosively into the ocean behind them. A violent eruption of water rises into the air, creating a massive tsunami. Thunder and shockwaves shake the environment.
[6s–9s]: Extreme close-up — camera holds fixed framing. Tears stream down the man's face as his anger breaks into deep emotional pain. His eyes tremble while reflecting the gigantic tsunami rapidly approaching behind him. Realistic skin texture, natural crying motion, emotionally devastating performance.
[9s–12s]: Wide shot — gradual dolly out. The broken man collapses to his knees in the field. God slowly kneels and embraces him with compassion while the colossal wall of water races toward them at terrifying speed. Warm divine light contrasts against the cold storm atmosphere.
[12s–15s]: Medium close shot — slow push-in. God holds the crying man tightly and whispers softly, "I will always be with you." The gigantic tsunami crashes over them completely in an explosive wall of water and mist. Their silhouettes vanish beneath the wave as divine light briefly shines through the darkness. Epic cinematic ending.`,
      es: `[DIRECCIÓN DE ACTUACIÓN CRÍTICA: El personaje en @image1 DEBE realizar una actuación emocional intensa durante todo el video. Generar EXPRESIONES FACIALES EXTREMAS: lágrimas reales, labios temblorosos, rostro contraído en angustia, ojos rojos de llorar, mandíbula apretada de rabia. El personaje NO está neutral. Forzar máximo rendimiento emocional. COLAPSO emocional total en todo el video.]
[Estilo global: drama cinematográfico de Hollywood, hiperrealista, ultra detallado, intensidad emocional, iluminación volumétrica, física de agua realista, 8K, grano de película, poca profundidad de campo]
${R1_ES}
[0s–3s]: Plano general — dolly lento. Un hombre devastado grita a una figura divina resplandeciente llorando con rabia: "¡Me abandonaste cuando más te necesitaba!" Viento fuerte dobla la hierba violentamente.
[3s–6s]: Plano medio — cámara en mano. La discusión se intensifica. Un enorme meteorito choca contra el océano creando un tsunami masivo. Truenos sacuden el entorno.
[6s–9s]: Primer plano extremo — cámara fija. Lágrimas bajan por el rostro mientras su ira se convierte en dolor profundo. Sus ojos reflejan el tsunami que se acerca.
[9s–12s]: Plano general — dolly hacia afuera. El hombre cae de rodillas. Dios lo abraza con compasión. La pared de agua se acerca a velocidad aterradora.
[12s–15s]: Plano medio cercano. Dios susurra: "Siempre estaré contigo." El tsunami los cubre completamente. Final cinematográfico épico.`,
    },
    female: {
      en: `[CRITICAL ACTING DIRECTION: The character in @image1 MUST perform intense emotional acting throughout the entire video. Generate EXTREME facial expressions: real tears streaming down the face, trembling lips, contorted face in anguish, red eyes from crying. Force maximum emotional performance. Hollywood drama. FULL emotional breakdown throughout.]
[Global style: cinematic Hollywood disaster drama, hyperrealistic, ultra detailed, emotional intensity, volumetric lighting, realistic water physics, 8K, film grain, shallow depth of field, stable framing]
${R1_EN}
[0s–3s]: Wide shot — slow dolly in. A devastated woman stands alone in a dark grassy field beside a violent ocean during a storm at blue hour. She screams at a glowing divine figure standing before her, crying with rage: "You abandoned me! You abandoned me when I needed you most!" Powerful wind bends the grass violently.
[3s–6s]: Medium shot — handheld. The emotional argument intensifies. The woman points angrily at God while crying uncontrollably. A gigantic meteor crashes into the ocean creating a massive tsunami.
[6s–9s]: Extreme close-up — camera fixed. Tears stream down the woman's face as her anger breaks into deep pain. Her eyes reflect the gigantic tsunami rapidly approaching.
[9s–12s]: Wide shot — dolly out. The broken woman collapses to her knees. God slowly kneels and embraces her with compassion while the colossal wall of water races toward them.
[12s–15s]: Medium close shot — slow push-in. God holds the crying woman tightly and whispers, "I will always be with you." The tsunami crashes over them completely. Epic cinematic ending.`,
      es: `[DIRECCIÓN DE ACTUACIÓN CRÍTICA: El personaje en @image1 DEBE realizar actuación emocional intensa. EXPRESIONES FACIALES EXTREMAS: lágrimas reales, labios temblorosos, angustia total. COLAPSO emocional durante todo el video.]
[Estilo global: drama cinematográfico Hollywood, hiperrealista, 8K, grano de película]
${R1_ES}
[0s–3s]: Una mujer devastada grita a Dios llorando con rabia: "¡Me abandonaste cuando más te necesitaba!" Viento violento, campo oscuro, océano tormentoso.
[3s–6s]: La discusión se intensifica. Un meteorito crea un tsunami masivo. Truenos sacuden el entorno.
[6s–9s]: Primer plano. Lágrimas bajan por su rostro reflejando el tsunami que se acerca.
[9s–12s]: La mujer cae de rodillas. Dios la abraza. La pared de agua se acerca a velocidad aterradora.
[12s–15s]: Dios susurra: "Siempre estaré contigo." El tsunami los cubre. Final épico.`,
    },
  },

  divineHuman: {
    male: {
      en: `[CRITICAL ACTING DIRECTION: The character in @image1 MUST perform intense emotional acting. Real tears, trembling lips, contorted face in anguish. Maximum emotional performance. Hollywood drama level.]
[Global style: emotional cinematic realism, Hollywood disaster film, hyperrealistic, dramatic storm atmosphere, realistic ocean simulation, film grain, shallow depth of field, 8K, stable framing]
${R1_EN}
[0s–4s]: Medium wide shot — slow push-in. A devastated man stands beside a stormy ocean, screaming emotionally at God standing directly in front of him as a real human being. God has long wet dark hair, a tired compassionate face, aged white robe soaked by rain. The man cries: "You abandoned me! You abandoned me when I needed you most!"
[4s–7s]: Medium shot — handheld. The man grabs God's robe while crying. A gigantic meteor crashes violently into the sea. Massive explosion of water. Thunder echoes across the coast.
[7s–10s]: Close-up — camera fixed. Tears stream down the man's trembling face. He realizes the gigantic tsunami forming behind God. Rain mixes with tears. Hyper realistic facial detail.
[10s–13s]: Wide shot — dolly out. The man falls to his knees. God immediately kneels and embraces him deeply. The colossal tsunami races toward them.
[13s–15s]: Medium close shot. God whispers: "I will always be with you." The massive wave crashes over them. Their silhouettes disappear as divine light shines briefly.`,
      es: `[DIRECCIÓN CRÍTICA: El personaje en @image1 DEBE actuar con emoción intensa. Lágrimas reales, labios temblorosos, angustia máxima. Drama Hollywood.]
[Estilo global: realismo cinematográfico emocional, hiperrealista, tormenta dramática, océano realista, 8K]
${R1_ES}
[0s–4s]: Un hombre devastado grita emocionalmente a Dios frente a él como ser humano real. Dios tiene cabello oscuro mojado, rostro compasivo, túnica blanca empapada. El hombre llora: "¡Me abandonaste cuando más te necesitaba!"
[4s–7s]: El hombre agarra la túnica de Dios llorando. Un meteorito gigante choca contra el mar. Explosión masiva. Truenos.
[7s–10s]: Lágrimas bajan por el rostro tembloroso. Ve el tsunami formándose detrás de Dios.
[10s–13s]: El hombre cae de rodillas. Dios lo abraza profundamente. El tsunami avanza.
[13s–15s]: Dios susurra: "Siempre estaré contigo." La ola los consume. Luz divina brilla por última vez.`,
    },
    female: {
      en: `[CRITICAL ACTING DIRECTION: The character in @image1 MUST perform intense emotional acting. Real tears, trembling lips, anguish. Maximum emotional performance. Hollywood drama level.]
[Global style: emotional cinematic realism, Hollywood disaster film, hyperrealistic, dramatic storm, realistic ocean, film grain, 8K, stable framing]
${R1_EN}
[0s–4s]: A devastated woman screams emotionally at God as a real human being. God has long wet dark hair, compassionate face, aged white robe. She cries: "You abandoned me! You abandoned me when I needed you most!"
[4s–7s]: She grabs God's robe while crying. A gigantic meteor crashes into the sea. Massive explosion. Thunder.
[7s–10s]: Tears stream down her trembling face. She realizes the tsunami forming behind God. Hyper realistic facial detail.
[10s–13s]: She falls to her knees. God kneels and embraces her deeply. The colossal tsunami races toward them.
[13s–15s]: God whispers: "I will always be with you." The massive wave crashes over them. Divine light shines briefly through darkness.`,
      es: `[DIRECCIÓN CRÍTICA: El personaje en @image1 DEBE actuar con emoción máxima. Lágrimas, angustia, drama Hollywood.]
${R1_ES}
[0s–4s]: Una mujer devastada grita a Dios como ser humano real con túnica blanca empapada. Llora: "¡Me abandonaste cuando más te necesitaba!"
[4s–7s]: Agarra la túnica llorando. Meteorito gigante choca contra el mar. Explosión. Truenos.
[7s–10s]: Lágrimas en su rostro tembloroso. Ve el tsunami detrás de Dios.
[10s–13s]: Cae de rodillas. Dios la abraza. El tsunami avanza.
[13s–15s]: Dios susurra: "Siempre estaré contigo." La ola los consume. Luz divina final.`,
    },
  },

  coupleDisaster: {
    female: {
      en: `[CRITICAL ACTING DIRECTION: BOTH characters MUST perform intense emotional acting. Real tears, trembling lips, faces contorted in pain and rage. Hollywood drama level. NO static faces.]
[Global style: emotional cinematic realism, Hollywood disaster romance, hyperrealistic, storm atmosphere, realistic ocean, film grain, 8K, stable framing, natural audio only]
${R1_EN} The WOMAN matches the reference images. The MAN is a handsome AI-generated character with strong features and rugged appearance.
[0s–4s]: A young couple on a coastal cliff during a massive storm. The woman cries: "You were never there when I needed you! You always left me alone!" The man shouts back: "I did everything for us and it was never enough!"
[4s–7s]: A gigantic meteor crashes into the ocean below. Colossal explosion. The woman screams: "NO! I DON'T WANT TO DIE!"
[7s–11s]: The woman collapses into the man's arms crying. An enormous tsunami rises behind them. He whispers: "Look at me… calm down… everything will be okay…"
[11s–13s]: They look into each other's eyes with fear and love. "I'm scared…" / "Me too…" One final kiss. Lightning illuminates the wave.
[13s–15s]: The tsunami crashes over the cliff consuming them completely. Emotionally tragic ending.`,
      es: `[DIRECCIÓN CRÍTICA: AMBOS personajes actúan con emoción máxima. Lágrimas, rabia, drama Hollywood.]
${R1_ES} La MUJER coincide con las referencias. El HOMBRE es generado por IA.
[0s–4s]: Pareja en acantilado durante tormenta masiva. La mujer llora: "¡Nunca estuviste cuando te necesitaba!" El hombre: "¡Hice todo por nosotros y nunca fue suficiente!"
[4s–7s]: Meteorito gigante choca contra el océano. La mujer grita: "¡NO QUIERO MORIR!"
[7s–11s]: La mujer colapsa en sus brazos. Tsunami enorme detrás. Él susurra: "Mírame… todo estará bien…"
[11s–13s]: Se miran con miedo y amor. Último beso. Relámpagos iluminan la ola.
[13s–15s]: El tsunami los cubre completamente. Final trágico.`,
    },
    male: {
      en: `[CRITICAL ACTING DIRECTION: BOTH characters MUST perform intense emotional acting. Real tears, trembling lips, Hollywood drama level.]
[Global style: emotional cinematic realism, Hollywood disaster romance, hyperrealistic, storm atmosphere, 8K, stable framing]
${R1_EN} The MAN matches the reference images. The WOMAN is a beautiful AI-generated character with expressive features.
[0s–4s]: Couple on coastal cliff during massive storm. The woman screams: "You were never there for me!" The man: "I did everything for us and it was never enough!"
[4s–7s]: Gigantic meteor crashes into ocean. The woman screams: "NO! I DON'T WANT TO DIE!"
[7s–11s]: She collapses into his arms. Enormous tsunami rises behind them. He whispers: "Look at me… everything will be okay…"
[11s–13s]: They look into each other's eyes. "I'm scared…" / "Me too…" Final kiss. Lightning illuminates the wave.
[13s–15s]: The tsunami crashes over them completely. Emotionally tragic ending.`,
      es: `[DIRECCIÓN CRÍTICA: AMBOS personajes con emoción máxima. Drama Hollywood.]
${R1_ES} El HOMBRE coincide con las referencias. La MUJER es generada por IA.
[0s–4s]: Pareja en acantilado. La mujer grita: "¡Nunca estuviste para mí!" Él: "¡Hice todo y nunca fue suficiente!"
[4s–7s]: Meteorito choca contra el océano. La mujer: "¡NO QUIERO MORIR!"
[7s–11s]: Ella colapsa en sus brazos. Tsunami enorme. Él susurra: "Mírame… todo estará bien…"
[11s–13s]: Se miran con miedo y amor. Último beso. Relámpagos.
[13s–15s]: El tsunami los cubre. Final trágico.`,
    },
    both: {
      en: `[CRITICAL ACTING DIRECTION: BOTH characters MUST perform intense emotional acting. Real tears, Hollywood drama level.]
[Global style: emotional cinematic realism, Hollywood disaster romance, hyperrealistic, storm atmosphere, 8K, stable framing]
${R2_EN}
[0s–4s]: Couple on coastal cliff during massive storm. The woman screams: "You were never there for me!" The man: "I did everything for us and it was never enough!"
[4s–7s]: Gigantic meteor crashes into ocean. The woman screams: "NO! I DON'T WANT TO DIE!"
[7s–11s]: She collapses into his arms. Enormous tsunami rises behind them. He whispers: "Look at me… everything will be okay…"
[11s–13s]: They look into each other's eyes with fear and love. Final kiss. Lightning illuminates the wave.
[13s–15s]: The tsunami crashes over them completely. Emotionally tragic ending.`,
      es: `[DIRECCIÓN CRÍTICA: AMBOS personajes con emoción máxima. Drama Hollywood.]
${R2_ES}
[0s–4s]: Pareja en acantilado. La mujer: "¡Nunca estuviste para mí!" Él: "¡Hice todo y nunca fue suficiente!"
[4s–7s]: Meteorito choca contra el océano. La mujer: "¡NO QUIERO MORIR!"
[7s–11s]: Ella colapsa en sus brazos. Tsunami enorme. Él: "Mírame… todo estará bien…"
[11s–13s]: Se miran con miedo y amor. Último beso. Relámpagos.
[13s–15s]: El tsunami los cubre. Final trágico.`,
    },
  },

  victoriasSecret: {
    female: {
      en: `[Global style: ultra luxury swimwear fashion campaign, Victoria's Secret inspired, cinematic beauty commercial, hyperrealistic, glamorous tropical atmosphere, golden sunlight, 8K]
${R1_EN} The MODEL is a woman matching the reference images.
[0s–3s]: Wide cinematic shot — slow motion tracking. A stunning supermodel walks barefoot along a luxurious tropical beach during golden hour. She wears an elegant white luxury swimsuit with flowing translucent fabric. Confident runway energy, graceful posture, cinematic lens flare.
[3s–6s]: Medium close-up — slow push-in. Wet hair moves softly in warm wind while golden sunlight reflects across her skin. She looks directly toward the camera with calm confidence and subtle sensuality. Turquoise ocean blurs softly in background.
[6s–9s]: Full body tracking shot — smooth side camera movement. The model walks beside an infinity pool at a luxury resort. Flowing fabric trails dramatically. High fashion movement, polished magazine-quality visuals.
[9s–12s]: Close-up — camera steady. She slowly adjusts oversized luxury sunglasses while smiling subtly. Wind lifts her hair naturally. Elegant jewelry sparkles gently.
[12s–15s]: Wide sunset shot — slow dolly out. She stands at the beach edge facing the glowing sunset. Flowing fabric moves elegantly. Timeless beauty campaign aesthetic.`,
      es: `[Estilo global: campaña de moda de lujo, inspiración Victoria's Secret, cinematográfico, hiperrealista, atmósfera tropical glamorosa, luz dorada, 8K]
${R1_ES} La MODELO es una mujer que coincide con las referencias.
[0s–3s]: La modelo camina descalza por una playa tropical de lujo durante la hora dorada. Traje de baño blanco elegante con tela translúcida fluyendo. Energía de pasarela, postura graciosa.
[3s–6s]: Primer plano medio. Cabello mojado en viento cálido. Mira directamente a la cámara con confianza y sensualidad sutil. Océano turquesa desenfocado.
[6s–9s]: Toma de cuerpo completo. Camina junto a piscina infinita en resort de lujo. Tela fluida dramática. Visuals de calidad de revista.
[9s–12s]: Primer plano. Ajusta lentes de sol de lujo sonriendo sutilmente. Viento levanta su cabello. Joyas brillan.
[12s–15s]: Plano amplio al atardecer. De pie en la orilla mirando el horizonte. Final cinematográfico de lujo atemporal.`,
    },
  },

  luchaTitanes: {
    male: {
      en: `The man in @image1. Reference character consistency: keep the exact face, hairstyle, facial features, and body proportions from the reference image. Consistent appearance throughout the full sequence. Realistic human appearance, anatomically correct, detailed natural hands, grounded physics, physically accurate motion flow.
[Global style: ultra-cinematic, epic scale, hyper-realistic, high contrast, deep shadows, atmospheric depth, subtle film grain]
[0s–3s]: Extreme wide aerial shot — high-speed tracking shot following him. He blasts forward at violent high speed above a vast open ocean under towering storm clouds. The ocean reacts explosively beneath him, waves tearing apart into long streaks, dense mist trails behind his body like a shockwave.
[3s–6s]: Wide shot — slow cinematic push-in. A colossal water elemental erupts upward from a mountain-sized wave, its body forming from massive spiraling vortex currents, glowing intense green-blue eyes illuminating the storm. It lunges forward with overwhelming force, a gigantic arm crashing toward him. He leans backward mid-air with precise control, narrowly evading the impact.
[6s–9s]: Medium action shot — camera holds fixed. He snaps forward with a devastating punch. The collision detonates into a massive explosion of water, shockwaves rippling outward across the ocean surface. He lands and sprints across the water at high speed, each step creating explosive splashes and trailing vapor.
[9s–12s]: Wide action shot — aggressive tracking shot. The creature swings another enormous arm with crushing force. He drops into a fast low slide beneath it, water slicing apart around him, then launches upward into a powerful spinning kick. The elemental body violently distorts, massive volumes of water bursting outward.
[12s–15s]: Medium close action shot — dynamic tracking. A gigantic water hand closes in, nearly capturing him. Time stretches into slow motion, droplets suspended in the air, lightning flashing across the sky. He twists sharply at the last instant, escapes, then accelerates forward explosively into a final high-speed punch-and-kick combination. A colossal water explosion engulfs the frame, the creature collapsing into a raging ocean as thick mist and spray consume the scene.
Lighting: dark storm clouds, dramatic high-contrast lighting, frequent lightning flashes, intense green-blue bioluminescent glow from the creature reflecting across the water. Smooth motion, stable framing, consistent lighting, consistent appearance.`,
      es: `El hombre en @image1. Consistencia de personaje: mantener el rostro exacto, peinado, rasgos faciales y proporciones corporales de la imagen de referencia. Apariencia consistente en toda la secuencia. Apariencia humana realista, anatomicamente correcto, física precisa.
[Estilo global: ultra-cinematografico, escala epica, hiper-realista, alto contraste, sombras profundas, grano de pelicula sutil]
[0s–3s]: Plano aereo extremo — seguimiento a alta velocidad. Avanza violentamente sobre un vasto oceano bajo nubes de tormenta masivas. El oceano reacciona explosivamente, las olas se separan en trazos largos, niebla densa se arrastra detras como onda de choque.
[3s–6s]: Plano amplio — acercamiento cinematografico lento. Un elemental de agua colosal erupciona desde una ola del tamano de una montana, ojos verde-azul brillantes iluminando la tormenta. Se abalanza con fuerza abrumadora. El se inclina hacia atras evadiendo por poco.
[6s–9s]: Toma de accion media — camara fija. Lanza un punetazo devastador. Explosion masiva de agua, ondas de choque en la superficie. Corre sobre el agua a alta velocidad.
[9s–12s]: Toma de accion amplia. La criatura lanza un brazo enorme. El se desliza rapido por debajo, luego lanza una patada giratoria poderosa. El cuerpo del elemental se distorsiona violentamente.
[12s–15s]: Toma de accion media cercana. Una mano gigante se acerca en camara lenta, gotas suspendidas, relampagos. Se tuerce en el ultimo instante y entrega combinacion final explosiva. Explosion colosal de agua engulle el encuadre.
Iluminacion: nubes oscuras, alto contraste dramatico, relampagos frecuentes, brillo bioluminiscente verde-azul intenso. Movimiento suave, encuadre estable.`,
    },
    female: {
      en: `The woman in @image1. Reference character consistency: keep the exact face, hairstyle, facial features, and body proportions from the reference image. Consistent appearance throughout the full sequence. Realistic human appearance, anatomically correct, physically accurate motion flow.
[Global style: ultra-cinematic, epic scale, hyper-realistic, high contrast, deep shadows, atmospheric depth, subtle film grain]
[0s–3s]: Extreme wide aerial shot — high-speed tracking shot following her. She blasts forward at violent high speed above a vast open ocean under towering storm clouds. The ocean reacts explosively beneath her, waves tearing apart into long streaks, dense mist trails behind her body like a shockwave.
[3s–6s]: Wide shot — slow cinematic push-in. A colossal water elemental erupts upward from a mountain-sized wave, glowing intense green-blue eyes illuminating the storm. It lunges with overwhelming force. She leans backward mid-air with precise control, narrowly evading the impact.
[6s–9s]: Medium action shot — camera holds fixed. She snaps forward with a devastating punch. Massive explosion of water, shockwaves rippling outward. She sprints across the water at high speed.
[9s–12s]: Wide action shot. The creature swings an enormous arm with crushing force. She drops into a fast slide beneath it, then launches into a powerful spinning kick. The elemental body violently distorts.
[12s–15s]: Medium close action shot — dynamic tracking. A gigantic water hand closes in. Time stretches into slow motion. She twists sharply at the last instant and delivers a final explosive combination. Colossal water explosion engulfs the frame.
Lighting: dark storm clouds, dramatic high-contrast lighting, lightning flashes, intense green-blue bioluminescent glow. Smooth motion, stable framing, consistent appearance.`,
      es: `La mujer en @image1. Consistencia de personaje: mantener el rostro exacto, peinado, rasgos faciales y proporciones corporales. Apariencia consistente. Realismo humano, fisica precisa.
[Estilo global: ultra-cinematografico, epico, hiper-realista, alto contraste, grano de pelicula]
[0s–3s]: Plano aereo extremo. Avanza violentamente sobre el oceano. Olas se separan, niebla densa detras como onda de choque.
[3s–6s]: Elemental de agua colosal con ojos verde-azul brillantes. Se lanza con fuerza. Ella evade por poco inclinandose hacia atras.
[6s–9s]: Punetazo devastador. Explosion masiva de agua. Corre sobre el agua a alta velocidad.
[9s–12s]: La criatura lanza un brazo enorme. Ella se desliza y lanza patada giratoria poderosa. El elemental se distorsiona.
[12s–15s]: Mano gigante en camara lenta. Se tuerce en el ultimo instante. Combinacion final explosiva. Explosion colosal. Relampagos dramaticos. Movimiento suave, encuadre estable.`,
    },
  },

};

function getPrompt(templateId, genderVariant, lang) {
  const p = PROMPTS[templateId]?.[genderVariant]?.[lang] || PROMPTS[templateId]?.[genderVariant]?.["en"];
  if (!p) throw new Error("No prompt for " + templateId + "/" + genderVariant + "/" + lang);
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
    faceUrl, profileUrl, face2Url, profile2Url, bodyUrl,
  } = body;

  if (!templateId || !genderVariant || !faceUrl) {
    return res.status(400).json({ ok: false, error: "Missing required fields" });
  }

  const jadeCost = JADE_COST[quality];
  if (!jadeCost) return res.status(400).json({ ok: false, error: "Invalid quality" });

  const ref = globalThis.crypto?.randomUUID?.() || (Date.now() + "-" + Math.random());

  const { error: spendErr } = await supabaseAdmin.rpc("spend_jades", {
    p_user_id: userId, p_amount: jadeCost, p_reason: "template_generate", p_ref: ref,
  });
  if (spendErr) {
    if ((spendErr.message || "").includes("INSUFFICIENT_JADES"))
      return res.status(402).json({ ok: false, error: "INSUFFICIENT_JADES", detail: "Necesitas " + jadeCost + " Jades." });
    return res.status(400).json({ ok: false, error: spendErr.message });
  }

  try {
    let imageUrls;
    if (genderVariant === "both") {
      imageUrls = [faceUrl, face2Url].filter(Boolean);
    } else {
      imageUrls = [faceUrl].filter(Boolean);
    }

    const isDrama = ["divineLight", "divineHuman", "coupleDisaster"].includes(templateId);
    const videoAspectRatio = isDrama ? "21:9" : "9:16";
    const videoDuration    = 10;

    let promptText = getPrompt(templateId, genderVariant, lang);
    if (bodyUrl) {
      imageUrls.push(bodyUrl);
      imageUrls = imageUrls.slice(0, 2);
      promptText += "\n\n[BODY REFERENCE: Use ONLY for body proportions. Do NOT copy the clothing.]";
    }

    console.log("[submit-video] user=" + userId + " template=" + templateId + " gender=" + genderVariant + " images=" + imageUrls.length);

    const evolinkRes = await fetch("https://api.evolink.ai/v1/videos/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + process.env.EVOLINK_API_KEY,
      },
      body: JSON.stringify({
        model:          "seedance-2.0-fast-image-to-video",
        prompt:         promptText,
        image_urls:     imageUrls,
        aspect_ratio:   videoAspectRatio,
        duration:       videoDuration,
        quality:        quality === "720" ? "720p" : "480p",
        generate_audio: true,
      }),
    });

    const evolinkData = await evolinkRes.json();
    console.log("[submit-video] EvoLink status=" + evolinkData.status + " id=" + evolinkData.id);

    if (!evolinkRes.ok || evolinkData.error) {
      throw new Error(evolinkData.error?.message || evolinkData.message || "EvoLink error " + evolinkRes.status);
    }

    const taskId = evolinkData.id;
    if (!taskId) throw new Error("EvoLink no devolvio task id");

    const jobId = globalThis.crypto?.randomUUID?.() || (Date.now() + "-" + Math.random());
    await supabaseAdmin.from("video_jobs").insert({
      id: jobId, user_id: userId, status: "IN_PROGRESS", mode: "template",
      prompt: promptText.slice(0, 500), provider: "evolink_seedance2fast",
      provider_request_id: taskId, provider_status: "pending",
      started_at: new Date().toISOString(),
      payload: { task_id: taskId, template_id: templateId, gender_variant: genderVariant, quality, jade_cost: jadeCost, ref },
    });

    console.log("[submit-video] EvoLink OK jobId=" + jobId + " taskId=" + taskId);
    return res.status(200).json({ ok: true, jobId, taskId, jadeCost });

  } catch (err) {
    try { await supabaseAdmin.rpc("spend_jades", { p_user_id: userId, p_amount: -jadeCost, p_reason: "template_refund_error", p_ref: ref }); } catch {}
    console.error("[submit-video] error:", err.message);
    return res.status(500).json({ ok: false, error: "Error generando video. Jades reembolsados." });
  }
}

export const config = { runtime: "nodejs" };
