// POST /api/tiktok-live/generate-avatar
// 1. Creates session in DB (status=pending, generation_status=generating)
// 2. Calls Gemini to generate persona_prompt + 4 Seedance video prompts
// 3. Submits 4 EvoLink jobs (idle/talking/dancing/lipsync) in parallel
// 4. Returns { session_id, task_ids }
import { supabaseAdmin }          from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

const EVOLINK_URL   = "https://api.evolink.ai/v1/videos/generations";
const EVOLINK_MODEL = "seedance-2.0-fast-reference-to-video";
const GEMINI_BASE   = "https://generativelanguage.googleapis.com/v1beta";

const LANG_LABEL = {
  mx: "Mexican Spanish",
  co: "Colombian Spanish",
  ar: "Argentine Spanish",
  gt: "Guatemalan Spanish",
  us: "American English",
  br: "Brazilian Portuguese",
};

async function callGeminiText(prompt) {
  const r = await fetch(
    `${GEMINI_BASE}/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
      }),
    }
  );
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${await r.text().catch(() => "")}`);
  const data = await r.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
}

async function buildPersonaPrompt(userDescription, language, behaviors, productLink) {
  const langLabel = LANG_LABEL[language] || "Neutral Spanish";
  const raw = await callGeminiText(`You are writing a persona system prompt for an AI TikTok Live avatar that will respond to live chat using text generation.

Avatar creator's goal: ${userDescription}
Language/accent: ${langLabel}
Behaviors to exhibit: ${(behaviors || []).join(", ")}
Product/brand/link to promote: ${productLink || "not specified"}

Write a concise persona definition (max 120 words) that:
1. Establishes this avatar as a native ${langLabel} speaker with authentic regional slang and expressions
2. Creates a warm, energetic, TikTok-native personality matching the creator's goal
3. Includes specific goals derived from the selected behaviors (get follows, react to gifts, promote product)
4. Rule: always reply in max 2 short sentences, always end with a call to action
5. If a product/link is specified, weave it naturally into call-to-actions

Output ONLY the persona text. No quotes, no labels, no JSON.`);
  return raw;
}

async function buildVideoPrompts(userDescription, language) {
  const langLabel = LANG_LABEL[language] || "Neutral Spanish";
  const raw = await callGeminiText(`You are an expert at writing Seedance 2.0 reference-to-video prompts for TikTok Live avatars.

The video generation uses 2 reference images:
- image 1: face close-up → preserves exact facial identity throughout
- image 2: full body photo → defines the exact outfit, body type, and background environment

Creator's vision: ${userDescription}
Language/cultural context: ${langLabel}

Generate exactly 4 short video prompts (2 sentences each). Every prompt MUST keep the person from both reference images exactly.

Return ONLY a valid JSON object (no markdown, no code fences):
{"idle":"...","talking":"...","dancing":"...","lipsync":"..."}

Prompt guidelines:
- idle: "image 1 face identity, image 2 outfit and background. Person stands naturally, breathing softly, subtle micro-movements, warm gaze at camera, calm and inviting energy, 5 seconds, 9:16."
- talking: "image 1 face identity, image 2 outfit and background. Person speaks animatedly to camera, natural hand gestures, expressive face, slight head tilt, engaging live-stream host energy, 5 seconds, 9:16."
- dancing: "image 1 face identity, image 2 outfit and background. Person dances to upbeat Latin music, smooth rhythmic hip and shoulder movements, full body visible, joyful expression, energetic TikTok dance vibe, 5 seconds, 9:16."
- lipsync: "image 1 face identity, image 2 outfit and background. Person sings along expressively, perfectly synchronized lip movement, music-lover gestures, eyes bright with emotion, immersive performance energy, 5 seconds, 9:16."

All 4 must have: NO text overlays, NO watermarks, NO subtitles, cinematic quality, smooth motion.`);

  // Extract JSON from whatever Gemini returns
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Gemini no devolvió JSON de prompts de video válido");
  return JSON.parse(match[0]);
}

async function submitEvolink(faceUrl, bodyUrl, videoPrompt) {
  const r = await fetch(EVOLINK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.EVOLINK_API_KEY}`,
    },
    body: JSON.stringify({
      model:          EVOLINK_MODEL,
      prompt:         videoPrompt,
      image_urls:     [faceUrl, bodyUrl],
      duration:       5,
      aspect_ratio:   "9:16",
      quality:        "480p",
      generate_audio: false,
    }),
  });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error?.message || `EvoLink ${r.status}`);
  if (!data.id) throw new Error("EvoLink no devolvió task id");
  return data.id;
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
    face_image_url,
    body_image_url,
    user_description,
    behaviors    = [],
    language     = "mx",
    voice_id,
    tiktok_username,
    product_link = "",
  } = body;

  if (!face_image_url || !body_image_url)
    return res.status(400).json({ ok: false, error: "Sube ambas fotos (rostro y cuerpo completo)" });
  if (!user_description?.trim())
    return res.status(400).json({ ok: false, error: "Describe qué quieres que haga tu avatar" });
  if (!tiktok_username?.trim())
    return res.status(400).json({ ok: false, error: "Ingresa tu @username de TikTok" });
  if (!voice_id)
    return res.status(400).json({ ok: false, error: "Selecciona un idioma/voz" });

  // Stop any existing active session for this user
  await supabaseAdmin
    .from("tiktok_live_sessions")
    .update({ status: "stopped" })
    .eq("user_id", userId)
    .in("status", ["active", "pending"]);

  // Create session (pending until videos are generated)
  const { data: session, error: insertErr } = await supabaseAdmin
    .from("tiktok_live_sessions")
    .insert({
      user_id:           userId,
      tiktok_username:   tiktok_username.replace(/^@/, ""),
      voice_id,
      persona_prompt:    "", // filled after Gemini
      status:            "pending",
      avatar_type:       "video",
      face_image_url,
      body_image_url,
      language,
      behaviors,
      product_link:      product_link || null,
      generation_status: "generating",
    })
    .select()
    .single();

  if (insertErr) {
    console.error("[generate-avatar] insert error:", insertErr.message);
    return res.status(500).json({ ok: false, error: insertErr.message });
  }

  const sessionId = session.id;

  try {
    // Gemini: generate persona_prompt + 4 video prompts in parallel
    const [personaPrompt, videoPrompts] = await Promise.all([
      buildPersonaPrompt(user_description, language, behaviors, product_link),
      buildVideoPrompts(user_description, language),
    ]);

    console.log("[generate-avatar] prompts generated for session", sessionId);

    // Submit 4 EvoLink jobs in parallel
    const [idleTaskId, talkingTaskId, dancingTaskId, lipsyncTaskId] = await Promise.all([
      submitEvolink(face_image_url, body_image_url, videoPrompts.idle),
      submitEvolink(face_image_url, body_image_url, videoPrompts.talking),
      submitEvolink(face_image_url, body_image_url, videoPrompts.dancing),
      submitEvolink(face_image_url, body_image_url, videoPrompts.lipsync),
    ]);

    const task_ids = {
      idle:    idleTaskId,
      talking: talkingTaskId,
      dancing: dancingTaskId,
      lipsync: lipsyncTaskId,
    };

    console.log("[generate-avatar] EvoLink jobs submitted:", task_ids);

    await supabaseAdmin
      .from("tiktok_live_sessions")
      .update({ persona_prompt, generation_task_ids: task_ids })
      .eq("id", sessionId);

    return res.status(200).json({ ok: true, session_id: sessionId, task_ids });

  } catch (err) {
    console.error("[generate-avatar] error:", err.message);
    await supabaseAdmin
      .from("tiktok_live_sessions")
      .update({ generation_status: "failed" })
      .eq("id", sessionId);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

export const config = { runtime: "nodejs" };
