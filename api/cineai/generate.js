// api/cineai/generate.js
// ─────────────────────────────────────────────────────────────
// Endpoint de generación de video con Seedance 2.0 via PiAPI
//
// Modos:
//   t2v          → solo texto → video
//   i2v          → foto del usuario → video animado
//   r2v          → video de referencia → copia SOLO el movimiento, NO el fondo
//   r2v+face     → video referencia + foto → movimiento con cara del usuario
//   animate      → foto exacta animada respetando fondo y personajes originales
//   lipsync      → foto + audio → lip sync de esa canción específica
//
// IMPORTANTE sobre R2V y fondo:
//   Seedance 2.0 copia el movimiento del video de referencia pero el fondo
//   siempre viene de la imagen del usuario o del prompt. NUNCA copia el fondo
//   del video de referencia. Esto es comportamiento del modelo, no un bug.
// ─────────────────────────────────────────────────────────────
import { supabaseAdmin }           from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader }  from "../../src/lib/getUserIdFromAuth.js";

const PIAPI_URL = "https://api.piapi.ai/api/v1/task";

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
    imageUrl,      // URL foto del usuario
    refVideoUrl,   // URL video de referencia (subido o externo)
    audioUrl,      // URL audio para lip sync
    animateExact,  // boolean: animar foto exacta respetando escenario
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

  // ── Construir prompt y payload ────────────────────────────
  let finalPrompt = String(prompt).trim();
  const inputExtra = {};
  let mode = "t2v";

  if (animateExact && imageUrl) {
    // Modo animar foto exacta — prompt muy específico para que respete el fondo
    // y los personajes originales de la imagen
    inputExtra.image_urls = [imageUrl];
    finalPrompt = `Animate this exact photo naturally with subtle realistic motion. STRICTLY preserve the original background, environment, scenery, and all characters exactly as they appear in the image. Do not change, replace, or add any new backgrounds or characters. Only add natural movement to the existing subjects. ${finalPrompt}`;
    mode = "animate";
  } else if (audioUrl && imageUrl) {
    // Modo lip sync — foto + audio
    inputExtra.image_urls = [imageUrl];
    inputExtra.audio_urls = [audioUrl];
    finalPrompt = `Lip sync the person in @Image1 to the audio in @Audio1. The person's mouth movements should match the song exactly. Keep the original background. ${finalPrompt}`;
    mode = "lipsync";
  } else if (audioUrl && !imageUrl) {
    // Audio sin foto — genera personaje con lip sync
    inputExtra.audio_urls = [audioUrl];
    finalPrompt = `Person lip syncing to the audio in @Audio1, mouth movements perfectly synced to the music. ${finalPrompt}`;
    mode = "lipsync";
  } else if (refVideoUrl) {
    // R2V — copia SOLO el movimiento, el fondo viene de la imagen o del prompt
    // NOTA: Seedance NUNCA copia el fondo del video de referencia
    inputExtra.video_urls = [refVideoUrl];
    if (imageUrl) {
      inputExtra.image_urls = [imageUrl];
      finalPrompt = `Copy ONLY the body movement and choreography from @Video1. Use the person from @Image1 as the subject. Background and environment should come from the prompt description, NOT from the reference video. ${finalPrompt}`;
      mode = "r2v+face";
    } else {
      finalPrompt = `Copy ONLY the body movement and choreography from @Video1. Background and environment should come from the prompt description, NOT from the reference video. ${finalPrompt}`;
      mode = "r2v";
    }
  } else if (imageUrl) {
    inputExtra.image_urls = [imageUrl];
    mode = "i2v";
  }

  const piPayload = {
    model: "seedance",
    task_type: "seedance-2-preview",
    input: {
      prompt: finalPrompt,
      duration,
      aspect_ratio: aspectRatio,
      ...inputExtra,
    },
  };

  // ── Llamar a PiAPI ────────────────────────────────────────
  let piTask;
  try {
    const piRes = await fetch(PIAPI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.PIAPI_KEY,
      },
      body: JSON.stringify(piPayload),
    });

    piTask = await piRes.json();

    if (!piRes.ok || piTask.code !== 200) {
      throw new Error(piTask.message || `PiAPI error ${piRes.status}`);
    }
  } catch (err) {
    // Reembolsar Jades si PiAPI falla
    await supabaseAdmin.rpc("spend_jades", {
      p_user_id: userId,
      p_amount:  -jadeCost,
      p_reason:  "cineai_refund_piapi_error",
      p_ref:     ref,
    });
    console.error("[cineai/generate] PiAPI error:", err.message);
    return res.status(500).json({ ok: false, error: "Error generando video. Jades reembolsados." });
  }

  const taskId = piTask.data?.task_id;

  if (!taskId) {
    // Sin taskId no podemos hacer polling — reembolsar
    await supabaseAdmin.rpc("spend_jades", {
      p_user_id: userId,
      p_amount:  -jadeCost,
      p_reason:  "cineai_refund_no_taskid",
      p_ref:     ref,
    });
    return res.status(500).json({ ok: false, error: "PiAPI no devolvió task_id" });
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
    provider:            "piapi_seedance",
    provider_request_id: taskId,
    provider_status:     "pending",
    started_at:          new Date().toISOString(),
    payload: {
      task_id:       taskId,
      cineai_mode:   mode,
      scene_mode:    sceneMode,
      duration,
      aspect_ratio:  aspectRatio,
      image_url:     imageUrl    || null,
      ref_video_url: refVideoUrl || null,
      audio_url:     audioUrl    || null,
      animate_exact: animateExact || false,
      jade_cost:     jadeCost,
      ref,
    },
  });

  if (insertErr) {
    console.error("[cineai/generate] video_jobs insert failed:", insertErr.message);
    // No reembolsamos aquí — el job en PiAPI ya está corriendo
    // El usuario puede perder el video si el insert falla
    // En producción se podría agregar un sistema de recuperación
  }

  console.error("[cineai/generate] OK", { userId, jobId, taskId, mode, jadeCost });

  return res.status(200).json({
    ok: true,
    jobId,
    taskId,
    mode,
    jadeCost,
  });
}

export const config = { runtime: "nodejs" };
