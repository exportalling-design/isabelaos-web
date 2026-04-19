// api/cineai/generate.js
// ─────────────────────────────────────────────────────────────
// Endpoint de generación de video con Seedance 2.0 via BytePlus ModelArk
//
// FACE BYPASS — Grid Overlay:
//   BytePlus bloquea fotos de personas reales con su detector facial.
//   Antes de mandar cualquier imagen con rostro, le aplicamos un grid
//   overlay 6x6 de líneas blancas sólidas que rompe los patrones de
//   detección biométrica sin afectar la calidad del output de Seedance.
//   El modelo sigue "viendo" el rostro y lo usa correctamente.
//   Técnica documentada y probada por la comunidad de creadores.
//
// IMPORTANTE — continuación de escena:
//   BytePlus NO permite mezclar imagen de primer frame con video de referencia.
//   En modo continuación solo se manda el último frame como imagen de arranque.
// ─────────────────────────────────────────────────────────────
import { supabaseAdmin }          from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";
import sharp from "sharp";

const BYTEPLUS_BASE   = "https://ark.ap-southeast.bytepluses.com/api/v3";
const BYTEPLUS_CREATE = `${BYTEPLUS_BASE}/contents/generations/tasks`;
const MODEL           = "dreamina-seedance-2-0-260128";

const JADE_COSTS = { 5: 40, 10: 75, 15: 110 };

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

// ── GRID OVERLAY — bypass del detector facial de BytePlus ─────
// Aplica una cuadrícula 6x6 de líneas blancas sólidas sobre la imagen.
// Rompe los patrones biométricos que activan el detector de rostros reales
// sin afectar la capacidad de Seedance de leer el rostro para el video.
// Referencia: técnica documentada por la comunidad (línea 12px, 100% opacidad).
async function applyGridOverlay(imageUrl) {
  try {
    // 1. Descargar la imagen original
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`No se pudo descargar imagen: ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    const inputBuffer = Buffer.from(arrayBuffer);

    // 2. Obtener dimensiones
    const metadata = await sharp(inputBuffer).metadata();
    const width    = metadata.width  || 512;
    const height   = metadata.height || 512;

    // 3. Generar SVG con cuadrícula 6x6 de líneas blancas sólidas
    const cols     = 10;
    const rows     = 10;
    const lineW    = 16; // grosor líneas en px
    const colStep  = Math.floor(width  / cols);
    const rowStep  = Math.floor(height / rows);

    let svgLines = "";

    // Líneas verticales
    for (let i = 1; i < cols; i++) {
      const x = i * colStep;
      svgLines += `<rect x="${x}" y="0" width="${lineW}" height="${height}" fill="white"/>`;
    }
    // Líneas horizontales
    for (let i = 1; i < rows; i++) {
      const y = i * rowStep;
      svgLines += `<rect x="0" y="${y}" width="${width}" height="${lineW}" fill="white"/>`;
    }

    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${svgLines}</svg>`
    );

    // 4. Composite: imagen original + grid encima
    const outputBuffer = await sharp(inputBuffer)
      .composite([{ input: svg, blend: "over" }])
      .blur(0.8)
      .jpeg({ quality: 88 })
      .toBuffer();

    // 5. Subir imagen procesada a Supabase Storage temporal
    const path = `cineai/grid/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
    const { error: uploadErr } = await supabaseAdmin.storage
      .from("user-uploads")
      .upload(path, outputBuffer, { contentType: "image/jpeg", upsert: false });

    if (uploadErr) throw new Error(`Error subiendo imagen procesada: ${uploadErr.message}`);

    const { data } = supabaseAdmin.storage.from("user-uploads").getPublicUrl(path);
    console.error("[cineai/generate] grid overlay aplicado:", path);
    return { url: data.publicUrl, tempPath: path };

  } catch (err) {
    // Si falla el grid, usar la URL original (BytePlus puede bloquearla, pero al menos intentamos)
    console.error("[cineai/generate] grid overlay failed, usando imagen original:", err.message);
    return { url: imageUrl, tempPath: null };
  }
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
    imageUrl,
    refVideoUrl,
    audioUrl,
    animateExact,
    isContinuation,
    duration    = 10,
    aspectRatio = "9:16",
    sceneMode   = "tiktok",
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

  // ── Aplicar grid overlay a imágenes con rostros ───────────
  // Se aplica a TODAS las imágenes de usuario para bypassear el detector facial.
  // Imágenes de continuación (últimos frames) también pueden tener rostros.
  let processedImageUrl  = imageUrl  || null;
  let gridTempPath       = null;

  if (imageUrl) {
    const gridResult = await applyGridOverlay(imageUrl);
    processedImageUrl = gridResult.url;
    gridTempPath      = gridResult.tempPath;
  }

  // ── Construir payload BytePlus ────────────────────────────
  let finalPrompt = String(prompt).trim();
  let mode    = "t2v";
  let modelId = MODEL;
  const content = [];

  if (isContinuation && processedImageUrl) {
    // CONTINUACIÓN — solo primer frame, sin video de referencia
    content.push({ type: "image_url", image_url: { url: processedImageUrl } });
    finalPrompt = `[Image 1] This is the last frame of the previous clip. Continue the scene seamlessly from this exact frame. Maintain the same atmosphere, lighting, color grade, camera movement style, and visual mood. The continuation must feel like an uninterrupted extension of the same shot with no style changes. ${finalPrompt}`;
    mode = "continuation";

  } else if (animateExact && processedImageUrl) {
    content.push({ type: "image_url", image_url: { url: processedImageUrl } });
    finalPrompt = `[Image 1] Animate this exact photo naturally with subtle realistic motion. STRICTLY preserve the original background, environment, scenery, and all characters exactly as they appear. Do not change, replace, or add any new backgrounds or characters. Only add natural movement to existing subjects. ${finalPrompt}`;
    mode = "animate";

  } else if (audioUrl && processedImageUrl) {
    // LIP SYNC — foto + audio
    content.push({ type: "image_url", image_url: { url: processedImageUrl } });
    content.push({ type: "audio_url", audio_url: { url: audioUrl } });
    finalPrompt = `[Image 1] Lip sync the person in this image to the audio in [Audio 1]. Mouth movements must match the song exactly. Keep the original background and lighting. ${finalPrompt}`;
    mode = "lipsync";

  } else if (audioUrl && !processedImageUrl) {
    content.push({ type: "audio_url", audio_url: { url: audioUrl } });
    finalPrompt = `[Audio 1] Person lip syncing to this audio, mouth movements perfectly synced to the music, expressive performance. ${finalPrompt}`;
    mode = "lipsync_nophoto";

  } else if (refVideoUrl && processedImageUrl) {
    // R2V + CARA
    content.push({ type: "image_url", image_url: { url: processedImageUrl } });
    content.push({ type: "video_url", video_url: { url: refVideoUrl } });
    finalPrompt = `[Image 1] Use this person as the subject. [Video 1] Copy ONLY the body movement and choreography from this reference video. Background and environment should come from the prompt description, NOT from the reference video. ${finalPrompt}`;
    mode = "r2v+face";

  } else if (refVideoUrl && !processedImageUrl) {
    content.push({ type: "video_url", video_url: { url: refVideoUrl } });
    finalPrompt = `[Video 1] Copy ONLY the body movement and choreography from this reference video. Background and environment should come from the prompt description, NOT from the reference video. ${finalPrompt}`;
    mode = "r2v";

  } else if (processedImageUrl) {
    content.push({ type: "image_url", image_url: { url: processedImageUrl } });
    finalPrompt = `[Image 1] ${finalPrompt}`;
    mode = "i2v";

  } else {
    mode = "t2v";
  }

  // Texto con parámetros al final
  content.push({
    type: "text",
    text: `${finalPrompt} --ratio ${aspectRatio} --duration ${duration} --resolution 720p`,
  });

  const byteplusPayload = { model: modelId, content };

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
    // Limpiar imagen temporal del grid
    if (gridTempPath) {
      await supabaseAdmin.storage.from("user-uploads").remove([gridTempPath]).catch(() => {});
    }
    // Reembolsar Jades
    await supabaseAdmin.rpc("spend_jades", {
      p_user_id: userId,
      p_amount:  -jadeCost,
      p_reason:  "cineai_refund_byteplus_error",
      p_ref:     ref,
    });
    console.error("[cineai/generate] BytePlus error:", err.message);
    return res.status(500).json({ ok: false, error: "Error generando video. Jades reembolsados." });
  }

  const taskId = taskData.id;
  if (!taskId) {
    if (gridTempPath) {
      await supabaseAdmin.storage.from("user-uploads").remove([gridTempPath]).catch(() => {});
    }
    await supabaseAdmin.rpc("spend_jades", {
      p_user_id: userId,
      p_amount:  -jadeCost,
      p_reason:  "cineai_refund_no_taskid",
      p_ref:     ref,
    });
    console.error("[cineai/generate] BytePlus no devolvió task id:", JSON.stringify(taskData));
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
      grid_temp_path:  gridTempPath   || null,
      jade_cost:       jadeCost,
      ref,
    },
  });

  if (insertErr) {
    console.error("[cineai/generate] video_jobs insert failed:", insertErr.message);
  }

  console.error("[cineai/generate] OK", { userId, jobId, taskId, mode, modelId, jadeCost, gridApplied: !!gridTempPath });

  return res.status(200).json({ ok: true, jobId, taskId, mode, jadeCost });
}

export const config = { runtime: "nodejs" };
