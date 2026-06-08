// api/comercial-generate.js
// SOLO EvoLink (Seedance 2.0) — sin BytePlus
// Precios dinámicos por plantilla:
//   producto_estelar  → 5s  → 15 Jades
//   explosion_sabor   → 5s  → 15 Jades
//   chef_ia           → 15s → 45 Jades
//   transicion_moda   → EN CONSTRUCCIÓN (deshabilitado)
//   comercial_completo→ EN CONSTRUCCIÓN (deshabilitado)
import { supabaseAdmin }          from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

const GEMINI_API_BASE    = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_IMAGE_MODEL = "gemini-2.0-flash-exp";
const ELEVENLABS_BASE    = "https://api.elevenlabs.io/v1";
const EVOLINK_URL        = "https://api.evolink.ai/v1/videos/generations";
const EVOLINK_MODEL      = "seedance-2.0-fast-reference-to-video";

// Precio por plantilla (Jades)
const PLANTILLA_COST = {
  producto_estelar: 15,
  explosion_sabor:  15,
  chef_ia:          45,
};

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

// ── Animación SOLO con EvoLink ──────────────────────────────
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
      duration:       Math.min(Number(duration) || 5, 15),
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
      const videoUrl =
        (Array.isArray(sd.results) && sd.results[0] && (typeof sd.results[0] === "string" ? sd.results[0] : sd.results[0].url)) ||
        sd.video_url || sd.output?.video_url || sd.output?.videos?.[0]?.url || sd.output?.url || null;
      if (!videoUrl) throw new Error("EvoLink completó pero sin video_url");
      return videoUrl;
    }
    if (sd.status === "failed") throw new Error(sd.error?.message || "EvoLink failed");
  }
  throw new Error("Timeout EvoLink");
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
  const { accent = "neutro", gender = "mujer",
          plantilla_id, imagenes = {}, textos = {}, hasHumanFace = false } = body;

  // Plantillas en construcción
  if (plantilla_id === "transicion_moda" || plantilla_id === "comercial_completo" || body.storyboard) {
    return res.status(400).json({ ok: false, error: "EN_CONSTRUCCION", detail: "Esta plantilla está temporalmente en mantenimiento." });
  }

  const cost = PLANTILLA_COST[plantilla_id];
  if (!cost) return res.status(400).json({ ok: false, error: "Plantilla no válida" });

  const ref = `comercial-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { error: spendErr } = await supabaseAdmin.rpc("spend_jades", {
    p_user_id: userId, p_amount: cost, p_reason: `comercial_${plantilla_id}`, p_ref: ref,
  });
  if (spendErr) {
    if ((spendErr.message || "").includes("INSUFFICIENT_JADES"))
      return res.status(402).json({ ok: false, error: "INSUFFICIENT_JADES", required: cost });
    return res.status(400).json({ ok: false, error: spendErr.message });
  }

  try {
    // ── PRODUCTO ESTELAR (5s) ─────────────────────────────────
    if (plantilla_id === "producto_estelar") {
      const producto = imagenes.producto || [];
      if (!producto.length) { await refund(userId, cost, ref); return res.status(400).json({ ok: false, error: "Sube la foto del producto" }); }
      const efectoMap = {
        golden_particles: "A hand elegantly launches the product into the air. Once airborne, an explosion of golden glowing particles and light rays burst from the product in slow motion, luxury commercial quality, dark studio background, dramatic rim lighting.",
        fire_energy:      "A hand powerfully throws the product upward. Mid-air, dramatic fire and energy bursts erupt around it, flames dancing in slow motion, dark background, cinematic power and force.",
        liquid_splash:    "A hand tosses the product into the air. It emerges from a spectacular liquid splash, crystal clear water droplets frozen in time around it, fresh and clean, high-speed photography style.",
        crystal_smoke:    "A hand lifts the product into the air. Mystical smoke and glowing crystal formations materialize around it, mysterious and sophisticated, dark moody cinematic lighting.",
        flower_petals:    "A hand gently launches the product upward. Blooming flower petals burst and fly through the air around it, natural and soft, warm golden light, luxury brand aesthetic.",
        electric_storm:   "A hand throws the product into the air. Electric lightning bolts and energy storms crackle around it mid-air, technology and innovation, dramatic blue neon light.",
      };
      const efecto = body.selectores?.efecto || "golden_particles";
      const videoPrompt = (efectoMap[efecto] || efectoMap.golden_particles) + " ABSOLUTELY NO text, NO subtitles, NO watermarks, NO logos.";
      const { url: imageUrl, path: imagePath } = await uploadImageTemp(producto[0].base64, producto[0].mimeType, userId);
      const videoUrl   = await imageToVideoEvolink(imageUrl, videoPrompt, "9:16", 5);
      const libraryUrl = await saveVideoToLibrary(userId, videoUrl);
      await supabaseAdmin.storage.from("user-uploads").remove([imagePath]).catch(() => {});
      const narration = textos?.narracion ? await generateNarration(textos.narracion, accent, gender) : null;
      return res.status(200).json({ ok: true, ref, plantilla_id, scenes: [{ scene_number: 1, ok: true, video_url: libraryUrl, audio_b64: narration?.base64 || null }], success_count: 1, total_scenes: 1, jade_cost: cost });
    }

    // ── EXPLOSIÓN DE SABOR (5s) ───────────────────────────────
    if (plantilla_id === "explosion_sabor") {
      const plato = imagenes.plato || [];
      if (!plato.length) { await refund(userId, cost, ref); return res.status(400).json({ ok: false, error: "Sube la foto del platillo" }); }
      const videoPrompt = "The dish dramatically explodes outward, each individual ingredient flies through the air in slow motion, components separating and floating in different directions revealing every detail, dark moody background, dramatic studio lighting, epic cinematic food commercial, ingredients suspended mid-air. ABSOLUTELY NO text, NO subtitles, NO watermarks.";
      const { url: imageUrl, path: imagePath } = await uploadImageTemp(plato[0].base64, plato[0].mimeType, userId);
      const videoUrl   = await imageToVideoEvolink(imageUrl, videoPrompt, "9:16", 5);
      const libraryUrl = await saveVideoToLibrary(userId, videoUrl);
      await supabaseAdmin.storage.from("user-uploads").remove([imagePath]).catch(() => {});
      const narration = textos?.narracion ? await generateNarration(textos.narracion, accent, gender) : null;
      return res.status(200).json({ ok: true, ref, plantilla_id, scenes: [{ scene_number: 1, ok: true, video_url: libraryUrl, audio_b64: narration?.base64 || null }], success_count: 1, total_scenes: 1, jade_cost: cost });
    }

    // ── CHEF IA (15s) ─────────────────────────────────────────
    if (plantilla_id === "chef_ia") {
      const plato = imagenes.plato || [];
      const chef  = imagenes.chef  || [];
      if (!plato.length) { await refund(userId, cost, ref); return res.status(400).json({ ok: false, error: "Sube la foto del platillo" }); }
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
      const videoUrl   = await imageToVideoEvolink(imageUrl, "Chef cinematic 15-second sequence: chef elegantly prepares, plates and presents the dish with professional flair, smooth cinematic camera movements, warm kitchen lighting, multiple angles, appetizing final reveal. NO text.", "9:16", 15);
      const libraryUrl = await saveVideoToLibrary(userId, videoUrl);
      await supabaseAdmin.storage.from("user-uploads").remove([imagePath]).catch(() => {});
      const narration = textos?.narracion ? await generateNarration(textos.narracion, accent, gender) : null;
      return res.status(200).json({ ok: true, ref, plantilla_id, scenes: [{ scene_number: 1, ok: true, video_url: libraryUrl, audio_b64: narration?.base64 || null }], success_count: 1, total_scenes: 1, jade_cost: cost });
    }

    await refund(userId, cost, ref);
    return res.status(400).json({ ok: false, error: "Plantilla no reconocida" });

  } catch (e) {
    await refund(userId, cost, ref);
    console.error("[comercial-generate] SERVER_ERROR:", e.message);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", detail: e.message });
  }
}

async function refund(userId, cost, ref) {
  try { await supabaseAdmin.rpc("spend_jades", { p_user_id: userId, p_amount: -cost, p_reason: "comercial_refund_error", p_ref: ref }); } catch {}
}

export const config = { runtime: "nodejs" };
