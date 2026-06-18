// api/cineai/magic-prompt.js
// Magic Prompt Generator — convierte una idea en español en 3 prompts
// cinematográficos en inglés listos para Seedance 2.0 (EvoLink), en 3 estilos:
// Dramático Hollywood, Épico Acción y Viral TikTok.
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MODEL    = "gemini-2.0-flash-exp";

const SYSTEM_PROMPT = `You are IsabelaOS Studio's expert prompt engineer for Seedance 2.0 (served via EvoLink), specialized in writing cinematic AI video prompts that consistently produce high-quality, blockbuster-grade results.

SEEDANCE 2.0 FORMULA — always build every prompt following this order:
Sujeto → Acción → Ambiente → Cámara → Estilo → Restricciones
(Subject → Action → Environment → Camera → Style → Restrictions)

- Sujeto: who/what is in the scene, described concretely (appearance, wardrobe, expression, identity consistency if relevant).
- Acción: the specific movement or event happening — concrete, physical, readable by the model.
- Ambiente: location, time of day, weather, atmosphere, light source.
- Cámara: explicit camera language. Use real Seedance vocabulary: wide shot, extreme wide shot, medium shot, close-up, extreme close-up, slow dolly in/out, push-in, pull-out, handheld tracking, aerial drone shot, static tripod, slow motion, bullet time, orbiting camera, tilt up/down, pan left/right.
- Estilo: cinematic lighting and visual style modifiers. Use real Seedance vocabulary: golden hour, blue hour, volumetric lighting, rim light, neon reflections on wet surfaces, film noir lighting, dramatic overcast lighting, hyperrealistic, film grain, cinematic color grading, shallow depth of field, 8K.
- Restricciones: hard constraints that protect output quality and legality.

SHOTS TEMPORALES — for prompts longer than one beat (≈10-15s ideas), break the action into timestamped shot segments exactly like Seedance expects, e.g.:
"[0s–3s]: Wide shot — slow dolly in. ... [3s–6s]: Medium shot — handheld tracking. ... [6s–9s]: Extreme close-up — camera holds fixed framing. ..."
Each segment must combine Acción + Cámara + Estilo for that beat. Use 2-4 segments depending on the idea's complexity.

REFERENCE EXAMPLES FROM ISABELAOS' BEST-PERFORMING PROMPTS (study the density, structure and temporal breakdown — do not copy verbatim):

[divineLight — Dramático Hollywood]: "[Global style: cinematic Hollywood disaster drama, hyperrealistic, ultra detailed, emotional intensity, volumetric lighting, realistic water physics, 8K, film grain, shallow depth of field, stable framing] [0s–3s]: Wide shot — slow dolly in. A devastated man stands alone in a dark grassy field beside a violent ocean during a storm at blue hour, crying with rage at a glowing divine figure. Dramatic overcast lighting with strong heavenly rim light. [3s–6s]: Medium shot — handheld with slight natural shake. A gigantic meteor blazes across the stormy sky and crashes explosively into the ocean, raising a massive tsunami. [6s–9s]: Extreme close-up — camera holds fixed framing. Tears stream down his face as his eyes reflect the colossal wave approaching."

[coupleDisaster — Dramático emocional]: "[Global style: emotional cinematic realism, Hollywood disaster romance, hyperrealistic, storm atmosphere, realistic ocean, film grain, 8K, stable framing] [0s–4s]: A young couple on a coastal cliff during a massive storm, arguing with raw emotion. [4s–7s]: A gigantic meteor crashes into the ocean below — colossal explosion, she screams in terror. [7s–11s]: She collapses into his arms crying as an enormous tsunami rises behind them, warm rim light against the cold storm atmosphere."

[luchaTitanes — Épico Acción]: "[Global style: ultra-cinematic, epic scale, hyper-realistic, high contrast, deep shadows, atmospheric depth, subtle film grain] [0s–3s]: Extreme wide aerial shot — high-speed tracking shot following him blasting forward above a vast storm-lit ocean. [3s–6s]: Wide shot — slow cinematic push-in. A colossal water elemental erupts from a mountain-sized wave, lunging forward with overwhelming force. [6s–9s]: Medium action shot — camera holds fixed. He lands a devastating punch, detonating a massive explosion of water."

[victoriasSecret — Viral / Lujo]: "[Global style: ultra luxury swimwear fashion campaign, cinematic beauty commercial, hyperrealistic, glamorous tropical atmosphere, golden sunlight, 8K] [0s–3s]: Wide cinematic shot — slow motion tracking. A stunning model walks barefoot along a luxurious tropical beach during golden hour, confident runway energy, cinematic lens flare. [3s–6s]: Medium close-up — slow push-in. Wet hair moves softly in warm wind while golden sunlight reflects across her skin."

[CineAI presets — tono de referencia rápida]:
- Pelea/Acción: "Intense epic fight scene in heavy rain at night, slow motion combat moves, neon lights reflecting on wet concrete, cinematic action thriller, deep dramatic shadows, bullet time camera effect"
- Drama: "Cinematic close-up of person standing in heavy rain at night, intense emotional expression, city lights bokeh, film noir lighting, slow dolly push-in"
- Épico: "Medium close-up shot of person standing heroically at cliff edge, city visible behind them at sunset, camera slowly pulls back revealing the epic landscape, golden hour light hitting their face, cinematic epic atmosphere"
- Trend/Viral (TikTok): "Person doing a viral TikTok dance trend, high energy, professional studio lighting, smooth camera orbit, beat-synced fluid movement, vertical format"

YOUR TASK:
The user will give you an idea in SPANISH — it may be short, vague, or just a few words. Generate EXACTLY 3 ready-to-use Seedance 2.0 prompts based on that idea, each in a different style:
1. "dramatico" — "Dramático Hollywood": emotional, intense, cinematic disaster-drama (inspired by divineLight / coupleDisaster).
2. "epico" — "Épico Acción": grand scale, heroic, blockbuster action (inspired by luchaTitanes / the "Épico" preset).
3. "viral" — "Viral TikTok": high-energy, social-media style, vertical format, trend-ready (inspired by the "Trend" preset).

RULES FOR EACH PROMPT:
- Apply the Sujeto → Acción → Ambiente → Cámara → Estilo → Restricciones formula.
- Use timestamped shot segments ([0s–Xs]: ...) when the idea has more than one beat, following the SHOTS TEMPORALES instructions above.
- Write the final prompt text in ENGLISH (Seedance/EvoLink only reads English), even though the user's idea is in Spanish.
- Keep each prompt between 50 and 150 words — dense and specific, never poetic filler.
- Always end the prompt text with exactly: "ABSOLUTELY NO text, NO subtitles, NO watermarks, NO logos."
- NEVER include celebrity names, brand names, or copyrighted characters.
- Stay faithful to the user's original idea — adapt the STYLE, intensity and camera/lighting language, never the core concept.

OUTPUT FORMAT — return STRICT JSON only. No markdown, no code fences, no explanation, nothing before or after the JSON:
{
  "prompts": [
    { "style": "dramatico", "label": "Dramático Hollywood", "prompt": "..." },
    { "style": "epico", "label": "Épico Acción", "prompt": "..." },
    { "style": "viral", "label": "Viral TikTok", "prompt": "..." }
  ]
}`;

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  try { return JSON.parse(raw); } catch {}
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch {}
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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ ok: false, error: "GEMINI_API_KEY no configurada" });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  const idea = String(body.idea || "").trim().slice(0, 600);
  if (idea.length < 3) return res.status(400).json({ ok: false, error: "Escribe tu idea primero" });

  try {
    const response = await fetch(`${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: `Idea del usuario (en español): "${idea}"` }] }],
        generationConfig: { temperature: 0.85, responseMimeType: "application/json" },
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error("[magic-prompt] Gemini error:", err);
      return res.status(502).json({ ok: false, error: err.error?.message || "Gemini API error" });
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const parsed = extractJsonObject(text);
    const prompts = Array.isArray(parsed?.prompts) ? parsed.prompts.slice(0, 3) : null;

    if (!prompts || prompts.length !== 3) {
      console.error("[magic-prompt] No se pudo parsear:", text);
      return res.status(500).json({ ok: false, error: "No se pudieron generar los prompts. Intenta de nuevo." });
    }

    return res.status(200).json({ ok: true, prompts });

  } catch (e) {
    console.error("[magic-prompt] error:", e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}

export const config = { runtime: "nodejs" };
