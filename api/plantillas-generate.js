// api/plantillas-generate.js
// ─────────────────────────────────────────────────────────────
// Backend unificado para las 5 plantillas de Comercial IA.
// Cada plantilla construye un prompt específico para Seedance 2.0
// via PiAPI (mismo proveedor que CineAI), genera narración con
// ElevenLabs si el usuario la pidió, y guarda el video en la
// biblioteca de Supabase Storage (bucket "videos").
//
// Plantillas:
//   transicion_moda   → Seedance Omni Reference (modelo + prendas)
//   producto_estelar  → Seedance I2V (producto + efecto elegido)
//   desfile_magico    → Seedance I2V (prendas → efecto → modelo)
//   explosion_sabor   → Seedance I2V (plato desintegrado en capas)
//   chef_ia           → Seedance I2V (chef avatar prepara el plato)
//
// Costo: 30 Jades por generación
// ─────────────────────────────────────────────────────────────
import { requireUser }  from "./_auth.js";
import { createClient } from "@supabase/supabase-js";

const PIAPI_URL       = "https://api.piapi.ai/api/v1/task";
const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";
const PLANTILLA_COST  = 30;
const VIDEO_BUCKET    = "videos";

// ── Voces ElevenLabs (mismo VOICE_MAP que comercial-generate) ─
const VOICE_MAP = {
  neutro:       { mujer: "htFfPSZGJwjBv1CL0aMD", hombre: "htFfPSZGJwjBv1CL0aMD" },
  guatemalteco: { mujer: "MbMvLOFbicjtQwgx0j2r", hombre: "htFfPSZGJwjBv1CL0aMD" },
  colombiano:   { mujer: "qHkrJuifPpn95wK3rm2A", hombre: "o2vbTbO3g4GrKUg7rehy" },
  mexicano:     { mujer: "MPAa8GSBiMLjMLVwn0Hq", hombre: "1IVWxPHWEi1qouA3cAop" },
  argentino:    { mujer: "6Mo5ciGH5nWiQacn5FYk", hombre: "JNcXxzrlvFDXcrGo2b47" },
  español:      { mujer: "qHkrJuifPpn95wK3rm2A", hombre: "o2vbTbO3g4GrKUg7rehy" },
  ingles:       { mujer: "DXFkLCBUTmvXpp2QwZjA", hombre: "sB7vwSCyX0tQmU24cW2C" },
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

// ── Convertir base64 a data URL para PiAPI ────────────────────
function toDataUrl(img) {
  if (!img?.base64 || !img?.mimeType) return null;
  return `data:${img.mimeType};base64,${img.base64}`;
}

// ── Generar narración ElevenLabs ──────────────────────────────
async function generateNarration(text, accent, gender) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || !text?.trim()) return null;

  const voiceId = getVoiceId(accent, gender);
  console.log(`[plantillas] narración voiceId=${voiceId} accent=${accent} gender=${gender}`);

  try {
    const r = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}`, {
      method:  "POST",
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
  } catch { return null; }
}

// ── Guardar video en Supabase Storage (biblioteca) ────────────
async function saveToLibrary(userId, videoBase64, plantillaNombre) {
  try {
    const sb       = getSupabaseAdmin();
    const buffer   = Buffer.from(videoBase64, "base64");
    const filename = `plantilla-${plantillaNombre}-${Date.now()}.mp4`;
    const path     = `${userId}/${filename}`;

    const { error } = await sb.storage
      .from(VIDEO_BUCKET)
      .upload(path, buffer, { contentType: "video/mp4", upsert: false });

    if (error) { console.error("[plantillas] storage upload:", error.message); return null; }

    const { data } = sb.storage.from(VIDEO_BUCKET).getPublicUrl(path);
    console.log(`[plantillas] ✅ guardado en biblioteca: ${path}`);
    return data?.publicUrl || null;
  } catch (e) { console.error("[plantillas] saveToLibrary:", e?.message); return null; }
}

// ── Construir payload para PiAPI según plantilla ──────────────
function buildPiapiPayload(plantillaId, imagenes, textos, selectores) {
  let prompt     = "";
  let imageUrls  = [];
  let videoUrls  = [];
  let taskType   = "seedance-2-preview"; // I2V estándar

  switch (plantillaId) {

    // ── 1. TRANSICIÓN DE MODA ─────────────────────────────────
    // Seedance Omni Reference: @Image1=modelo, @Image2..N=prendas
    // El modelo permanece igual, solo cambia la ropa en transición
    case "transicion_moda": {
      const modelo  = imagenes?.modelo?.[0];
      const prendas = imagenes?.prendas || [];
      const fondo   = imagenes?.fondo?.[0];

      if (modelo) imageUrls.push(toDataUrl(modelo));
      prendas.forEach(p => { if (p) imageUrls.push(toDataUrl(p)); });
      if (fondo) imageUrls.push(toDataUrl(fondo));

      // Etiquetas: @Image1=modelo, @Image2..@ImageN=prendas
      const prendasTags = prendas.map((_, i) => `@Image${i + 2}`).join(", ");
      const fondoTag    = fondo ? ` Background from @Image${prendas.length + 2}.` : " Lifestyle background: resort pool area, warm sunlight.";

      prompt = [
        `Fashion model from @Image1 stands in a ${fondo ? "scene" : "resort"} setting.`,
        `She smoothly transitions wearing each outfit: ${prendasTags}.`,
        `The model's face, body, and background remain IDENTICAL throughout.`,
        `ONLY the clothing changes in each transition — smooth outfit swap effect.`,
        `Camera: fixed medium shot, 9:16 vertical.`,
        fondoTag,
        `Cinematic lighting, professional fashion video quality.`,
        `ABSOLUTELY NO subtitles. ABSOLUTELY NO text overlay. Silent video.`,
      ].join(" ");

      taskType = "seedance-2-preview"; // Omni reference soporta múltiples imágenes
      break;
    }

    // ── 2. PRODUCTO ESTELAR ───────────────────────────────────
    // Seedance I2V: producto lanzado al aire con efectos
    case "producto_estelar": {
      const producto = imagenes?.producto?.[0];
      const efecto   = selectores?.efecto || "splash";

      if (producto) imageUrls.push(toDataUrl(producto));

      const EFECTOS = {
        splash:  "surrounded by dynamic liquid splashes, foam waves, and droplets flying through the air",
        petals:  "surrounded by floating rose petals, soft petal rain, delicate flower elements swirling",
        fire:    "wrapped in dramatic golden flames and energy sparks, epic cinematic fire effect",
        luxury:  "surrounded by golden particles, glitter dust, luxury shimmer effects, premium atmosphere",
        smoke:   "emerging from elegant smoke wisps, ice crystal effects, mysterious high-end atmosphere",
      };

      prompt = [
        `The product from @Image1 is dramatically launched into the air by a hand.`,
        `Mid-air, it transforms: ${EFECTOS[efecto] || EFECTOS.splash}.`,
        `Product floats in center frame, rotating slowly, beautifully lit with dramatic studio lighting.`,
        `Dark elegant background with bokeh highlights.`,
        `Cinematic slow motion, 9:16 vertical format.`,
        `Professional commercial quality. Photorealistic physics.`,
        `ABSOLUTELY NO subtitles. ABSOLUTELY NO text. Silent video.`,
      ].join(" ");
      break;
    }

    // ── 3. DESFILE MÁGICO ─────────────────────────────────────
    // Seedance I2V: prendas sueltas → efecto mágico → modelo con outfit
    case "desfile_magico": {
      const prendas = imagenes?.prendas || [];
      const fondo   = imagenes?.fondo?.[0];
      const efecto  = selectores?.efecto || "aurora";

      prendas.forEach(p => { if (p) imageUrls.push(toDataUrl(p)); });
      if (fondo) imageUrls.push(toDataUrl(fondo));

      const EFECTOS_MAGICOS = {
        aurora:     "glowing light particles and soft ethereal smoke",
        bloom:      "blooming flowers, flowing liquid streams, and petal rain",
        galaxia:    "galaxy sparkles, morphing stardust, and cosmic energy",
        natura:     "colorful butterflies, mist, and natural leaf elements",
        fuego_frio: "frozen smoke, golden crystal shards, and cold fire effect",
      };

      const efDesc  = EFECTOS_MAGICOS[efecto] || EFECTOS_MAGICOS.aurora;
      const fondoDesc = fondo ? "in the provided background scene" : "at a luxury resort poolside, sunny day";

      prompt = [
        `Clothing items ${prendas.map((_, i) => `@Image${i + 1}`).join(", ")} float separately in the air.`,
        `A magical effect of ${efDesc} swirls around them.`,
        `The clothing pieces fly together and assemble onto a beautiful fashion model.`,
        `The model appears fully dressed in the complete outfit, posed confidently ${fondoDesc}.`,
        `Smooth cinematic transition, 9:16 vertical, professional fashion campaign quality.`,
        `ABSOLUTELY NO subtitles. ABSOLUTELY NO text overlay. Silent video.`,
      ].join(" ");
      break;
    }

    // ── 4. EXPLOSIÓN DE SABOR ─────────────────────────────────
    // Seedance I2V: plato se desintegra mostrando ingredientes flotando
    case "explosion_sabor": {
      const plato   = imagenes?.plato?.[0];
      const negocio = textos?.nombre_negocio || "el restaurante";
      const slogan  = textos?.slogan || "";

      if (plato) imageUrls.push(toDataUrl(plato));

      prompt = [
        `The food dish from @Image1 explodes dramatically in slow motion.`,
        `Each ingredient separates and floats: buns fly up, meat patty rises, cheese melts and stretches,`,
        `lettuce and tomato spin outward, sauces splash dynamically in all directions.`,
        `Dark dramatic background with cinematic lighting — professional food commercial quality.`,
        `The ingredients are sharply lit, juicy textures visible, steam and steam particles.`,
        `Camera: dynamic slow-motion tracking shot capturing the explosion from slightly below.`,
        `9:16 vertical format. Photorealistic food photography quality.`,
        `ABSOLUTELY NO text overlay. ABSOLUTELY NO subtitles. Silent video.`,
      ].join(" ");
      break;
    }

    // ── 5. CHEF IA ────────────────────────────────────────────
    // Seedance I2V: chef (usuario o avatar) prepara el plato cinematográficamente
    case "chef_ia": {
      const plato      = imagenes?.plato?.[0];
      const chef       = imagenes?.chef?.[0];
      const avatarTipo = selectores?.avatar_tipo || "chef_hombre_latino";
      const negocio    = textos?.nombre_negocio || "el restaurante";

      if (plato) imageUrls.push(toDataUrl(plato));
      if (chef)  imageUrls.push(toDataUrl(chef));

      const AVATARES = {
        chef_hombre_latino:  "a confident Latino male chef, shaved head, dark apron, tattooed arms",
        chef_mujer_latina:   "a confident Latina female chef, dark hair tied back, professional white chef coat",
        chef_hombre_barbudo: "a rugged male chef with beard and tattoos, dark uniform, intense expression",
        chef_mujer_moderna:  "a modern female chef, stylish appearance, professional kitchen attire",
      };

      const chefDesc = chef
        ? "the chef from @Image2"
        : AVATARES[avatarTipo] || AVATARES.chef_hombre_latino;

      prompt = [
        `${chefDesc} stands intimidatingly in a dramatic professional kitchen.`,
        `Cinematic dark atmosphere, industrial steel kitchen, dramatic overhead lighting.`,
        `The chef prepares the dish from @Image1: hands press the meat, flames burst on the grill,`,
        `ingredients sizzle dramatically, cheese melts in close-up, juices drip in slow motion.`,
        `Final shot: chef holds the finished dish toward camera, confident pose.`,
        `Style: dark cinematic commercial, like a premium restaurant brand film.`,
        `9:16 vertical format. Professional cinematography quality.`,
        `ABSOLUTELY NO subtitles. ABSOLUTELY NO text overlay. Silent video.`,
      ].join(" ");
      break;
    }

    default:
      throw new Error(`Plantilla desconocida: ${plantillaId}`);
  }

  // Filtrar nulls
  imageUrls = imageUrls.filter(Boolean);

  const input = {
    prompt,
    duration:     10,
    aspect_ratio: "9:16",
  };

  // Agregar imágenes según cuántas haya
  if (imageUrls.length === 1) {
    input.image_urls = imageUrls; // I2V estándar
  } else if (imageUrls.length > 1) {
    input.image_urls = imageUrls; // Omni reference
  }

  return {
    model:     "seedance",
    task_type: taskType,
    input,
  };
}

// ── Handler principal ─────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(401).json({ ok: false, error: auth.error });
    const user = auth.user;

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

    const { plantilla_id, imagenes, textos, selectores, accent, gender } = body;

    if (!plantilla_id) return res.status(400).json({ ok: false, error: "MISSING_PLANTILLA_ID" });

    // Cobrar Jades
    const sb  = getSupabaseAdmin();
    const ref = `plantilla-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const { error: spendErr } = await sb.rpc("spend_jades", {
      p_user_id: user.id,
      p_amount:  PLANTILLA_COST,
      p_reason:  `plantilla_${plantilla_id}`,
      p_ref:     ref,
    });

    if (spendErr) {
      if ((spendErr.message || "").includes("INSUFFICIENT_JADES")) {
        return res.status(402).json({ ok: false, error: "INSUFFICIENT_JADES", required: PLANTILLA_COST });
      }
      return res.status(400).json({ ok: false, error: "JADE_CHARGE_FAILED", detail: spendErr.message });
    }

    console.log(`[plantillas] user=${user.id} plantilla=${plantilla_id} cost=${PLANTILLA_COST}J`);

    // Construir payload para PiAPI
    let piPayload;
    try {
      piPayload = buildPiapiPayload(plantilla_id, imagenes, textos, selectores);
    } catch (e) {
      // Reembolsar si el payload falla
      await sb.rpc("spend_jades", { p_user_id: user.id, p_amount: -PLANTILLA_COST, p_reason: "plantilla_refund_payload_error", p_ref: ref });
      return res.status(400).json({ ok: false, error: e.message });
    }

    // Llamar a PiAPI (Seedance 2.0)
    const piKey = process.env.PIAPI_KEY;
    if (!piKey) {
      await sb.rpc("spend_jades", { p_user_id: user.id, p_amount: -PLANTILLA_COST, p_reason: "plantilla_refund_no_pikey", p_ref: ref });
      return res.status(500).json({ ok: false, error: "PIAPI_KEY no configurada." });
    }

    let piTask;
    try {
      const piRes = await fetch(PIAPI_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/json", "x-api-key": piKey },
        body:    JSON.stringify(piPayload),
      });
      piTask = await piRes.json();
      if (!piRes.ok || piTask.code !== 200) throw new Error(piTask.message || `PiAPI error ${piRes.status}`);
    } catch (err) {
      await sb.rpc("spend_jades", { p_user_id: user.id, p_amount: -PLANTILLA_COST, p_reason: "plantilla_refund_piapi_error", p_ref: ref });
      console.error("[plantillas] PiAPI error:", err.message);
      return res.status(500).json({ ok: false, error: "Error conectando con el generador de video. Jades reembolsados." });
    }

    const taskId = piTask.data?.task_id;
    if (!taskId) {
      await sb.rpc("spend_jades", { p_user_id: user.id, p_amount: -PLANTILLA_COST, p_reason: "plantilla_refund_no_taskid", p_ref: ref });
      return res.status(500).json({ ok: false, error: "PiAPI no devolvió task_id." });
    }

    // Guardar job en video_jobs (misma tabla que CineAI)
    const jobId = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

    const narracionTexto = textos?.narracion?.trim() || "";

    await sb.from("video_jobs").insert({
      id:                  jobId,
      user_id:             user.id,
      status:              "IN_PROGRESS",
      mode:                "plantilla",
      prompt:              piPayload.input.prompt,
      provider:            "piapi_seedance",
      provider_request_id: taskId,
      provider_status:     "pending",
      started_at:          new Date().toISOString(),
      payload: {
        plantilla_id,
        task_id:        taskId,
        ref,
        jade_cost:      PLANTILLA_COST,
        narration_text: narracionTexto,
        accent:         accent || "neutro",
        gender:         gender || "mujer",
        // Guardamos los textos y selectores para referencia
        textos:    textos    || {},
        selectores: selectores || {},
      },
    }).catch(e => console.error("[plantillas] video_jobs insert:", e?.message));

    console.log(`[plantillas] ✅ job creado jobId=${jobId} taskId=${taskId}`);

    // Generar narración en paralelo (no bloquea la respuesta)
    // Se guarda en job payload cuando esté lista
    if (narracionTexto) {
      generateNarration(narracionTexto, accent, gender)
        .then(async audio => {
          if (!audio) return;
          await sb.from("video_jobs")
            .update({ payload: sb.from("video_jobs").select() }) // placeholder — se actualiza en polling
            .eq("id", jobId)
            .catch(() => {});
        })
        .catch(() => {});
    }

    return res.status(200).json({
      ok:     true,
      jobId,
      taskId,
      plantilla_id,
      jade_cost: PLANTILLA_COST,
    });

  } catch (e) {
    console.error("[plantillas-generate] SERVER_ERROR:", e?.message || e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", detail: String(e?.message || e) });
  }
}

export const config = { runtime: "nodejs" };