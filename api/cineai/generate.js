// api/cineai/generate.js
// ─────────────────────────────────────────────────────────────
// Endpoint de generación de video con Seedance 2.0 via BytePlus ModelArk
//
// Proveedor: BytePlus ModelArk (API oficial de ByteDance)
// Base URL:  https://ark.ap-southeast.bytepluses.com/api/v3
// Auth:      Authorization: Bearer BYTEPLUS_API_KEY
// Variable Vercel: BYTEPLUS_API_KEY
//
// Modelos disponibles:
//   dreamina-seedance-2-0-t2v-250924    → texto → video (sin imagen)
//   dreamina-seedance-2-0-i2v-250924    → imagen → video (calidad máxima)
//   dreamina-seedance-2-0-fast-t2v-250924 → texto rápido
//   dreamina-seedance-2-0-fast-i2v-250924 → imagen rápida
//
// Estructura del payload BytePlus:
//   content: array de objetos con type: "text" | "image_url" | "video_url"
//   El texto incluye los parámetros al final: --ratio 9:16 --duration 10
//   Las imágenes/videos se pasan como objetos separados en el array content
//
// IMPORTANTE — continuación de escena:
//   imageUrl   = último frame del clip anterior (@Image1 = arranque visual)
//   refVideoUrl = clip completo anterior     (@Video1 = referencia de atmósfera)
//   Seedance mantiene luz, cámara y estilo entre clips con esta técnica.
//
// IMPORTANTE — audio:
//   BytePlus Seedance 2.0 SÍ soporta audio nativo. Se pasa como type: "audio_url"
//   en el array content. Formatos: mp3, wav. Máx 15 segundos.
// ─────────────────────────────────────────────────────────────
import { supabaseAdmin }          from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

const BYTEPLUS_BASE = "https://ark.ap-southeast.bytepluses.com/api/v3";
const BYTEPLUS_CREATE = `${BYTEPLUS_BASE}/contents/generations/tasks`;

// ── Modelos BytePlus Seedance 2.0 ────────────────────────────
// i2v = image-to-video (acepta imagen como referencia)
// t2v = text-to-video (solo texto)
// fast = más rápido y barato, misma calidad visual
const MODEL_I2V      = "dreamina-seedance-2-0-i2v-250924";
const MODEL_T2V      = "dreamina-seedance-2-0-t2v-250924";
const MODEL_FAST_I2V = "dreamina-seedance-2-0-fast-i2v-250924";
const MODEL_FAST_T2V = "dreamina-seedance-2-0-fast-t2v-250924";

// ── Costo en Jades por duración ───────────────────────────────
const JADE_COSTS = { 5: 40, 10: 75, 15: 110 };

// ── Celebridades y personajes bloqueados ──────────────────────
const BLOCKED_NAMES = [
  "tom cruise","brad pitt","angelina jolie","scarlett johansson",
  "will smith","dwayne johnson","the rock","ryan reynolds",
  "chris evans","chris hemsworth","robert downey","zendaya",
  "bad bunny","benito martinez","j balvin","ozuna","daddy yankee",
  "maluma","shakira","jennifer lopez","j.lo","taylor swift",
  "beyoncé","beyonce","rihanna","drake","nicki minaj","cardi b",
  "ariana grande","billie eilish","harry styles","ed sheeran",
  "justin bieber","selena gomez","elon musk","jeff bezos",
  "mark zuckerberg","donald trump","joe biden","obama",
  "kim kardashian","kanye west","ye","messi","cristiano ronaldo",
  "ronaldo","neymar","lebron james","michael jordan","kobe bryant",
  "spider-man","spiderman","batman","superman","iron man","ironman",
  "thor","hulk","captain america","black widow","darth vader",
  "grogu","baby yoda","yoda","luke skywalker","han solo",
  "shrek","sonic","pikachu","mario","mickey mouse",
  "spongebob","esponja","patrick star","bugs bunny",
  "harry potter","hermione","voldemort","gandalf","frodo",
  "james bond","jack sparrow","indiana jones",
  "optimus prime","megatron","godzilla","king kong",
  "bruce lee","brucelle","bruce willis","jackie chan",
  "disney","marvel","pixar","warner","dc comics","netflix",
];

function detectBlockedContent(text) {
  const lower = (text || "").toLowerCase();
  for (const name of BLOCKED_NAMES) {
    const escaped = name.replace(/[-]/g, "\\-");
    const regex = new RegExp(`\\b${escaped}\\b`, "i");
    if (regex.test(lower)) return name;
  }
  return null;
}

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
    prompt,
    imageUrl,        // URL foto del usuario O último frame en modo continuación
    refVideoUrl,     // URL video de referencia O clip anterior en continuación
    audioUrl,        // URL audio para lip sync (mp3/wav, máx 15s)
    animateExact,    // boolean: animar foto exacta respetando escenario
    isContinuation,  // boolean: modo continuación perfecta entre clips
    duration = 10,
    aspectRatio = "9:16",
    sceneMode = "tiktok",
  } = body;

  if (!prompt || String(prompt).trim().length < 5) {
    return res.status(400).json({ ok: false, error: "El prompt es muy corto" });
  }

  const blocked = detectBlockedContent(prompt);
  if (blocked) {
    return res.status(400).json({
      ok: false,
      error: `"${blocked}" está bloqueado por derechos de autor. Describe un personaje original.`,
      blocked: true,
    });
  }

  const jadeCost = JADE_COSTS[duration] || 75;

  const ref = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

  // ── Descontar Jades antes de llamar a BytePlus ────────────
  const { error: spendErr } = await supabaseAdmin.rpc("spend_jades", {
    p_user_id: userId,
    p_amount:  jadeCost,
    p_reason:  "cineai_generate",
    p_ref:     ref,
  });

  if (spendErr) {
    console.error("[cineai/generate] spend_jades failed:", spendErr.message);
    if ((spendErr.message || "").includes("INSUFFICIENT_JADES")) {
      return res.status(402).json({
        ok: false,
        error: "INSUFFICIENT_JADES",
        detail: `Necesitas ${jadeCost} Jades para esta generación.`,
      });
    }
    return res.status(400).json({ ok: false, error: spendErr.message });
  }

  // ── Construir payload BytePlus ────────────────────────────
  // BytePlus usa un array "content" donde cada elemento es:
  //   { type: "text",      text: "..." }
  //   { type: "image_url", image_url: { url: "..." } }
  //   { type: "video_url", video_url: { url: "..." } }
  //   { type: "audio_url", audio_url: { url: "..." } }
  // Los parámetros van al final del texto: --ratio 9:16 --duration 10

  let finalPrompt = String(prompt).trim();
  let mode = "t2v";
  let modelId = MODEL_T2V;
  const content = []; // array de contenido para BytePlus

  if (isContinuation && imageUrl && refVideoUrl) {
    // ── MODO CONTINUACIÓN PERFECTA ────────────────────────────
    // Último frame como imagen de arranque + clip completo como referencia
    // de atmósfera, iluminación, movimiento de cámara y estilo visual.
    content.push({ type: "image_url", image_url: { url: imageUrl } });
    content.push({ type: "video_url", video_url: { url: refVideoUrl } });
    finalPrompt = `[Image 1] Start from this exact frame and continue the scene seamlessly. [Video 1] Use this clip as full reference to maintain the exact same atmosphere, lighting, color grade, and camera movement style. The continuation must feel like an uninterrupted extension of the same shot. ${finalPrompt}`;
    mode = "continuation";
    modelId = MODEL_I2V;

  } else if (isContinuation && imageUrl && !refVideoUrl) {
    // Fallback continuación solo con frame (no debería pasar)
    content.push({ type: "image_url", image_url: { url: imageUrl } });
    finalPrompt = `[Image 1] Continue this exact scene seamlessly from this frame. Maintain the same atmosphere, lighting, and visual style. ${finalPrompt}`;
    mode = "continuation_frame_only";
    modelId = MODEL_I2V;

  } else if (animateExact && imageUrl) {
    // ── MODO ANIMAR FOTO EXACTA ───────────────────────────────
    content.push({ type: "image_url", image_url: { url: imageUrl } });
    finalPrompt = `[Image 1] Animate this exact photo naturally with subtle realistic motion. STRICTLY preserve the original background, environment, scenery, and all characters exactly as they appear. Do not change, replace, or add any new backgrounds or characters. Only add natural movement to existing subjects. ${finalPrompt}`;
    mode = "animate";
    modelId = MODEL_I2V;

  } else if (audioUrl && imageUrl) {
    // ── MODO LIP SYNC — foto + audio ─────────────────────────
    // BytePlus Seedance 2.0 SÍ soporta audio nativo (a diferencia de PiAPI)
    content.push({ type: "image_url", image_url: { url: imageUrl } });
    content.push({ type: "audio_url", audio_url: { url: audioUrl } });
    finalPrompt = `[Image 1] Lip sync the person in this image to the audio in [Audio 1]. Mouth movements must match the song exactly. Keep the original background and lighting. ${finalPrompt}`;
    mode = "lipsync";
    modelId = MODEL_I2V;

  } else if (audioUrl && !imageUrl) {
    // ── LIP SYNC SIN FOTO ─────────────────────────────────────
    content.push({ type: "audio_url", audio_url: { url: audioUrl } });
    finalPrompt = `[Audio 1] Person lip syncing to this audio, mouth movements perfectly synced to the music, expressive performance. ${finalPrompt}`;
    mode = "lipsync_nophoto";
    modelId = MODEL_T2V;

  } else if (refVideoUrl && imageUrl) {
    // ── R2V + CARA — copia movimiento con cara del usuario ────
    content.push({ type: "image_url", image_url: { url: imageUrl } });
    content.push({ type: "video_url", video_url: { url: refVideoUrl } });
    finalPrompt = `[Image 1] Use this person as the subject. [Video 1] Copy ONLY the body movement and choreography from this reference video. Background and environment should come from the prompt description, NOT from the reference video. ${finalPrompt}`;
    mode = "r2v+face";
    modelId = MODEL_I2V;

  } else if (refVideoUrl && !imageUrl) {
    // ── R2V — solo copia movimiento ───────────────────────────
    content.push({ type: "video_url", video_url: { url: refVideoUrl } });
    finalPrompt = `[Video 1] Copy ONLY the body movement and choreography from this reference video. Background and environment should come from the prompt description, NOT from the reference video. ${finalPrompt}`;
    mode = "r2v";
    modelId = MODEL_T2V;

  } else if (imageUrl) {
    // ── I2V — animar foto ─────────────────────────────────────
    content.push({ type: "image_url", image_url: { url: imageUrl } });
    finalPrompt = `[Image 1] ${finalPrompt}`;
    mode = "i2v";
    modelId = MODEL_I2V;

  } else {
    // ── T2V — solo texto ──────────────────────────────────────
    mode = "t2v";
    modelId = MODEL_T2V;
  }

  // Agregar el texto con los parámetros al final (formato BytePlus)
  const textWithParams = `${finalPrompt} --ratio ${aspectRatio} --duration ${duration} --resolution 720p`;
  content.push({ type: "text", text: textWithParams });

  const byteplusPayload = {
    model:   modelId,
    content: content,
  };

  // ── Llamar a BytePlus ─────────────────────────────────────
  let taskData;
  try {
    const bpRes = await fetch(BYTEPLUS_CREATE, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${process.env.BYTEPLUS_API_KEY}`,
      },
      body: JSON.stringify(byteplusPayload),
    });

    taskData = await bpRes.json();

    if (!bpRes.ok || taskData.error) {
      throw new Error(taskData.error?.message || taskData.message || `BytePlus error ${bpRes.status}`);
    }
  } catch (err) {
    // Reembolsar Jades si BytePlus falla
    await supabaseAdmin.rpc("spend_jades", {
      p_user_id: userId,
      p_amount:  -jadeCost,
      p_reason:  "cineai_refund_byteplus_error",
      p_ref:     ref,
    });
    console.error("[cineai/generate] BytePlus error:", err.message);
    return res.status(500).json({ ok: false, error: "Error generando video. Jades reembolsados." });
  }

  // BytePlus devuelve el task en taskData directamente (no en taskData.data)
  const taskId = taskData.id;

  if (!taskId) {
    await supabaseAdmin.rpc("spend_jades", {
      p_user_id: userId,
      p_amount:  -jadeCost,
      p_reason:  "cineai_refund_no_taskid",
      p_ref:     ref,
    });
    console.error("[cineai/generate] BytePlus no devolvió task id. Response:", JSON.stringify(taskData));
    return res.status(500).json({ ok: false, error: "BytePlus no devolvió task id" });
  }

  // ── Guardar en video_jobs ─────────────────────────────────
  const jobId = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

  const { error: insertErr } = await supabaseAdmin.from("video_jobs").insert({
    id:                  jobId,
    user_id:             userId,
    status:              "IN_PROGRESS",
    mode:                "cineai",
    prompt:              finalPrompt,
    provider:            "byteplus_seedance",
    provider_request_id: taskId,
    provider_status:     "running",
    started_at:          new Date().toISOString(),
    payload: {
      task_id:         taskId,
      cineai_mode:     mode,
      scene_mode:      sceneMode,
      duration,
      aspect_ratio:    aspectRatio,
      model:           modelId,
      image_url:       imageUrl    || null,
      ref_video_url:   refVideoUrl || null,
      audio_url:       audioUrl    || null,
      animate_exact:   animateExact   || false,
      is_continuation: isContinuation || false,
      jade_cost:       jadeCost,
      ref,
    },
  });

  if (insertErr) {
    console.error("[cineai/generate] video_jobs insert failed:", insertErr.message);
  }

  console.error("[cineai/generate] OK", { userId, jobId, taskId, mode, modelId, jadeCost });

  return res.status(200).json({
    ok: true,
    jobId,
    taskId,
    mode,
    jadeCost,
  });
}

export const config = { runtime: "nodejs" };
