// api/generate.js  (usado por CineAIPanel vía /api/cineai/generate que apunta aquí)
// ─────────────────────────────────────────────────────────────
// MIGRACIÓN COMPLETA A PIAPI — fal.ai ELIMINADO
// Razón: fal.ai cobró $21 USD por 1 video de 15s con Seedance 2.0
// PiAPI tiene precio fijo predecible y ya lo usamos en CineAI exitosamente
//
// ROUTING PiAPI:
//   Con imagen(s) → seedance-2-preview  (i2v / r2v+face / animate / lipsync / continuation)
//   Sin imagen    → seedance-2-preview  (t2v / r2v sin rostro)
//   Audio lip sync→ PiAPI acepta audio directo (sin el workaround de fal.ai)
// ─────────────────────────────────────────────────────────────
import { supabaseAdmin }          from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

const PIAPI_URL      = "https://api.piapi.ai/api/v1/task";
const PIAPI_MODEL    = "seedance";
const PIAPI_TASK     = "seedance-2-preview";   // Seedance 2.0 fast — precio fijo
const JADE_COSTS     = { 5: 40, 10: 75, 15: 110 };

const BLOCKED_NAMES = [
  "tom cruise","brad pitt","angelina jolie","scarlett johansson","will smith",
  "dwayne johnson","the rock","ryan reynolds","chris evans","chris hemsworth",
  "robert downey","zendaya","bad bunny","benito martinez","j balvin","ozuna",
  "daddy yankee","maluma","shakira","jennifer lopez","j.lo","taylor swift",
  "beyoncé","beyonce","rihanna","drake","nicki minaj","cardi b","ariana grande",
  "billie eilish","harry styles","ed sheeran","justin bieber","selena gomez",
  "elon musk","jeff bezos","mark zuckerberg","donald trump","joe biden","obama",
  "kim kardashian","kanye west","ye","messi","cristiano ronaldo","ronaldo",
  "neymar","lebron james","michael jordan","kobe bryant","spider-man","spiderman",
  "batman","superman","iron man","ironman","thor","hulk","captain america",
  "black widow","darth vader","grogu","baby yoda","yoda","luke skywalker",
  "han solo","shrek","sonic","pikachu","mario","mickey mouse","spongebob",
  "esponja","patrick star","bugs bunny","harry potter","hermione","voldemort",
  "gandalf","frodo","james bond","jack sparrow","indiana jones","optimus prime",
  "megatron","godzilla","king kong","bruce lee","bruce willis","jackie chan",
  "disney","marvel","pixar","warner","dc comics","netflix",
];

function detectBlockedContent(text) {
  const lower = (text || "").toLowerCase();
  for (const name of BLOCKED_NAMES) {
    if (new RegExp(`\\b${name.replace(/[-]/g,"\\-")}\\b`, "i").test(lower)) return name;
  }
  return null;
}

// ── Enviar tarea a PiAPI ───────────────────────────────────────
async function submitToPiAPI(payload) {
  const r = await fetch(PIAPI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.PIAPI_KEY,
    },
    body: JSON.stringify(payload),
  });

  const data = await r.json();

  if (!r.ok || data.code !== 200) {
    console.error("[PiAPI] error response:", JSON.stringify(data));
    throw new Error(data.message || `PiAPI error ${r.status}`);
  }

  const taskId = data.data?.task_id;
  if (!taskId) throw new Error("PiAPI no devolvió task_id");

  return { taskId };
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
  const {
    prompt,
    imageUrl,           // primera imagen / último frame en continuación
    refImages,          // array de hasta 6 URLs de imágenes de referencia
    refVideoUrl,        // video de referencia / video anterior en continuación
    audioUrl,           // audio para lip sync
    animateExact,       // boolean: animar foto exacta respetando fondo
    isContinuation,     // boolean: continuación de clip anterior
    duration   = 10,
    aspectRatio = "9:16",
    sceneMode  = "tiktok",
  } = body;

  if (!prompt || String(prompt).trim().length < 5)
    return res.status(400).json({ ok: false, error: "El prompt es muy corto" });

  const blocked = detectBlockedContent(prompt);
  if (blocked)
    return res.status(400).json({ ok: false, error: `"${blocked}" está bloqueado.`, blocked: true });

  const jadeCost = JADE_COSTS[duration] || 75;
  const ref = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

  // ── Descontar Jades ──────────────────────────────────────────
  const { error: spendErr } = await supabaseAdmin.rpc("spend_jades", {
    p_user_id: userId,
    p_amount:  jadeCost,
    p_reason:  "cineai_generate",
    p_ref:     ref,
  });

  if (spendErr) {
    if ((spendErr.message || "").includes("INSUFFICIENT_JADES"))
      return res.status(402).json({ ok: false, error: "INSUFFICIENT_JADES", detail: `Necesitas ${jadeCost} Jades.` });
    return res.status(400).json({ ok: false, error: spendErr.message });
  }

  // ── Construir payload PiAPI ──────────────────────────────────
  // PiAPI Seedance 2.0 acepta:
  //   image_urls  → array de URLs de imágenes (hasta 6)
  //   video_urls  → array de URL de video de referencia
  //   audio_urls  → array de URL de audio (lip sync)
  //   prompt, duration, aspect_ratio

  let finalPrompt = String(prompt).trim();
  let mode        = "t2v";
  const inputExtra = {};

  // Construir lista de imágenes — combinar imageUrl + refImages (deduplicar)
  const allImages = [];
  if (imageUrl) allImages.push(imageUrl);
  if (Array.isArray(refImages)) {
    for (const u of refImages) {
      if (u && !allImages.includes(u)) allImages.push(u);
    }
  }
  // Máximo 6 imágenes según documentación PiAPI
  const imageList = allImages.slice(0, 6);

  if (isContinuation && imageList.length > 0 && refVideoUrl) {
    // ── CONTINUACIÓN PERFECTA ────────────────────────────────
    // Image1 = último frame (ancla visual exacta del punto de inicio)
    // Video1 = clip completo anterior (referencia de atmósfera, luz, estilo)
    mode = "continuation";
    inputExtra.image_urls = imageList;
    inputExtra.video_urls = [refVideoUrl];
    finalPrompt = `Continue this exact scene seamlessly from @Image1. Use @Video1 as full reference to maintain the same atmosphere, lighting, camera movement, color grading, and visual style. The continuation must feel like an uninterrupted extension of the same shot. ${finalPrompt}`;

  } else if (isContinuation && imageList.length > 0) {
    // Continuación sin video anterior — solo frame
    mode = "continuation_frame";
    inputExtra.image_urls = imageList;
    finalPrompt = `Continue this exact scene seamlessly from @Image1. Maintain the same atmosphere, lighting, and visual style. ${finalPrompt}`;

  } else if (animateExact && imageList.length > 0) {
    // Animar foto exacta respetando fondo
    mode = "animate";
    inputExtra.image_urls = imageList;
    finalPrompt = `@Image1 Animate this exact photo naturally with subtle realistic motion. STRICTLY preserve the original background, environment, and all characters. Only add natural movement to existing subjects. ${finalPrompt}`;

  } else if (audioUrl && imageList.length > 0) {
    // Lip sync — PiAPI SÍ acepta audio directamente (ventaja sobre fal.ai)
    mode = "lipsync";
    inputExtra.image_urls = imageList;
    inputExtra.audio_urls = [audioUrl];
    const imgRefs = imageList.map((_, i) => `@Image${i + 1}`).join(" ");
    finalPrompt = `${imgRefs} Lip sync the person to the audio in @Audio1. Mouth movements perfectly synced to the music, expressive performance, close-up moments. ${finalPrompt}`;

  } else if (audioUrl && imageList.length === 0) {
    // Audio sin foto
    mode = "lipsync_t2v";
    inputExtra.audio_urls = [audioUrl];
    finalPrompt = `Person lip syncing to the audio in @Audio1. Mouth movements perfectly synced to the music. ${finalPrompt}`;

  } else if (refVideoUrl && imageList.length > 0) {
    // Video de referencia + imágenes — copiar movimiento con cara del usuario
    mode = "r2v+face";
    inputExtra.image_urls = imageList;
    inputExtra.video_urls = [refVideoUrl];
    const imgRefs = imageList.map((_, i) => `@Image${i + 1}`).join(", ");
    finalPrompt = `Use the person from ${imgRefs} as the subject. @Video1 Copy ONLY the body movement and choreography. Background from the prompt, NOT from the reference video. ${finalPrompt}`;

  } else if (refVideoUrl && imageList.length === 0) {
    // Video de referencia sin foto — copiar movimiento puro
    mode = "r2v";
    inputExtra.video_urls = [refVideoUrl];
    finalPrompt = `@Video1 Copy ONLY the body movement and choreography from this reference. Background from the prompt, NOT from the reference video. ${finalPrompt}`;

  } else if (imageList.length > 0) {
    // Imagen(s) sola(s) → i2v con consistencia facial
    mode = "i2v";
    inputExtra.image_urls = imageList;
    const imgRefs = imageList.map((_, i) => `@Image${i + 1}`).join(" ");
    finalPrompt = `${imgRefs} ${finalPrompt}`;

  } else {
    // Solo texto
    mode = "t2v";
  }

  const piPayload = {
    model:     PIAPI_MODEL,
    task_type: PIAPI_TASK,
    input: {
      prompt:       finalPrompt,
      duration,
      aspect_ratio: aspectRatio,
      ...inputExtra,
    },
  };

  // ── Llamar a PiAPI ───────────────────────────────────────────
  let taskId;
  try {
    const result = await submitToPiAPI(piPayload);
    taskId = result.taskId;
  } catch (err) {
    // Reembolsar Jades si PiAPI falla
    try {
      await supabaseAdmin.rpc("spend_jades", {
        p_user_id: userId, p_amount: -jadeCost,
        p_reason: "cineai_refund_piapi_error", p_ref: ref,
      });
    } catch {}
    console.error("[generate] PiAPI error:", err.message);
    return res.status(500).json({ ok: false, error: "Error generando video. Jades reembolsados." });
  }

  // ── Guardar job en Supabase ──────────────────────────────────
  const jobId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

  const { error: insertErr } = await supabaseAdmin.from("video_jobs").insert({
    id:                  jobId,
    user_id:             userId,
    status:              "IN_PROGRESS",
    mode:                "cineai",
    prompt:              finalPrompt,
    provider:            "piapi_seedance",
    provider_request_id: taskId,
    provider_status:     "pending",
    started_at:          new Date().toISOString(),
    payload: {
      task_id:         taskId,
      cineai_mode:     mode,
      scene_mode:      sceneMode,
      duration,
      aspect_ratio:    aspectRatio,
      image_url:       imageUrl      || null,
      ref_images:      imageList,
      ref_video_url:   refVideoUrl   || null,
      audio_url:       audioUrl      || null,
      animate_exact:   animateExact  || false,
      is_continuation: isContinuation || false,
      jade_cost:       jadeCost,
      provider:        "piapi_seedance",
      ref,
    },
  });

  if (insertErr) console.error("[generate] insert failed:", insertErr.message);

  console.log("[generate] OK", { userId, jobId, taskId, mode, jadeCost, provider: "piapi_seedance" });

  return res.status(200).json({
    ok: true,
    jobId,
    taskId,
    mode,
    jadeCost,
    provider: "piapi_seedance",
  });
}

export const config = { runtime: "nodejs" };
