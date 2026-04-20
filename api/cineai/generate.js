// api/cineai/generate.js
// ROUTING:
//   Con imagen → fal.ai (reference-to-video/fast)
//   Sin imagen → BytePlus (t2v)
// PiAPI deshabilitado temporalmente
import { supabaseAdmin }          from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

const FAL_ENDPOINT    = "bytedance/seedance-2.0/fast/reference-to-video";
const BYTEPLUS_BASE   = "https://ark.ap-southeast.bytepluses.com/api/v3";
const BYTEPLUS_CREATE = `${BYTEPLUS_BASE}/contents/generations/tasks`;
const BYTEPLUS_MODEL  = "dreamina-seedance-2-0-260128";
const JADE_COSTS      = { 5: 40, 10: 75, 15: 110 };

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

async function submitToFal(input) {
  const r = await fetch(`https://fal.run/${FAL_ENDPOINT}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Key ${process.env.FAL_KEY}` },
    body: JSON.stringify(input),
  });
  const data = await r.json();
  if (!r.ok) {
    console.error("[fal] error response:", JSON.stringify(data));
    throw new Error(`fal.ai ${r.status}: ${JSON.stringify(data)}`);
  }
  return {
    requestId: data?.request_id || data?.requestId || null,
    videoUrl:  data?.video?.url || data?.data?.video?.url || null,
  };
}

async function submitToByteplus(content) {
  const r = await fetch(BYTEPLUS_CREATE, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.BYTEPLUS_API_KEY}` },
    body: JSON.stringify({ model: BYTEPLUS_MODEL, content }),
  });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error?.message || data.message || `BytePlus error ${r.status}`);
  if (!data.id) throw new Error("BytePlus no devolvió task id");
  return { taskId: data.id };
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
    prompt, imageUrl, refVideoUrl, audioUrl,
    animateExact, isContinuation,
    duration = 10, aspectRatio = "9:16", sceneMode = "tiktok",
  } = body;

  if (!prompt || String(prompt).trim().length < 5)
    return res.status(400).json({ ok: false, error: "El prompt es muy corto" });

  const blocked = detectBlockedContent(prompt);
  if (blocked)
    return res.status(400).json({ ok: false, error: `"${blocked}" está bloqueado.`, blocked: true });

  const jadeCost = JADE_COSTS[duration] || 75;
  const ref = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

  const { error: spendErr } = await supabaseAdmin.rpc("spend_jades", {
    p_user_id: userId, p_amount: jadeCost, p_reason: "cineai_generate", p_ref: ref,
  });
  if (spendErr) {
    if ((spendErr.message || "").includes("INSUFFICIENT_JADES"))
      return res.status(402).json({ ok: false, error: "INSUFFICIENT_JADES", detail: `Necesitas ${jadeCost} Jades.` });
    return res.status(400).json({ ok: false, error: spendErr.message });
  }

  const hasImage    = !!imageUrl;
  const hasAudio    = !!audioUrl;
  const hasRefVideo = !!refVideoUrl;

  // ROUTING: imagen → fal.ai | sin imagen → BytePlus
  const provider = hasImage ? "fal_seedance" : "byteplus_seedance";

  let finalPrompt  = String(prompt).trim();
  let mode         = "t2v";
  let taskId       = null;
  let falRequestId = null;
  let falVideoUrl  = null;

  try {
    if (provider === "fal_seedance") {
      // ── FAL.AI — cualquier caso con imagen ────────────────
      const input = {
        aspect_ratio:   aspectRatio,
        duration:       String(duration),
        resolution:     "720p",
        generate_audio: true,
      };

      if (isContinuation) {
        // Continuación — último frame como first frame
        mode = "continuation";
        input.image_urls = [imageUrl];
        input.prompt = `@Image1 This is the last frame of the previous clip. Continue the scene seamlessly from this exact frame. Maintain the same atmosphere, lighting, color grade, camera movement style and visual mood. ${finalPrompt}`;

      } else if (hasAudio && hasRefVideo) {
        mode = "r2v+face+audio";
        input.image_urls = [imageUrl];
        input.video_urls = [refVideoUrl];
        input.audio_urls = [audioUrl];
        input.prompt = `@Image1 Use this person as the subject. @Video1 Copy the movement and choreography. @Audio1 Sync to this audio. ${finalPrompt}`;

      } else if (hasAudio) {
        mode = "lipsync";
        input.image_urls = [imageUrl];
        input.audio_urls = [audioUrl];
        input.prompt = `@Image1 Lip sync the person in this image to the audio in @Audio1. Mouth movements must match exactly. Keep original background and lighting. ${finalPrompt}`;

      } else if (hasRefVideo) {
        mode = "r2v+face";
        input.image_urls = [imageUrl];
        input.video_urls = [refVideoUrl];
        input.prompt = `@Image1 Use this person as the subject. @Video1 Copy ONLY the body movement and choreography from this reference. Background from the prompt, NOT from the reference video. ${finalPrompt}`;

      } else if (animateExact) {
        mode = "animate";
        input.image_urls = [imageUrl];
        input.prompt = `@Image1 Animate this exact photo naturally with subtle realistic motion. STRICTLY preserve the original background, environment, and all characters. Only add natural movement to existing subjects. ${finalPrompt}`;

      } else {
        // Foto sola → i2v con consistencia facial
        mode = "i2v";
        input.image_urls = [imageUrl];
        input.prompt = `@Image1 ${finalPrompt}`;
      }

      const result = await submitToFal(input);
      falRequestId = result.requestId;
      falVideoUrl  = result.videoUrl;

    } else {
      // ── BYTEPLUS — sin imagen (texto puro, video ref sin rostro) ──
      const content = [];

      if (hasRefVideo) {
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
    try { await supabaseAdmin.rpc("spend_jades", { p_user_id: userId, p_amount: -jadeCost, p_reason: "cineai_refund_error", p_ref: ref }); } catch {}
    console.error(`[cineai/generate] ${provider} error:`, err.message);
    return res.status(500).json({ ok: false, error: "Error generando video. Jades reembolsados." });
  }

  const providerTaskId = taskId || falRequestId;
  if (!providerTaskId && !falVideoUrl) {
    try { await supabaseAdmin.rpc("spend_jades", { p_user_id: userId, p_amount: -jadeCost, p_reason: "cineai_refund_no_taskid", p_ref: ref }); } catch {}
    console.error(`[cineai/generate] no task id. provider=${provider}`);
    return res.status(500).json({ ok: false, error: "El proveedor no devolvió task id" });
  }

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
      fal_endpoint:    provider === "fal_seedance" ? FAL_ENDPOINT : null,
      ref,
    },
  }).then(({ error }) => { if (error) console.error("[cineai/generate] insert failed:", error.message); });

  console.error("[cineai/generate] OK", { userId, jobId, taskId: providerTaskId, mode, provider, jadeCost });

  return res.status(200).json({
    ok: true, jobId, taskId: providerTaskId, mode, provider, jadeCost,
    videoUrl: falVideoUrl || null,
  });
}

export const config = { runtime: "nodejs" };
