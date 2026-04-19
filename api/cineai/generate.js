// api/cineai/generate.js
// ─────────────────────────────────────────────────────────────
// Routing automático entre 3 proveedores:
//
//   Foto sola              → PiAPI       (más barato, no bloquea rostros)
//   Foto + audio           → fal.ai      (lip sync nativo)
//   Foto + video           → fal.ai      (reference-to-video)
//   Foto + audio + video   → fal.ai      (todo junto)
//   Sin foto               → BytePlus    (ya pagado, perfecto)
//   Continuación           → BytePlus    (último frame sin problema)
//
// Vercel env vars:
//   PIAPI_KEY, FAL_KEY, BYTEPLUS_API_KEY
// ─────────────────────────────────────────────────────────────
import { supabaseAdmin }          from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

// ── PiAPI ─────────────────────────────────────────────────────
const PIAPI_URL   = "https://api.piapi.ai/api/v1/task";
const PIAPI_MODEL = "seedance";

// ── fal.ai ────────────────────────────────────────────────────
const FAL_ENDPOINTS = {
  reference: "bytedance/seedance-2.0/fast/reference-to-video",
  image:     "bytedance/seedance-2.0/fast/image-to-video",
};

// ── BytePlus ──────────────────────────────────────────────────
const BYTEPLUS_BASE   = "https://ark.ap-southeast.bytepluses.com/api/v3";
const BYTEPLUS_CREATE = `${BYTEPLUS_BASE}/contents/generations/tasks`;
const BYTEPLUS_MODEL  = "dreamina-seedance-2-0-260128";

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
  "bruce lee","bruce willis","jackie chan",
  "disney","marvel","pixar","warner","dc comics","netflix",
];

function detectBlockedContent(text) {
  const lower = (text || "").toLowerCase();
  for (const name of BLOCKED_NAMES) {
    if (new RegExp(`\\b${name.replace(/[-]/g,"\\-")}\\b`, "i").test(lower)) return name;
  }
  return null;
}

// ── PiAPI submit ──────────────────────────────────────────────
async function submitToPiapi({ prompt, imageUrl, duration, aspectRatio }) {
  const body = {
    model:     PIAPI_MODEL,
    task_type: "seedance-2-preview",
    input: {
      prompt,
      image_url:    imageUrl,
      mode:         "omni_reference",
      duration,
      aspect_ratio: aspectRatio,
      resolution:   "720p",
    },
  };

  const r = await fetch(PIAPI_URL, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key":    process.env.PIAPI_KEY,
    },
    body: JSON.stringify(body),
  });

  const data = await r.json();
  if (!r.ok || data.code !== 200) {
    throw new Error(data?.message || data?.error || `PiAPI error ${r.status}`);
  }

  const taskId = data?.data?.task_id;
  if (!taskId) throw new Error("PiAPI no devolvió task_id");
  return { taskId };
}

// ── fal.ai submit ─────────────────────────────────────────────
async function submitToFal(endpoint, input) {
  const r = await fetch(`https://fal.run/${endpoint}`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Key ${process.env.FAL_KEY}`,
    },
    body: JSON.stringify(input),
  });

  const data = await r.json();
  if (!r.ok) {
    throw new Error(data?.detail || data?.error || data?.message || `fal.ai error ${r.status}`);
  }

  const requestId = data?.request_id || data?.requestId;
  const videoUrl  = data?.video?.url || data?.data?.video?.url || null;
  return { requestId, videoUrl };
}

// ── BytePlus submit ───────────────────────────────────────────
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
  if (!data.id) throw new Error("BytePlus no devolvió task id");
  return { taskId: data.id };
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

  if (!prompt || String(prompt).trim().length < 5)
    return res.status(400).json({ ok: false, error: "El prompt es muy corto" });

  const blocked = detectBlockedContent(prompt);
  if (blocked)
    return res.status(400).json({ ok: false, error: `"${blocked}" está bloqueado.`, blocked: true });

  const jadeCost = JADE_COSTS[duration] || 75;
  const ref = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

  // ── Cobrar Jades ──────────────────────────────────────────
  const { error: spendErr } = await supabaseAdmin.rpc("spend_jades", {
    p_user_id: userId, p_amount: jadeCost, p_reason: "cineai_generate", p_ref: ref,
  });
  if (spendErr) {
    if ((spendErr.message || "").includes("INSUFFICIENT_JADES"))
      return res.status(402).json({ ok: false, error: "INSUFFICIENT_JADES", detail: `Necesitas ${jadeCost} Jades.` });
    return res.status(400).json({ ok: false, error: spendErr.message });
  }

  // ─────────────────────────────────────────────────────────
  // ROUTING
  // ─────────────────────────────────────────────────────────
  const hasImage    = !!imageUrl;
  const hasAudio    = !!audioUrl;
  const hasRefVideo = !!refVideoUrl;

  // Determinar proveedor
  let provider;
  if (!hasImage || isContinuation) {
    provider = "byteplus_seedance";
  } else if (hasAudio || hasRefVideo) {
    provider = "fal_seedance";       // foto + algo más → fal.ai
  } else {
    provider = "piapi_seedance";     // foto sola → PiAPI
  }

  let finalPrompt  = String(prompt).trim();
  let mode         = "t2v";
  let taskId       = null;
  let falRequestId = null;
  let falVideoUrl  = null;

  try {
    if (provider === "piapi_seedance") {
      // ── PiAPI — foto sola ─────────────────────────────────
      mode = "i2v";
      const result = await submitToPiapi({ prompt: finalPrompt, imageUrl, duration, aspectRatio });
      taskId = result.taskId;

    } else if (provider === "fal_seedance") {
      // ── fal.ai — foto + audio y/o video ──────────────────
      if (hasAudio && !hasRefVideo) {
        mode = "lipsync";
        const result = await submitToFal(FAL_ENDPOINTS.reference, {
          prompt:        `@Image1 Lip sync the person to the audio in @Audio1. Mouth movements must match exactly. Keep original background and lighting. ${finalPrompt}`,
          image_urls:    [imageUrl],
          audio_urls:    [audioUrl],
          aspect_ratio:  aspectRatio,
          duration:      String(duration),
          resolution:    "720p",
          generate_audio: true,
        });
        falRequestId = result.requestId;
        falVideoUrl  = result.videoUrl;

      } else if (hasRefVideo && !hasAudio) {
        mode = "r2v+face";
        const result = await submitToFal(FAL_ENDPOINTS.reference, {
          prompt:       `@Image1 Use this person as the subject. @Video1 Copy ONLY the body movement and choreography. Background from prompt, NOT from reference video. ${finalPrompt}`,
          image_urls:   [imageUrl],
          video_urls:   [refVideoUrl],
          aspect_ratio: aspectRatio,
          duration:     String(duration),
          resolution:   "720p",
          generate_audio: true,
        });
        falRequestId = result.requestId;
        falVideoUrl  = result.videoUrl;

      } else {
        // foto + audio + video
        mode = "r2v+face+audio";
        const result = await submitToFal(FAL_ENDPOINTS.reference, {
          prompt:       `@Image1 Use this person. @Video1 Copy the movement. @Audio1 Lip sync to this audio. ${finalPrompt}`,
          image_urls:   [imageUrl],
          video_urls:   [refVideoUrl],
          audio_urls:   [audioUrl],
          aspect_ratio: aspectRatio,
          duration:     String(duration),
          resolution:   "720p",
          generate_audio: true,
        });
        falRequestId = result.requestId;
        falVideoUrl  = result.videoUrl;
      }

    } else {
      // ── BytePlus — sin foto ───────────────────────────────
      const content = [];

      if (isContinuation && imageUrl) {
        content.push({ type: "image_url", image_url: { url: imageUrl } });
        finalPrompt = `[Image 1] This is the last frame of the previous clip. Continue the scene seamlessly. Maintain same atmosphere, lighting, color grade, camera movement. ${finalPrompt}`;
        mode = "continuation";
      } else if (hasRefVideo) {
        content.push({ type: "video_url", video_url: { url: refVideoUrl } });
        finalPrompt = `[Video 1] Copy ONLY the body movement from this reference. Background from prompt. ${finalPrompt}`;
        mode = "r2v";
      } else if (hasAudio) {
        content.push({ type: "audio_url", audio_url: { url: audioUrl } });
        finalPrompt = `[Audio 1] Person lip syncing to this audio, perfectly synced, expressive. ${finalPrompt}`;
        mode = "lipsync_nophoto";
      } else {
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
    await supabaseAdmin.rpc("spend_jades", {
      p_user_id: userId, p_amount: -jadeCost, p_reason: "cineai_refund_error", p_ref: ref,
    }).catch(() => {});
    console.error(`[cineai/generate] ${provider} error:`, err.message);
    return res.status(500).json({ ok: false, error: "Error generando video. Jades reembolsados." });
  }

  const providerTaskId = taskId || falRequestId;
  if (!providerTaskId && !falVideoUrl) {
    await supabaseAdmin.rpc("spend_jades", {
      p_user_id: userId, p_amount: -jadeCost, p_reason: "cineai_refund_no_taskid", p_ref: ref,
    }).catch(() => {});
    console.error(`[cineai/generate] no task id. provider=${provider}`);
    return res.status(500).json({ ok: false, error: "El proveedor no devolvió task id" });
  }

  // ── Guardar en video_jobs ─────────────────────────────────
  const jobId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

  await supabaseAdmin.from("video_jobs").insert({
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
      fal_endpoint:    provider === "fal_seedance"
        ? (hasAudio || hasRefVideo ? FAL_ENDPOINTS.reference : FAL_ENDPOINTS.image)
        : null,
      ref,
    },
  }).then(({ error }) => {
    if (error) console.error("[cineai/generate] insert failed:", error.message);
  });

  console.error("[cineai/generate] OK", { userId, jobId, taskId: providerTaskId, mode, provider, jadeCost });

  return res.status(200).json({
    ok: true, jobId, taskId: providerTaskId, mode, provider, jadeCost,
    videoUrl: falVideoUrl || null,
  });
}

export const config = { runtime: "nodejs" };
