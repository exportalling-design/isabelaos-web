// api/comercial-storyboard.js
// ─────────────────────────────────────────────────────────────
// Gemini genera un storyboard de nivel agencia publicitaria:
//   - Estructura narrativa real (gancho → problema → solución → CTA)
//   - Prompts de imagen universales (ropa, comida, carros, servicios...)
//   - Prompts de video sin audio para Veo3
//   - Narración en off por escena para ElevenLabs
//   - Soporte de idioma: español (todos los acentos) e inglés
// ─────────────────────────────────────────────────────────────
import { requireUser } from "./_auth.js";
 
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MODEL    = "gemini-2.5-flash";
 
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
 
  try {
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(401).json({ ok: false, error: auth.error });
 
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
 
    const description   = String(body?.description || "").trim();
    const duration      = body?.duration === 60 ? 60 : 30;
    const referenceImgs = Array.isArray(body?.referenceImages) ? body.referenceImages : [];
    const accent        = String(body?.accent  || "neutro").trim();
    const gender        = String(body?.gender  || "mujer").trim();
 
    if (!description) return res.status(400).json({ ok: false, error: "MISSING_DESCRIPTION" });
 
    const sceneCount  = duration === 60 ? 7 : 4;
    const isEnglish   = accent === "ingles";
    const narLang     = isEnglish ? "English" : "Spanish";
    const narGender   = gender === "hombre" ? (isEnglish ? "male narrator" : "narrador masculino") : (isEnglish ? "female narrator" : "narradora femenina");
    const narAccent   = isEnglish ? "American English accent" : `acento ${accent}`;
 
    const parts = [];
 
    // Incluir todas las fotos de referencia
    for (const img of referenceImgs.slice(0, 3)) {
      if (img?.base64 && img?.mimeType) {
        parts.push({ inline_data: { mime_type: img.mimeType, data: img.base64 } });
      }
    }
 
    const systemPrompt = [
      "You are the creative director of a top-tier Latin American advertising agency.",
      "You have won Cannes Lions awards for commercial campaigns across every product category:",
      "fashion, food, automotive, real estate, services, beauty, technology, and more.",
      "Your job: generate a PROFESSIONAL, SALES-DRIVEN storyboard for a short commercial.",
      "",
      "╔══════════════════════════════════════╗",
      "  CLIENT BRIEF",
      "╚══════════════════════════════════════╝",
      `DESCRIPTION: ${description}`,
      `DURATION: ${duration} seconds (${sceneCount} scenes × 8 seconds each)`,
      `VOICEOVER: ${narGender}, ${narAccent}`,
      `NARRATION LANGUAGE: ${narLang}`,
      referenceImgs.length > 0
        ? `VISUAL REFERENCES: ${referenceImgs.length} image(s) provided — analyze them carefully to understand the product/service/person/location and incorporate them into every scene`
        : "NO VISUAL REFERENCES — create from description only",
      "",
      "╔══════════════════════════════════════╗",
      "  MANDATORY NARRATIVE STRUCTURE",
      "╚══════════════════════════════════════╝",
      "Commercials that SELL follow this psychological arc:",
      "",
      sceneCount === 4 ? [
        "Scene 1 — HOOK: Stop-the-scroll image. Visually shocking or emotionally magnetic.",
        "Scene 2 — PROBLEM or DESIRE: Viewer identifies with the situation/need.",
        "Scene 3 — SOLUTION: Product/service enters as the perfect answer.",
        "Scene 4 — RESULT + CTA: Happy customer / beautiful product + action call.",
      ].join("\n") : [
        "Scene 1 — HOOK: Stop-the-scroll visual. Shocking, beautiful, or emotionally magnetic.",
        "Scene 2 — CONTEXT: Situation the target audience recognizes and relates to.",
        "Scene 3 — PROBLEM AGITATION: The need/pain at its peak.",
        "Scene 4 — SOLUTION: Product/service enters as the answer.",
        "Scene 5 — KEY BENEFITS: 2-3 benefits shown visually, not just stated.",
        "Scene 6 — SOCIAL PROOF: Real-looking result, happy customer, transformation.",
        "Scene 7 — CTA: Clear, urgent call to action.",
      ].join("\n"),
      "",
      "╔══════════════════════════════════════╗",
      "  PRODUCTION INSTRUCTIONS",
      "╚══════════════════════════════════════╝",
      "",
      "IMAGE PROMPTS (for Gemini Image AI):",
      "- Write in ENGLISH, extremely detailed, 60-100 words",
      "- Specify: lighting type, camera angle, composition, atmosphere, color palette",
      "- Must work for ANY product category (fashion, food, car, service, location...)",
      "- If reference images show a product: the product must be featured prominently",
      "- If reference images show a person: maintain their likeness",
      "- Quality level: national TV commercial / luxury brand campaign",
      "- Format: 9:16 vertical portrait",
      "- NEVER include any text or subtitles in the image description",
      "",
      "VIDEO PROMPTS (for Veo3 AI video generator):",
      "- Write in ENGLISH, 25-40 words",
      "- Describe ONLY camera movement and action — nothing else",
      "- Examples: 'Slow zoom in on product', 'Tracking shot follows model walking',",
      "  'Crane shot descends to reveal restaurant', 'Close-up handheld of food being plated'",
      "- CRITICAL: DO NOT mention audio, music, dialogue, or speech",
      "- CRITICAL: DO NOT mention text, subtitles, or captions",
      "- These are SILENT clips — voiceover added separately",
      "",
      `VOICEOVER NARRATION (for ElevenLabs — write in ${narLang}):`,
      `- ${isEnglish ? "Maximum 20 words per scene" : "Máximo 18 palabras por escena"}`,
      `- ${isEnglish ? "Tone: persuasive, emotional, natural — NOT robotic" : "Tono: persuasivo, emocional, natural — NO robótico"}`,
      `- ${isEnglish ? "Must flow as one continuous narration across all scenes" : "Debe fluir como narración continua entre escenas"}`,
      `- ${isEnglish ? `Voice: ${narGender}, ${narAccent}` : `Voz: ${narGender}, ${narAccent}`}`,
      "",
      `Generate exactly ${sceneCount} scenes. Respond ONLY with valid JSON, no markdown, no explanation:`,
      "{",
      '  "title": "creative commercial title (max 6 words)",',
      '  "style": "visual style description: color palette, lighting, mood",',
      '  "target_audience": "specific target audience (age, context, need)",',
      '  "narrative_hook": "the core creative idea that makes this commercial memorable",',
      '  "scenes": [',
      "    {",
      '      "scene_number": 1,',
      '      "duration_seconds": 8,',
      `      "narrative_role": "hook|problem|solution|benefit|cta",`,
      '      "camera": "shot type in Spanish (primer plano, plano general, plano medio, etc.)",',
      '      "image_prompt": "detailed photorealistic image prompt in English for Gemini Image, 60-100 words",',
      '      "video_prompt": "Veo3 camera movement prompt in English, 25-40 words, NO audio/text/dialogue",',
      `      "narration": "voiceover text in ${narLang}, max ${isEnglish ? 20 : 18} words, persuasive",`,
      '      "description": "what happens in this scene, 1-2 sentences"',
      "    }",
      "  ],",
      '  "call_to_action": "final CTA text (e.g.: Visit us today / Call now / Order online)",',
      '  "music_mood": "suggested music mood for editing (e.g.: upbeat latino, emotional, energetic)"',
      "}",
    ].join("\n");
 
    parts.push({ text: systemPrompt });
 
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
 
    console.log(`[comercial-storyboard] OK — ${storyboard.scenes.length} escenas — "${storyboard.title}" accent=${accent} gender=${gender}`);
 
    return res.status(200).json({ ok: true, storyboard, duration, sceneCount: storyboard.scenes.length });
 
  } catch (e) {
    console.error("[comercial-storyboard] ERROR:", e?.message || e);
    return res.status(500).json({ ok: false, error: e?.message || "Error generando storyboard." });
  }
}
