// /api/optimize-prompt.js
// Optimización de prompts para IsabelaOS
// Soporta:
// - IMAGE:
//    1) Flux normal
//    2) Flux + avatar/anchor + skin standard
//    3) Realistic Vision + avatar/anchor + skin natural
// - VIDEO:
//    1) WAN local/open-source
//    2) VEO 3 fast
//    3) WAN fast por API (futuro)
//
// Mantiene compatibilidad con el frontend actual:
// body: { prompt, negative_prompt }
// y permite mejoras futuras con:
// body: {
//   mode: "image" | "video",
//   skin_mode: "standard" | "natural",
//   has_anchor: true | false,
//   image_model: "flux" | "realistic_vision",
//   video_model: "wan" | "veo3_fast" | "wan_fast_api"
// }

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
  if (route.startsWith("image_")) return 0.4;
  return 0.5;
}

function getMaxTokensForRoute(route) {
  if (route.startsWith("image_")) return 700;
  return 900;
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
Transform the user's idea into a concise, visually strong, image-generation prompt for FLUX.

IMPORTANT RULES:
- This is for IMAGE only, never for video.
- Do NOT add motion, frame, temporal, blinking, tracking, or camera movement language.
- Do NOT invent a second subject.
- Keep the prompt faithful to the user's intent.
- Prioritize: subject, pose, clothing, environment, lighting, composition, realism/stylization.
- Keep prompts compact and useful, not poetic.
- Negative prompt should remove common generation problems only.
- If the user did not request camera/lens language, keep it minimal.
- Do not add NSFW content unless explicitly present in the user prompt.

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
- Pipeline will preserve identity using anchor tools, so prompt must not fight identity

GOAL:
Create a prompt that helps FLUX compose the scene correctly while staying compatible with anchored identity and a light SDXL quality refine later.

IMPORTANT RULES:
- This is for IMAGE only, never for video.
- Do NOT add motion, temporal, blinking, frame, or camera movement language.
- Do NOT over-describe face details; identity is handled by anchor tools.
- Focus on pose, wardrobe, body framing, environment, lighting, mood, composition.
- Avoid excessive face adjectives that can conflict with anchor identity.
- Keep the subject singular: one person only unless the user explicitly asked otherwise.
- Negative prompt should include duplicate person / extra limbs / bad anatomy issues.
- Keep output compact and production-friendly.

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
- This route aims for realistic skin and natural texture

GOAL:
Create a prompt that helps Realistic Vision generate a single subject with realistic skin, stable anatomy, and clean composition, while staying compatible with anchor identity preservation.

IMPORTANT RULES:
- This is for IMAGE only, never for video.
- Do NOT add motion, temporal, blinking, frame, or camera movement language.
- Do NOT add cinematic video wording.
- The prompt must strongly favor a single person only.
- Prefer realistic portrait / single-subject composition.
- Avoid overly complex scene choreography.
- Favor natural skin texture, subtle imperfections, pores, realistic complexion, analog realism when relevant.
- Do NOT over-specify the face identity because anchor tools preserve identity.
- Negative prompt must strongly block duplicate person / extra faces / merged body / stacked bodies / clone artifacts.
- Keep it compact and usable.

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
Turn the user's idea into a practical prompt for WAN video generation.

IMPORTANT RULES:
- This is for VIDEO, so motion language is allowed.
- Keep motion realistic and simple.
- Prioritize: subject, action, environment, lighting, framing, camera motion.
- Avoid overloading with too many simultaneous actions.
- Keep scenes stable and achievable.
- If the user didn't ask for camera movement, keep camera mostly stable.
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
Create a premium, clear, cinematic prompt optimized for a high-end API video model.

IMPORTANT RULES:
- This is for VIDEO, so motion language is allowed.
- Keep the prompt visually strong but not bloated.
- Prioritize: subject, key action, scene, lighting, mood, camera movement if requested, realism.
- Avoid contradictory instructions.
- Keep action readable and stable.
- Negative prompt should be clean and practical.
- Do not add unnecessary pseudo-technical jargon.
- If the user asks for a specific movement, make it explicit and readable.

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
Create a short, efficient prompt optimized for a fast video model where clarity matters more than excessive detail.

IMPORTANT RULES:
- This is for VIDEO, so motion language is allowed.
- Keep prompts short, clear, and easy to parse.
- Prioritize one subject, one main action, one environment, one camera behavior.
- Avoid prompt bloat.
- Negative prompt should focus on stability, anatomy, duplicate faces, flicker, jitter, warped motion.
- If the user asks for realism, emphasize realistic movement and believable lighting.

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
Return strict JSON:
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
    prompt,
    negative_prompt: negativePrompt,
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

  if (route === "image_flux_anchor_standard") {
    if (!/single person|one person|one woman|solo/i.test(op)) {
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
      "subtle skin imperfections",
      "visible pores",
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
// Parse de respuesta OpenAI
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
    const sliced = raw.slice(start, end + 1);
    return safeJsonParse(sliced);
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
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
      }),
    });

    const raw = await openaiRes.json().catch(() => null);

    if (!openaiRes.ok) {
      return res.status(openaiRes.status).json({
        ok: false,
        error:
          raw?.error?.message ||
          raw?.error ||
          "OpenAI request failed",
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
