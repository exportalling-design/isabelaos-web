// api/product-photoshoot.js
// ─────────────────────────────────────────────────────────────
// Endpoint de generación de fotos de producto con Gemini
// COBRO: 5 Jades por imagen (sesión de 4 = 20 Jades total)
// Patrón idéntico a generate.js
// ─────────────────────────────────────────────────────────────
import { requireUser } from "./_auth.js";
import { createClient } from "@supabase/supabase-js";
 
function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("MISSING_SUPABASE_ENV");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
 
const JADES_PER_IMAGE = 5;
 
const VARIATION_ANGLES = [
  "front view, perfectly centered composition",
  "three-quarter angle, slightly elevated perspective",
  "side profile view, horizontal composition",
  "overhead flat lay, top-down bird's eye view",
];
 
function buildPrompt(template, productDescription, season, variationIndex) {
  const angle      = VARIATION_ANGLES[variationIndex] || VARIATION_ANGLES[0];
  const productCtx = productDescription
    ? `The product is: ${productDescription}.`
    : "Use the exact product shown in the reference image.";
 
  const prompts = {
    studio: `
      Professional e-commerce product photography, ${angle}.
      ${productCtx}
      Background: Pure white or very light grey seamless studio backdrop.
      Lighting: Soft three-point studio lighting — key light, fill light, and rim light.
      Style: High-end retail catalog photography, 4K quality, photorealistic.
      CRITICAL: The product must be IDENTICAL to the reference — same shape, colors, design, packaging. Only the background and lighting change.
    `,
    lifestyle: `
      Lifestyle product photography, ${angle}.
      ${productCtx}
      Setting: Natural, aspirational Latin American home or outdoor environment.
      Warm tones, natural materials — wood, tropical plants, ceramic, linen.
      Lighting: Natural window light or golden hour outdoor light.
      Style: Magazine editorial lifestyle photography, warm color grading, 4K quality, photorealistic.
      CRITICAL: The product must be IDENTICAL to the reference — same shape, colors, design, packaging.
    `,
    inuse: `
      Lifestyle product photography featuring a person using the product, ${angle}.
      ${productCtx}
      Model: Latin American person (brown skin tone, dark hair), 25-35 years old,
      casually dressed, naturally interacting with or holding the product.
      Setting: Modern warm Latin American urban or home environment.
      Style: Social media influencer photography, authentic and aspirational, 4K quality.
      Show the product clearly and prominently.
      CRITICAL: The product must be IDENTICAL to the reference — same shape, colors, design, packaging.
    `,
    campaign: `
      ${getSeasonPrompt(season)}
      ${productCtx}
      Shot composition: ${angle}.
      The product is the clear hero of the image.
      Style: Professional marketing campaign, suitable for social media ads, 4K quality, photorealistic.
      CRITICAL: The product must be IDENTICAL to the reference — same shape, colors, design, packaging.
    `,
  };
 
  return prompts[template] || prompts.studio;
}
 
function getSeasonPrompt(season) {
  const seasons = {
    christmas:   "Christmas holiday campaign. Elegant scene — gold and red accents, pine branches, fairy lights bokeh. Palette: deep reds, gold, ivory, forest green. Mood: premium festive luxury.",
    valentines:  "Valentine's Day campaign. Romantic scene — rose petals, velvet textures, candle bokeh. Palette: deep rose, blush pink, burgundy, gold. Mood: romantic luxury.",
    halloween:   "Halloween campaign, stylish not scary. Pumpkins, autumn leaves, orange and purple accent lighting. Palette: deep orange, black, purple, gold. Mood: fun fashion-forward.",
    mothers:     "Mother's Day campaign. Elegant spring scene — white roses, peonies, soft pastel ribbons, warm natural light. Palette: blush pink, ivory, sage green, lavender. Mood: tender elegant.",
    blackfriday: "Black Friday campaign. Bold dramatic dark background, gold or neon accent lighting, modern minimal composition. Palette: deep black, gold, white. Mood: powerful exclusive.",
    summer:      "Summer lifestyle campaign. Bright natural light, tropical elements, vibrant colors, fresh flowers. Palette: coral, turquoise, sunny yellow, white. Mood: energetic fresh joyful.",
  };
  return seasons[season] || seasons.christmas;
}
 
async function callGemini(imageBase64, imageMimeType, prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("MISSING_GEMINI_API_KEY");
 
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${apiKey}`;
 
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { inline_data: { mime_type: imageMimeType || "image/jpeg", data: imageBase64 } },
          { text: `Use this product image as the exact reference. Generate a new professional photograph of this SAME product:\n\n${prompt}` },
        ],
      }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    }),
  });
 
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    throw new Error(`Gemini HTTP ${r.status}: ${errText.slice(0, 300)}`);
  }
 
  const data  = await r.json();
 
  // Log completo para debug
  const rawParts = data?.candidates?.[0]?.content?.parts || [];
  console.log("[photoshoot] Gemini parts count:", rawParts.length);
  rawParts.forEach((p, i) => {
    if (p.text) console.log(`[photoshoot] part[${i}] text:`, p.text.slice(0, 100));
    if (p.inlineData || p.inline_data) {
      const pd = p.inlineData || p.inline_data;
      console.log(`[photoshoot] part[${i}] image mimeType:`, pd.mimeType || pd.mime_type, "dataLen:", (pd.data||"").length);
    }
  });
  if (data?.candidates?.[0]?.finishReason) {
    console.log("[photoshoot] finishReason:", data.candidates[0].finishReason);
  }
 
  // Buscar imagen en ambos formatos (inlineData y inline_data)
  for (const part of rawParts) {
    const pd = part.inlineData || part.inline_data;
    if (pd?.data) {
      return { base64: pd.data, mimeType: pd.mimeType || pd.mime_type || "image/jpeg" };
    }
  }
 
  const textParts = rawParts.filter(p => p.text).map(p => p.text).join(" ");
  throw new Error("Gemini no devolvió imagen. finishReason=" + (data?.candidates?.[0]?.finishReason || "N/A") + " text=" + textParts.slice(0, 200));
}
 
// ══════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ══════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  const cors = {
    "access-control-allow-origin":  "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "content-type":                 "application/json; charset=utf-8",
  };
 
  if (req.method === "OPTIONS") {
    return res.status(204).setHeader("access-control-allow-origin", "*").end();
  }
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
 
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }
 
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
 
    // ── 1. Auth (idéntico a generate-montaje.js) ─────────────
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    const userId = auth.user.id;
    console.log("[photoshoot] user:", userId);
 
    // ── 2. Validar body ───────────────────────────────────────
    const { imageBase64, imageMimeType, template, season, productDescription, variationIndex } = body;
 
    if (!imageBase64) {
      return res.status(400).json({ ok: false, error: "MISSING_IMAGE" });
    }
    if (!["studio", "lifestyle", "inuse", "campaign"].includes(template)) {
      return res.status(400).json({ ok: false, error: "INVALID_TEMPLATE" });
    }
 
    const idx = Number(variationIndex) || 0;
    console.log("[photoshoot] template:", template, "variation:", idx);
 
    // ── 3. Descontar Jades ANTES de llamar a Gemini ───────────
    //       (igual que generate.js descuenta antes de RunPod)
    const ref = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
 
    const sb = getSupabaseAdmin();
    const { error: spendErr } = await sb.rpc("spend_jades", {
      p_user_id: userId,
      p_amount:  JADES_PER_IMAGE,
      p_reason:  `photoshoot_${template}_v${idx}`,
      p_ref:     ref,
    });
 
    if (spendErr) {
      console.error("[photoshoot] JADE_CHARGE_FAILED:", spendErr);
 
      if ((spendErr.message || "").includes("INSUFFICIENT_JADES")) {
        return res.status(402).json({
          ok:       false,
          error:    "INSUFFICIENT_JADES",
          detail:   `Necesitas ${JADES_PER_IMAGE} Jades para esta generación.`,
          required: JADES_PER_IMAGE,
        });
      }
 
      return res.status(400).json({ ok: false, error: "JADE_CHARGE_FAILED", details: spendErr.message });
    }
 
    console.log("[photoshoot] ✅ descontados", JADES_PER_IMAGE, "Jades, ref:", ref);
 
    // ── 4. Llamar a Gemini ────────────────────────────────────
    const prompt    = buildPrompt(template, productDescription || "", season || "christmas", idx);
    const generated = await callGemini(imageBase64, imageMimeType || "image/jpeg", prompt);
    console.log("[photoshoot] Gemini OK, mimeType:", generated.mimeType);
 
    // ── 5. Devolver imagen ────────────────────────────────────
    return res.status(200).json({
      ok:             true,
      imageUrl:       `data:${generated.mimeType};base64,${generated.base64}`,
      template,
      variationIndex: idx,
      jades_spent:    JADES_PER_IMAGE,
    });
 
  } catch (e) {
    console.error("[photoshoot] SERVER_ERROR:", e?.message || e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", detail: String(e?.message || e) });
  }
}
 
export const config = { runtime: "nodejs" };
