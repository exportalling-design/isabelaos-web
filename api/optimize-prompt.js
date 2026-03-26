// /api/optimize-prompt.js
// IsabelaOS prompt optimizer
// Siempre devuelve prompts finales en INGLÉS

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// -----------------------------
// Helpers
// -----------------------------
function cleanText(v, maxLen = 4000) {
  const s = String(v || "").replace(/\0/g, "").trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function compactText(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,+/g, ",")
    .trim();
}

function stripBadImageTerms(text) {
  const badTerms = [
    "across frames",
    "frame skipping",
    "motion artifacts",
    "gentle blinking",
    "temporal wobble",
    "temporal consistency",
    "stable details across frames",
    "smooth motion",
    "camera drift",
    "camera keeps subject centered",
    "subject stays fully in frame",
    "slow push-in camera movement",
    "push-in camera movement",
    "slow push-in",
    "subtle blinking",
    "flicker",
    "jitter",
    "ghosting",
    "out of frame",
    "off-frame",
  ];

  let out = String(text || "");
  for (const term of badTerms) {
    const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    out = out.replace(rx, "");
  }
  return compactText(out);
}

function inferMode(body) {
  const explicit = cleanText(body.mode || "").toLowerCase();
  if (explicit === "image" || explicit === "video") return explicit;

  const videoModel = cleanText(body.video_model || "").toLowerCase();
  if (videoModel) return "video";

  return "image";
}

function inferImageRoute(body) {
  const skinMode = cleanText(body.skin_mode || "standard").toLowerCase();
  const hasAnchor = !!body.has_anchor;
  const imageModel = cleanText(body.image_model || "").toLowerCase();

  if (imageModel === "realistic_vision") {
    return "image_realistic_natural_anchor";
  }

  if (skinMode === "natural" && hasAnchor) {
    return "image_realistic_natural_anchor";
  }

  if (hasAnchor) {
    return "image_flux_anchor_standard";
  }

  return "image_flux_normal";
}

function inferVideoRoute(body) {
  const model = cleanText(body.video_model || "").toLowerCase();

  if (model === "veo3_fast" || model === "veo3" || model === "veo") {
    return "video_veo3_fast";
  }

  if (model === "wan_fast_api" || model === "wan_fast") {
    return "video_wan_fast_api";
  }

  return "video_wan_local";
}

function getRoute(body) {
  const mode = inferMode(body);
  if (mode === "video") return inferVideoRoute(body);
  return inferImageRoute(body);
}

function getTemperatureForRoute(route) {
  if (route.startsWith("image_")) return 0.45;
  return 0.5;
}

function getMaxTokensForRoute(route) {
  if (route.startsWith("image_")) return 900;
  return 1000;
}

// -----------------------------
// System prompt base
// -----------------------------
function getEnglishOutputRule() {
  return `
CRITICAL LANGUAGE RULES:
- Always output the final optimizedPrompt in ENGLISH.
- Always output the final optimizedNegative in ENGLISH.
- Even if the user writes in Spanish or another language, translate and optimize into ENGLISH.
- Never return the final prompt in Spanish.
- Never explain the translation. Just return the JSON.
  `.trim();
}

// -----------------------------
// System prompts por ruta
// -----------------------------
function getSystemPrompt(route) {
  switch (route) {
    case "image_flux_normal":
      return `
You are a prompt optimizer for IMAGE generation in IsabelaOS.

TARGET ENGINE:
- FLUX text-to-image
- No avatar anchor
- General image generation

GOAL:
Transform the user's idea into a concise, visually strong AI image prompt in ENGLISH for FLUX.

${getEnglishOutputRule()}

IMPORTANT RULES:
- This is for IMAGE only, never for video.
- Do NOT add motion, frame, temporal, blinking, tracking, or camera movement language.
- Do NOT invent a second subject.
- Keep the prompt faithful to the user's intent.
- Prioritize: subject, pose, clothing, environment, lighting, composition, realism/stylization.
- Make the final prompt stronger and more professional than the user's original wording.
- Keep prompts compact and useful, not poetic or verbose.
- If appropriate, use professional image prompt wording like: cinematic lighting, realistic skin texture, detailed composition, high detail, natural shadows, depth of field.
- Negative prompt should remove common image generation problems only.
- If the user did not request camera/lens language, keep it minimal.
- Do not add NSFW content unless explicitly present in the user's prompt.

OUTPUT STYLE:
Return strict JSON only:
{
  "optimizedPrompt": "...",
  "optimizedNegative": "..."
}
      `.trim();

    case "image_flux_anchor_standard":
      return `
You are a prompt optimizer for IMAGE generation in IsabelaOS.

TARGET ENGINE:
- FLUX text-to-image
- Avatar anchor present
- Skin mode: STANDARD
- Pipeline preserves identity using anchor tools

GOAL:
Create a stronger, cleaner AI image prompt in ENGLISH for FLUX, focused on composition and scene quality while staying compatible with anchored identity.

${getEnglishOutputRule()}

IMPORTANT RULES:
- This is for IMAGE only, never for video.
- Do NOT add motion, temporal, blinking, frame, or camera movement language.
- Do NOT over-describe the face identity. Identity is preserved by anchor tools.
- Focus on pose, wardrobe, body framing, environment, lighting, mood, and composition.
- Keep the subject singular: one person only unless the user explicitly asks otherwise.
- Make the prompt more professional and visually rich than the user's original text.
- Use strong but practical visual wording.
- Negative prompt must include common defects like duplicate face, extra face, extra limbs, bad anatomy, deformed hands when relevant.
- Keep the result compact and production-friendly.

OUTPUT STYLE:
Return strict JSON only:
{
  "optimizedPrompt": "...",
  "optimizedNegative": "..."
}
      `.trim();

    case "image_realistic_natural_anchor":
      return `
You are a prompt optimizer for IMAGE generation in IsabelaOS.

TARGET ENGINE:
- Realistic Vision
- Avatar anchor present
- Skin mode: NATURAL
- This route aims for realistic skin, better texture, and natural-looking composition

GOAL:
Create a strong ENGLISH AI image prompt optimized for realistic single-subject generation with natural skin texture and stable anatomy.

${getEnglishOutputRule()}

IMPORTANT RULES:
- This is for IMAGE only, never for video.
- Do NOT add motion, temporal, blinking, frame, or camera movement language.
- Do NOT add cinematic video wording.
- The prompt must strongly favor a single person only.
- Avoid overly complex choreography or multi-subject composition.
- Favor realistic portrait/full-body composition depending on the user's request.
- Favor natural skin texture, visible pores, subtle imperfections, realistic complexion, analog realism when relevant.
- Do NOT over-specify face identity because anchor tools preserve it.
- Make the final prompt clearly better, more visual, and more model-friendly than the user's original text.
- Negative prompt must strongly block duplicate person, extra faces, merged body, stacked bodies, clone artifacts, warped anatomy.
- Keep it compact but high quality.

OUTPUT STYLE:
Return strict JSON only:
{
  "optimizedPrompt": "...",
  "optimizedNegative": "..."
}
      `.trim();

    case "video_wan_local":
      return `
You are a prompt optimizer for VIDEO generation in IsabelaOS.

TARGET ENGINE:
- WAN local / open-source video model

GOAL:
Transform the user's idea into a practical, strong VIDEO prompt in ENGLISH.

${getEnglishOutputRule()}

IMPORTANT RULES:
- This is for VIDEO, so motion language is allowed.
- Keep motion realistic and simple.
- Prioritize: subject, action, environment, lighting, framing, camera motion.
- Avoid overloading with too many simultaneous actions.
- Keep scenes stable and achievable.
- If the user did not request camera movement, keep the camera mostly stable.
- Make the final prompt stronger and cleaner than the user's original text.
- Negative prompt should remove flicker, jitter, extra limbs, duplicate faces, warped anatomy, unstable motion.
- Output should be concise and production-ready.

OUTPUT STYLE:
Return strict JSON only:
{
  "optimizedPrompt": "...",
  "optimizedNegative": "..."
}
      `.trim();

    case "video_veo3_fast":
      return `
You are a prompt optimizer for VIDEO generation in IsabelaOS.

TARGET ENGINE:
- VEO 3 Fast API

GOAL:
Create a premium, clear, cinematic VIDEO prompt in ENGLISH optimized for a high-end API video model.

${getEnglishOutputRule()}

IMPORTANT RULES:
- This is for VIDEO, so motion language is allowed.
- Keep the prompt visually strong but not bloated.
- Prioritize: subject, key action, scene, lighting, mood, camera movement if requested, realism.
- Avoid contradictory instructions.
- Keep the action readable and stable.
- Negative prompt should be practical and clean.
- Do not add unnecessary pseudo-technical jargon.
- If the user asks for a specific movement, make it explicit and readable.
- Make the result feel premium and production-ready.

OUTPUT STYLE:
Return strict JSON only:
{
  "optimizedPrompt": "...",
  "optimizedNegative": "..."
}
      `.trim();

    case "video_wan_fast_api":
      return `
You are a prompt optimizer for VIDEO generation in IsabelaOS.

TARGET ENGINE:
- WAN Fast API

GOAL:
Create a short, efficient VIDEO prompt in ENGLISH optimized for a fast model where clarity matters more than prompt bloat.

${getEnglishOutputRule()}

IMPORTANT RULES:
- This is for VIDEO, so motion language is allowed.
- Keep prompts short, clear, and easy to parse.
- Prioritize one subject, one main action, one environment, one camera behavior.
- Avoid prompt bloat.
- Negative prompt should focus on stability, anatomy, duplicate faces, flicker, jitter, warped motion.
- If the user asks for realism, emphasize believable movement and lighting.

OUTPUT STYLE:
Return strict JSON only:
{
  "optimizedPrompt": "...",
  "optimizedNegative": "..."
}
      `.trim();

    default:
      return `
You are a prompt optimizer for IsabelaOS.

${getEnglishOutputRule()}

Return strict JSON only:
{
  "optimizedPrompt": "...",
  "optimizedNegative": "..."
}
      `.trim();
  }
}

// -----------------------------
// User payload por ruta
// -----------------------------
function buildUserPrompt(route, prompt, negativePrompt, body) {
  const base = {
    route,
    original_user_prompt: prompt,
    original_negative_prompt: negativePrompt,
    skin_mode: cleanText(body.skin_mode || ""),
    has_anchor: !!body.has_anchor,
    image_model: cleanText(body.image_model || ""),
    video_model: cleanText(body.video_model || ""),
  };

  return JSON.stringify(base, null, 2);
}

// -----------------------------
// Post-proceso de salida
// -----------------------------
function normalizeOutput(route, optimizedPrompt, optimizedNegative) {
  let op = compactText(optimizedPrompt || "");
  let on = compactText(optimizedNegative || "");

  if (route.startsWith("image_")) {
    op = stripBadImageTerms(op);
    on = stripBadImageTerms(on);
  }

  if (route === "image_flux_normal") {
    if (!/single person|one person|single woman|one woman/i.test(op)) {
      op = compactText(`${op}, single person`);
    }
  }

  if (route === "image_flux_anchor_standard") {
    if (!/single person|one person|single woman|one woman/i.test(op)) {
      op = compactText(`${op}, single person`);
    }

    const mustNeg = [
      "duplicate face",
      "extra face",
      "extra limbs",
      "bad anatomy",
      "deformed hands",
    ];

    for (const term of mustNeg) {
      if (!new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(on)) {
        on = compactText(on ? `${on}, ${term}` : term);
      }
    }
  }

  if (route === "image_realistic_natural_anchor") {
    if (!/single person|one person|one woman|solo portrait|one face/i.test(op)) {
      op = compactText(`${op}, single person, one face only`);
    }

    const addPos = [
      "natural skin texture",
      "visible pores",
      "subtle skin imperfections",
    ];

    for (const term of addPos) {
      if (!new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(op)) {
        op = compactText(`${op}, ${term}`);
      }
    }

    const mustNeg = [
      "multiple people",
      "duplicate face",
      "extra face",
      "extra head",
      "merged body",
      "stacked bodies",
      "cloned face",
    ];

    for (const term of mustNeg) {
      if (!new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(on)) {
        on = compactText(on ? `${on}, ${term}` : term);
      }
    }
  }

  return {
    optimizedPrompt: op,
    optimizedNegative: on,
  };
}

// -----------------------------
// Parse de respuesta
// -----------------------------
function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  const parsed = safeJsonParse(raw);
  if (parsed) return parsed;

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return safeJsonParse(raw.slice(start, end + 1));
  }

  return null;
}

// -----------------------------
// Handler
// -----------------------------
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  if (!OPENAI_API_KEY) {
    return res.status(500).json({
      ok: false,
      error: "OPENAI_API_KEY no configurada",
    });
  }

  try {
    const body = req.body || {};

    const prompt = cleanText(body.prompt || "", 5000);
    const negativePrompt = cleanText(body.negative_prompt || "", 4000);

    if (!prompt) {
      return res.status(400).json({
        ok: false,
        error: "Falta prompt",
      });
    }

    const route = getRoute(body);
    const systemPrompt = getSystemPrompt(route);
    const userPrompt = buildUserPrompt(route, prompt, negativePrompt, body);

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: getTemperatureForRoute(route),
        max_tokens: getMaxTokensForRoute(route),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    const raw = await openaiRes.json().catch(() => null);

    if (!openaiRes.ok) {
      return res.status(openaiRes.status).json({
        ok: false,
        error: raw?.error?.message || raw?.error || "OpenAI request failed",
        route,
      });
    }

    const text =
      raw?.choices?.[0]?.message?.content ||
      raw?.choices?.[0]?.text ||
      "";

    const parsed = extractJsonObject(text);

    if (!parsed || typeof parsed !== "object") {
      return res.status(500).json({
        ok: false,
        error: "No se pudo parsear la respuesta del optimizador",
        raw_text: text,
        route,
      });
    }

    const normalized = normalizeOutput(
      route,
      parsed.optimizedPrompt || prompt,
      parsed.optimizedNegative || negativePrompt
    );

    return res.status(200).json({
      ok: true,
      route,
      optimizedPrompt: normalized.optimizedPrompt || prompt,
      optimizedNegative: normalized.optimizedNegative || negativePrompt || "",
      sourceModel: "gpt-4o-mini",
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}
