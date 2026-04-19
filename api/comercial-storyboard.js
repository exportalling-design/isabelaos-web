// api/comercial-storyboard.js
// ─────────────────────────────────────────────────────────────
// Gemini genera un storyboard de nivel agencia publicitaria
// ─────────────────────────────────────────────────────────────
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MODEL    = "gemini-2.5-flash";

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

  const description   = String(body?.description || "").trim();
  const duration      = body?.duration === 60 ? 60 : 30;
  const referenceImgs = Array.isArray(body?.referenceImages) ? body.referenceImages : [];
  const accent        = String(body?.accent  || "neutro").trim();
  const gender        = String(body?.gender  || "mujer").trim();

  if (!description) return res.status(400).json({ ok: false, error: "MISSING_DESCRIPTION" });

  const sceneCount = duration === 60 ? 7 : 4;
  const isEnglish  = accent === "ingles";
  const narLang    = isEnglish ? "English" : "Spanish";
  const narGender  = gender === "hombre"
    ? (isEnglish ? "male narrator" : "narrador masculino")
    : (isEnglish ? "female narrator" : "narradora femenina");
  const narAccent  = isEnglish ? "American English accent" : `acento ${accent}`;

  const parts = [];
  for (const img of referenceImgs.slice(0, 3)) {
    if (img?.base64 && img?.mimeType) {
      parts.push({ inline_data: { mime_type: img.mimeType, data: img.base64 } });
    }
  }

  const systemPrompt = [
    "You are the creative director of a top-tier Latin American advertising agency.",
    "You have won Cannes Lions awards for commercial campaigns across every product category.",
    "Generate a PROFESSIONAL, SALES-DRIVEN, VISUALLY SPECTACULAR storyboard.",
    "",
    "╔══════════════════════════════════════╗",
    "  CLIENT BRIEF",
    "╚══════════════════════════════════════╝",
    `DESCRIPTION: ${description}`,
    `DURATION: ${duration} seconds (${sceneCount} scenes × 8 seconds each)`,
    `VOICEOVER: ${narGender}, ${narAccent}`,
    `NARRATION LANGUAGE: ${narLang}`,
    referenceImgs.length > 0
      ? `VISUAL REFERENCES: ${referenceImgs.length} image(s) provided — analyze carefully and incorporate into every scene`
      : "NO VISUAL REFERENCES — create from description only",
    "",
    "╔══════════════════════════════════════╗",
    "  MANDATORY NARRATIVE STRUCTURE",
    "╚══════════════════════════════════════╝",
    sceneCount === 4 ? [
      "Scene 1 — HOOK: Stop-the-scroll. Visually shocking, cinematic, emotionally magnetic.",
      "Scene 2 — DESIRE/PROBLEM: Viewer deeply identifies with the situation or aspiration.",
      "Scene 3 — SOLUTION: Product/service enters as THE answer. Dramatic reveal.",
      "Scene 4 — RESULT + CTA: Transformation complete. Aspirational result. Clear action call.",
    ].join("\n") : [
      "Scene 1 — HOOK: Stop-the-scroll visual. Shocking beauty or emotional impact.",
      "Scene 2 — CONTEXT: Situation the target audience immediately recognizes.",
      "Scene 3 — PROBLEM AGITATION: The need/pain at its most intense.",
      "Scene 4 — SOLUTION: Product/service enters dramatically as the answer.",
      "Scene 5 — KEY BENEFITS: 2-3 benefits shown visually with cinematic power.",
      "Scene 6 — SOCIAL PROOF: Real-looking result, transformation, happy outcome.",
      "Scene 7 — CTA: Clear, urgent, emotional call to action.",
    ].join("\n"),
    "",
    "╔══════════════════════════════════════╗",
    "  PRODUCTION INSTRUCTIONS",
    "╚══════════════════════════════════════╝",
    "",
    "IMAGE PROMPTS (Gemini Image AI — write in ENGLISH, 80-120 words):",
    "- Specify: lighting type, camera angle, composition, atmosphere, color palette, mood",
    "- Make each scene VISUALLY SPECTACULAR — think luxury brand campaign, not stock photo",
    "- If references show a person: maintain their exact likeness in every scene",
    "- If references show a product: feature it heroically with dramatic lighting",
    "- 9:16 vertical format, national TV commercial quality",
    "- NEVER include any text, subtitles, or watermarks in image descriptions",
    "",
    "VIDEO PROMPTS (Veo3/BytePlus — write in ENGLISH, 30-50 words):",
    "- ONLY camera movement and subject action — nothing else",
    "- Use cinematic techniques: 'slow push-in', 'orbital drone shot', 'macro detail reveal',",
    "  'tracking shot', 'dramatic crane descent', 'whip pan', 'extreme close-up pull back'",
    "- These are SILENT clips — NO audio, NO music, NO dialogue mentioned",
    "- NO text, NO subtitles in video prompts",
    "",
    `VOICEOVER (ElevenLabs — write in ${narLang}, max ${isEnglish ? 20 : 18} words per scene):`,
    `- Persuasive, emotional, poetic — NOT corporate robot`,
    `- Must flow as one continuous cinematic narration across all scenes`,
    `- Voice: ${narGender}, ${narAccent}`,
    "",
    `Generate exactly ${sceneCount} scenes. Respond ONLY with valid JSON, no markdown:`,
    `{`,
    `  "title": "creative commercial title (max 6 words)",`,
    `  "style": "visual style: color palette, lighting mood, cinematic reference",`,
    `  "target_audience": "specific target (age, psychographic, aspiration)",`,
    `  "narrative_hook": "the core creative idea that makes this commercial unforgettable",`,
    `  "scenes": [`,
    `    {`,
    `      "scene_number": 1,`,
    `      "duration_seconds": 8,`,
    `      "narrative_role": "hook|desire|problem|solution|benefit|proof|cta",`,
    `      "camera": "shot type in Spanish",`,
    `      "image_prompt": "spectacular photorealistic image prompt in English, 80-120 words",`,
    `      "video_prompt": "BytePlus camera movement in English, 30-50 words, NO audio/text",`,
    `      "narration": "voiceover in ${narLang}, max ${isEnglish ? 20 : 18} words, emotional",`,
    `      "description": "what happens in this scene, 1-2 sentences"`,
    `    }`,
    `  ],`,
    `  "call_to_action": "final CTA text",`,
    `  "music_mood": "suggested music mood for editing"`,
    `}`,
  ].join("\n");

  parts.push({ text: systemPrompt });

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("MISSING_GEMINI_API_KEY");

    const r = await fetch(
      `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: { temperature: 0.75, topP: 0.9, maxOutputTokens: 6000 },
        }),
      }
    );

    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`Gemini error ${r.status}: ${txt.slice(0, 300)}`);
    }

    const data    = await r.json();
    const rawText = data?.candidates?.[0]?.content?.parts
      ?.map(p => p?.text || "").join("").trim() || "";

    let storyboard = null;
    try {
      storyboard = JSON.parse(rawText.replace(/```json|```/g, "").trim());
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) { try { storyboard = JSON.parse(match[0]); } catch {} }
    }

    if (!storyboard?.scenes?.length) {
      console.error("[comercial-storyboard] rawText:", rawText.slice(0, 500));
      throw new Error("Gemini no generó un storyboard válido.");
    }

    console.error(`[comercial-storyboard] OK — ${storyboard.scenes.length} escenas — "${storyboard.title}"`);

    return res.status(200).json({
      ok:         true,
      storyboard,
      duration,
      sceneCount: storyboard.scenes.length,
    });

  } catch (e) {
    console.error("[comercial-storyboard] ERROR:", e.message);
    return res.status(500).json({ ok: false, error: e.message || "Error generando storyboard." });
  }
}
