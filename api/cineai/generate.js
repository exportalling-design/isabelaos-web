// api/cineai/generate.js
// ─────────────────────────────────────────────────────────────
// ROUTING DEFINITIVO:
//   Con foto (imageUrl presente) → EvoLink seedance-2.0-fast-reference-to-video
//   Sin foto (solo texto/video)  → BytePlus dreamina-seedance-2-0-260128
//
// EvoLink: POST https://api.evolink.ai/v1/videos/generations
//   Parámetros: model, prompt, image_urls[], video_urls[], audio_urls[],
//               duration (4-15), quality (480p/720p), aspect_ratio
//
// BytePlus: POST https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks
//   Parámetros: model, content[] con type texto/video_url
// ─────────────────────────────────────────────────────────────
import { supabaseAdmin }          from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

// EvoLink — con foto
const EVOLINK_URL   = "https://api.evolink.ai/v1/videos/generations";
const EVOLINK_MODEL = "seedance-2.0-fast-reference-to-video";

// BytePlus — sin foto (IA pura)
const BYTEPLUS_URL   = "https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks";
const BYTEPLUS_MODEL = "dreamina-seedance-2-0-260128";

// Aspect ratios válidos EvoLink
const VALID_RATIOS = ["16:9","9:16","1:1","4:3","3:4","21:9","adaptive"];

const JADE_COSTS = {
  "480p": { 5: 22, 10: 42, 15: 63  },
  "720p": { 5: 40, 10: 75, 15: 110 },
};

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
    imageUrl,        // foto principal del usuario
    refImages,       // fotos adicionales de referencia
    refVideoUrl,     // video de referencia
    audioUrl,        // audio para lip sync
    animateExact,
    isContinuation,
    duration    = 5,
    aspectRatio = "9:16",
    quality     = "480p",
    sceneMode   = "tiktok",
  } = body;

  if (!prompt || String(prompt).trim().length < 5)
    return res.status(400).json({ ok: false, error: "El prompt es muy corto" });

  const blocked = detectBlockedContent(prompt);
  if (blocked)
    return res.status(400).json({ ok: false, error: `"${blocked}" está bloqueado.`, blocked: true });

  const dur   = Math.min(Math.max(Number(duration) || 5, 4), 15);
  const ratio = VALID_RATIOS.includes(aspectRatio) ? aspectRatio : "9:16";
  const q = quality === "720p" ? "720p" : "480p";
  const jadeCost = (JADE_COSTS[q] || JADE_COSTS["480p"])[dur] || (JADE_COSTS[q] || JADE_COSTS["480p"])[5];
  const ref = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

  // ── Descontar Jades ANTES ─────────────────────────────────
  const { error: spendErr } = await supabaseAdmin.rpc("spend_jades", {
    p_user_id: userId, p_amount: jadeCost,
    p_reason: "cineai_generate", p_ref: ref,
  });
  if (spendErr) {
    if ((spendErr.message || "").includes("INSUFFICIENT_JADES"))
      return res.status(402).json({ ok: false, error: "INSUFFICIENT_JADES", detail: `Necesitas ${jadeCost} Jades.` });
    return res.status(400).json({ ok: false, error: spendErr.message });
  }

  // ── Construir listas de referencia ───────────────────────
  // image_urls: image 1 = sujeto principal, image 2-9 = adicionales
  const imageList = [];
  if (imageUrl) imageList.push(imageUrl);
  if (Array.isArray(refImages)) {
    for (const u of refImages) {
      if (u && !imageList.includes(u) && imageList.length < 9) imageList.push(u);
    }
  }
  const videoList = refVideoUrl ? [refVideoUrl] : [];
  const audioList = audioUrl    ? [audioUrl]    : [];

  const hasFoto = imageList.length > 0;
  let finalPrompt = String(prompt).trim();
  let mode        = "t2v";
  let taskId      = null;
  let provider    = null;

  try {
    if (hasFoto) {
      // ════════════════════════════════════════════════
      // CON FOTO → EVOLINK
      // ════════════════════════════════════════════════
      if (isContinuation && videoList.length > 0) {
        mode = "continuation";
        finalPrompt = `Use image 1 as the exact first frame. Use video 1 as full reference to maintain atmosphere, lighting, camera movement and style. Continue the scene as an uninterrupted extension. ${finalPrompt}`;
      } else if (isContinuation) {
        mode = "continuation_frame";
        finalPrompt = `Continue this scene seamlessly from image 1 as the first frame. Same atmosphere, lighting and visual style. ${finalPrompt}`;
      } else if (animateExact) {
        mode = "animate";
        finalPrompt = `Animate image 1 with subtle realistic motion. STRICTLY preserve the original background, environment and all characters. Only add natural movement to existing subjects. ${finalPrompt}`;
      } else if (audioList.length > 0) {
        mode = "lipsync";
        const imgRefs = imageList.map((_, i) => `image ${i + 1}`).join(", ");
        finalPrompt = `Lip sync ${imgRefs} to audio 1. Mouth movements perfectly synchronized. Realistic facial expressions. ${finalPrompt}`;
      } else if (videoList.length > 0) {
        mode = "r2v+face";
        const imgRefs = imageList.map((_, i) => `image ${i + 1}`).join(", ");
        finalPrompt = `Use ${imgRefs} as the subject. Copy ONLY body movement and choreography from video 1. Background from prompt, NOT from reference video. ${finalPrompt}`;
      } else {
        mode = "i2v";
        finalPrompt = imageList.length === 1
          ? `image 1 ${finalPrompt}`
          : `Use ${imageList.map((_, i) => `image ${i + 1}`).join(", ")} as references. ${finalPrompt}`;
      }

      // Payload EvoLink
      const evoBody = {
        model:          EVOLINK_MODEL,
        prompt:         finalPrompt,
        duration:       dur,
        quality:        (quality === "720p" ? "720p" : "480p"),
        aspect_ratio:   ratio,
        generate_audio: true,
        image_urls:     imageList,                        // siempre presente (hay foto)
        ...(videoList.length > 0 && { video_urls: videoList }),
        ...(audioList.length > 0 && { audio_urls: audioList }),
      };

      console.log("[generate] → EvoLink", { mode, images: imageList.length, videos: videoList.length, audios: audioList.length, dur, ratio });

      const r = await fetch(EVOLINK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.EVOLINK_API_KEY}` },
        body: JSON.stringify(evoBody),
      });
      const d = await r.json();
      console.log("[generate] EvoLink resp:", JSON.stringify({ id: d.id, status: d.status, error: d.error || null }));
      if (!r.ok || d.error) throw new Error(d.error?.message || d.message || `EvoLink error ${r.status}`);
      if (!d.id) throw new Error("EvoLink no devolvió task id");
      taskId   = d.id;
      provider = "evolink_seedance";

    } else {
      // ════════════════════════════════════════════════
      // SIN FOTO → BYTEPLUS (IA pura)
      // ════════════════════════════════════════════════
      const contentArr = [];

      if (videoList.length > 0) {
        mode = "r2v";
        contentArr.push({ type: "video_url", video_url: { url: videoList[0] } });
        finalPrompt = `[Video 1] Copy ONLY the body movement from this reference. Background from prompt. ${finalPrompt}`;
      } else {
        mode = "t2v";
      }

      contentArr.push({
        type: "text",
        text: `${finalPrompt} --ratio ${ratio} --duration ${dur} --resolution 720p`,
      });

      console.log("[generate] → BytePlus", { mode, dur, ratio });

      const r = await fetch(BYTEPLUS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.BYTEPLUS_API_KEY}` },
        body: JSON.stringify({ model: BYTEPLUS_MODEL, content: contentArr }),
      });
      const d = await r.json();
      console.log("[generate] BytePlus resp:", JSON.stringify({ id: d.id, status: d.status, error: d.error || null }));
      if (!r.ok || d.error) throw new Error(d.error?.message || d.message || `BytePlus error ${r.status}`);
      if (!d.id) throw new Error("BytePlus no devolvió task id");
      taskId   = d.id;
      provider = "byteplus_seedance";
    }

  } catch (err) {
    // Reembolsar Jades
    try { await supabaseAdmin.rpc("spend_jades", { p_user_id: userId, p_amount: -jadeCost, p_reason: "cineai_refund_error", p_ref: ref }); } catch {}
    console.error("[generate] error:", err.message);
    return res.status(500).json({ ok: false, error: "Error generando video. Jades reembolsados." });
  }

  // ── Guardar job ───────────────────────────────────────────
  const jobId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  await supabaseAdmin.from("video_jobs").insert({
    id: jobId, user_id: userId, status: "IN_PROGRESS", mode: "cineai",
    prompt: finalPrompt, provider, provider_request_id: taskId,
    provider_status: "pending", started_at: new Date().toISOString(),
    payload: {
      task_id: taskId, cineai_mode: mode, scene_mode: sceneMode,
      duration: dur, aspect_ratio: ratio, quality: (quality === "720p" ? "720p" : "480p"),
      image_url: imageUrl || null, image_list: imageList,
      ref_video_url: refVideoUrl || null, audio_url: audioUrl || null,
      animate_exact: animateExact || false, is_continuation: isContinuation || false,
      jade_cost: jadeCost, provider, ref,
    },
  }).then(({ error }) => { if (error) console.error("[generate] insert failed:", error.message); });

  console.log("[generate] OK", { userId, jobId, taskId, mode, provider, dur, ratio, jadeCost });
  return res.status(200).json({ ok: true, jobId, taskId, mode, provider, jadeCost });
}

export const config = { runtime: "nodejs" };
