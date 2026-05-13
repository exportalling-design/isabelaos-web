// api/templates/submit-video.js
// Modelo: Seedance 2 Fast — Omni Reference (acepta imágenes de referencia)
// Sube imágenes a Supabase Storage → envía URLs a PiAPI (no base64)
import { supabaseAdmin }          from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

const JADE_COST = { "480": 30, "720": 60 };

// ── NOTAS DE REFERENCIA ────────────────────────────────────────────────────
const R1_EN = "The main character's face and appearance must EXACTLY match the provided reference images (image1 = front face, image2 = multi-angle profile sheet). Maintain consistent identity throughout all shots.";
const R1_ES = "El rostro del personaje principal debe coincidir EXACTAMENTE con las imágenes de referencia proporcionadas (imagen1 = rostro frontal, imagen2 = hoja de perfiles multi-ángulo). Mantener identidad consistente en todos los planos.";
const R2_EN = "The MAN's face must match image1 (front face) and image2 (profile sheet). The WOMAN's face must match image3 (front face) and image4 (profile sheet). Maintain consistent identity throughout all shots for both characters.";
const R2_ES = "El rostro del HOMBRE debe coincidir con imagen1 (rostro frontal) e imagen2 (hoja de perfiles). El rostro de la MUJER debe coincidir con imagen3 e imagen4. Mantener identidad consistente en todos los planos para ambos personajes.";

// ── PROMPTS ORIGINALES COMPLETOS ───────────────────────────────────────────
const PROMPTS = {

  // ── DIVINE LIGHT ──────────────────────────────────────────────────────────
  divineLight: {
    male: {
      en: `[Global style: cinematic Hollywood disaster drama, hyperrealistic, ultra detailed, emotional intensity, volumetric lighting, realistic water physics, 8K, film grain, shallow depth of field, stable framing]
${R1_EN}
[0s–3s]: Wide shot — slow dolly in. A devastated man stands alone in a dark grassy field beside a violent ocean during a storm at blue hour. He screams at a glowing divine figure standing before him, crying with rage: "You abandoned me! You abandoned me when I needed you most!" Powerful wind bends the grass violently. Dramatic overcast lighting with strong heavenly rim light around God.
[3s–6s]: Medium shot — handheld with slight natural shake. The emotional argument intensifies. The man points angrily at God while crying uncontrollably. Suddenly, a gigantic meteor blazes across the stormy sky and crashes explosively into the ocean behind them. A violent eruption of water rises into the air, creating a massive tsunami. Thunder and shockwaves shake the environment.
[6s–9s]: Extreme close-up — camera holds fixed framing. Tears stream down the man's face as his anger breaks into deep emotional pain. His eyes tremble while reflecting the gigantic tsunami rapidly approaching behind him. Realistic skin texture, natural crying motion, emotionally devastating performance.
[9s–12s]: Wide shot — gradual dolly out. The broken man collapses to his knees in the field. God slowly kneels and embraces him with compassion while the colossal wall of water races toward them at terrifying speed. Warm divine light contrasts against the cold storm atmosphere. Wind and water particles whip violently around them.
[12s–15s]: Medium close shot — slow push-in. God holds the crying man tightly and whispers softly, "I will always be with you." The gigantic tsunami crashes over them completely in an explosive wall of water and mist. Their silhouettes vanish beneath the wave as divine light briefly shines through the darkness. Epic cinematic ending, emotionally overwhelming, realistic water simulation, smooth motion, stable framing.`,

      es: `[Estilo global: drama cinematográfico de Hollywood, hiperrealista, ultra detallado, intensidad emocional, iluminación volumétrica, física de agua realista, 8K, grano de película, poca profundidad de campo, encuadre estable]
${R1_ES}
[0s–3s]: Plano general — dolly lento hacia adelante. Un hombre devastado está solo en un campo oscuro junto a un océano violento durante una tormenta al azul del atardecer. Le grita a una figura divina resplandeciente frente a él, llorando con rabia: "¡Me abandonaste! ¡Me abandonaste cuando más te necesitaba!" El viento fuerte dobla violentamente la hierba. Iluminación dramática nublada con fuerte luz celestial alrededor de Dios.
[3s–6s]: Plano medio — cámara en mano con ligero movimiento natural. La discusión emocional se intensifica. El hombre señala a Dios con ira mientras llora sin control. De repente, un enorme meteorito cruza el cielo tormentoso y choca explosivamente contra el océano. Una violenta erupción de agua sube al aire, creando un tsunami masivo.
[6s–9s]: Primer plano extremo — cámara fija. Las lágrimas bajan por el rostro del hombre mientras su ira se convierte en dolor profundo. Sus ojos tiemblan reflejando el gigantesco tsunami que se acerca. Textura de piel realista, llanto natural, actuación emocionalmente devastadora.
[9s–12s]: Plano general — dolly lento hacia afuera. El hombre quebrantado cae de rodillas. Dios se arrodilla y lo abraza con compasión mientras la colosal pared de agua se acerca a velocidad aterradora. Luz divina cálida contrasta con la fría tormenta.
[12s–15s]: Plano medio cercano — lento acercamiento. Dios sostiene al hombre llorando y susurra suavemente: "Siempre estaré contigo." El gigantesco tsunami los cubre completamente en una pared explosiva de agua y neblina. Sus siluetas desaparecen bajo la ola mientras la luz divina brilla brevemente en la oscuridad. Final cinematográfico épico.`,
    },

    female: {
      en: `[Global style: cinematic Hollywood disaster drama, hyperrealistic, ultra detailed, emotional intensity, volumetric lighting, realistic water physics, 8K, film grain, shallow depth of field, stable framing]
${R1_EN}
[0s–3s]: Wide shot — slow dolly in. A devastated woman stands alone in a dark grassy field beside a violent ocean during a storm at blue hour. She screams at a glowing divine figure standing before her, crying with rage: "You abandoned me! You abandoned me when I needed you most!" Powerful wind whips her hair and bends the grass violently. Dramatic overcast lighting with strong heavenly rim light around God.
[3s–6s]: Medium shot — handheld with slight natural shake. The emotional argument intensifies. The woman points angrily at God while crying uncontrollably. Suddenly, a gigantic meteor blazes across the stormy sky and crashes explosively into the ocean behind them. A violent eruption of water rises into the air, creating a massive tsunami. Thunder and shockwaves shake the environment.
[6s–9s]: Extreme close-up — camera holds fixed framing. Tears stream down the woman's face as her anger breaks into deep emotional pain. Her eyes tremble while reflecting the gigantic tsunami rapidly approaching behind her. Realistic skin texture, natural crying motion, emotionally devastating performance.
[9s–12s]: Wide shot — gradual dolly out. The broken woman collapses to her knees in the field. God slowly kneels and embraces her with compassion while the colossal wall of water races toward them at terrifying speed. Warm divine light contrasts against the cold storm atmosphere. Wind and water particles whip violently around them.
[12s–15s]: Medium close shot — slow push-in. God holds the crying woman tightly and whispers softly, "I will always be with you." The gigantic tsunami crashes over them completely in an explosive wall of water and mist. Their silhouettes vanish beneath the wave as divine light briefly shines through the darkness. Epic cinematic ending, emotionally overwhelming, realistic water simulation, smooth motion, stable framing.`,

      es: `[Estilo global: drama cinematográfico de Hollywood, hiperrealista, ultra detallado, intensidad emocional, iluminación volumétrica, física de agua realista, 8K, grano de película, poca profundidad de campo, encuadre estable]
${R1_ES}
[0s–3s]: Plano general — dolly lento. Una mujer devastada está sola en un campo oscuro junto a un océano violento durante una tormenta. Le grita a una figura divina resplandeciente: "¡Me abandonaste! ¡Me abandonaste cuando más te necesitaba!" El viento sacude su cabello y dobla la hierba violentamente.
[3s–6s]: Plano medio — cámara en mano. La discusión se intensifica. La mujer señala a Dios llorando. Un enorme meteorito choca contra el océano creando un tsunami masivo.
[6s–9s]: Primer plano extremo. Lágrimas bajan por el rostro de la mujer. Sus ojos reflejan el tsunami que se acerca. Textura de piel realista.
[9s–12s]: Plano general — dolly hacia afuera. La mujer cae de rodillas. Dios se arrodilla y la abraza mientras la pared de agua se acerca. Luz divina cálida contra la tormenta fría.
[12s–15s]: Plano medio cercano. Dios sostiene a la mujer y susurra: "Siempre estaré contigo." El tsunami los cubre en una pared explosiva de agua. Final cinematográfico épico.`,
    },
  },

  // ── DIVINE HUMAN ──────────────────────────────────────────────────────────
  divineHuman: {
    male: {
      en: `[Global style: emotional cinematic realism, Hollywood disaster film, hyperrealistic, natural performances, dramatic storm atmosphere, realistic ocean simulation, subtle film grain, shallow depth of field, blue-grey cinematic palette, 8K, physically accurate motion, stable framing]
${R1_EN}
[0s–4s]: Medium wide shot — slow push-in. A devastated man stands beside a stormy ocean on a dark coastal field at blue hour, screaming emotionally at God standing directly in front of him as a real human being. God has long wet dark hair, a tired compassionate face, and wears an aged dirty white robe soaked by rain and wind. The man cries uncontrollably, shouting: "You abandoned me! You abandoned me when I needed you most!" Heavy wind blows through their clothes and hair naturally. Realistic emotional acting, cinematic overcast lighting.
[4s–7s]: Medium shot — handheld with slight natural shake. The man grabs God's robe while crying and arguing face-to-face with him. God listens silently with sadness in his eyes like a father watching his son suffer. In the distant ocean behind them, a gigantic meteor suddenly tears through the cloudy sky and crashes violently into the sea. A massive explosion of water erupts upward. Thunder echoes across the coast.
[7s–10s]: Close-up — camera holds fixed framing. Tears stream down the man's trembling face as his anger collapses into heartbreak. He slowly realizes the gigantic tsunami forming behind God. Reflections of the rising wall of water appear in his wet eyes. Rain mixes with tears on his skin. Natural micro-expressions, hyper realistic facial detail.
[10s–13s]: Wide shot — gradual dolly out. Completely broken emotionally, the man falls to his knees. God immediately kneels with him and pulls him into a deep emotional embrace. The colossal tsunami races toward them across the ocean, towering behind their silhouettes. The white robe moves violently in the wind and rain. Warm divine light subtly surrounds them against the cold storm atmosphere.
[13s–15s]: Medium close shot — slow push-in. God holds the crying man tightly as the gigantic tsunami crashes toward them. Water mist and violent wind explode around their bodies. God whispers softly: "I will always be with you." The man breaks down crying in God's arms as the massive wave consumes both of them completely. Their silhouettes disappear beneath the water while a faint divine light shines through the darkness for a final moment.`,

      es: `[Estilo global: realismo cinematográfico emocional, película de desastre de Hollywood, hiperrealista, actuaciones naturales, atmósfera de tormenta dramática, simulación de océano realista, grano de película sutil, poca profundidad de campo, paleta cinematográfica azul-gris, 8K, movimiento físicamente preciso, encuadre estable]
${R1_ES}
[0s–4s]: Plano medio amplio — lento acercamiento. Un hombre devastado está junto a un océano tormentoso en un campo costero oscuro al azul del atardecer, gritando emocionalmente a Dios que está directamente frente a él como un ser humano real. Dios tiene el cabello oscuro mojado, un rostro cansado y compasivo, y viste una vieja túnica blanca empapada por la lluvia y el viento. El hombre llora incontrolablemente: "¡Me abandonaste! ¡Me abandonaste cuando más te necesitaba!" El viento fuerte sopla naturalmente por su ropa y cabello.
[4s–7s]: Plano medio — cámara en mano con ligero movimiento. El hombre agarra la túnica de Dios mientras llora y discute cara a cara. Dios escucha en silencio con tristeza en sus ojos. En el océano lejano, un enorme meteorito choca violentamente contra el mar. Una explosión masiva de agua erupciona hacia arriba. El trueno retumba por la costa.
[7s–10s]: Primer plano — cámara fija. Las lágrimas bajan por el rostro tembloroso del hombre mientras su ira se convierte en angustia. Lentamente se da cuenta del gigantesco tsunami que se forma detrás de Dios. Reflejos del agua aparecen en sus ojos mojados.
[10s–13s]: Plano general — dolly lento hacia afuera. Completamente quebrantado, el hombre cae de rodillas. Dios se arrodilla inmediatamente y lo abraza profundamente. El colosal tsunami avanza hacia ellos por el océano. La túnica blanca se mueve violentamente en el viento y la lluvia.
[13s–15s]: Plano medio cercano — lento acercamiento. Dios sostiene al hombre llorando mientras el gigantesco tsunami se acerca. Dios susurra suavemente: "Siempre estaré contigo." La ola masiva los consume completamente. Sus siluetas desaparecen bajo el agua mientras una tenue luz divina brilla por última vez.`,
    },

    female: {
      en: `[Global style: emotional cinematic realism, Hollywood disaster film, hyperrealistic, natural performances, dramatic storm atmosphere, realistic ocean simulation, subtle film grain, shallow depth of field, blue-grey cinematic palette, 8K, physically accurate motion, stable framing]
${R1_EN}
[0s–4s]: Medium wide shot — slow push-in. A devastated woman stands beside a stormy ocean on a dark coastal field at blue hour, screaming emotionally at God standing directly in front of her as a real human being. God has long wet dark hair, a tired compassionate face, and wears an aged dirty white robe soaked by rain and wind. The woman cries uncontrollably, shouting: "You abandoned me! You abandoned me when I needed you most!" Heavy wind blows through their clothes and hair naturally. Realistic emotional acting, cinematic overcast lighting.
[4s–7s]: Medium shot — handheld with slight natural shake. The woman grabs God's robe while crying and arguing face-to-face with him. God listens silently with sadness in his eyes like a father watching his daughter suffer. In the distant ocean behind them, a gigantic meteor suddenly tears through the cloudy sky and crashes violently into the sea. A massive explosion of water erupts upward. Thunder echoes across the coast.
[7s–10s]: Close-up — camera holds fixed framing. Tears stream down the woman's trembling face as her anger collapses into heartbreak. She slowly realizes the gigantic tsunami forming behind God. Reflections of the rising wall of water appear in her wet eyes. Rain mixes with tears on her skin. Natural micro-expressions, hyper realistic facial detail.
[10s–13s]: Wide shot — gradual dolly out. Completely broken emotionally, the woman falls to her knees. God immediately kneels with her and pulls her into a deep emotional embrace. The colossal tsunami races toward them across the ocean, towering behind their silhouettes. The white robe moves violently in the wind and rain.
[13s–15s]: Medium close shot — slow push-in. God holds the crying woman tightly as the gigantic tsunami crashes toward them. God whispers softly: "I will always be with you." The woman breaks down crying in God's arms as the massive wave consumes both of them completely. Their silhouettes disappear beneath the water while a faint divine light shines through the darkness for a final moment.`,

      es: `[Estilo global: realismo cinematográfico emocional, película de desastre de Hollywood, hiperrealista, actuaciones naturales, atmósfera de tormenta dramática, simulación de océano realista, grano de película sutil, poca profundidad de campo, paleta cinematográfica azul-gris, 8K, movimiento físicamente preciso, encuadre estable]
${R1_ES}
[0s–4s]: Plano medio amplio — lento acercamiento. Una mujer devastada junto a un océano tormentoso grita a Dios como ser humano real frente a ella. Dios tiene cabello oscuro mojado, rostro cansado y compasivo, túnica blanca vieja empapada. La mujer llora: "¡Me abandonaste! ¡Me abandonaste cuando más te necesitaba!"
[4s–7s]: Plano medio — cámara en mano. La mujer agarra la túnica de Dios discutiendo cara a cara. Dios escucha con tristeza como padre mirando sufrir a su hija. Un enorme meteorito choca contra el mar. Explosión masiva de agua.
[7s–10s]: Primer plano — cámara fija. Lágrimas bajan por el rostro tembloroso de la mujer. Ve el gigantesco tsunami formándose detrás de Dios. Reflejos del agua en sus ojos mojados.
[10s–13s]: Plano general — dolly hacia afuera. La mujer cae de rodillas. Dios la abraza profundamente. El colosal tsunami avanza hacia ellos.
[13s–15s]: Plano medio cercano. Dios susurra: "Siempre estaré contigo." La ola masiva los consume. Sus siluetas desaparecen bajo el agua.`,
    },
  },

  // ── COUPLE DISASTER ───────────────────────────────────────────────────────
  coupleDisaster: {
    female: {
      en: `[Global style: emotional cinematic realism, Hollywood disaster romance drama, hyperrealistic, intense emotional performances, realistic storm atmosphere, realistic ocean physics, blue-grey cinematic palette, shallow depth of field, film grain, 8K, physically accurate motion, stable framing, natural production audio only, no background music, realistic thunder, wind, ocean waves, rain ambience, clear emotional dialogue]
${R1_EN} The WOMAN is the character matching the reference images. The MAN is a handsome AI-generated character with strong features, wet dark hair, and rugged appearance — do NOT use the reference images for the man.
[0s–4s]: Medium wide shot — slow push-in. A young couple stands at the edge of a tall coastal cliff above a violent dark ocean during a massive storm at blue hour. Heavy rain pours down while powerful wind blows through their soaked clothes and hair. They argue emotionally face-to-face. The woman cries while screaming: "You were never there when I needed you! You always left me alone!" The man, heartbroken and frustrated, shouts back: "I did everything for us and it was never enough for you!" Dramatic overcast lighting, realistic rain and wind motion, natural emotional acting.
[4s–7s]: Wide shot — handheld with slight natural shake. Suddenly a gigantic meteor tears violently across the storm clouds and crashes into the ocean below the cliff. A colossal explosion of water erupts upward into the sky. Thunder and shockwaves shake the coastline violently. The couple turns toward the ocean in absolute terror. The woman begins screaming hysterically: "NO! I DON'T WANT TO DIE!" Realistic fear, chaotic storm atmosphere, violent ocean movement.
[7s–11s]: Medium close shot — camera holds fixed framing. The terrified woman collapses emotionally into the man's arms while crying uncontrollably. Behind them, an enormous tsunami rises rapidly across the horizon, illuminated by lightning flashes. The man holds her tightly, trembling with fear himself while whispering softly: "Look at me… calm down… everything will be okay…" Rain runs down their faces. Hyper realistic crying, natural trembling lips, emotional micro-expressions, realistic skin texture.
[11s–13s]: Close-up — slow push-in. The couple slowly separates from the embrace and looks deeply into each other's eyes with overwhelming fear and love. The violent wind blows through their wet hair while the colossal tsunami races toward the cliff behind them. The woman whispers through tears: "I'm scared…" The man replies softly: "Me too…" They lean toward each other and share one final emotional kiss. Cinematic lightning flashes illuminate the wave behind them.
[13s–15s]: Extreme wide shot — camera holds fixed framing. The gigantic tsunami crashes violently over the cliff in an explosive wall of water and mist, completely consuming the couple. Their silhouettes disappear beneath the massive wave as thunder roars across the dark ocean. Emotionally tragic ending, realistic water simulation, smooth motion, stable framing, natural storm audio only, no music.`,

      es: `[Estilo global: realismo cinematográfico emocional, drama romántico de desastre de Hollywood, hiperrealista, actuaciones emocionales intensas, atmósfera de tormenta realista, física de océano realista, paleta cinematográfica azul-gris, poca profundidad de campo, grano de película, 8K, movimiento físicamente preciso, encuadre estable, solo audio natural de producción, sin música de fondo, truenos realistas, viento, olas del océano, ambiente de lluvia, diálogo emocional claro]
${R1_ES} La MUJER es el personaje que coincide con las imágenes de referencia. El HOMBRE es un personaje generado por IA con rasgos fuertes, cabello oscuro mojado y apariencia atractiva — NO usar las imágenes de referencia para el hombre.
[0s–4s]: Plano medio amplio — lento acercamiento. Una pareja joven está al borde de un alto acantilado costero sobre un océano oscuro y violento durante una tormenta masiva al azul del atardecer. La lluvia intensa cae mientras el viento poderoso sopla por su ropa y cabello empapados. Discuten emocionalmente cara a cara. La mujer llora mientras grita: "¡Nunca estuviste cuando te necesitaba! ¡Siempre me dejaste sola!" El hombre, con el corazón destrozado: "¡Hice todo por nosotros y nunca fue suficiente para ti!"
[4s–7s]: Plano general — cámara en mano. De repente un enorme meteorito cruza violentamente las nubes de tormenta y choca contra el océano debajo del acantilado. Una colosal explosión de agua erupciona hacia el cielo. Los truenos y las ondas de choque sacuden la costa violentamente. La pareja se gira hacia el océano en terror absoluto. La mujer comienza a gritar histéricamente: "¡NO! ¡NO QUIERO MORIR!"
[7s–11s]: Plano medio cercano — cámara fija. La aterrorizada mujer colapsa emocionalmente en los brazos del hombre llorando incontrolablemente. Detrás de ellos, un enorme tsunami sube rápidamente por el horizonte, iluminado por destellos de relámpagos. El hombre la sostiene firmemente, temblando de miedo él mismo mientras susurra: "Mírame… tranquila… todo estará bien…"
[11s–13s]: Primer plano — lento acercamiento. La pareja se separa lentamente del abrazo y se mira profundamente a los ojos con miedo y amor abrumadores. La mujer susurra entre lágrimas: "Tengo miedo…" El hombre responde suavemente: "Yo también…" Se acercan y comparten un último beso emocional. Los relámpagos iluminan la ola detrás de ellos.
[13s–15s]: Plano general extremo — cámara fija. El gigantesco tsunami choca violentamente sobre el acantilado en una pared explosiva de agua y neblina, consumiendo completamente a la pareja. Sus siluetas desaparecen bajo la ola masiva mientras el trueno ruge por el oscuro océano. Final trágicamente emotivo.`,
    },

    male: {
      en: `[Global style: emotional cinematic realism, Hollywood disaster romance drama, hyperrealistic, intense emotional performances, realistic storm atmosphere, realistic ocean physics, blue-grey cinematic palette, shallow depth of field, film grain, 8K, physically accurate motion, stable framing, natural production audio only, no background music, realistic thunder, wind, ocean waves, rain ambience, clear emotional dialogue]
${R1_EN} The MAN is the character matching the reference images. The WOMAN is a beautiful AI-generated character with long flowing wet hair and emotional expressive features — do NOT use the reference images for the woman.
[0s–4s]: Medium wide shot — slow push-in. A young couple stands at the edge of a tall coastal cliff above a violent dark ocean during a massive storm at blue hour. Heavy rain pours down while powerful wind blows through their soaked clothes and hair. They argue emotionally face-to-face. The woman cries while screaming: "You were never there when I needed you! You always left me alone!" The man, heartbroken and frustrated, shouts back: "I did everything for us and it was never enough for you!" Dramatic overcast lighting, realistic rain and wind motion, natural emotional acting.
[4s–7s]: Wide shot — handheld with slight natural shake. Suddenly a gigantic meteor tears violently across the storm clouds and crashes into the ocean below the cliff. A colossal explosion of water erupts upward into the sky. Thunder and shockwaves shake the coastline violently. The couple turns toward the ocean in absolute terror. The woman begins screaming hysterically: "NO! I DON'T WANT TO DIE!"
[7s–11s]: Medium close shot — camera holds fixed framing. The terrified woman collapses emotionally into the man's arms while crying uncontrollably. Behind them, an enormous tsunami rises rapidly across the horizon. The man holds her tightly, trembling with fear himself while whispering softly: "Look at me… calm down… everything will be okay…" Rain runs down their faces. Hyper realistic crying, natural trembling lips, emotional micro-expressions.
[11s–13s]: Close-up — slow push-in. The couple looks deeply into each other's eyes with overwhelming fear and love. The woman whispers: "I'm scared…" The man replies: "Me too…" They share one final emotional kiss. Cinematic lightning flashes illuminate the wave.
[13s–15s]: Extreme wide shot — camera holds fixed framing. The gigantic tsunami crashes violently over the cliff consuming the couple completely. Their silhouettes disappear beneath the massive wave as thunder roars across the dark ocean. Emotionally tragic ending, realistic water simulation, smooth motion, stable framing, natural storm audio only, no music.`,

      es: `[Estilo global: realismo cinematográfico emocional, drama romántico de desastre de Hollywood, hiperrealista, actuaciones emocionales intensas, atmósfera de tormenta realista, física de océano realista, paleta cinematográfica azul-gris, poca profundidad de campo, grano de película, 8K, movimiento físicamente preciso, encuadre estable, solo audio natural de producción, sin música de fondo]
${R1_ES} El HOMBRE es el personaje que coincide con las imágenes de referencia. La MUJER es un personaje generado por IA con cabello largo mojado y rasgos expresivos — NO usar las imágenes de referencia para la mujer.
[0s–4s]: Plano medio amplio — lento acercamiento. Una pareja joven al borde de un alto acantilado costero. La mujer llora gritando: "¡Nunca estuviste cuando te necesitaba! ¡Siempre me dejaste sola!" El hombre responde: "¡Hice todo por nosotros y nunca fue suficiente para ti!"
[4s–7s]: Plano general — cámara en mano. Un enorme meteorito choca violentamente contra el océano. Explosión colosal. La mujer grita: "¡NO! ¡NO QUIERO MORIR!"
[7s–11s]: Plano medio cercano — cámara fija. La mujer colapsa en los brazos del hombre llorando. Un tsunami enorme sube por el horizonte. El hombre susurra: "Mírame… tranquila… todo estará bien…"
[11s–13s]: Primer plano — lento acercamiento. Se miran con miedo y amor. "Tengo miedo…" / "Yo también…" Un último beso. Los relámpagos iluminan la ola.
[13s–15s]: Plano general extremo. El tsunami los cubre completamente. Final trágicamente emotivo.`,
    },

    both: {
      en: `[Global style: emotional cinematic realism, Hollywood disaster romance drama, hyperrealistic, intense emotional performances, realistic storm atmosphere, realistic ocean physics, blue-grey cinematic palette, shallow depth of field, film grain, 8K, physically accurate motion, stable framing, natural production audio only, no background music, realistic thunder, wind, ocean waves, rain ambience, clear emotional dialogue]
${R2_EN}
[0s–4s]: Medium wide shot — slow push-in. A young couple stands at the edge of a tall coastal cliff above a violent dark ocean during a massive storm at blue hour. Heavy rain pours down while powerful wind blows through their soaked clothes and hair. They argue emotionally face-to-face. The woman cries while screaming: "You were never there when I needed you! You always left me alone!" The man, heartbroken and frustrated, shouts back: "I did everything for us and it was never enough for you!" Dramatic overcast lighting, realistic rain and wind motion, natural emotional acting.
[4s–7s]: Wide shot — handheld with slight natural shake. Suddenly a gigantic meteor tears violently across the storm clouds and crashes into the ocean below the cliff. A colossal explosion of water erupts upward into the sky. Thunder and shockwaves shake the coastline violently. The couple turns toward the ocean in absolute terror. The woman begins screaming hysterically: "NO! I DON'T WANT TO DIE!" Realistic fear, chaotic storm atmosphere, violent ocean movement.
[7s–11s]: Medium close shot — camera holds fixed framing. The terrified woman collapses emotionally into the man's arms while crying uncontrollably. Behind them, an enormous tsunami rises rapidly across the horizon, illuminated by lightning flashes. The man holds her tightly, trembling with fear himself while whispering softly: "Look at me… calm down… everything will be okay…" Rain runs down their faces. Hyper realistic crying, natural trembling lips, emotional micro-expressions, realistic skin texture.
[11s–13s]: Close-up — slow push-in. The couple slowly separates from the embrace and looks deeply into each other's eyes with overwhelming fear and love. The woman whispers through tears: "I'm scared…" The man replies softly: "Me too…" They lean toward each other and share one final emotional kiss. Cinematic lightning flashes illuminate the wave behind them.
[13s–15s]: Extreme wide shot — camera holds fixed framing. The gigantic tsunami crashes violently over the cliff in an explosive wall of water and mist, completely consuming the couple. Their silhouettes disappear beneath the massive wave as thunder roars across the dark ocean. Emotionally tragic ending, realistic water simulation, smooth motion, stable framing, natural storm audio only, no music.`,

      es: `[Estilo global: realismo cinematográfico emocional, drama romántico de desastre de Hollywood, hiperrealista, actuaciones emocionales intensas, atmósfera de tormenta realista, física de océano realista, paleta cinematográfica azul-gris, poca profundidad de campo, grano de película, 8K, movimiento físicamente preciso, encuadre estable, solo audio natural de producción, sin música de fondo, truenos realistas, viento, olas del océano, ambiente de lluvia, diálogo emocional claro]
${R2_ES}
[0s–4s]: Plano medio amplio — lento acercamiento. Una pareja joven está al borde de un alto acantilado costero sobre un océano oscuro y violento durante una tormenta masiva al azul del atardecer. La lluvia intensa cae mientras el viento poderoso sopla por su ropa y cabello empapados. Discuten emocionalmente cara a cara. La mujer llora mientras grita: "¡Nunca estuviste cuando te necesitaba! ¡Siempre me dejaste sola!" El hombre, con el corazón destrozado: "¡Hice todo por nosotros y nunca fue suficiente para ti!"
[4s–7s]: Plano general — cámara en mano. De repente un enorme meteorito cruza violentamente las nubes de tormenta y choca contra el océano debajo del acantilado. Una colosal explosión de agua erupciona hacia el cielo. Los truenos y las ondas de choque sacuden la costa violentamente. La pareja se gira hacia el océano en terror absoluto. La mujer comienza a gritar histéricamente: "¡NO! ¡NO QUIERO MORIR!"
[7s–11s]: Plano medio cercano — cámara fija. La aterrorizada mujer colapsa emocionalmente en los brazos del hombre llorando incontrolablemente. Detrás de ellos, un enorme tsunami sube rápidamente por el horizonte, iluminado por destellos de relámpagos. El hombre la sostiene firmemente mientras susurra: "Mírame… tranquila… todo estará bien…"
[11s–13s]: Primer plano — lento acercamiento. La pareja se separa lentamente del abrazo y se mira profundamente a los ojos con miedo y amor abrumadores. La mujer susurra entre lágrimas: "Tengo miedo…" El hombre responde suavemente: "Yo también…" Se acercan y comparten un último beso emocional.
[13s–15s]: Plano general extremo — cámara fija. El gigantesco tsunami choca violentamente sobre el acantilado consumiendo completamente a la pareja. Sus siluetas desaparecen bajo la ola masiva. Final trágicamente emotivo.`,
    },
  },

  // ── VICTORIA'S SECRET ──────────────────────────────────────────────────────
  victoriasSecret: {
    female: {
      en: `[Global style: ultra luxury swimwear fashion campaign, Victoria's Secret inspired aesthetic, cinematic beauty commercial, hyperrealistic, glamorous tropical atmosphere, golden sunlight, luxury resort energy, soft glowing skin, shallow depth of field, smooth motion, glossy fashion cinematography, elegant sensuality, high-end magazine aesthetic, 8K]
${R1_EN} The MODEL is a woman matching the reference images.
[0s–3s]: Wide cinematic shot — slow motion tracking shot. A stunning supermodel walks barefoot along the shoreline of a luxurious tropical beach during golden hour. Gentle ocean waves roll across the sand while warm sunlight creates a glowing halo around her hair and skin. She wears an elegant white luxury swimsuit with flowing translucent fabric moving naturally in the ocean breeze. Confident runway energy, graceful posture, cinematic lens flare, luxury beauty campaign aesthetic.
[3s–6s]: Medium close-up — slow push-in focused on the model's face and upper body. Wet hair moves softly in the warm wind while golden sunlight reflects across her skin. She looks directly toward the camera with calm confidence and subtle sensuality. Tropical palm trees and turquoise ocean blur softly in the background. Natural beauty, luxury editorial makeup, emotionally captivating gaze, elegant fashion commercial style.
[6s–9s]: Full body tracking shot — smooth side camera movement. The model walks beside an infinity pool overlooking the ocean at a luxury resort. Flowing fabric trails behind her dramatically while sunlight sparkles across the water. Cinematic swimsuit advertisement energy, high fashion movement, polished magazine-quality visuals, realistic skin texture, luxury resort atmosphere.
[9s–12s]: Close-up — camera holds steady. The model slowly adjusts oversized luxury sunglasses while smiling subtly. Wind lifts her hair naturally as sunlight illuminates her face with a soft golden glow. Elegant jewelry sparkles gently. Sophisticated confidence, iconic fashion campaign framing, luxury editorial realism.
[12s–15s]: Wide sunset shot — slow cinematic dolly out. The model stands at the edge of the beach facing the glowing sunset horizon while ocean waves wash softly around her feet. Flowing fabric moves elegantly behind her in the wind. Luxury cinematic ending, timeless beauty campaign aesthetic, hyperrealistic fashion photography style, soft golden sunset atmosphere.`,

      es: `[Estilo global: campaña de moda de trajes de baño ultra lujo, estética inspirada en Victoria's Secret, comercial de belleza cinematográfico, hiperrealista, atmósfera tropical glamorosa, luz dorada del sol, energía de resort de lujo, piel brillante suave, poca profundidad de campo, movimiento suave, cinematografía de moda brillante, sensualidad elegante, estética de revista de alta gama, 8K]
${R1_ES} La MODELO es una mujer que coincide con las imágenes de referencia.
[0s–3s]: Plano cinematográfico amplio — toma de seguimiento en cámara lenta. Una impresionante supermodelo camina descalza por la orilla de una lujosa playa tropical durante la hora dorada. Las suaves olas del océano ruedan por la arena mientras la luz cálida del sol crea un halo brillante alrededor de su cabello y piel. Viste un elegante traje de baño blanco de lujo con tela translúcida fluyendo naturalmente en la brisa del océano.
[3s–6s]: Primer plano medio — lento acercamiento al rostro y parte superior del cuerpo. El cabello mojado se mueve suavemente en el viento cálido mientras la luz dorada se refleja en su piel. Mira directamente hacia la cámara con confianza tranquila y sensualidad sutil. Las palmeras tropicales y el océano turquesa se desdibujan suavemente en el fondo.
[6s–9s]: Toma de cuerpo completo — movimiento lateral suave de cámara. La modelo camina junto a una piscina infinita con vista al océano en un resort de lujo. La tela fluida se arrastra detrás de ella dramáticamente mientras la luz del sol brilla en el agua.
[9s–12s]: Primer plano — cámara estable. La modelo ajusta lentamente sus lentes de sol de lujo mientras sonríe sutilmente. El viento levanta su cabello naturalmente mientras la luz del sol ilumina su rostro con un suave brillo dorado. Las joyas elegantes brillan suavemente.
[12s–15s]: Plano amplio al atardecer — dolly cinematográfico lento hacia afuera. La modelo está al borde de la playa mirando el horizonte brillante del atardecer mientras las olas del océano lavan suavemente sus pies. La tela fluida se mueve elegantemente detrás de ella en el viento. Final cinematográfico de lujo, estética de campaña de belleza atemporal.`,
    },
  },
};

function getPrompt(templateId, genderVariant, lang) {
  const p = PROMPTS[templateId]?.[genderVariant]?.[lang] || PROMPTS[templateId]?.[genderVariant]?.["en"];
  if (!p) throw new Error(`No prompt for ${templateId}/${genderVariant}/${lang}`);
  return p;
}

// ── Subir imagen a ImgBB → URL limpia que PiAPI acepta ───────────────────
// ImgBB no bloquea personas reales, URLs directas sin headers problemáticos
async function uploadToImgBB(base64, label) {
  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey) throw new Error("MISSING_IMGBB_API_KEY — agrega IMGBB_API_KEY en Vercel");

  const form = new URLSearchParams();
  form.append("key", apiKey);
  form.append("image", base64);
  form.append("name", `isabelaos-${label}-${Date.now()}`);
  form.append("expiration", "3600"); // expira en 1 hora — solo se usa para PiAPI

  const res = await fetch("https://api.imgbb.com/1/upload", {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ImgBB upload failed (${label}): ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data.success) throw new Error(`ImgBB error (${label}): ${data.error?.message || "unknown"}`);

  const url = data.data?.url;
  if (!url) throw new Error(`ImgBB no URL for ${label}`);
  console.log(`[submit-video] ImgBB OK (${label}): ${url.slice(0,60)}`);
  return url;
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
    // ── Subir imágenes → URLs ────────────────────────────────────────────────
    console.log(`[submit-video] Uploading images for user ${userId} template=${templateId}`);

    const faceUrl    = await uploadToImgBB(faceBase64, "face1");
    const profileUrl = await uploadToImgBB(profileBase64, "profile1");

    const references = [
      { url: faceUrl,    tag: "character" },
      { url: profileUrl, tag: "character" },
    ];

    if (face2Base64 && face2Mime) {
      const face2Url = await uploadToImgBB(face2Base64, "face2");
      references.push({ url: face2Url, tag: "character" });
    }
    if (profile2Base64 && profile2Mime) {
      const profile2Url = await uploadToImgBB(profile2Base64, "profile2");
      references.push({ url: profile2Url, tag: "character" });
    }

    let promptText = getPrompt(templateId, genderVariant, lang);

    if (bodyBase64 && bodyMime) {
      const bodyUrl = await uploadToImgBB(bodyBase64, "body");
      references.push({ url: bodyUrl, tag: "style" });
      promptText += "\n\n[BODY REFERENCE: Use ONLY for body proportions. Do NOT copy the clothing — use completely different scene-appropriate clothing.]";
    }

    console.log(`[submit-video] Sending ${references.length} URLs to PiAPI Seedance 2 Fast`);

    // ── PiAPI — Seedance 2 Fast — Omni Reference ─────────────────────────────
    const piRes = await fetch("https://api.piapi.ai/api/v1/task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.PIAPI_KEY,
      },
      body: JSON.stringify({
        model:     "seedance",
        task_type: "seedance-2-fast",
        input: {
          prompt:       promptText,
          mode:         "omni_reference",
          image_urls:   references.map((r) => r.url),
          duration:     15,
          aspect_ratio: "9:16",
          resolution:   quality === "720" ? "720p" : "480p",
        },
      }),
    });

    const piData = await piRes.json();
    console.log(`[submit-video] PiAPI response code=${piData.code} taskId=${piData.data?.task_id}`);

    if (!piRes.ok || (piData.code && piData.code !== 200)) {
      throw new Error(piData.message || `PiAPI error ${piRes.status}`);
    }

    const taskId = piData.data?.task_id;
    if (!taskId) throw new Error("PiAPI no devolvió task_id");

    // ── Guardar job ────────────────────────────────────────────────────────────
    const jobId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    await supabaseAdmin.from("video_jobs").insert({
      id: jobId, user_id: userId,
      status: "IN_PROGRESS", mode: "template",
      prompt: promptText.slice(0, 500),
      provider: "piapi_seedance2fast",
      provider_request_id: taskId,
      provider_status: "pending",
      started_at: new Date().toISOString(),
      payload: { task_id: taskId, template_id: templateId, gender_variant: genderVariant, quality, jade_cost: jadeCost, ref },
    });

    console.log(`[submit-video] OK jobId=${jobId} taskId=${taskId}`);
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
