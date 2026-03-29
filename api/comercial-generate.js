// api/comercial-generate.js
// ─────────────────────────────────────────────────────────────
// Pipeline completo de generación de comercial:
//   1. Recibe el storyboard (generado en paso 1)
//   2. Por cada escena genera imagen con Gemini Image
//   3. Convierte imagen a video con Veo3 (sin audio, sin subtítulos)
//   4. Genera narración en off con ElevenLabs (género + acento)
//   5. Devuelve clips + narración por escena
//
// Voces: verificadas manualmente en biblioteca ElevenLabs
// Transiciones: pendiente RunPod FFmpeg worker
// ─────────────────────────────────────────────────────────────
import { requireUser } from "./_auth.js";
import { createClient } from "@supabase/supabase-js";
 
const GEMINI_API_BASE    = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_IMAGE_MODEL = "gemini-2.0-flash-preview-image-generation";
const ELEVENLABS_BASE    = "https://api.elevenlabs.io/v1";
const COMERCIAL_COST     = 120;
 
// ── Voces verificadas manualmente en ElevenLabs ───────────────
const VOICE_MAP = {
  neutro: {
    mujer:  "htFfPSZGJwjBv1CL0aMD", // Antonio — neutro latino
    hombre: "htFfPSZGJwjBv1CL0aMD", // Antonio — neutro latino
  },
  guatemalteco: {
    mujer:  "MbMvLOFbicjtQwgx0j2r", // Michelle — acento guatemalteco femenino
    hombre: "htFfPSZGJwjBv1CL0aMD", // Antonio — neutro (no hay GT masculino disponible)
  },
  colombiano: {
    mujer:  "qHkrJuifPpn95wK3rm2A", // Andrea — colombiana joven, cheerful and calm
    hombre: "o2vbTbO3g4GrKUg7rehy", // Cristian Sanchez — colombiano, lively and deep
  },
  mexicano: {
    mujer:  "MPAa8GSBiMLjMLVwn0Hq", // Daniela — femenina, sensual
    hombre: "1IVWxPHWEi1qouA3cAop", // Omar — mexicano, articulate and conversational
  },
  argentino: {
    mujer:  "6Mo5ciGH5nWiQacn5FYk", // Roma — argentina femenina
    hombre: "JNcXxzrlvFDXcrGo2b47", // Franco — argentino masculino
  },
  español: {
    mujer:  "qHkrJuifPpn95wK3rm2A", // Andrea (fallback castellano)
    hombre: "o2vbTbO3g4GrKUg7rehy", // Cristian (fallback castellano)
  },
  ingles: {
    mujer:  "DXFkLCBUTmvXpp2QwZjA", // Erin — profesional femenina inglés
    hombre: "sB7vwSCyX0tQmU24cW2C", // Jon — natural authority inglés
  },
};
 
function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("MISSING_SUPABASE_ENV");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
 
function getVoiceId(accent, gender) {
  const a = (accent || "neutro").toLowerCase().trim();
  const g = (gender || "mujer").toLowerCase().trim() === "hombre" ? "hombre" : "mujer";
  return (VOICE_MAP[a] || VOICE_MAP["neutro"])[g] || VOICE_MAP["neutro"]["mujer"];
}
 
// ── Generar imagen de escena — prompt universal ───────────────
// Funciona para cualquier categoría: ropa, comida, carros,
// servicios, joyería, restaurantes, spas, lo que sea.
async function generateSceneImage(prompt, referenceImages = []) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("MISSING_GEMINI_API_KEY");
 
  const url   = `${GEMINI_API_BASE}/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`;
  const parts = [];
 
  const hasRefs = referenceImages.some(img => img?.base64);
  for (const img of referenceImages.slice(0, 3)) {
    if (img?.base64 && img?.mimeType) {
      parts.push({ inline_data: { mime_type: img.mimeType, data: img.base64 } });
    }
  }
 
  const fullPrompt = [
    "You are a world-class advertising photographer with 20 years shooting campaigns for major global brands.",
    "Create ONE stunning photorealistic advertisement photograph for this scene.",
    "",
    "=== SCENE ===",
    prompt,
    "",
    "=== REFERENCE IMAGE INSTRUCTIONS ===",
    hasRefs ? [
      "Reference images are provided above. Apply these rules based on what they show:",
      "",
      "If references show CLOTHING / FASHION:",
      "  → Show a model WEARING the exact garment(s) from the reference",
      "  → Reproduce exactly: fabric texture, pattern, color, cut, details, stitching",
      "  → The clothing must be indistinguishable from the reference photo",
      "",
      "If references show FOOD / BEVERAGES:",
      "  → Feature the exact dish/product with professional food photography techniques",
      "  → Steam, texture, colors, plating must match the reference",
      "  → Use appetizing angles (slightly elevated, natural light or warm studio)",
      "",
      "If references show a LOCATION / STORE / RESTAURANT:",
      "  → Use the actual space as the background/setting for the scene",
      "  → Maintain the architectural details, decor, lighting of the real place",
      "",
      "If references show a PRODUCT (electronics, jewelry, car, cosmetics, etc.):",
      "  → Feature the exact product prominently — same model, color, shape",
      "  → Use dramatic product photography lighting: rim lights, reflections, hero angles",
      "",
      "If references show a PERSON / MODEL / AVATAR:",
      "  → Maintain their exact likeness: face, skin tone, hair, distinctive features",
      "  → Place them naturally in the scene described",
      "",
      "Use ALL provided reference images together to build the most accurate scene possible.",
    ].join("\n") : "No references provided — create a premium generic commercial scene based on the description.",
    "",
    "=== QUALITY STANDARDS ===",
    "• Photorealistic — must look like an actual professional photograph",
    "• Cinematic lighting: golden hour / dramatic studio / soft natural — whatever fits",
    "• Composition: rule of thirds, intentional depth of field, dynamic framing",
    "• Colors: rich, vibrant, commercial-grade color grading",
    "• Format: 9:16 vertical portrait for social media (Reels, TikTok, Stories)",
    "• Quality level: national TV commercial / luxury brand campaign",
    "",
    "=== HARD PROHIBITIONS ===",
    "• NO text, typography, logos, watermarks of any kind",
    "• NO subtitles or captions anywhere in the image",
    "• NO generic stock photo look — must feel like a real brand campaign",
    "• NO AI-generation artifacts, distortions, or unrealistic proportions",
  ].join("\n");
 
  parts.push({ text: fullPrompt });
 
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        temperature: 0.35,
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
 
// ── Convertir imagen a video con Veo3 Fast ────────────────────
// Prompt negativo fuerte: sin subtítulos, sin texto, sin audio
async function imageToVideoVeo3(imageBase64, imageMime, videoPrompt) {
  const falKey = process.env.FAL_KEY;
  if (!falKey) throw new Error("MISSING_FAL_KEY");
 
  const dataUrl = `data:${imageMime};base64,${imageBase64}`;
 
  const enhancedPrompt = [
    videoPrompt,
    // Calidad cinematográfica
    "Cinematic camera movement. Professional commercial quality. Smooth intentional motion.",
    "Sharp focus on subject. Consistent color grade throughout the clip.",
    // Prohibiciones de texto — repetidas por importancia
    "ABSOLUTELY NO subtitles. ABSOLUTELY NO captions. ABSOLUTELY NO text overlay.",
    "ABSOLUTELY NO on-screen text of any kind. ABSOLUTELY NO watermarks. ABSOLUTELY NO logos.",
    "ABSOLUTELY NO lower thirds. ABSOLUTELY NO title cards.",
    // Prohibiciones de audio y diálogo
    "ABSOLUTELY NO dialogue. ABSOLUTELY NO speech. ABSOLUTELY NO talking.",
    "Silent video — voiceover will be added separately in post-production.",
    // Prohibiciones de transiciones internas
    "ABSOLUTELY NO internal cuts or transitions — single continuous shot only.",
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
      aspect_ratio: "9:16",
    }),
  });
 
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Veo3 error ${r.status}: ${txt.slice(0, 300)}`);
  }
 
  const data     = await r.json();
  const videoUrl = data?.video?.url || data?.url || null;
  if (!videoUrl) throw new Error("Veo3 no devolvió URL de video.");
 
  const videoRes    = await fetch(videoUrl);
  if (!videoRes.ok) throw new Error("No se pudo descargar el video de Veo3.");
  const videoBuffer = await videoRes.arrayBuffer();
  const videoBase64 = Buffer.from(videoBuffer).toString("base64");
 
  return { url: videoUrl, base64: videoBase64, mimeType: "video/mp4" };
}
 
// ── Generar narración en off con ElevenLabs ───────────────────
async function generateNarration(text, accent, gender) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.log("[comercial] ElevenLabs no configurado — saltando narración");
    return null;
  }
 
  const voiceId = getVoiceId(accent, gender);
  console.log(`[comercial] narración — accent=${accent} gender=${gender} voiceId=${voiceId}`);
 
  const r = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability:         0.55,
        similarity_boost:  0.80,
        style:             0.35,
        use_speaker_boost: true,
      },
    }),
  });
 
  if (!r.ok) {
    console.error(`[comercial] ElevenLabs error ${r.status}:`, (await r.text().catch(() => "")).slice(0, 200));
    return null;
  }
 
  const audioBuffer = await r.arrayBuffer();
  return { base64: Buffer.from(audioBuffer).toString("base64"), mimeType: "audio/mpeg" };
}
 
// ── Handler principal ─────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
 
  try {
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(401).json({ ok: false, error: auth.error });
    const user = auth.user;
 
    const body            = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const storyboard      = body?.storyboard;
    const referenceImages = Array.isArray(body?.referenceImages) ? body.referenceImages : [];
    const accent          = String(body?.accent || "neutro");
    const gender          = String(body?.gender || "mujer");
 
    if (!storyboard?.scenes?.length) return res.status(400).json({ ok: false, error: "MISSING_STORYBOARD" });
 
    // Cobrar Jades
    const sb  = getSupabaseAdmin();
    const ref = `comercial-${Date.now()}-${Math.random().toString(36).slice(2)}`;
 
    const { error: spendErr } = await sb.rpc("spend_jades", {
      p_user_id: user.id, p_amount: COMERCIAL_COST, p_reason: "comercial_completo", p_ref: ref,
    });
 
    if (spendErr) {
      if ((spendErr.message || "").includes("INSUFFICIENT_JADES")) {
        return res.status(402).json({ ok: false, error: "INSUFFICIENT_JADES", required: COMERCIAL_COST });
      }
      return res.status(400).json({ ok: false, error: "JADE_CHARGE_FAILED", detail: spendErr.message });
    }
 
    console.log(`[comercial-generate] user=${user.id} scenes=${storyboard.scenes.length} accent=${accent} gender=${gender} refs=${referenceImages.length} cost=${COMERCIAL_COST}J`);
 
    // Procesar escenas en paralelo
    const sceneResults = await Promise.allSettled(
      storyboard.scenes.map(async (scene, idx) => {
        console.log(`[comercial] escena ${idx + 1}/${storyboard.scenes.length}`);
 
        let sceneImage = null;
        try { sceneImage = await generateSceneImage(scene.image_prompt, referenceImages); }
        catch (e) { console.error(`[comercial] imagen ${idx + 1}:`, e?.message); }
 
        let videoResult = null;
        if (sceneImage) {
          try { videoResult = await imageToVideoVeo3(sceneImage.base64, sceneImage.mimeType, scene.video_prompt); }
          catch (e) { console.error(`[comercial] video ${idx + 1}:`, e?.message); }
        }
 
        let narration = null;
        if (scene.narration) {
          try { narration = await generateNarration(scene.narration, accent, gender); }
          catch (e) { console.error(`[comercial] narración ${idx + 1}:`, e?.message); }
        }
 
        return {
          scene_number:   scene.scene_number,
          narrative_role: scene.narrative_role || null,
          camera:         scene.camera,
          description:    scene.description,
          narration_text: scene.narration,
          image_b64:      sceneImage?.base64   || null,
          image_mime:     sceneImage?.mimeType || "image/jpeg",
          video_url:      videoResult?.url     || null,
          video_b64:      videoResult?.base64  || null,
          audio_b64:      narration?.base64    || null,
          audio_mime:     narration?.mimeType  || "audio/mpeg",
          ok: !!(videoResult?.url || videoResult?.base64),
        };
      })
    );
 
    const scenes       = sceneResults.map((r, idx) =>
      r.status === "fulfilled" ? r.value : { scene_number: idx + 1, ok: false, error: r.reason?.message || "Error" }
    );
    const successCount = scenes.filter(s => s.ok).length;
    console.log(`[comercial-generate] ✅ ${successCount}/${scenes.length} escenas OK`);
 
    return res.status(200).json({
      ok: successCount > 0, ref,
      title: storyboard.title, style: storyboard.style,
      music_mood: storyboard.music_mood, call_to_action: storyboard.call_to_action,
      accent, gender, scenes, success_count: successCount,
      total_scenes: scenes.length, jade_cost: COMERCIAL_COST,
    });
 
  } catch (e) {
    console.error("[comercial-generate] SERVER_ERROR:", e?.message || e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", detail: String(e?.message || e) });
  }
}
 
export const config = { runtime: "nodejs" };
