// api/comercial-generate.js
// ROUTING: con personas → EvoLink | sin personas → BytePlus
// Si BytePlus bloquea por rostro → error FACE_DETECTED → frontend muestra mensaje
import { supabaseAdmin }          from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

const GEMINI_API_BASE    = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_IMAGE_MODEL = "gemini-2.0-flash-exp";
const ELEVENLABS_BASE    = "https://api.elevenlabs.io/v1";
const BYTEPLUS_BASE      = "https://ark.ap-southeast.bytepluses.com/api/v3";
const BYTEPLUS_CREATE    = `${BYTEPLUS_BASE}/contents/generations/tasks`;
const BYTEPLUS_MODEL     = "dreamina-seedance-2-0-260128";
const EVOLINK_URL        = "https://api.evolink.ai/v1/videos/generations";
const EVOLINK_MODEL      = "seedance-2.0-fast-reference-to-video";
const COMERCIAL_COST     = 120;

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
  return (VOICE_MAP[(a||"neutro").toLowerCase()] || VOICE_MAP.neutro)[(g||"mujer").toLowerCase() === "hombre" ? "hombre" : "mujer"];
}

async function uploadImageTemp(base64, mimeType, userId) {
  const ext  = mimeType.includes("png") ? "png" : "jpg";
  const path = `comercial/temp/${userId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabaseAdmin.storage.from("user-uploads")
    .upload(path, Buffer.from(base64, "base64"), { contentType: mimeType, upsert: false });
  if (error) throw new Error(`Error subiendo imagen: ${error.message}`);
  const { data } = supabaseAdmin.storage.from("user-uploads").getPublicUrl(path);
  return { url: data.publicUrl, path };
}

async function generateSceneImage(prompt, referenceImages = []) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("MISSING_GEMINI_API_KEY");
  const parts = [];
  for (const img of referenceImages.slice(0, 4))
    if (img?.base64 && img?.mimeType)
      parts.push({ inline_data: { mime_type: img.mimeType, data: img.base64 } });
  parts.push({ text: prompt });
  const r = await fetch(`${GEMINI_API_BASE}/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["TEXT", "IMAGE"], temperature: 0.3 } }),
  });
  if (!r.ok) throw new Error(`Gemini error ${r.status}`);
  const data    = await r.json();
  const imgPart = data?.candidates?.[0]?.content?.parts?.find(p => p?.inlineData?.data || p?.inline_data?.data);
  if (!imgPart) throw new Error("Gemini no devolvió imagen.");
  const pd = imgPart.inlineData || imgPart.inline_data;
  return { base64: pd.data, mimeType: pd.mimeType || pd.mime_type || "image/jpeg" };
}

async function imageToVideoByteplus(imageUrl, videoPrompt, aspectRatio, duration) {
  const r = await fetch(BYTEPLUS_CREATE, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.BYTEPLUS_API_KEY}` },
    body: JSON.stringify({ model: BYTEPLUS_MODEL, content: [
      { type: "image_url", image_url: { url: imageUrl } },
      { type: "text", text: `[Image 1] ${videoPrompt} --ratio ${aspectRatio} --duration ${duration} --resolution 720p` },
    ]}),
  });
  const data = await r.json();
  if (!r.ok || data.error) {
    const msg = data.error?.message || data.message || "";
    if (msg.toLowerCase().includes("real person") || msg.toLowerCase().includes("face")) throw new Error("FACE_DETECTED");
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
      if (msg.toLowerCase().includes("real person") || msg.toLowerCase().includes("face")) throw new Error("FACE_DETECTED");
      throw new Error(msg || "BytePlus failed");
    }
  }
  throw new Error("Timeout BytePlus");
}

async function imageToVideoEvolink(imageUrl, videoPrompt, aspectRatio, duration) {
  const r = await fetch(EVOLINK_URL, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${process.env.EVOLINK_API_KEY}`,
    },
    body: JSON.stringify({
      model:          EVOLINK_MODEL,
      prompt:         `image 1 ${videoPrompt}`,
      image_urls:     [imageUrl],
      duration:       Math.min(Number(duration) || 5, 10),
      aspect_ratio:   aspectRatio,
      quality:        "480p",
      generate_audio: false,
    }),
  });
  const data = await r.json();
  console.log("[comercial] EvoLink submit:", { id: data.id, status: data.status, error: data.error || null });
  if (!r.ok || data.error) throw new Error(data.error?.message || data.message || `EvoLink error ${r.status}`);
  const taskId = data.id;
  if (!taskId) throw new Error("EvoLink no devolvió task id");
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(res => setTimeout(res, 8000));
    const sr = await fetch(`https://api.evolink.ai/v1/tasks/${taskId}`, {
      headers: { "Authorization": `Bearer ${process.env.EVOLINK_API_KEY}` },
    });
    const sd = await sr.json();
    console.log("[comercial] EvoLink poll:", { status: sd.status, id: taskId });
    if (sd.status === "completed" || sd.status === "succeeded") {
      const videoUrl = sd.video_url || sd.output?.video_url || sd.output?.videos?.[0]?.url || sd.output?.url || null;
      if (!videoUrl) throw new Error("EvoLink completó pero sin video_url");
      return videoUrl;
    }
    if (sd.status === "failed") throw new Error(sd.error?.message || "EvoLink failed");
  }
  throw new Error("Timeout EvoLink");
}

async function generateSceneVideo(imageUrl, videoPrompt, aspectRatio, duration, hasHumanFace, alwaysEvolink = false) {
  if (alwaysEvolink || hasHumanFace) {
    return await imageToVideoEvolink(imageUrl, videoPrompt, aspectRatio, duration);
  }
  return await imageToVideoByteplus(imageUrl, videoPrompt, aspectRatio, duration);
}

async function saveVideoToLibrary(userId, videoUrl) {
  try {
    const res    = await fetch(videoUrl);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const path   = `${userId}/comercial_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`;
    const { error } = await supabaseAdmin.storage.from("videos").upload(path, buffer, { contentType: "video/mp4", upsert: false });
    if (error) throw new Error(error.message);
    const { data } = supabaseAdmin.storage.from("videos").getPublicUrl(path);
    return data?.publicUrl || videoUrl;
  } catch (err) { console.error("[comercial] saveVideo failed:", err.message); return videoUrl; }
}

async function generateNarration(text, accent, gender) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || !text?.trim()) return null;
  const r = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${getVoiceId(accent, gender)}`, {
    method: "POST", headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.55, similarity_boost: 0.80, style: 0.35, use_speaker_boost: true } }),
  });
  if (!r.ok) return null;
  return { base64: Buffer.from(await r.arrayBuffer()).toString("base64"), mimeType: "audio/mpeg" };
}

function buildModaImagePrompt(idx, total, hasModelo, hasFondo) {
  if (hasModelo && hasFondo) return `World-class fashion photographer. [Image 1] EXACT model — preserve face, skin, hair PERFECTLY. [Image 2] EXACT background — reproduce it exactly. [Image 3] Clothing — model WEARING it, exact fabric, pattern, cut. Full body 9:16. NO text.`;
  if (hasModelo) return `World-class fashion photographer. [Image 1] EXACT model — preserve face PERFECTLY. [Image 2] Clothing — model WEARING it. Scene ${idx+1}/${total}: invent stunning aspirational background. Full body 9:16. NO text.`;
  if (hasFondo)  return `World-class fashion photographer. [Image 1] EXACT background — reproduce exactly. [Image 2] Clothing — generate stunning model WEARING it, age 20-28. Full body 9:16. NO text.`;
  return `World-class fashion photographer luxury campaign. [Image 1] Clothing — generate aspirational model WEARING it, age 20-28. Scene ${idx+1}/${total}: unique stunning location. Full body 9:16. NO text.`;
}

function buildStoryboardImagePrompt(scene, refs) {
  return [
    "World-class advertising photographer. ONE stunning photorealistic advertisement photograph.",
    scene.image_prompt,
    refs?.some(i => i?.base64) ? "Use ALL reference images. Maintain exact likeness of people. Feature products prominently." : "",
    "Cinematic lighting. 9:16 vertical. TV commercial quality. NO text, NO subtitles, NO logos.",
  ].filter(Boolean).join("\n");
}

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
  const { storyboard, referenceImages = [], accent = "neutro", gender = "mujer",
          plantilla_id, imagenes = {}, textos = {}, hasHumanFace = false } = body;

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
    // ── TRANSICIÓN DE MODA ────────────────────────────────────
    if (plantilla_id === "transicion_moda") {
      const prendas = imagenes.prendas || [];
      const modelo  = imagenes.modelo  || [];
      const fondo   = imagenes.fondo   || [];
      if (!prendas.length) return res.status(400).json({ ok: false, error: "Necesitas al menos una foto de prenda" });
      const hasModelo = modelo.length > 0;
      const hasFondo  = fondo.length  > 0;
      const sceneResults = [];

      for (let i = 0; i < prendas.length; i++) {
        try {
          const refs = [...(hasModelo ? [modelo[0]] : []), ...(hasFondo ? [fondo[0]] : []), prendas[i]];
          const sceneImage = await generateSceneImage(buildModaImagePrompt(i, prendas.length, hasModelo, hasFondo), refs);
          const { url: imageUrl, path: imagePath } = await uploadImageTemp(sceneImage.base64, sceneImage.mimeType, userId);
          const vp = hasModelo ? "Fashion model walks confidently, hair flowing, outfit clearly visible. Cinematic dolly-in, golden hour. NO text." : "Elegant fashion model walks toward camera, outfit in full detail. Cinematic push-in, warm light. NO text.";
          const videoUrl = await generateSceneVideo(imageUrl, vp, "9:16", 5, hasHumanFace && hasModelo);
          const libraryUrl = await saveVideoToLibrary(userId, videoUrl);
          await supabaseAdmin.storage.from("user-uploads").remove([imagePath]).catch(() => {});
          const narration = textos?.narracion ? await generateNarration(textos.narracion, accent, gender) : null;
          sceneResults.push({ scene_number: i + 1, ok: true, video_url: libraryUrl, audio_b64: narration?.base64 || null });
        } catch (err) {
          console.error(`[comercial] prenda ${i+1}:`, err.message);
          sceneResults.push({ scene_number: i + 1, ok: false, error: err.message === "FACE_DETECTED" ? "FACE_DETECTED" : err.message });
        }
      }
      const successCount = sceneResults.filter(s => s.ok).length;
      return res.status(200).json({ ok: successCount > 0, ref, plantilla_id, scenes: sceneResults, success_count: successCount, total_scenes: prendas.length, jade_cost: COMERCIAL_COST });
    }

    // ── PRODUCTO ESTELAR ──────────────────────────────────────
    if (plantilla_id === "producto_estelar") {
      const producto = imagenes.producto || [];
      if (!producto.length) return res.status(400).json({ ok: false, error: "Sube la foto del producto" });

      // NO usamos Gemini — la foto del usuario ES el producto.
      // BytePlus anima directamente con el prompt del efecto.
      // El prompt describe: mano lanza el producto al aire → transformación en el aire con el efecto.
      const efectoMap = {
        golden_particles: "A hand elegantly launches the product (@image1) into the air. Once airborne, an explosion of golden glowing particles and light rays burst from the product in slow motion, luxury commercial quality, dark studio background, dramatic rim lighting.",
        fire_energy:      "A hand powerfully throws the product (@image1) upward. Mid-air, dramatic fire and energy bursts erupt around it, flames dancing in slow motion, dark background, cinematic power and force.",
        liquid_splash:    "A hand tosses the product (@image1) into the air. It emerges from a spectacular liquid splash, crystal clear water droplets frozen in time around it, fresh and clean, high-speed photography style.",
        crystal_smoke:    "A hand lifts the product (@image1) into the air. Mystical smoke and glowing crystal formations materialize around it, mysterious and sophisticated, dark moody cinematic lighting.",
        flower_petals:    "A hand gently launches the product (@image1) upward. Blooming flower petals burst and fly through the air around it, natural and soft, warm golden light, luxury brand aesthetic.",
        electric_storm:   "A hand throws the product (@image1) into the air. Electric lightning bolts and energy storms crackle around it mid-air, technology and innovation, dramatic blue neon light.",
      };
      const efecto = body.selectores?.efecto || "golden_particles";
      const videoPrompt = (efectoMap[efecto] || efectoMap.golden_particles) + " ABSOLUTELY NO text, NO subtitles, NO watermarks, NO logos.";

      const { url: imageUrl, path: imagePath } = await uploadImageTemp(producto[0].base64, producto[0].mimeType, userId);
      const videoUrl   = await imageToVideoByteplus(imageUrl, videoPrompt, "9:16", 5);
      const libraryUrl = await saveVideoToLibrary(userId, videoUrl);
      await supabaseAdmin.storage.from("user-uploads").remove([imagePath]).catch(() => {});
      const narration = textos?.narracion ? await generateNarration(textos.narracion, accent, gender) : null;
      return res.status(200).json({ ok: true, ref, plantilla_id, scenes: [{ scene_number: 1, ok: true, video_url: libraryUrl, audio_b64: narration?.base64 || null }], success_count: 1, total_scenes: 1, jade_cost: COMERCIAL_COST });
    }

    // ── EXPLOSIÓN DE SABOR ────────────────────────────────────
    if (plantilla_id === "explosion_sabor") {
      const plato = imagenes.plato || [];
      if (!plato.length) return res.status(400).json({ ok: false, error: "Sube la foto del platillo" });
      // NO usamos Gemini — la foto del plato va directo a BytePlus
      // BytePlus anima el plato explotando con cada ingrediente volando
      const videoPrompt = "@image1 The dish dramatically explodes outward, each individual ingredient flies through the air in slow motion, components separating and floating in different directions revealing every detail, dark moody background, dramatic studio lighting, epic cinematic food commercial, ingredients suspended mid-air. ABSOLUTELY NO text, NO subtitles, NO watermarks.";
      const { url: imageUrl, path: imagePath } = await uploadImageTemp(plato[0].base64, plato[0].mimeType, userId);
      const videoUrl   = await imageToVideoByteplus(imageUrl, videoPrompt, "9:16", 5);
      const libraryUrl = await saveVideoToLibrary(userId, videoUrl);
      await supabaseAdmin.storage.from("user-uploads").remove([imagePath]).catch(() => {});
      const narration = textos?.narracion ? await generateNarration(textos.narracion, accent, gender) : null;
      return res.status(200).json({ ok: true, ref, plantilla_id, scenes: [{ scene_number: 1, ok: true, video_url: libraryUrl, audio_b64: narration?.base64 || null }], success_count: 1, total_scenes: 1, jade_cost: COMERCIAL_COST });
    }

    // ── CHEF IA ───────────────────────────────────────────────
    if (plantilla_id === "chef_ia") {
      const plato = imagenes.plato || [];
      const chef  = imagenes.chef  || [];
      if (!plato.length) return res.status(400).json({ ok: false, error: "Sube la foto del platillo" });
      const avatarDescs = {
        chef_hombre_latino: "professional Latin male chef, 30s, white coat, confident",
        chef_mujer_latina:  "elegant Latin female chef, 30s, white coat, warm smile",
        chef_barbudo:       "tattooed bearded male chef, black apron, urban style",
        chef_mujer_moderna: "young modern female chef, stylish apron",
      };
      const chefDesc   = chef.length ? "[Image 1] is the chef — maintain exact likeness." : `Generate ${avatarDescs[body.selectores?.avatar_tipo] || avatarDescs.chef_hombre_latino}.`;
      const refs       = chef.length ? [chef[0], plato[0]] : [plato[0]];
      const sceneImage = await generateSceneImage(`World-class food photographer. ${chefDesc} [Image ${chef.length ? 2 : 1}] finished dish. Chef plating in professional kitchen, cinematic lighting, photorealistic, 9:16, NO text.`, refs);
      const { url: imageUrl, path: imagePath } = await uploadImageTemp(sceneImage.base64, sceneImage.mimeType, userId);
      const useHuman   = hasHumanFace && chef.length > 0;
      const videoUrl   = await generateSceneVideo(imageUrl, "Chef elegantly plates and presents dish, smooth cinematic camera movement, warm kitchen lighting. NO text.", "9:16", 5, useHuman);
      const libraryUrl = await saveVideoToLibrary(userId, videoUrl);
      await supabaseAdmin.storage.from("user-uploads").remove([imagePath]).catch(() => {});
      const narration = textos?.narracion ? await generateNarration(textos.narracion, accent, gender) : null;
      return res.status(200).json({ ok: true, ref, plantilla_id, scenes: [{ scene_number: 1, ok: true, video_url: libraryUrl, audio_b64: narration?.base64 || null }], success_count: 1, total_scenes: 1, jade_cost: COMERCIAL_COST });
    }

    // ── STORYBOARD COMPLETO ───────────────────────────────────
    if (!storyboard?.scenes?.length)
      return res.status(400).json({ ok: false, error: "MISSING_STORYBOARD" });

    const sceneResults = await Promise.allSettled(
      storyboard.scenes.map(async (scene, idx) => {
        let sceneImage = null;
        try { sceneImage = await generateSceneImage(buildStoryboardImagePrompt(scene, referenceImages), referenceImages); }
        catch (e) { console.error(`[comercial] img ${idx+1}:`, e.message); }
        let videoUrl = null;
        if (sceneImage) {
          try {
            const { url: imageUrl, path: imagePath } = await uploadImageTemp(sceneImage.base64, sceneImage.mimeType, userId);
            videoUrl = await generateSceneVideo(imageUrl, scene.video_prompt, "9:16", 5, hasHumanFace);
            videoUrl = await saveVideoToLibrary(userId, videoUrl);
            await supabaseAdmin.storage.from("user-uploads").remove([imagePath]).catch(() => {});
          } catch (e) { console.error(`[comercial] video ${idx+1}:`, e.message); }
        }
        let narration = null;
        if (scene.narration) try { narration = await generateNarration(scene.narration, accent, gender); } catch {}
        return { scene_number: scene.scene_number, narrative_role: scene.narrative_role || null, description: scene.description, narration_text: scene.narration, image_b64: sceneImage?.base64 || null, image_mime: sceneImage?.mimeType || "image/jpeg", video_url: videoUrl || null, audio_b64: narration?.base64 || null, audio_mime: "audio/mpeg", ok: !!videoUrl };
      })
    );
    const scenes       = sceneResults.map((r, idx) => r.status === "fulfilled" ? r.value : { scene_number: idx+1, ok: false, error: r.reason?.message });
    const successCount = scenes.filter(s => s.ok).length;
    return res.status(200).json({ ok: successCount > 0, ref, title: storyboard.title, style: storyboard.style, music_mood: storyboard.music_mood, call_to_action: storyboard.call_to_action, accent, gender, scenes, success_count: successCount, total_scenes: scenes.length, jade_cost: COMERCIAL_COST });

  } catch (e) {
    try { await supabaseAdmin.rpc("spend_jades", { p_user_id: userId, p_amount: -COMERCIAL_COST, p_reason: "comercial_refund_error", p_ref: ref }); } catch {}
    console.error("[comercial-generate] SERVER_ERROR:", e.message);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", detail: e.message });
  }
}

export const config = { runtime: "nodejs" };
