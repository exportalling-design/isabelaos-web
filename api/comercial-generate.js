// api/comercial-generate.js
// ─────────────────────────────────────────────────────────────
// Script principal del módulo Comercial IA.
//
// ROUTING de video:
//   hasHumanFace=true  → PiAPI (Seedance 2.0 — soporta rostros reales)
//   hasHumanFace=false → BytePlus (Seedance 2.0 — no acepta rostros reales)
//   Si BytePlus detecta rostro → error FACE_DETECTED → frontend avisa al usuario
//
// Plantillas:
//   transicion_moda   → Gemini genera foto modelo+prenda por cada prenda → Seedance anima
//   producto_estelar  → Gemini genera escena épica del producto → BytePlus anima
//   explosion_sabor   → Gemini genera explosión de ingredientes → BytePlus anima
//   chef_ia           → Gemini genera chef con plato → PiAPI o BytePlus según rostro
//   comercial_completo → Storyboard Gemini → N escenas → PiAPI o BytePlus
//
// IMPORTANTE:
//   - El producto NUNCA cambia — se preserva exactamente en todos los efectos
//   - La modelo se mantiene idéntica en todas las prendas (Transición de Moda)
//   - Si no se sube modelo/fondo, la IA los inventa
// ─────────────────────────────────────────────────────────────
import { supabaseAdmin }          from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

const GEMINI_API_BASE    = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_IMAGE_MODEL = "gemini-2.0-flash-preview-image-generation";
const ELEVENLABS_BASE    = "https://api.elevenlabs.io/v1";
const BYTEPLUS_BASE      = "https://ark.ap-southeast.bytepluses.com/api/v3";
const BYTEPLUS_CREATE    = `${BYTEPLUS_BASE}/contents/generations/tasks`;
const BYTEPLUS_MODEL     = "dreamina-seedance-2-0-260128";
const PIAPI_URL          = "https://api.piapi.ai/api/v1/task";
const COMERCIAL_COST     = 120;

// ── Voces ElevenLabs ──────────────────────────────────────────
const VOICE_MAP = {
  neutro:       { mujer: "htFfPSZGJwjBv1CL0aMD", hombre: "htFfPSZGJwjBv1CL0aMD" },
  guatemalteco: { mujer: "MbMvLOFbicjtQwgx0j2r", hombre: "htFfPSZGJwjBv1CL0aMD" },
  colombiano:   { mujer: "qHkrJuifPpn95wK3rm2A", hombre: "o2vbTbO3g4GrKUg7rehy" },
  mexicano:     { mujer: "MPAa8GSBiMLjMLVwn0Hq", hombre: "1IVWxPHWEi1qouA3cAop" },
  argentino:    { mujer: "6Mo5ciGH5nWiQacn5FYk", hombre: "JNcXxzrlvFDXcrGo2b47" },
  español:      { mujer: "qHkrJuifPpn95wK3rm2A", hombre: "o2vbTbO3g4GrKUg7rehy" },
  ingles:       { mujer: "DXFkLCBUTmvXpp2QwZjA", hombre: "sB7vwSCyX0tQmU24cW2C" },
};
function getVoiceId(a, g) {
  return (VOICE_MAP[(a || "neutro").toLowerCase()] || VOICE_MAP.neutro)[
    (g || "mujer").toLowerCase() === "hombre" ? "hombre" : "mujer"
  ];
}

// ── Subir imagen temporal a Storage para obtener URL pública ──
async function uploadImageTemp(base64, mimeType, userId) {
  const ext  = mimeType.includes("png") ? "png" : "jpg";
  const path = `comercial/temp/${userId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabaseAdmin.storage
    .from("user-uploads")
    .upload(path, Buffer.from(base64, "base64"), { contentType: mimeType, upsert: false });
  if (error) throw new Error(`Error subiendo imagen: ${error.message}`);
  const { data } = supabaseAdmin.storage.from("user-uploads").getPublicUrl(path);
  return { url: data.publicUrl, path };
}

// ── Gemini Image: genera imagen de escena ─────────────────────
async function generateSceneImage(prompt, referenceImages = []) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("MISSING_GEMINI_API_KEY");
  const parts = [];
  for (const img of referenceImages.slice(0, 4))
    if (img?.base64 && img?.mimeType)
      parts.push({ inline_data: { mime_type: img.mimeType, data: img.base64 } });
  parts.push({ text: prompt });
  const r = await fetch(
    `${GEMINI_API_BASE}/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"], temperature: 0.3 },
      }),
    }
  );
  if (!r.ok) throw new Error(`Gemini error ${r.status}`);
  const data    = await r.json();
  const imgPart = data?.candidates?.[0]?.content?.parts?.find(
    p => p?.inlineData?.data || p?.inline_data?.data
  );
  if (!imgPart) throw new Error("Gemini no devolvió imagen.");
  const pd = imgPart.inlineData || imgPart.inline_data;
  return { base64: pd.data, mimeType: pd.mimeType || pd.mime_type || "image/jpeg" };
}

// ── BytePlus: imagen → video (sin rostros) ────────────────────
async function imageToVideoByteplus(imageUrl, videoPrompt, aspectRatio, duration) {
  const r = await fetch(BYTEPLUS_CREATE, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${process.env.BYTEPLUS_API_KEY}`,
    },
    body: JSON.stringify({
      model:   BYTEPLUS_MODEL,
      content: [
        { type: "image_url", image_url: { url: imageUrl } },
        { type: "text", text: `[Image 1] ${videoPrompt} --ratio ${aspectRatio} --duration ${duration} --resolution 720p` },
      ],
    }),
  });
  const data = await r.json();
  if (!r.ok || data.error) {
    const msg = data.error?.message || data.message || "";
    if (msg.toLowerCase().includes("real person") || msg.toLowerCase().includes("face"))
      throw new Error("FACE_DETECTED");
    throw new Error(msg || `BytePlus error ${r.status}`);
  }
  const taskId = data.id;
  if (!taskId) throw new Error("BytePlus no devolvió task id");

  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(res => setTimeout(res, 8000));
    const sr = await fetch(`${BYTEPLUS_BASE}/contents/generations/tasks/${taskId}`, {
      headers: { "Authorization": `Bearer ${process.env.BYTEPLUS_API_KEY}` },
    });
    const sd = await sr.json();
    if (sd.status === "succeeded") {
      if (!sd.content?.video_url) throw new Error("BytePlus sin video_url");
      return sd.content.video_url;
    }
    if (sd.status === "failed") {
      const msg = sd.error?.message || "";
      if (msg.toLowerCase().includes("real person") || msg.toLowerCase().includes("face"))
        throw new Error("FACE_DETECTED");
      throw new Error(msg || "BytePlus failed");
    }
  }
  throw new Error("Timeout BytePlus");
}

// ── PiAPI: imagen → video (con rostros reales — Seedance 2.0) ─
async function imageToVideoPiapi(imageUrl, videoPrompt, aspectRatio, duration) {
  const r = await fetch(PIAPI_URL, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key":    process.env.PIAPI_KEY,
    },
    body: JSON.stringify({
      model:     "seedance",
      task_type: "seedance-2-preview",
      input: {
        prompt:       `@image1 ${videoPrompt}`,
        image_urls:   [imageUrl],
        mode:         "omni_reference",
        duration,
        aspect_ratio: aspectRatio,
        resolution:   "720p",
      },
    }),
  });
  const data = await r.json();
  if (!r.ok || data.code !== 200) throw new Error(data?.message || `PiAPI error ${r.status}`);
  const taskId = data?.data?.task_id;
  if (!taskId) throw new Error("PiAPI no devolvió task_id");

  const deadline = Date.now() + 8 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(res => setTimeout(res, 8000));
    const sr  = await fetch(`https://api.piapi.ai/api/v1/task/${taskId}`, {
      headers: { "x-api-key": process.env.PIAPI_KEY },
    });
    const sd      = await sr.json();
    const status  = sd?.data?.status;
    const videoUrl =
      sd?.data?.output?.video     ||
      sd?.data?.output?.video_url ||
      sd?.data?.output?.url       ||
      null;
    if (status === "completed" && videoUrl) return videoUrl;
    if (status === "failed") throw new Error(sd?.data?.error?.message || "PiAPI failed");
  }
  throw new Error("Timeout PiAPI");
}

// ── Router: elige proveedor según hasHumanFace ────────────────
async function generateSceneVideo(imageUrl, videoPrompt, aspectRatio, duration, hasHumanFace) {
  if (hasHumanFace) return await imageToVideoPiapi(imageUrl, videoPrompt, aspectRatio, duration);
  return await imageToVideoByteplus(imageUrl, videoPrompt, aspectRatio, duration);
}

// ── Guardar video en biblioteca (Supabase Storage) ────────────
async function saveVideoToLibrary(userId, videoUrl) {
  try {
    const res    = await fetch(videoUrl);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const path   = `${userId}/comercial_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`;
    const { error } = await supabaseAdmin.storage
      .from("videos")
      .upload(path, buffer, { contentType: "video/mp4", upsert: false });
    if (error) throw new Error(error.message);
    const { data } = supabaseAdmin.storage.from("videos").getPublicUrl(path);
    return data?.publicUrl || videoUrl;
  } catch (err) {
    console.error("[comercial] saveVideo failed:", err.message);
    return videoUrl;
  }
}

// ── ElevenLabs: narración en off ──────────────────────────────
async function generateNarration(text, accent, gender) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || !text?.trim()) return null;
  const r = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${getVoiceId(accent, gender)}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.55, similarity_boost: 0.80, style: 0.35, use_speaker_boost: true },
    }),
  });
  if (!r.ok) return null;
  return { base64: Buffer.from(await r.arrayBuffer()).toString("base64"), mimeType: "audio/mpeg" };
}

// ── Prompts de imagen para Transición de Moda ─────────────────
// Gemini genera UNA foto realista de la modelo vistiendo la prenda.
// 4 casos según qué imágenes subió el usuario.
function buildModaImagePrompt(idx, total, hasModelo, hasFondo) {
  const scene = `outfit ${idx + 1} of ${total}`;
  if (hasModelo && hasFondo) {
    return [
      "You are a world-class fashion photographer shooting a luxury campaign.",
      "[Image 1] = REFERENCE MODEL — CRITICAL: preserve this exact person's face, skin tone, body proportions, hair color and style with 100% fidelity. This person MUST appear in the photo.",
      "[Image 2] = REFERENCE BACKGROUND — reproduce this exact location/environment as the setting.",
      "[Image 3] = CLOTHING ITEM — the model must be wearing this exact garment. Match the fabric texture, pattern, color, cut, buttons, zippers, every detail exactly.",
      `Generate: full body photo of the model wearing the clothing (${scene}), standing in the background location.`,
      "Camera: medium-full shot, model centered, 9:16 vertical portrait.",
      "Lighting: cinematic, golden hour or dramatic studio — matching the background mood.",
      "NO text, NO watermarks, NO logos anywhere in the image.",
    ].join(" ");
  }
  if (hasModelo) {
    return [
      "You are a world-class fashion photographer shooting a luxury campaign.",
      "[Image 1] = REFERENCE MODEL — CRITICAL: preserve this exact person's face, skin tone, body proportions, hair with 100% fidelity.",
      "[Image 2] = CLOTHING ITEM — the model must be wearing this exact garment. Match every detail of fabric, pattern, color, cut.",
      `Generate: full body photo of the model wearing the clothing (${scene}).`,
      `Invent a stunning aspirational background: ${["luxury resort poolside", "European cobblestone street", "modern minimalist studio", "rooftop city view at sunset"][idx % 4]}.`,
      "Camera: full body shot, 9:16 vertical. Cinematic lighting. NO text.",
    ].join(" ");
  }
  if (hasFondo) {
    return [
      "You are a world-class fashion photographer shooting a luxury campaign.",
      "[Image 1] = REFERENCE BACKGROUND — reproduce this exact location as the setting.",
      "[Image 2] = CLOTHING ITEM — generate a beautiful fashion model aged 20-28, diverse and aspirational, wearing this exact garment.",
      `Generate: full body photo (${scene}), model standing in the exact background provided.`,
      "Model: confident pose, professional, photorealistic. Camera: 9:16 vertical, full body. NO text.",
    ].join(" ");
  }
  // Solo ropa — IA inventa todo
  const backgrounds = [
    "luxury infinity pool at a 5-star resort, golden hour light, tropical palms",
    "sleek modern art museum interior, white walls, geometric architecture",
    "European fashion week street, cobblestones, elegant storefronts",
    "dramatic cliffside overlooking turquoise ocean at sunset",
  ];
  return [
    "You are a world-class fashion photographer shooting a luxury campaign.",
    "[Image 1] = CLOTHING ITEM — generate a stunning fashion model aged 20-28, aspirational and diverse, wearing this exact garment.",
    `Invent background: ${backgrounds[idx % 4]}.`,
    `Full body shot (${scene}), confident pose, cinematic lighting, 9:16 vertical portrait. NO text. NO watermarks.`,
  ].join(" ");
}

// ── Prompts épicos para Producto Estelar ──────────────────────
// El producto NUNCA cambia — es el protagonista absoluto.
// El efecto envuelve al producto sin alterarlo.
const EFECTOS_PRODUCTO = {
  golden_particles: {
    imagePrompt: [
      "Ultra-cinematic product hero shot. The EXACT product from [Image 1] floats centered in frame.",
      "CRITICAL: The product must appear IDENTICAL to the reference — same shape, label, color, every detail.",
      "Effect: thousands of luminous gold particles orbit the product in elegant spiraling streams,",
      "like a constellation forming around it. Particles catch light and shimmer.",
      "Background: pure black velvet void with subtle depth. Dramatic rim lighting makes the product glow.",
      "Mood: supreme luxury, Chanel/Dior campaign level. 9:16 vertical. NO text, NO logos other than on product.",
    ].join(" "),
    videoPrompt: "Product levitates slowly, golden particle streams spiral around it in mesmerizing orbits. Camera: slow push-in with subtle rotation. Golden light pulses. Cinematic slow motion. NO text.",
  },
  fire_energy: {
    imagePrompt: [
      "Epic cinematic product shot. The EXACT product from [Image 1] stands on a dark stage.",
      "CRITICAL: Product identical to reference — preserve all labels, colors, shape exactly.",
      "Effect: dramatic fire bursts erupt BEHIND and AROUND the product — deep orange and blue flames —",
      "but the product itself is pristine, untouched, illuminated by the fire's glow.",
      "Sparks rain down. Smoke curls artistically. Background: darkness with ember particles.",
      "Mood: power, energy, volcanic force. 9:16 vertical. Photorealistic, NO text.",
    ].join(" "),
    videoPrompt: "Flames erupt dramatically behind product, sparks fly in slow motion. Product stands perfect and untouched, lit by fire glow. Epic camera: low angle push-in. NO text.",
  },
  liquid_splash: {
    imagePrompt: [
      "Award-winning product photography. The EXACT product from [Image 1] emerges from a dramatic liquid splash.",
      "CRITICAL: Product completely identical to reference — label, color, shape preserved perfectly.",
      "Effect: a crown of crystal-clear liquid explodes upward around the product base,",
      "frozen in time. Droplets hang suspended in the air, refracting light like diamonds.",
      "Background: pure white or soft gradient. Studio lighting, ultra-sharp detail.",
      "Mood: freshness, purity, premium beauty brand. 9:16 vertical. NO text.",
    ].join(" "),
    videoPrompt: "Liquid crown explodes around product in ultra slow motion, droplets cascade beautifully. Product perfectly still in center. Camera: slow zoom reveal. Crystal clear water physics. NO text.",
  },
  crystal_smoke: {
    imagePrompt: [
      "Mysterious luxury product photograph. The EXACT product from [Image 1] sits surrounded by ethereal smoke.",
      "CRITICAL: Product identical to reference — every label, color, shape, detail preserved.",
      "Effect: translucent smoke wisps curl and swirl around the product like elegant spirits.",
      "Ice crystals form on nearby surfaces. Deep purple and indigo background with subtle light rays.",
      "Crystalline formations emerge from the base. Mood: mystery, high-end perfume campaign.",
      "9:16 vertical. Cinematic depth of field. NO text.",
    ].join(" "),
    videoPrompt: "Smoke curls hauntingly around product, ice crystals shimmer and form. Light rays pierce through smoke. Camera: slow orbit around product. Mysterious atmosphere. NO text.",
  },
  flower_petals: {
    imagePrompt: [
      "Editorial beauty product photography. The EXACT product from [Image 1] in a sea of flower petals.",
      "CRITICAL: Product completely identical to reference — label, color, shape exact.",
      "Effect: thousands of rose and cherry blossom petals rain down around the product,",
      "some resting gently on nearby surfaces. Soft bokeh background of lush blooms.",
      "Golden hour warm light creates a magical glow. Petals in motion frozen mid-fall.",
      "Mood: natural luxury, botanical beauty, Dior Garden campaign. 9:16 vertical. NO text.",
    ].join(" "),
    videoPrompt: "Rose petals rain down in slow motion around product, some twirling gracefully. Warm golden light. Camera: gentle upward tilt reveal. Magical dreamy atmosphere. NO text.",
  },
  electric_storm: {
    imagePrompt: [
      "Electrifying tech product photography. The EXACT product from [Image 1] at the center of an electric storm.",
      "CRITICAL: Product identical to reference — preserve all details, label, color, shape.",
      "Effect: electric blue lightning arcs reach toward the product from all directions",
      "but stop just before touching it — the product is the source of the energy.",
      "Plasma bolts, electric sparks, and energy rings surround it. Dark storm background.",
      "Mood: innovation, technology, power — Apple/Tesla campaign level. 9:16 vertical. NO text.",
    ].join(" "),
    videoPrompt: "Electric lightning arcs dramatically around product, energy pulses radiate outward. Product glows with inner power. Camera: slow dramatic push-in. Epic sound design energy. NO text.",
  },
};

// ── Prompt para Explosión de Sabor ────────────────────────────
function buildExplosionPrompt(nombreNegocio) {
  return [
    "Award-winning food photography for a premium restaurant campaign.",
    "The EXACT dish from [Image 1] — preserve all ingredients, colors, plating style.",
    "Effect: the dish EXPLODES outward in cinematic slow motion.",
    "Each ingredient separates dramatically:",
    "— The bun/bread flies upward with sesame seeds scattering",
    "— The main protein (meat/fish/etc) rises in the center, perfectly lit, textures visible",
    "— Cheese melts and stretches in long golden strings",
    "— Vegetables (lettuce, tomato, onion) spin outward like a galaxy",
    "— Sauces splash in elegant arcs, droplets frozen mid-air",
    "— Spices and seasonings float like cosmic dust",
    "Background: deep black with subtle warm smoke and atmospheric fog.",
    "Lighting: dramatic rim lights illuminate each ingredient from below and behind.",
    "Mood: a Michelin-star explosion, cinematic food commercial.",
    "9:16 vertical. Ultra-photorealistic. Every ingredient crispy and appetizing. NO text.",
  ].join(" ");
}

// ── Prompt para Chef IA ────────────────────────────────────────
function buildChefPrompt(chefDesc, hasChefPhoto) {
  return [
    "Cinematic food brand film photograph.",
    hasChefPhoto
      ? `[Image 1] = REFERENCE CHEF — preserve this exact person's face, skin, features with 100% fidelity. [Image 2] = finished dish.`
      : `Generate: ${chefDesc}. [Image 1] = finished dish.`,
    "Scene: professional kitchen, dark dramatic atmosphere.",
    "Industrial steel surfaces, hanging copper pots, dramatic overhead spotlights.",
    "The chef stands confidently, holding or plating the dish.",
    "Cinematic composition: chef in foreground, kitchen bokeh background.",
    "Lighting: warm dramatic key light, blue-toned fill, rim light separating chef from background.",
    "Mood: premium restaurant brand film — Gordon Ramsay / Nobu campaign level.",
    "9:16 vertical. Photorealistic. NO text.",
  ].join(" ");
}

// ── Prompt para Storyboard ────────────────────────────────────
function buildStoryboardImagePrompt(scene, refs) {
  return [
    "World-class advertising photographer. ONE stunning photorealistic advertisement photograph.",
    scene.image_prompt,
    refs?.some(i => i?.base64) ? "Use ALL reference images. Maintain exact likeness of people. Feature products prominently." : "",
    "Cinematic lighting. 9:16 vertical. TV commercial quality. NO text, NO subtitles, NO logos.",
  ].filter(Boolean).join("\n");
}

// ── Handler principal ─────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin",  "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("content-type",                 "application/json; charset=utf-8");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const userId = await getUserIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  const {
    storyboard,
    referenceImages = [],
    accent        = "neutro",
    gender        = "mujer",
    plantilla_id,
    imagenes      = {},
    textos        = {},
    selectores    = {},
    hasHumanFace  = false,
  } = body;

  // Cobrar Jades
  const ref = `comercial-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { error: spendErr } = await supabaseAdmin.rpc("spend_jades", {
    p_user_id: userId, p_amount: COMERCIAL_COST, p_reason: "comercial_completo", p_ref: ref,
  });
  if (spendErr) {
    if ((spendErr.message || "").includes("INSUFFICIENT_JADES"))
      return res.status(402).json({ ok: false, error: "INSUFFICIENT_JADES", required: COMERCIAL_COST });
    return res.status(400).json({ ok: false, error: spendErr.message });
  }

  try {

    // ════════════════════════════════════════════════════════
    // PLANTILLA: TRANSICIÓN DE MODA
    // Flujo: Gemini genera foto modelo+prenda → Seedance anima
    // ════════════════════════════════════════════════════════
    if (plantilla_id === "transicion_moda") {
      const prendas = imagenes.prendas || [];
      const modelo  = imagenes.modelo  || [];
      const fondo   = imagenes.fondo   || [];

      if (!prendas.length)
        return res.status(400).json({ ok: false, error: "Necesitas al menos una foto de prenda." });

      const hasModelo = modelo.length > 0;
      const hasFondo  = fondo.length  > 0;

      console.log(`[comercial] transicion_moda — prendas=${prendas.length} hasModelo=${hasModelo} hasFondo=${hasFondo} hasHumanFace=${hasHumanFace}`);

      const sceneResults = [];

      for (let i = 0; i < prendas.length; i++) {
        try {
          // Construir referencias para Gemini según caso
          // Orden: modelo (si hay) → fondo (si hay) → prenda actual
          const refs = [
            ...(hasModelo ? [modelo[0]] : []),
            ...(hasFondo  ? [fondo[0]]  : []),
            prendas[i],
          ].filter(Boolean);

          const imagePrompt = buildModaImagePrompt(i, prendas.length, hasModelo, hasFondo);

          // PASO 1: Gemini genera foto realista de modelo con prenda
          console.log(`[comercial] prenda ${i + 1} — generando imagen con Gemini`);
          const sceneImage = await generateSceneImage(imagePrompt, refs);

          // PASO 2: Subir imagen a Storage para obtener URL
          const { url: imageUrl, path: imagePath } = await uploadImageTemp(
            sceneImage.base64, sceneImage.mimeType, userId
          );

          // PASO 3: Seedance anima la foto
          // Si hay modelo real → PiAPI, si no → BytePlus
          const videoPrompt = hasModelo
            ? "Fashion model walks confidently toward camera, hair flowing naturally, outfit perfectly visible. Cinematic dolly-in movement. Golden hour light. Fabric moves gracefully. NO text. NO subtitles."
            : "Elegant fashion model turns and walks toward camera, showing full outfit. Smooth cinematic movement. Warm professional lighting. NO text. NO subtitles.";

          console.log(`[comercial] prenda ${i + 1} — animando con Seedance (hasHumanFace=${hasHumanFace && hasModelo})`);
          const videoUrl = await generateSceneVideo(
            imageUrl, videoPrompt, "9:16", 5,
            hasHumanFace && hasModelo // solo usa PiAPI si hay modelo real Y el usuario marcó el checkbox
          );

          // Guardar en biblioteca
          const libraryUrl = await saveVideoToLibrary(userId, videoUrl);

          // Limpiar imagen temporal
          await supabaseAdmin.storage.from("user-uploads").remove([imagePath]).catch(() => {});

          // Narración si se proporcionó
          const narration = textos?.narracion
            ? await generateNarration(textos.narracion, accent, gender)
            : null;

          sceneResults.push({
            scene_number: i + 1,
            ok:           true,
            video_url:    libraryUrl,
            audio_b64:    narration?.base64 || null,
          });

        } catch (err) {
          console.error(`[comercial] prenda ${i + 1} error:`, err.message);
          sceneResults.push({
            scene_number: i + 1,
            ok:           false,
            error:        err.message === "FACE_DETECTED" ? "FACE_DETECTED" : err.message,
          });
        }
      }

      const successCount = sceneResults.filter(s => s.ok).length;
      return res.status(200).json({
        ok:            successCount > 0,
        ref,
        plantilla_id,
        scenes:        sceneResults,
        success_count: successCount,
        total_scenes:  prendas.length,
        jade_cost:     COMERCIAL_COST,
      });
    }

    // ════════════════════════════════════════════════════════
    // PLANTILLA: PRODUCTO ESTELAR
    // El producto NUNCA cambia — efectos épicos alrededor
    // ════════════════════════════════════════════════════════
    if (plantilla_id === "producto_estelar") {
      const producto = imagenes.producto || [];
      if (!producto.length)
        return res.status(400).json({ ok: false, error: "Sube la foto de tu producto." });

      const efectoKey  = selectores?.efecto || "golden_particles";
      const efectoData = EFECTOS_PRODUCTO[efectoKey] || EFECTOS_PRODUCTO.golden_particles;

      console.log(`[comercial] producto_estelar — efecto=${efectoKey}`);

      // Gemini genera la imagen épica del producto
      const sceneImage = await generateSceneImage(
        `${efectoData.imagePrompt}`,
        [producto[0]]
      );
      const { url: imageUrl, path: imagePath } = await uploadImageTemp(
        sceneImage.base64, sceneImage.mimeType, userId
      );

      // BytePlus anima (productos no tienen rostros)
      const videoUrl   = await imageToVideoByteplus(imageUrl, efectoData.videoPrompt, "9:16", 5);
      const libraryUrl = await saveVideoToLibrary(userId, videoUrl);
      await supabaseAdmin.storage.from("user-uploads").remove([imagePath]).catch(() => {});

      const narration = textos?.narracion
        ? await generateNarration(textos.narracion, accent, gender)
        : null;

      return res.status(200).json({
        ok:            true,
        ref,
        plantilla_id,
        scenes:        [{ scene_number: 1, ok: true, video_url: libraryUrl, audio_b64: narration?.base64 || null }],
        success_count: 1,
        total_scenes:  1,
        jade_cost:     COMERCIAL_COST,
      });
    }

    // ════════════════════════════════════════════════════════
    // PLANTILLA: EXPLOSIÓN DE SABOR
    // ════════════════════════════════════════════════════════
    if (plantilla_id === "explosion_sabor") {
      const plato = imagenes.plato || [];
      if (!plato.length)
        return res.status(400).json({ ok: false, error: "Sube la foto del platillo." });

      const nombreNegocio = textos?.nombre_negocio || "";
      console.log(`[comercial] explosion_sabor — negocio="${nombreNegocio}"`);

      const sceneImage = await generateSceneImage(
        buildExplosionPrompt(nombreNegocio),
        [plato[0]]
      );
      const { url: imageUrl, path: imagePath } = await uploadImageTemp(
        sceneImage.base64, sceneImage.mimeType, userId
      );

      const videoUrl   = await imageToVideoByteplus(
        imageUrl,
        "Food ingredients explode dramatically outward in ultra slow motion. Each ingredient flies apart beautifully. Sauces splash in arcs. Camera: slow pull-back from below. Epic cinematic. NO text.",
        "9:16", 5
      );
      const libraryUrl = await saveVideoToLibrary(userId, videoUrl);
      await supabaseAdmin.storage.from("user-uploads").remove([imagePath]).catch(() => {});

      const narration = textos?.narracion
        ? await generateNarration(textos.narracion, accent, gender)
        : null;

      return res.status(200).json({
        ok:            true,
        ref,
        plantilla_id,
        scenes:        [{ scene_number: 1, ok: true, video_url: libraryUrl, audio_b64: narration?.base64 || null }],
        success_count: 1,
        total_scenes:  1,
        jade_cost:     COMERCIAL_COST,
      });
    }

    // ════════════════════════════════════════════════════════
    // PLANTILLA: CHEF IA
    // ════════════════════════════════════════════════════════
    if (plantilla_id === "chef_ia") {
      const plato = imagenes.plato || [];
      const chef  = imagenes.chef  || [];
      if (!plato.length)
        return res.status(400).json({ ok: false, error: "Sube la foto del platillo." });

      const hasChefPhoto = chef.length > 0;
      const avatarDescs  = {
        chef_hombre_latino: "a professional confident Latin male chef, 30s, clean white chef coat, strong presence",
        chef_mujer_latina:  "an elegant professional Latin female chef, 30s, white chef coat, warm authoritative smile",
        chef_barbudo:       "a tattooed bearded male chef, 35s, dark apron, urban artisan style, intense focused expression",
        chef_mujer_moderna: "a young modern female chef, stylish apron, contemporary chic professional look",
      };
      const chefDesc = hasChefPhoto
        ? "[Image 1] = REFERENCE CHEF — preserve face EXACTLY."
        : `Generate ${avatarDescs[selectores?.avatar_tipo] || avatarDescs.chef_hombre_latino}.`;

      const refs = hasChefPhoto ? [chef[0], plato[0]] : [plato[0]];

      console.log(`[comercial] chef_ia — hasChefPhoto=${hasChefPhoto} hasHumanFace=${hasHumanFace}`);

      const sceneImage = await generateSceneImage(
        buildChefPrompt(chefDesc, hasChefPhoto),
        refs
      );
      const { url: imageUrl, path: imagePath } = await uploadImageTemp(
        sceneImage.base64, sceneImage.mimeType, userId
      );

      const videoUrl = await generateSceneVideo(
        imageUrl,
        "Chef elegantly plates and presents dish with confident professional movements. Slow cinematic camera push-in. Warm dramatic kitchen lighting. Steam rises from dish. NO text.",
        "9:16", 5,
        hasHumanFace && hasChefPhoto
      );
      const libraryUrl = await saveVideoToLibrary(userId, videoUrl);
      await supabaseAdmin.storage.from("user-uploads").remove([imagePath]).catch(() => {});

      const narration = textos?.narracion
        ? await generateNarration(textos.narracion, accent, gender)
        : null;

      return res.status(200).json({
        ok:            true,
        ref,
        plantilla_id,
        scenes:        [{ scene_number: 1, ok: true, video_url: libraryUrl, audio_b64: narration?.base64 || null }],
        success_count: 1,
        total_scenes:  1,
        jade_cost:     COMERCIAL_COST,
      });
    }

    // ════════════════════════════════════════════════════════
    // COMERCIAL COMPLETO (storyboard)
    // ════════════════════════════════════════════════════════
    if (!storyboard?.scenes?.length)
      return res.status(400).json({ ok: false, error: "MISSING_STORYBOARD" });

    const sceneResults = await Promise.allSettled(
      storyboard.scenes.map(async (scene, idx) => {
        let sceneImage = null;
        try {
          sceneImage = await generateSceneImage(
            buildStoryboardImagePrompt(scene, referenceImages),
            referenceImages
          );
        } catch (e) { console.error(`[comercial] img ${idx + 1}:`, e.message); }

        let videoUrl = null;
        if (sceneImage) {
          try {
            const { url: imageUrl, path: imagePath } = await uploadImageTemp(
              sceneImage.base64, sceneImage.mimeType, userId
            );
            videoUrl = await generateSceneVideo(imageUrl, scene.video_prompt, "9:16", 5, hasHumanFace);
            videoUrl = await saveVideoToLibrary(userId, videoUrl);
            await supabaseAdmin.storage.from("user-uploads").remove([imagePath]).catch(() => {});
          } catch (e) { console.error(`[comercial] video ${idx + 1}:`, e.message); }
        }

        let narration = null;
        if (scene.narration) {
          try { narration = await generateNarration(scene.narration, accent, gender); } catch {}
        }

        return {
          scene_number:   scene.scene_number,
          narrative_role: scene.narrative_role || null,
          description:    scene.description,
          narration_text: scene.narration,
          image_b64:      sceneImage?.base64   || null,
          image_mime:     sceneImage?.mimeType || "image/jpeg",
          video_url:      videoUrl             || null,
          audio_b64:      narration?.base64    || null,
          audio_mime:     "audio/mpeg",
          ok:             !!videoUrl,
        };
      })
    );

    const scenes       = sceneResults.map((r, idx) =>
      r.status === "fulfilled" ? r.value : { scene_number: idx + 1, ok: false, error: r.reason?.message }
    );
    const successCount = scenes.filter(s => s.ok).length;

    return res.status(200).json({
      ok:            successCount > 0,
      ref,
      title:         storyboard.title,
      style:         storyboard.style,
      music_mood:    storyboard.music_mood,
      call_to_action: storyboard.call_to_action,
      accent,
      gender,
      scenes,
      success_count: successCount,
      total_scenes:  scenes.length,
      jade_cost:     COMERCIAL_COST,
    });

  } catch (e) {
    // Reembolsar Jades si hay error general
    try {
      await supabaseAdmin.rpc("spend_jades", {
        p_user_id: userId, p_amount: -COMERCIAL_COST,
        p_reason:  "comercial_refund_error", p_ref: ref,
      });
    } catch {}
    console.error("[comercial-generate] SERVER_ERROR:", e.message);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", detail: e.message });
  }
}

export const config = { runtime: "nodejs" };
