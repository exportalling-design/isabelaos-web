// api/cineai/viral-captions.js
// Genera 3 captions virales (español + inglés) a partir del prompt de Seedance
// que se usó para generar el video, listos para publicar en redes.
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MODEL    = "gemini-3.1-flash-image-preview";

const SYSTEM_PROMPT = `You are IsabelaOS Studio's social media copywriter, specialized in writing viral captions for AI-generated cinematic videos made with Seedance 2.0.

You will receive the ENGLISH technical prompt that was used to generate a short cinematic video (it describes the subject, action, environment, camera and style — it is NOT something to repeat verbatim, just the source material to understand what the video shows).

YOUR TASK:
Read the scene described in the prompt and write EXACTLY 3 ready-to-post captions, each with a different angle:
1. "instagram_reels" — "Instagram Reels": engaging, warm, uses 1-3 emojis naturally, includes a soft call-to-action (comment, share, follow, save), tone fits Instagram's aesthetic-driven audience.
2. "tiktok_hook" — "TikTok Hook": starts with a punchy attention-grabbing HOOK line (the first sentence must work as a scroll-stopper — a question, a bold claim, or a "POV:" / "Wait for it" style opener), short and energetic, TikTok slang/pacing.
3. "motivational" — "Motivacional": inspirational tone connected to the scene's mood (resilience, dreams, courage, transformation, etc.), reflective and uplifting.

RULES FOR EACH CAPTION:
- Write BOTH a Spanish version ("caption_es") and an English version ("caption_en") — they must be natural, idiomatic translations of each other, not robotic word-for-word translations.
- Keep each caption between 1 and 4 short sentences/lines — scannable, not a wall of text.
- Include relevant hashtags as a separate array ("hashtags") — mix broad reach tags (#ai, #aivideo, #viral, #fyp, #reels) with content-specific tags inferred from the scene (e.g. #cinematic, #dramatic, #actionscene, #romance) — 5 to 8 hashtags total, no spaces inside a tag, no "#" duplicated.
- Never include celebrity names, brand names, or copyrighted characters.
- Do not mention "Seedance", "EvoLink", "prompt" or any technical/internal terminology — write as a creator talking to their audience about the VIDEO, not about how it was made.
- Do not use markdown formatting (no **bold**, no bullet lists) inside the caption text — plain text only, emojis are fine.

OUTPUT FORMAT — respond with VALID JSON ONLY. No markdown, no code fences, no backticks, no explanation, nothing before or after the JSON — your entire response must be parseable directly by JSON.parse():
{
  "captions": [
    { "style": "instagram_reels", "label": "Instagram Reels", "caption_es": "...", "caption_en": "...", "hashtags": ["#...", "#..."] },
    { "style": "tiktok_hook", "label": "TikTok Hook", "caption_es": "...", "caption_en": "...", "hashtags": ["#...", "#..."] },
    { "style": "motivational", "label": "Motivacional", "caption_es": "...", "caption_en": "...", "hashtags": ["#...", "#..."] }
  ]
}`;

function safeParseJSON(text) {
  const raw = String(text || "").replace(/```json|```/g, "").trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ ok: false, error: "GEMINI_API_KEY no configurada" });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  const prompt = String(body.prompt || "").trim().slice(0, 1500);
  if (prompt.length < 3) return res.status(400).json({ ok: false, error: "Falta el prompt del video" });

  try {
    const fullPrompt = `${SYSTEM_PROMPT}\n\nVideo prompt used to generate the scene:\n"${prompt}"`;

    const response = await fetch(`${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
        generationConfig: {
          responseModalities: ["TEXT"],
          temperature:        0.9,
          topP:               0.9,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error("[viral-captions] Gemini error:", errText);
      return res.status(502).json({ ok: false, error: `Gemini API error ${response.status}` });
    }

    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.filter((p) => p?.text).map((p) => p.text).join("\n").trim();
    const parsed = safeParseJSON(text);
    const captions = Array.isArray(parsed?.captions) ? parsed.captions.slice(0, 3) : null;

    if (!captions || captions.length !== 3) {
      console.error("[viral-captions] No se pudo parsear:", text);
      return res.status(500).json({ ok: false, error: "No se pudieron generar los captions. Intenta de nuevo." });
    }

    return res.status(200).json({ ok: true, captions });

  } catch (e) {
    console.error("[viral-captions] error:", e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}

export const config = { runtime: "nodejs" };
