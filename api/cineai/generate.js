// api/cineai/generate.js
// ─────────────────────────────────────────────────────────────
// ROUTING:
//   Con foto → EvoLink Seedance 2.0 fast-image-to-video
//   Sin foto → BytePlus Seedance 2.0
// ─────────────────────────────────────────────────────────────
import { supabaseAdmin }          from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

const EVOLINK_BASE    = "https://api.evolink.ai/v1/videos/generations";
const EVOLINK_MODEL   = "seedance-2.0-fast-image-to-video";
const BYTEPLUS_BASE   = "https://ark.ap-southeast.bytepluses.com/api/v3";
const BYTEPLUS_CREATE = `${BYTEPLUS_BASE}/contents/generations/tasks`;
const BYTEPLUS_MODEL  = "dreamina-seedance-2-0-260128";

const JADE_COSTS = { 5: 40, 10: 75, 15: 110 };

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

async function submitToEvoLink({ imageUrls, prompt, duration, aspectRatio }) {
  const body = {
    model:          EVOLINK_MODEL,
    prompt,
    image_urls:     imageUrls.slice(0, 2),
    duration:       Math.min(Number(duration) || 10, 10),
    aspect_ratio:   aspectRatio,
    quality:        "720p",
    generate_audio: true,
  };
  const r = await fetch(EVOLINK_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.EVOLINK_API_KEY}` },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error?.message || data.message || `EvoLink error ${r.status}`);
  if (!data.id) throw new Error("EvoLink no devolvió task id");
  return { taskId: data.id, provider: "evolink_seedance" };
}

async function submitToByteplus(contentArr) {
  const r = await fetch(BYTEPLUS_CREATE, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.BYTEPLUS_API_KEY}` },
    body: JSON.stringify({ model: BYTEPLUS_MODEL, content: contentArr }),
  });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error?.message || data.message || `BytePlus error ${r.status}`);
  if (!data.id) throw new Error("BytePlus no devolvió task id");
  return { taskId: data.id, provider: "byteplus_seedance" };
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
    prompt, imageUrl, refImages, refVideoUrl, audioUrl,
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

  const hasPerson   = !!imageUrl;
  const hasRefVideo = !!refVideoUrl;

  const allImages = [];
  if (imageUrl) allImages.push(imageUrl);
  if (Array.isArray(refImages)) {
    for (const u of refImages) if (u && !allImages.includes(u)) allImages.push(u);
  }
  const imageList = allImages.slice(0, 6);

  let finalPrompt = String(prompt).trim();
  let mode        = "t2v";
  let taskId      = null;
  let provider    = null;

  try {
    if (hasPerson) {
      // ── CON FOTO → EVOLINK ─────────────────────────────────
      if (isContinuation && hasRefVideo) {
        mode = "continuation";
        finalPrompt = `Continue this exact scene seamlessly from the first frame image. Maintain the same atmosphere, lighting, camera movement, color grading and visual style. Must feel like an uninterrupted extension of the same shot. ${finalPrompt}`;
      } else if (isContinuation) {
        mode = "continuation_frame";
        finalPrompt = `Continue this exact scene seamlessly from the first frame image. Maintain the same atmosphere, lighting and visual style. ${finalPrompt}`;
      } else if (animateExact) {
        mode = "animate";
        finalPrompt = `Animate this exact photo naturally with subtle realistic motion. STRICTLY preserve the original background, environment, and all characters. Only add natural movement to existing subjects. ${finalPrompt}`;
      } else if (hasRefVideo) {
        mode = "r2v+face";
        finalPrompt = `The person in @image1 is the subject. Copy ONLY the body movement from the reference. Background from the prompt, NOT from the reference video. ${finalPrompt}`;
      } else {
        mode = "i2v";
        finalPrompt = `@image1 ${finalPrompt}`;
      }

      const result = await submitToEvoLink({ imageUrls: imageList, prompt: finalPrompt, duration, aspectRatio });
      taskId   = result.taskId;
      provider = result.provider;

    } else {
      // ── SIN FOTO → BYTEPLUS ────────────────────────────────
      const contentArr = [];
      if (hasRefVideo) {
        mode = "r2v";
        contentArr.push({ type: "video_url", video_url: { url: refVideoUrl } });
        finalPrompt = `[Video 1] Copy ONLY the body movement from this reference. Background from prompt. ${finalPrompt}`;
      } else {
        mode = "t2v";
      }
      contentArr.push({
        type: "text",
        text: `${finalPrompt} --ratio ${aspectRatio} --duration ${duration} --resolution 720p`,
      });

      const result = await submitToByteplus(contentArr);
      taskId   = result.taskId;
      provider = result.provider;
    }

  } catch (err) {
    try {
      await supabaseAdmin.rpc("spend_jades", {
        p_user_id: userId, p_amount: -jadeCost, p_reason: "cineai_refund_error", p_ref: ref,
      });
    } catch {}
    console.error(`[generate] ${provider || "?"} error:`, err.message);
    return res.status(500).json({ ok: false, error: "Error generando video. Jades reembolsados." });
  }

  const jobId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

  await supabaseAdmin.from("video_jobs").insert({
    id: jobId, user_id: userId, status: "IN_PROGRESS", mode: "cineai",
    prompt: finalPrompt, provider, provider_request_id: taskId,
    provider_status: "pending", started_at: new Date().toISOString(),
    payload: {
      task_id: taskId, cineai_mode: mode, scene_mode: sceneMode,
      duration, aspect_ratio: aspectRatio, image_url: imageUrl || null,
      ref_images: imageList, ref_video_url: refVideoUrl || null,
      audio_url: audioUrl || null, animate_exact: animateExact || false,
      is_continuation: isContinuation || false, jade_cost: jadeCost, provider, ref,
    },
  }).then(({ error }) => { if (error) console.error("[generate] insert failed:", error.message); });

  console.log("[generate] OK", { userId, jobId, taskId, mode, provider, jadeCost });
  return res.status(200).json({ ok: true, jobId, taskId, mode, provider, jadeCost });
}

export const config = { runtime: "nodejs" };
