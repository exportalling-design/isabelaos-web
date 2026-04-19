// api/comercial-generate.js
// ─────────────────────────────────────────────────────────────
// Pipeline completo de generación de comercial con BytePlus Seedance 2.0:
//   1. Recibe el storyboard
//   2. Por cada escena genera imagen con Gemini Image
//   3. Convierte imagen a video con BytePlus Seedance 2.0
//   4. Genera narración en off con ElevenLabs
//   5. Devuelve clips + narración por escena
//
// TRANSICIÓN DE MODA — 4 casos:
//   CASO 1 — Solo ropa:        IA inventa modelo + fondo
//   CASO 2 — Ropa + Modelo:    Usa modelo real, IA inventa fondo
//   CASO 3 — Ropa + Fondo:     IA inventa modelo, usa fondo real
//   CASO 4 — Ropa+Modelo+Fondo: Respeta todo
// ─────────────────────────────────────────────────────────────
import { supabaseAdmin }          from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

const GEMINI_API_BASE    = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_IMAGE_MODEL = "gemini-2.0-flash-preview-image-generation";
const ELEVENLABS_BASE    = "https://api.elevenlabs.io/v1";
const BYTEPLUS_BASE      = "https://ark.ap-southeast.bytepluses.com/api/v3";
const BYTEPLUS_CREATE    = `${BYTEPLUS_BASE}/contents/generations/tasks`;
const BYTEPLUS_MODEL     = "dreamina-seedance-2-0-260128";

const COMERCIAL_COST = 120;

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

function getVoiceId(accent, gender) {
  const a = (accent || "neutro").toLowerCase().trim();
  const g = (gender || "mujer").toLowerCase().trim() === "hombre" ? "hombre" : "mujer";
  return (VOICE_MAP[a] || VOICE_MAP["neutro"])[g] || VOICE_MAP["neutro"]["mujer"];
}

// ── Subir imagen a Supabase Storage temporal ─────────────────
// BytePlus necesita URL pública, no base64
async function uploadImageTemp(base64, mimeType, userId) {
  const ext  = mimeType.includes("png") ? "png" : "jpg";
  const path = `comercial/temp/${userId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const buf  = Buffer.from(base64, "base64");

  const { error } = await supabaseAdmin.storage
    .from("user-uploads")
    .upload(path, buf, { contentType: mimeType, upsert: false });

  if (error) throw new Error(`Error subiendo imagen temporal: ${error.message}`);

  const { data } = supabaseAdmin.storage.from("user-uploads").getPublicUrl(path);
  return { url: data.publicUrl, path };
}

// ── Generar imagen de escena con Gemini ───────────────────────
async function generateSceneImage(prompt, referenceImages = []) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("MISSING_GEMINI_API_KEY");

  const url   = `${GEMINI_API_BASE}/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`;
  const parts = [];

  const hasRefs = referenceImages.some(img => img?.base64);
  for (const img of referenceImages.slice(0, 4)) {
    if (img?.base64 && img?.mimeType) {
      parts.push({ inline_data: { mime_type: img.mimeType, data: img.base64 } });
    }
  }

  parts.push({ text: prompt });

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"], temperature: 0.3 },
    }),
  });

  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Gemini Image error ${r.status}: ${txt.slice(0, 300)}`);
  }

  const data    = await r.json();
  const imgPart = data?.candidates?.[0]?.content?.parts?.find(
    p => p?.inlineData?.data || p?.inline_data?.data
  );
  if (!imgPart) throw new Error("Gemini no devolvió imagen.");

  const pd = imgPart.inlineData || imgPart.inline_data;
  return { base64: pd.data, mimeType: pd.mimeType || pd.mime_type || "image/jpeg" };
}

// ── Convertir imagen a video con BytePlus Seedance 2.0 ────────
async function imageToVideoByteplus(imageUrl, videoPrompt, aspectRatio = "9:16", duration = 5) {
  const payload = {
    model:   BYTEPLUS_MODEL,
    content: [
      { type: "image_url", image_url: { url: imageUrl } },
      {
        type: "text",
        text: `[Image 1] ${videoPrompt} --ratio ${aspectRatio} --duration ${duration} --resolution 720p`,
      },
    ],
  };

  const r = await fetch(BYTEPLUS_CREATE, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${process.env.BYTEPLUS_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await r.json();
  if (!r.ok || data.error) {
    throw new Error(data.error?.message || data.message || `BytePlus error ${r.status}`);
  }

  const taskId = data.id;
  if (!taskId) throw new Error("BytePlus no devolvió task id");

  // Polling hasta succeeded
  const deadline = Date.now() + 5 * 60 * 1000; // 5 min max por clip
  while (Date.now() < deadline) {
    await new Promise(res => setTimeout(res, 8000));

    const sr   = await fetch(`${BYTEPLUS_BASE}/contents/generations/tasks/${taskId}`, {
      headers: { "Authorization": `Bearer ${process.env.BYTEPLUS_API_KEY}` },
    });
    const sd = await sr.json();

    if (sd.status === "succeeded") {
      const videoUrl = sd.content?.video_url;
      if (!videoUrl) throw new Error("BytePlus succeeded pero no devolvió video_url");
      return videoUrl;
    }
    if (sd.status === "failed") {
      throw new Error(sd.error?.message || "BytePlus video generation failed");
    }
    // running → seguir esperando
  }

  throw new Error("Timeout: BytePlus tardó más de 5 minutos en generar el clip");
}

// ── Guardar video en Supabase Storage biblioteca ──────────────
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
    console.error("[comercial-generate] saveVideoToLibrary failed:", err.message);
    return videoUrl;
  }
}

// ── Generar narración ElevenLabs ──────────────────────────────
async function generateNarration(text, accent, gender) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || !text?.trim()) return null;

  const voiceId = getVoiceId(accent, gender);

  const r = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.55, similarity_boost: 0.80, style: 0.35, use_speaker_boost: true },
    }),
  });

  if (!r.ok) return null;

  const buf = await r.arrayBuffer();
  return { base64: Buffer.from(buf).toString("base64"), mimeType: "audio/mpeg" };
}

// ── Construir prompt Gemini para Transición de Moda ───────────
function buildModaImagePrompt(prenda, idx, total, hasModelo, hasFondo, modeloDesc, fondoDesc) {
  const casos = [];

  if (hasModelo && hasFondo) {
    // CASO 4: Respeta modelo real Y fondo real
    casos.push(
      `You are a world-class fashion photographer. Create a photorealistic fashion advertisement photograph.`,
      `[Image 1] is the EXACT model/person — preserve their face, skin tone, hair, body proportions PERFECTLY.`,
      `[Image 2] is the EXACT background/location — reproduce it exactly: architecture, lighting, atmosphere, colors.`,
      `[Image ${idx + 3}] is the clothing item for this scene. The model must be WEARING this exact garment.`,
      `Reproduce the garment exactly: fabric texture, pattern, color, cut, every detail must match the reference.`,
      `Place the model naturally in the exact background shown. Maintain the real environment.`,
    );
  } else if (hasModelo && !hasFondo) {
    // CASO 2: Modelo real, IA inventa fondo
    casos.push(
      `You are a world-class fashion photographer. Create a photorealistic fashion advertisement photograph.`,
      `[Image 1] is the EXACT model/person — preserve their face, skin tone, hair, body proportions PERFECTLY.`,
      `[Image 2] is the clothing item. The model must be WEARING this exact garment with perfect detail reproduction.`,
      `Invent a stunning, aspirational background appropriate for a luxury fashion campaign.`,
      `Background ideas: rooftop terrace at golden hour, chic boutique interior, urban street with bokeh lights, tropical resort pool.`,
      `Scene ${idx + 1} of ${total}: vary the background to create visual progression and storytelling.`,
    );
  } else if (!hasModelo && hasFondo) {
    // CASO 3: Fondo real, IA inventa modelo
    casos.push(
      `You are a world-class fashion photographer. Create a photorealistic fashion advertisement photograph.`,
      `[Image 1] is the EXACT background/location — reproduce it exactly: architecture, lighting, atmosphere, all details.`,
      `[Image 2] is the clothing item. Generate a stunning, aspirational fashion model WEARING this exact garment.`,
      `The model: confident, professional, aspirational. Age 20-28. Ethnicity appropriate for Latin American fashion market.`,
      `Reproduce the garment exactly: fabric texture, pattern, color, cut, every detail must match the reference.`,
      `Place the model naturally in the exact background provided.`,
    );
  } else {
    // CASO 1: Solo ropa, IA inventa todo
    casos.push(
      `You are a world-class fashion photographer shooting a luxury Latin American fashion campaign.`,
      `[Image 1] is the clothing item for this scene. Create a stunning photorealistic fashion photograph.`,
      `Generate a beautiful, aspirational model WEARING this exact garment. Age 20-28, confident, professional.`,
      `Reproduce the garment exactly: fabric texture, pattern, color, cut, every stitch must be accurate.`,
      `Scene ${idx + 1} of ${total}: use a different stunning location each scene to create visual variety.`,
      `Location ideas: luxury hotel lobby, beachfront at sunset, modern city skyline, tropical garden, elegant restaurant.`,
    );
  }

  casos.push(
    ``,
    `QUALITY STANDARDS:`,
    `• Photorealistic — must look like an actual professional fashion photograph`,
    `• Cinematic lighting: dramatic, intentional, magazine-quality`,
    `• Full body or 3/4 shot showing the complete outfit`,
    `• 9:16 vertical format for social media`,
    `• Rich colors, sharp details, aspirational atmosphere`,
    `• NO text, NO subtitles, NO watermarks, NO logos anywhere`,
  );

  return casos.join("\n");
}

// ── Handler principal ─────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin",  "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("content-type",                 "application/json; charset=utf-8");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const userId = await getUserIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

  const {
    storyboard,
    referenceImages = [],
    accent          = "neutro",
    gender          = "mujer",
    // Campos específicos de Transición de Moda
    plantilla_id,
    imagenes = {},  // { modelo: [{base64,mimeType}], prendas: [...], fondo: [{...}] }
  } = body;

  // ── Cobrar Jades ──────────────────────────────────────────
  const ref = `comercial-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { error: spendErr } = await supabaseAdmin.rpc("spend_jades", {
    p_user_id: userId,
    p_amount:  COMERCIAL_COST,
    p_reason:  "comercial_completo",
    p_ref:     ref,
  });

  if (spendErr) {
    if ((spendErr.message || "").includes("INSUFFICIENT_JADES")) {
      return res.status(402).json({ ok: false, error: "INSUFFICIENT_JADES", required: COMERCIAL_COST });
    }
    return res.status(400).json({ ok: false, error: spendErr.message });
  }

  try {
    // ── MODO: TRANSICIÓN DE MODA ──────────────────────────────
    if (plantilla_id === "transicion_moda") {
      const prendas = imagenes.prendas || [];
      const modelo  = imagenes.modelo  || [];
      const fondo   = imagenes.fondo   || [];

      if (!prendas.length) {
        return res.status(400).json({ ok: false, error: "Necesitas al menos una foto de prenda" });
      }

      const hasModelo = modelo.length > 0;
      const hasFondo  = fondo.length > 0;

      console.error(`[comercial] transicion_moda — prendas=${prendas.length} modelo=${hasModelo} fondo=${hasFondo}`);

      const sceneResults = [];

      for (let i = 0; i < prendas.length; i++) {
        try {
          // Construir referencias para Gemini según el caso
          const refs = [];
          if (hasModelo) refs.push(modelo[0]);
          if (hasFondo)  refs.push(fondo[0]);
          refs.push(prendas[i]);

          const prompt = buildModaImagePrompt(
            prendas[i], i, prendas.length,
            hasModelo, hasFondo,
            "modelo de la referencia", "fondo de la referencia"
          );

          // Generar imagen con Gemini
          const sceneImage = await generateSceneImage(prompt, refs);

          // Subir imagen a Storage para obtener URL pública para BytePlus
          const { url: imageUrl, path: imagePath } = await uploadImageTemp(
            sceneImage.base64, sceneImage.mimeType, userId
          );

          // Generar video con BytePlus Seedance
          const videoPrompt = [
            hasModelo
              ? "Fashion model walks forward confidently, hair flowing naturally, outfit details clearly visible."
              : "Elegant fashion model walks confidently toward camera, outfit in perfect detail.",
            "Smooth cinematic camera movement, slow dolly-in, golden hour rim lighting.",
            "Commercial quality motion, natural fabric movement, aspirational atmosphere.",
            "ABSOLUTELY NO text, NO subtitles, NO captions, NO watermarks.",
          ].join(" ");

          const byteplusVideoUrl = await imageToVideoByteplus(imageUrl, videoPrompt, "9:16", 5);

          // Guardar en biblioteca
          const libraryUrl = await saveVideoToLibrary(userId, byteplusVideoUrl);

          // Limpiar imagen temporal
          await supabaseAdmin.storage.from("user-uploads").remove([imagePath]).catch(() => {});

          // Narración si hay texto
          const narText = body.textos?.narracion || "";
          const narration = narText ? await generateNarration(narText, accent, gender) : null;

          sceneResults.push({
            scene_number: i + 1,
            ok:           true,
            image_b64:    sceneImage.base64,
            image_mime:   sceneImage.mimeType,
            video_url:    libraryUrl,
            audio_b64:    narration?.base64  || null,
            audio_mime:   narration?.mimeType || "audio/mpeg",
          });

        } catch (err) {
          console.error(`[comercial] prenda ${i + 1} error:`, err.message);
          sceneResults.push({ scene_number: i + 1, ok: false, error: err.message });
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

    // ── MODO: STORYBOARD NORMAL (otros tipos de comercial) ────
    if (!storyboard?.scenes?.length) {
      return res.status(400).json({ ok: false, error: "MISSING_STORYBOARD" });
    }

    console.error(`[comercial-generate] storyboard — scenes=${storyboard.scenes.length} accent=${accent} gender=${gender}`);

    const sceneResults = await Promise.allSettled(
      storyboard.scenes.map(async (scene, idx) => {
        console.error(`[comercial] escena ${idx + 1}/${storyboard.scenes.length}`);

        // Generar imagen
        let sceneImage = null;
        try {
          const imagePrompt = buildStoryboardImagePrompt(scene, referenceImages);
          sceneImage = await generateSceneImage(imagePrompt, referenceImages);
        } catch (e) {
          console.error(`[comercial] imagen ${idx + 1}:`, e.message);
        }

        // Convertir a video con BytePlus
        let videoUrl = null;
        if (sceneImage) {
          try {
            const { url: imageUrl, path: imagePath } = await uploadImageTemp(
              sceneImage.base64, sceneImage.mimeType, userId
            );

            const bp = await imageToVideoByteplus(imageUrl, scene.video_prompt, "9:16", 5);
            videoUrl = await saveVideoToLibrary(userId, bp);

            await supabaseAdmin.storage.from("user-uploads").remove([imagePath]).catch(() => {});
          } catch (e) {
            console.error(`[comercial] video ${idx + 1}:`, e.message);
          }
        }

        // Narración
        let narration = null;
        if (scene.narration) {
          try { narration = await generateNarration(scene.narration, accent, gender); }
          catch (e) { console.error(`[comercial] narración ${idx + 1}:`, e.message); }
        }

        return {
          scene_number:   scene.scene_number,
          narrative_role: scene.narrative_role || null,
          camera:         scene.camera,
          description:    scene.description,
          narration_text: scene.narration,
          image_b64:      sceneImage?.base64  || null,
          image_mime:     sceneImage?.mimeType || "image/jpeg",
          video_url:      videoUrl || null,
          audio_b64:      narration?.base64   || null,
          audio_mime:     narration?.mimeType || "audio/mpeg",
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
    // Reembolsar Jades si hay error crítico
    await supabaseAdmin.rpc("spend_jades", {
      p_user_id: userId,
      p_amount:  -COMERCIAL_COST,
      p_reason:  "comercial_refund_error",
      p_ref:     ref,
    }).catch(() => {});

    console.error("[comercial-generate] SERVER_ERROR:", e.message);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", detail: e.message });
  }
}

// ── Prompt Gemini para storyboard normal ─────────────────────
function buildStoryboardImagePrompt(scene, referenceImages) {
  const hasRefs = referenceImages?.some(img => img?.base64);
  return [
    "You are a world-class advertising photographer with 20 years shooting campaigns for major global brands.",
    "Create ONE stunning photorealistic advertisement photograph for this scene.",
    "",
    "=== SCENE ===",
    scene.image_prompt,
    "",
    hasRefs ? [
      "=== REFERENCE IMAGES ===",
      "Use ALL provided reference images to build the most accurate scene possible.",
      "If references show a PERSON: maintain their exact likeness — face, skin tone, hair.",
      "If references show a PRODUCT: feature it prominently with exact colors, shape, details.",
      "If references show a LOCATION: use it as the background/setting.",
      "If references show CLOTHING: the model must be WEARING it with exact detail reproduction.",
    ].join("\n") : "",
    "",
    "=== QUALITY STANDARDS ===",
    "• Photorealistic — must look like an actual professional photograph",
    "• Cinematic lighting appropriate for the scene mood",
    "• 9:16 vertical format for social media",
    "• National TV commercial / luxury brand campaign quality",
    "• NO text, NO subtitles, NO watermarks, NO logos anywhere",
  ].filter(Boolean).join("\n");
}

export const config = { runtime: "nodejs" };
