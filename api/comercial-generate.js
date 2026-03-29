// api/comercial-generate.js
// ─────────────────────────────────────────────────────────────
// Pipeline completo de generación de comercial:
//   1. Recibe el storyboard de Gemini (ya generado en paso 1)
//   2. Por cada escena genera imagen con Gemini Image
//   3. Convierte cada imagen a video con Veo3 Fast (sin audio)
//   4. Genera narración en off con ElevenLabs (género + acento)
//   5. Devuelve lista de clips + narración por escena
//
// Estrategia de voz: narración en off profesional sobre los clips.
// La voz se selecciona dinámicamente por género y acento usando
// Voice Design de ElevenLabs para máxima calidad y flexibilidad.
// ─────────────────────────────────────────────────────────────
import { requireUser } from "./_auth.js";
import { createClient } from "@supabase/supabase-js";
 
// ── Config ────────────────────────────────────────────────────
const GEMINI_API_BASE    = "https://generativelanguage.googleapis.com/v1beta";
// Modelo correcto para generación de imágenes con Gemini
const GEMINI_IMAGE_MODEL = "gemini-2.0-flash-preview-image-generation";
const ELEVENLABS_BASE    = "https://api.elevenlabs.io/v1";
 
// Costo: 120 Jades todo incluido
const COMERCIAL_COST = 120;
 
// Voces predefinidas de ElevenLabs por acento y género
// IDs verificados de la Voice Library pública de ElevenLabs
// Voces en español latino con licencia comercial
const VOICE_MAP = {
  neutro: {
    mujer:  "cgSgspJ2msm6clMCkdW9", // Jessica — neutral, clara, comercial
    hombre: "onwK4e9ZLuTAKqWW03F9", // Daniel — neutro latino, narración
  },
  guatemalteco: {
    // Michelle — acento guatemalteco femenino natural
    mujer:  "jBpfuIE2acCo8z3wKNLl",
    // Para hombre guatemalteco usamos neutro latino (no hay voz GT masculina pública)
    hombre: "onwK4e9ZLuTAKqWW03F9",
  },
  colombiano: {
    // Yinet — colombiana, upbeat, perfecta para comerciales
    mujer:  "9F4C8IG88qxQmkoRr05Z",
    // Voz masculina colombiana de la biblioteca pública
    hombre: "VR6AewLTigWG4xSOukaG",
  },
  mexicano: {
    // Valentina — mexicana, cálida y clara
    mujer:  "ThT5KcBeYPX3keUQqHPh",
    // Voz masculina mexicana
    hombre: "pqHfZKP75CvOlQylNhV4",
  },
  argentino: {
    // Voz femenina argentina
    mujer:  "XrExE9yKIg1WjnnlVkGX",
    // Voz masculina argentina
    hombre: "AZnzlk1XvdvUeBnXmlld",
  },
  español: {
    // Voz femenina española (Castilla)
    mujer:  "EXAVITQu4vr4xnSDxMaL",
    // Voz masculina española
    hombre: "ErXwobaYiN019PkySvjV",
  },
};
 
function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("MISSING_SUPABASE_ENV");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
 
// ── Seleccionar voice ID por acento y género ──────────────────
function getVoiceId(accent, gender) {
  const accentKey = accent?.toLowerCase() || "neutro";
  const genderKey = gender?.toLowerCase() === "hombre" ? "hombre" : "mujer";
  const map = VOICE_MAP[accentKey] || VOICE_MAP["neutro"];
  return map[genderKey] || VOICE_MAP["neutro"]["mujer"];
}
 
// ── Generar imagen de escena con Gemini Image ─────────────────
// Recibe TODAS las fotos de referencia (hasta 3) para mejor contexto
async function generateSceneImage(prompt, referenceImages = []) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("MISSING_GEMINI_API_KEY");
 
  const url   = `${GEMINI_API_BASE}/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`;
  const parts = [];
 
  // Incluir TODAS las fotos de referencia (no solo la primera)
  for (const img of referenceImages.slice(0, 3)) {
    if (img?.base64 && img?.mimeType) {
      parts.push({
        inline_data: { mime_type: img.mimeType, data: img.base64 }
      });
    }
  }
 
  // Prompt cinematográfico de nivel agencia
  const fullPrompt = [
    "You are a top-tier commercial photographer working for a major advertising agency.",
    "Create a STUNNING, professional advertisement photograph based on the reference images and this scene description.",
    "",
    `SCENE: ${prompt}`,
    "",
    "Requirements:",
    "- Photorealistic, high-end commercial quality",
    "- Perfect lighting: cinematic, professional studio or location lighting",
    "- Composition: rule of thirds, dynamic and visually striking",
    "- Colors: rich, saturated, brand-worthy palette",
    "- The result must look like it was shot by a professional photographer for a major brand campaign",
    "- If reference images show a person, maintain their likeness and style",
    "- If reference images show a product, feature it prominently and beautifully",
    "- No text, watermarks, or logos in the image",
  ].join("\n");
 
  parts.push({ text: fullPrompt });
 
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        temperature: 0.4,
      },
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
 
  if (!imgPart) throw new Error("Gemini Image no devolvió imagen para la escena.");
 
  const pd = imgPart.inlineData || imgPart.inline_data;
  return { base64: pd.data, mimeType: pd.mimeType || pd.mime_type || "image/jpeg" };
}
 
// ── Convertir imagen a video con Veo3 Fast (fal.ai) ──────────
// IMPORTANTE: el prompt explícitamente pide que no haya diálogo
// porque la narración la aplica ElevenLabs como voz en off
async function imageToVideoVeo3(imageBase64, imageMime, videoPrompt) {
  const falKey = process.env.FAL_KEY;
  if (!falKey) throw new Error("MISSING_FAL_KEY");
 
  const dataUrl = `data:${imageMime};base64,${imageBase64}`;
 
  // Prompt mejorado: movimiento cinematográfico, sin audio/diálogo
  const enhancedPrompt = [
    videoPrompt,
    "Cinematic camera movement. Professional commercial style.",
    "NO dialogue, NO speech, NO talking. Ambient sound only or silent.",
    "The scene has no audio — voiceover will be added in post-production.",
  ].join(" ");
 
  const r = await fetch("https://fal.run/fal-ai/veo3/image-to-video", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Key ${falKey}`,
    },
    body: JSON.stringify({
      image_url:    dataUrl,
      prompt:       enhancedPrompt,
      duration:     "8s",
      aspect_ratio: "9:16", // Vertical para redes sociales
    }),
  });
 
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Veo3 error ${r.status}: ${txt.slice(0, 300)}`);
  }
 
  const data     = await r.json();
  const videoUrl = data?.video?.url || data?.url || null;
  if (!videoUrl) throw new Error("Veo3 no devolvió URL de video.");
 
  // Descargar el video y convertir a base64
  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) throw new Error("No se pudo descargar el video de Veo3.");
  const videoBuffer = await videoRes.arrayBuffer();
  const videoBase64 = Buffer.from(videoBuffer).toString("base64");
 
  return { url: videoUrl, base64: videoBase64, mimeType: "video/mp4" };
}
 
// ── Generar narración en off con ElevenLabs ───────────────────
// Voz seleccionada por acento + género para máxima autenticidad
async function generateNarration(text, accent, gender) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.log("[comercial] ElevenLabs no configurado — saltando narración");
    return null;
  }
 
  const voiceId = getVoiceId(accent, gender);
  const url     = `${ELEVENLABS_BASE}/text-to-speech/${voiceId}`;
 
  console.log(`[comercial] narración — accent=${accent} gender=${gender} voiceId=${voiceId}`);
 
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key":   apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability:        0.55,
        similarity_boost: 0.80,
        style:            0.35,
        use_speaker_boost: true,
      },
    }),
  });
 
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    console.error(`[comercial] ElevenLabs error ${r.status}:`, errText.slice(0, 200));
    return null;
  }
 
  const audioBuffer = await r.arrayBuffer();
  const audioBase64 = Buffer.from(audioBuffer).toString("base64");
  return { base64: audioBase64, mimeType: "audio/mpeg" };
}
 
// ── Handler principal ─────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }
 
  try {
    // Auth
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(401).json({ ok: false, error: auth.error });
    const user = auth.user;
 
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
 
    const storyboard      = body?.storyboard;
    const referenceImages = Array.isArray(body?.referenceImages) ? body.referenceImages : [];
    const accent          = String(body?.accent  || "neutro");
    const gender          = String(body?.gender  || "mujer");
    const hasAvatar       = !!body?.hasAvatar;
 
    if (!storyboard?.scenes?.length) {
      return res.status(400).json({ ok: false, error: "MISSING_STORYBOARD" });
    }
 
    // ── Cobrar Jades ─────────────────────────────────────────
    const sb  = getSupabaseAdmin();
    const ref = `comercial-${Date.now()}-${Math.random().toString(36).slice(2)}`;
 
    const { error: spendErr } = await sb.rpc("spend_jades", {
      p_user_id: user.id,
      p_amount:  COMERCIAL_COST,
      p_reason:  "comercial_completo",
      p_ref:     ref,
    });
 
    if (spendErr) {
      if ((spendErr.message || "").includes("INSUFFICIENT_JADES")) {
        return res.status(402).json({
          ok: false, error: "INSUFFICIENT_JADES",
          detail: `Necesitas ${COMERCIAL_COST} Jades para generar un comercial.`,
          required: COMERCIAL_COST,
        });
      }
      return res.status(400).json({
        ok: false, error: "JADE_CHARGE_FAILED", detail: spendErr.message
      });
    }
 
    console.log(
      `[comercial-generate] user=${user.id} scenes=${storyboard.scenes.length}` +
      ` accent=${accent} gender=${gender} cost=${COMERCIAL_COST}J`
    );
 
    // ── Procesar cada escena en PARALELO ─────────────────────
    const sceneResults = await Promise.allSettled(
      storyboard.scenes.map(async (scene, idx) => {
        console.log(`[comercial] procesando escena ${idx + 1}/${storyboard.scenes.length}`);
 
        // 1. Generar imagen base de la escena
        //    Pasa TODAS las fotos de referencia para mejor consistencia
        let sceneImage = null;
        try {
          sceneImage = await generateSceneImage(scene.image_prompt, referenceImages);
        } catch (e) {
          console.error(`[comercial] imagen escena ${idx + 1} falló:`, e?.message);
        }
 
        // 2. Generar clip de video desde la imagen (sin audio)
        let videoResult = null;
        if (sceneImage) {
          try {
            videoResult = await imageToVideoVeo3(
              sceneImage.base64,
              sceneImage.mimeType,
              scene.video_prompt
            );
          } catch (e) {
            console.error(`[comercial] video escena ${idx + 1} falló:`, e?.message);
          }
        }
 
        // 3. Generar narración en off con la voz correcta (acento + género)
        let narration = null;
        if (scene.narration) {
          try {
            narration = await generateNarration(scene.narration, accent, gender);
          } catch (e) {
            console.error(`[comercial] narración escena ${idx + 1} falló:`, e?.message);
          }
        }
 
        return {
          scene_number:    scene.scene_number,
          camera:          scene.camera,
          description:     scene.description,
          narration_text:  scene.narration,
          image_b64:       sceneImage?.base64   || null,
          image_mime:      sceneImage?.mimeType || "image/jpeg",
          video_url:       videoResult?.url     || null,
          video_b64:       videoResult?.base64  || null,
          audio_b64:       narration?.base64    || null,
          audio_mime:      narration?.mimeType  || "audio/mpeg",
          ok: !!(videoResult?.url || videoResult?.base64),
        };
      })
    );
 
    const scenes = sceneResults.map((r, idx) =>
      r.status === "fulfilled" ? r.value : {
        scene_number: idx + 1,
        ok:    false,
        error: r.reason?.message || "Error desconocido",
      }
    );
 
    const successCount = scenes.filter(s => s.ok).length;
    console.log(`[comercial-generate] ✅ ${successCount}/${scenes.length} escenas OK`);
 
    return res.status(200).json({
      ok:             successCount > 0,
      ref,
      title:          storyboard.title,
      style:          storyboard.style,
      music_mood:     storyboard.music_mood,
      call_to_action: storyboard.call_to_action,
      accent,
      gender,
      scenes,
      success_count:  successCount,
      total_scenes:   scenes.length,
      jade_cost:      COMERCIAL_COST,
    });
 
  } catch (e) {
    console.error("[comercial-generate] SERVER_ERROR:", e?.message || e);
    return res.status(500).json({
      ok: false, error: "SERVER_ERROR", detail: String(e?.message || e)
    });
  }
}
 
export const config = { runtime: "nodejs" };
