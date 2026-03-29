// ─────────────────────────────────────────────────────────────
// Endpoint Vercel Serverless para generar fotos de producto
// con Gemini 2.5 Flash Image (mismo modelo que usa Pomelli)
// Formato idéntico a jades-buy.js y demás endpoints del proyecto
// ─────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";
import { requireUser }  from "./_auth.js";
 
// ── Constantes ────────────────────────────────────────────────
const JADES_PER_IMAGE   = 5;
const IMAGES_PER_SESSION = 4;
const TOTAL_JADES       = JADES_PER_IMAGE * IMAGES_PER_SESSION; // 20
 
// ── Ángulos de variación (1 por cada una de las 4 imágenes) ──
const VARIATION_ANGLES = [
  "front view, perfectly centered composition",
  "three-quarter angle, slightly elevated perspective",
  "side profile view, horizontal composition",
  "overhead flat lay, top-down bird's eye view",
];
 
// ── Supabase admin ────────────────────────────────────────────
function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("MISSING_SUPABASE_ENV");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
 
// ── Prompts por template ──────────────────────────────────────
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
      The product must look pristine, sharp, and commercially ready.
      No distractions, no props. Clean minimal composition.
      Style: High-end retail catalog photography, 4K quality, photorealistic.
      CRITICAL: The product must be IDENTICAL to the reference — same shape, colors, design, packaging. Only the background and lighting change.
    `,
 
    lifestyle: `
      Lifestyle product photography, ${angle}.
      ${productCtx}
      Setting: Natural, aspirational Latin American home or outdoor environment.
      Use warm tones and natural materials — wood surfaces, tropical plants, ceramic, linen textures.
      The scene feels authentic and lived-in, not overly staged.
      Lighting: Natural light through a window or soft golden hour outdoor light.
      The product is the hero but surrounded by complementary lifestyle props.
      Style: Magazine editorial lifestyle photography, warm color grading, 4K quality, photorealistic.
      CRITICAL: The product must be IDENTICAL to the reference — same shape, colors, design, packaging.
    `,
 
    inuse: `
      Lifestyle product photography featuring a person using the product, ${angle}.
      ${productCtx}
      Model: A Latin American person (brown skin tone, dark hair), 25-35 years old,
      well-dressed in casual modern style, naturally interacting with or holding the product.
      The model's expression is genuine and happy, not overly posed.
      Setting: Modern warm Latin American urban or home environment.
      Style: Social media influencer photography, authentic and aspirational, warm cinematic color grade, 4K quality.
      The product must be shown clearly and prominently.
      CRITICAL: The product must be IDENTICAL to the reference — same shape, colors, design, packaging.
    `,
 
    campaign: `
      ${getSeasonPrompt(season)}
      ${productCtx}
      Shot composition: ${angle}.
      The product is the clear hero of the image.
      Style: Professional marketing campaign photography, suitable for social media ads and digital campaigns.
      High production value, brand-ready, 4K quality, photorealistic.
      CRITICAL: The product must be IDENTICAL to the reference — same shape, colors, design, packaging.
    `,
  };
 
  return prompts[template] || prompts.studio;
}
 
function getSeasonPrompt(season) {
  const seasons = {
    christmas: `
      Christmas holiday product campaign.
      Setting: Elegant Christmas scene — warm gold and red accents, subtle pine branches,
      soft fairy lights bokeh in background, tasteful gift wrapping nearby.
      Color palette: Deep reds, gold, ivory white, forest green accents.
      Mood: Premium, festive, luxurious holiday campaign.
    `,
    valentines: `
      Valentine's Day product campaign.
      Setting: Romantic scene — soft pink and rose tones, rose petals,
      velvet textures, candles with warm bokeh background.
      Color palette: Deep rose, blush pink, burgundy, gold accents.
      Mood: Romantic, luxurious, aspirational Valentine's gift.
    `,
    halloween: `
      Halloween product campaign, stylish not scary.
      Setting: Chic Halloween scene — pumpkins, autumn leaves,
      moody atmosphere with orange and purple accent lighting.
      Color palette: Deep orange, black, purple, gold.
      Mood: Fun, fashion-forward Halloween campaign.
    `,
    mothers: `
      Mother's Day product campaign.
      Setting: Elegant spring scene — white roses, peonies,
      soft pastel ribbons, warm natural light.
      Color palette: Blush pink, ivory, sage green, soft lavender.
      Mood: Tender, elegant. Premium Mother's Day gift campaign.
    `,
    blackfriday: `
      Black Friday promotional campaign.
      Setting: Bold dramatic dark background,
      subtle gold or neon accent lighting, modern minimal composition.
      Color palette: Deep black, gold, white, electric accent.
      Mood: Powerful, exclusive, high-impact sale campaign.
    `,
    summer: `
      Summer lifestyle campaign.
      Setting: Bright fresh scene — natural light, tropical elements,
      vibrant colors, fresh flowers as props.
      Color palette: Bright coral, turquoise, sunny yellow, fresh white.
      Mood: Energetic, fresh, joyful. Summer lifestyle campaign.
    `,
  };
  return seasons[season] || seasons.christmas;
}
 
// ── Llamada a Gemini API (REST directo, sin SDK) ──────────────
// Usamos fetch directo porque el proyecto es Vite/Node puro
// y no queremos añadir dependencias pesadas
async function callGemini(imageBase64, imageMimeType, prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("MISSING_GEMINI_API_KEY");
 
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent?key=${apiKey}`;
 
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          {
            inline_data: {
              mime_type: imageMimeType || "image/jpeg",
              data: imageBase64,
            },
          },
          {
            text: `Use this product image as the exact reference. Generate a new professional photograph of this SAME product:\n\n${prompt}`,
          },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ["IMAGE"],
      image_config: {
        aspect_ratio: "1:1",
      },
    },
  };
 
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
 
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    throw new Error(`Gemini HTTP ${r.status}: ${errText.slice(0, 200)}`);
  }
 
  const data = await r.json();
 
  // Extraer imagen de la respuesta
  const parts = data?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part.inline_data?.data) {
      return {
        base64: part.inline_data.data,
        mimeType: part.inline_data.mime_type || "image/jpeg",
      };
    }
  }
 
  throw new Error("Gemini no devolvió imagen en la respuesta");
}
 
// ══════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ══════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }
 
  try {
    // ── 1. Auth ───────────────────────────────────────────────
    const auth = await requireUser(req);
    if (!auth.ok) {
      console.log("[photoshoot] AUTH_FAILED:", auth.error);
      return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    }
    const user = auth.user;
    console.log("[photoshoot] user:", user.id);
 
    // ── 2. Validar body ───────────────────────────────────────
    const {
      imageBase64,
      imageMimeType,
      template,
      season,
      productDescription,
      variationIndex,
    } = req.body || {};
 
    if (!imageBase64) {
      return res.status(400).json({ ok: false, error: "MISSING_IMAGE" });
    }
 
    const validTemplates = ["studio", "lifestyle", "inuse", "campaign"];
    if (!validTemplates.includes(template)) {
      return res.status(400).json({ ok: false, error: "INVALID_TEMPLATE", validTemplates });
    }
 
    const idx = Number(variationIndex) || 0;
    console.log("[photoshoot] template:", template, "variation:", idx, "season:", season || "N/A");
 
    // ── 3. Verificar saldo de Jades server-side ───────────────
    const sb = getSupabaseAdmin();
 
    const { data: profile, error: profileErr } = await sb
      .from("profiles")
      .select("jades")
      .eq("id", user.id)
      .single();
 
    if (profileErr || !profile) {
      console.error("[photoshoot] ERROR leyendo perfil:", profileErr?.message);
      return res.status(500).json({ ok: false, error: "PROFILE_NOT_FOUND" });
    }
 
    if (profile.jades < JADES_PER_IMAGE) {
      console.log("[photoshoot] SALDO_INSUFICIENTE:", profile.jades, "necesita:", JADES_PER_IMAGE);
      return res.status(402).json({
        ok: false,
        error: "INSUFFICIENT_JADES",
        jades_available: profile.jades,
        jades_required: JADES_PER_IMAGE,
      });
    }
 
    // ── 4. Construir prompt y llamar a Gemini ─────────────────
    const prompt = buildPrompt(template, productDescription || "", season || "christmas", idx);
 
    console.log("[photoshoot] llamando Gemini, variación:", idx);
    const generated = await callGemini(imageBase64, imageMimeType, prompt);
    console.log("[photoshoot] Gemini OK, mimeType:", generated.mimeType);
 
    // ── 5. Descontar Jades (solo si Gemini fue exitoso) ───────
    const { error: spendErr } = await sb.rpc("spend_jades", {
      p_user_id: user.id,
      p_amount:  JADES_PER_IMAGE,
      p_reason:  `photoshoot:${template}:v${idx}`,
    });
 
    if (spendErr) {
      // El gasto falló pero la imagen ya se generó — loguear pero devolver imagen
      console.error("[photoshoot] SPEND_ERROR (imagen generada igual):", spendErr.message);
    } else {
      console.log("[photoshoot] ✅ descontados", JADES_PER_IMAGE, "Jades, variación:", idx);
    }
 
    // ── 6. Devolver imagen como data URL ──────────────────────
    const imageUrl = `data:${generated.mimeType};base64,${generated.base64}`;
 
    return res.status(200).json({
      ok: true,
      imageUrl,
      template,
      variationIndex: idx,
      jades_spent: JADES_PER_IMAGE,
    });
 
  } catch (e) {
    console.error("[photoshoot] SERVER_ERROR:", e?.message || e);
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      detail: String(e?.message || e),
    });
  }
}
 
export const config = { runtime: "nodejs" };
