// api/comercial-generate.js
// ─────────────────────────────────────────────────────────────
// Pipeline completo de generación de comercial:
//   1. Toma el storyboard de Gemini
//   2. Por cada escena genera imagen (Gemini Image o FLUX+FaceSwap)
//   3. Convierte cada imagen a video con Veo3 Fast
//   4. Genera narración con ElevenLabs
//   5. Devuelve lista de clips + narración por escena
//
// Nota: el ensamble final (concatenar clips + audio) lo hace
// el frontend con la Web Audio API o lo descarga por separado.
// Para v2 se puede agregar ensamble en el servidor con ffmpeg.
// ─────────────────────────────────────────────────────────────
import { requireUser } from "./_auth.js";
import { createClient } from "@supabase/supabase-js";
 
// ── Config ────────────────────────────────────────────────────
const GEMINI_API_BASE  = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image-preview";
const ELEVENLABS_BASE  = "https://api.elevenlabs.io/v1";
 
// Costo: 120 Jades todo incluido
const COMERCIAL_COST = 120;
 
// Voces de ElevenLabs por acento
const VOICE_MAP = {
  "guatemalteco": "pNInz6obpgDQGcFmaJgB", // Adam — neutro latino
  "colombiano":   "ErXwobaYiN019PkySvjV", // Antoni
  "mexicano":     "VR6AewLTigWG4xSOukaG", // Arnold
  "neutro":       "21m00Tcm4TlvDq8ikWAM", // Rachel — neutro
  "argentino":    "AZnzlk1XvdvUeBnXmlld", // Domi
  "español":      "EXAVITQu4vr4xnSDxMaL", // Bella
};
 
function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("MISSING_SUPABASE_ENV");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
 
// ── Generar imagen de escena con Gemini Image ─────────────────
async function generateSceneImage(prompt, referenceBase64, referenceMime) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("MISSING_GEMINI_API_KEY");
 
  const url  = `${GEMINI_API_BASE}/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`;
  const parts = [];
 
  if (referenceBase64) {
    parts.push({ inline_data: { mime_type: referenceMime || "image/jpeg", data: referenceBase64 } });
  }
 
  parts.push({ text: `You are a professional commercial photographer. Generate a high-quality commercial photo based on this reference and description. ${prompt} Make it look like a professional advertisement photo.` });
 
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"], temperature: 0.4 },
    }),
  });
 
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Gemini Image error ${r.status}: ${txt.slice(0, 200)}`);
  }
 
  const data  = await r.json();
  const imgPart = data?.candidates?.[0]?.content?.parts?.find(p => p?.inlineData?.data || p?.inline_data?.data);
  if (!imgPart) throw new Error("Gemini no devolvió imagen para la escena.");
 
  const pd = imgPart.inlineData || imgPart.inline_data;
  return { base64: pd.data, mimeType: pd.mimeType || pd.mime_type || "image/jpeg" };
}
 
// ── Convertir imagen a video con Veo3 Fast (fal.ai) ──────────
async function imageToVideoVeo3(imageBase64, imageMime, videoPrompt) {
  const falKey = process.env.FAL_KEY;
  if (!falKey) throw new Error("MISSING_FAL_KEY");
 
  // Subir imagen a fal.ai como data URL
  const dataUrl = `data:${imageMime};base64,${imageBase64}`;
 
  const r = await fetch("https://fal.run/fal-ai/veo3/image-to-video", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      Authorization:   `Key ${falKey}`,
    },
    body: JSON.stringify({
      image_url:   dataUrl,
      prompt:      videoPrompt,
      duration:    "8s",
      aspect_ratio: "9:16", // Vertical para redes sociales
    }),
  });
 
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Veo3 error ${r.status}: ${txt.slice(0, 200)}`);
  }
 
  const data = await r.json();
  const videoUrl = data?.video?.url || data?.url || null;
  if (!videoUrl) throw new Error("Veo3 no devolvió URL de video.");
 
  // Descargar el video y convertir a base64
  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) throw new Error("No se pudo descargar el video de Veo3.");
  const videoBuffer = await videoRes.arrayBuffer();
  const videoBase64 = Buffer.from(videoBuffer).toString("base64");
 
  return { url: videoUrl, base64: videoBase64, mimeType: "video/mp4" };
}
 
// ── Generar narración con ElevenLabs ─────────────────────────
async function generateNarration(text, accent) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.log("[comercial] ElevenLabs no configurado — saltando narración");
    return null;
  }
 
  const voiceId = VOICE_MAP[accent] || VOICE_MAP["neutro"];
  const url     = `${ELEVENLABS_BASE}/text-to-speech/${voiceId}`;
 
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key":   apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.3 },
    }),
  });
 
  if (!r.ok) {
    console.error("[comercial] ElevenLabs error:", r.status);
    return null;
  }
 
  const audioBuffer = await r.arrayBuffer();
  const audioBase64 = Buffer.from(audioBuffer).toString("base64");
  return { base64: audioBase64, mimeType: "audio/mpeg" };
}
 
// ── Handler principal ─────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
 
  try {
    // Auth
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(401).json({ ok: false, error: auth.error });
    const user = auth.user;
 
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
 
    const storyboard     = body?.storyboard;
    const referenceImages = Array.isArray(body?.referenceImages) ? body.referenceImages : [];
    const accent         = String(body?.accent || "neutro");
    const hasAvatar      = !!body?.hasAvatar;
 
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
      return res.status(400).json({ ok: false, error: "JADE_CHARGE_FAILED", detail: spendErr.message });
    }
 
    console.log(`[comercial-generate] user=${user.id} scenes=${storyboard.scenes.length} cost=${COMERCIAL_COST}J`);
 
    // Imagen de referencia principal (primera foto subida)
    const mainRef = referenceImages[0] || null;
 
    // ── Procesar cada escena en PARALELO ─────────────────────
    const sceneResults = await Promise.allSettled(
      storyboard.scenes.map(async (scene, idx) => {
        console.log(`[comercial] procesando escena ${idx + 1}/${storyboard.scenes.length}`);
 
        // 1. Generar imagen base de la escena
        let sceneImage = null;
        try {
          sceneImage = await generateSceneImage(
            scene.image_prompt,
            mainRef?.base64 || null,
            mainRef?.mimeType || "image/jpeg"
          );
        } catch (e) {
          console.error(`[comercial] imagen escena ${idx + 1} falló:`, e?.message);
        }
 
        // 2. Generar clip de video desde la imagen
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
 
        // 3. Generar narración de la escena
        let narration = null;
        if (scene.narration) {
          try {
            narration = await generateNarration(scene.narration, accent);
          } catch (e) {
            console.error(`[comercial] narración escena ${idx + 1} falló:`, e?.message);
          }
        }
 
        return {
          scene_number:  scene.scene_number,
          camera:        scene.camera,
          description:   scene.description,
          narration_text: scene.narration,
          image_b64:     sceneImage?.base64     || null,
          image_mime:    sceneImage?.mimeType   || "image/jpeg",
          video_url:     videoResult?.url       || null,
          video_b64:     videoResult?.base64    || null,
          audio_b64:     narration?.base64      || null,
          audio_mime:    narration?.mimeType    || "audio/mpeg",
          ok: !!(videoResult?.url || videoResult?.base64),
        };
      })
    );
 
    const scenes = sceneResults.map((r, idx) =>
      r.status === "fulfilled" ? r.value : {
        scene_number: idx + 1, ok: false,
        error: r.reason?.message || "Error desconocido",
      }
    );
 
    const successCount = scenes.filter(s => s.ok).length;
    console.log(`[comercial-generate] ✅ ${successCount}/${scenes.length} escenas OK`);
 
    return res.status(200).json({
      ok:          successCount > 0,
      ref,
      title:       storyboard.title,
      style:       storyboard.style,
      music_mood:  storyboard.music_mood,
      call_to_action: storyboard.call_to_action,
      scenes,
      success_count: successCount,
      total_scenes:  scenes.length,
      jade_cost:   COMERCIAL_COST,
    });
 
  } catch (e) {
    console.error("[comercial-generate] SERVER_ERROR:", e?.message || e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", detail: String(e?.message || e) });
  }
}
 
export const config = { runtime: "nodejs" };
