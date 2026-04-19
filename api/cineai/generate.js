// api/cineai/generate.js
// ─────────────────────────────────────────────────────────────
// Routing automático entre 3 proveedores según el caso:
//
//   CON foto + audio  → fal.ai  (acepta imagen + audio, no bloquea rostros)
//   CON foto sin audio → fal.ai  (más barato que BytePlus para rostros)
//   CON video referencia + foto → fal.ai (reference-to-video)
//   SIN foto, sin audio → BytePlus (ya pagado, funciona perfecto)
//   Continuación → BytePlus (sin foto real, solo último frame)
//
// Variables Vercel necesarias:
//   BYTEPLUS_API_KEY  — BytePlus ModelArk
//   FAL_KEY           — fal.ai
// ─────────────────────────────────────────────────────────────
import { supabaseAdmin }          from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

// ── BytePlus ──────────────────────────────────────────────────
const BYTEPLUS_BASE   = "https://ark.ap-southeast.bytepluses.com/api/v3";
const BYTEPLUS_CREATE = `${BYTEPLUS_BASE}/contents/generations/tasks`;
const BYTEPLUS_MODEL  = "dreamina-seedance-2-0-260128";

// ── fal.ai endpoints Seedance 2.0 ────────────────────────────
const FAL_BASE = "https://fal.run";
const FAL_ENDPOINTS = {
  reference: "bytedance/seedance-2.0/fast/reference-to-video", // imagen + audio + video
  image:     "bytedance/seedance-2.0/fast/image-to-video",     // solo imagen
  text:      "bytedance/seedance-2.0/fast/text-to-video",      // solo texto
};

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
    if (new RegExp(`\\b${escaped}\\b`, "i").test(lower)) return name;
  }
  return null;
}

// ── Llamar a fal.ai (submit async) ───────────────────────────
async function submitToFal(endpoint, input) {
  const url = `${FAL_BASE}/${endpoint}`;
  const r = await fetch(url, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Key ${process.env.FAL_KEY}`,
    },
    body: JSON.stringify(input),
  });

  // fal.ai devuelve 200 con request_id en modo queue
  // o devuelve el resultado directo si es sync
  const data = await r.json();
  if (!r.ok) {
    throw new Error(data?.detail || data?.error || `fal.ai error ${r.status}`);
  }

  // Si hay request_id es async, si hay video es sync
  const requestId = data?.request_id || data?.requestId;
  const videoUrl  = data?.video?.url || data?.data?.video?.url;

  return { requestId, videoUrl, raw: data };
}

// ── Llamar a BytePlus ─────────────────────────────────────────
async function submitToByteplus(content) {
  const r = await fetch(BYTEPLUS_CREATE, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${process.env.BYTEPLUS_API_KEY}`,
    },
    body: JSON.stringify({ model: BYTEPLUS_MODEL, content }),
  });

  const data = await r.json();
  if (!r.ok || data.error) {
    throw new Error(data.error?.message || data.message || `BytePlus error ${r.status}`);
  }

  return { taskId: data.id, raw: data };
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
      error: `"${blocked}" está bloqueado. Describe un personaje original.`,
      blocked: true,
    });
  }

  const jadeCost = JADE_COSTS[duration] || 75;
  const ref = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

  // ── Cobrar Jades ──────────────────────────────────────────
  const { error: spendErr } = await supabaseAdmin.rpc("spend_jades", {
    p_user_id: userId,
    p_amount:  jadeCost,
    p_reason:  "cineai_generate",
    p_ref:     ref,
  });

  if (spendErr) {
    if ((spendErr.message || "").includes("INSUFFICIENT_JADES")) {
      return res.status(402).json({
        ok: false,
        error: "INSUFFICIENT_JADES",
        detail: `Necesitas ${jadeCost} Jades.`,
      });
    }
    return res.status(400).json({ ok: false, error: spendErr.message });
  }

  // ─────────────────────────────────────────────────────────
  // ROUTING LOGIC
  // CON imageUrl → fal.ai (no bloquea rostros reales)
  // SIN imageUrl → BytePlus (ya pagado, perfecto para texto/video)
  // Continuación → BytePlus (el último frame no tiene problema de moderación)
  // ─────────────────────────────────────────────────────────
  const useFal      = !!(imageUrl && !isContinuation);
  const provider    = useFal ? "fal_seedance" : "byteplus_seedance";
  let finalPrompt   = String(prompt).trim();
  let mode          = "t2v";
  let taskId        = null;   // BytePlus task id
  let falRequestId  = null;   // fal.ai request id
  let falVideoUrl   = null;   // fal.ai sync response (raro pero posible)

  try {
    if (useFal) {
      // ── FAL.AI — cuando hay imagen (con o sin audio/video) ──
      const hasAudio    = !!audioUrl;
      const hasRefVideo = !!refVideoUrl;

      if (hasAudio || hasRefVideo) {
        // reference-to-video — acepta imagen + audio + video juntos
        mode = hasAudio ? "lipsync" : "r2v+face";
        const imageUrls = [imageUrl];
        const videoUrls = hasRefVideo ? [refVideoUrl] : undefined;
        const audioUrls = hasAudio    ? [audioUrl]    : undefined;

        let promptText = finalPrompt;
        if (hasAudio && !hasRefVideo) {
          promptText = `@Image1 Lip sync the person to the audio in @Audio1. Mouth movements must match exactly. Keep original background and lighting. ${finalPrompt}`;
        } else if (hasRefVideo && !hasAudio) {
          promptText = `@Image1 Use this person as the subject. @Video1 Copy ONLY the body movement and choreography from this reference. Background comes from the prompt, NOT from the reference video. ${finalPrompt}`;
          mode = "r2v+face";
        } else if (hasAudio && hasRefVideo) {
          promptText = `@Image1 Use this person. @Video1 Copy the movement. @Audio1 Lip sync to this audio. ${finalPrompt}`;
          mode = "r2v+face+audio";
        }

        const input = {
          prompt:          promptText,
          image_urls:      imageUrls,
          aspect_ratio:    aspectRatio,
          duration:        String(duration),
          resolution:      "720p",
          generate_audio:  true,
        };
        if (videoUrls) input.video_urls = videoUrls;
        if (audioUrls) input.audio_urls = audioUrls;

        const result = await submitToFal(FAL_ENDPOINTS.reference, input);
        falRequestId = result.requestId;
        falVideoUrl  = result.videoUrl;

      } else if (animateExact) {
        // image-to-video — animar foto exacta
        mode = "animate";
        const result = await submitToFal(FAL_ENDPOINTS.image, {
          prompt:       `Animate this exact photo naturally. STRICTLY preserve original background, scenery and all characters. Only add natural movement to existing subjects. ${finalPrompt}`,
          image_url:    imageUrl,
          aspect_ratio: aspectRatio,
          duration:     String(duration),
          resolution:   "720p",
          generate_audio: true,
        });
        falRequestId = result.requestId;
        falVideoUrl  = result.videoUrl;

      } else {
        // image-to-video estándar — foto del usuario
        mode = "i2v";
        const result = await submitToFal(FAL_ENDPOINTS.image, {
          prompt:       `@Image1 ${finalPrompt}`,
          image_url:    imageUrl,
          aspect_ratio: aspectRatio,
          duration:     String(duration),
          resolution:   "720p",
          generate_audio: true,
        });
        falRequestId = result.requestId;
        falVideoUrl  = result.videoUrl;
      }

    } else {
      // ── BYTEPLUS — sin imagen (texto, video ref, continuación) ──
      const content = [];

      if (isContinuation && imageUrl) {
        // Continuación — último frame como primer frame
        content.push({ type: "image_url", image_url: { url: imageUrl } });
        finalPrompt = `[Image 1] This is the last frame of the previous clip. Continue the scene seamlessly. Maintain same atmosphere, lighting, color grade, camera movement. ${finalPrompt}`;
        mode = "continuation";

      } else if (refVideoUrl && !imageUrl) {
        // R2V — solo video de referencia sin cara
        content.push({ type: "video_url", video_url: { url: refVideoUrl } });
        finalPrompt = `[Video 1] Copy ONLY the body movement and choreography from this reference video. Background comes from the prompt. ${finalPrompt}`;
        mode = "r2v";

      } else if (audioUrl && !imageUrl) {
        // Audio sin foto
        content.push({ type: "audio_url", audio_url: { url: audioUrl } });
        finalPrompt = `[Audio 1] Person lip syncing to this audio, perfectly synced, expressive. ${finalPrompt}`;
        mode = "lipsync_nophoto";

      } else {
        // Solo texto
        mode = "t2v";
      }

      content.push({
        type: "text",
        text: `${finalPrompt} --ratio ${aspectRatio} --duration ${duration} --resolution 720p`,
      });

      const result = await submitToByteplus(content);
      taskId = result.taskId;
    }

  } catch (err) {
    // Reembolsar Jades si falla
    await supabaseAdmin.rpc("spend_jades", {
      p_user_id: userId,
      p_amount:  -jadeCost,
      p_reason:  "cineai_refund_error",
      p_ref:     ref,
    });
    console.error(`[cineai/generate] ${provider} error:`, err.message);
    return res.status(500).json({ ok: false, error: "Error generando video. Jades reembolsados." });
  }

  // ── Verificar que tenemos un ID para hacer polling ────────
  const providerTaskId = taskId || falRequestId;
  if (!providerTaskId && !falVideoUrl) {
    await supabaseAdmin.rpc("spend_jades", {
      p_user_id: userId,
      p_amount:  -jadeCost,
      p_reason:  "cineai_refund_no_taskid",
      p_ref:     ref,
    });
    console.error(`[cineai/generate] no task id. provider=${provider}`);
    return res.status(500).json({ ok: false, error: "El proveedor no devolvió task id" });
  }

  // ── Guardar en video_jobs ─────────────────────────────────
  const jobId = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

  const { error: insertErr } = await supabaseAdmin.from("video_jobs").insert({
    id:                  jobId,
    user_id:             userId,
    status:              falVideoUrl ? "COMPLETED" : "IN_PROGRESS",
    mode:                "cineai",
    prompt:              finalPrompt,
    provider,
    provider_request_id: providerTaskId || jobId,
    provider_status:     falVideoUrl ? "completed" : "running",
    result_url:          falVideoUrl || null,
    started_at:          new Date().toISOString(),
    payload: {
      cineai_mode:     mode,
      scene_mode:      sceneMode,
      duration,
      aspect_ratio:    aspectRatio,
      image_url:       imageUrl    || null,
      ref_video_url:   refVideoUrl || null,
      audio_url:       audioUrl    || null,
      animate_exact:   animateExact   || false,
      is_continuation: isContinuation || false,
      jade_cost:       jadeCost,
      provider,
      task_id:         taskId       || null,
      fal_request_id:  falRequestId || null,
      ref,
    },
  });

  if (insertErr) {
    console.error("[cineai/generate] video_jobs insert failed:", insertErr.message);
  }

  console.error("[cineai/generate] OK", {
    userId, jobId,
    taskId: providerTaskId,
    mode, provider, jadeCost,
    syncVideo: !!falVideoUrl,
  });

  return res.status(200).json({
    ok:       true,
    jobId,
    taskId:   providerTaskId,
    mode,
    provider,
    jadeCost,
    // Si fal.ai devolvió el video directo (sync), lo mandamos ya
    videoUrl: falVideoUrl || null,
  });
}

export const config = { runtime: "nodejs" };
