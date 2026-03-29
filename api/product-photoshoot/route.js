// ============================================================
// API Route - Product Photoshoot con Gemini 2.5 Flash Image
// Recibe: imagen base64 del producto + template + variación
// Devuelve: imagen generada en base64
// ============================================================
 
import { GoogleGenAI } from "@google/genai";
 
// Inicializar cliente de Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
 
// ============================================================
// PROMPTS POR TEMPLATE
// Cada variación tiene un ángulo/contexto diferente
// ============================================================
const VARIATION_ANGLES = [
  "front view, centered composition",
  "three-quarter angle view, slightly elevated",
  "side profile view, horizontal composition",
  "overhead flat lay view, top-down perspective",
];
 
function buildPrompt(template, productDescription, season, variationIndex) {
  const angle = VARIATION_ANGLES[variationIndex] || VARIATION_ANGLES[0];
  const productCtx = productDescription
    ? `The product is: ${productDescription}.`
    : "Use the product shown in the reference image.";
 
  const prompts = {
    studio: `
      Professional product photography, ${angle}.
      ${productCtx}
      Setting: Pure white or very light grey seamless studio backdrop.
      Lighting: Soft studio lighting with a three-point setup — key light, fill light, and rim light to create gentle depth and dimension.
      The product should look pristine, well-lit, and commercially ready.
      No shadows, no distractions. Clean minimal background.
      Shot style: E-commerce product photography, high-end retail catalog quality.
      Photorealistic, ultra sharp, 4K quality.
    `,
 
    lifestyle: `
      Lifestyle product photography, ${angle}.
      ${productCtx}
      Setting: A natural, aspirational Latin American home or outdoor environment — warm tones, natural materials like wood, plants, ceramic, linen.
      The scene should feel authentic and lived-in, not overly staged.
      Natural light coming through a window or soft golden hour outdoor light.
      The product is the hero but surrounded by complementary lifestyle props.
      Shot style: Magazine editorial lifestyle photography, aspirational but relatable.
      Photorealistic, warm color grading, 4K quality.
    `,
 
    inuse: `
      Lifestyle product photography featuring a person using the product, ${angle}.
      ${productCtx}
      Model: A Latin American woman or man (diverse representation — brown skin tones, dark hair), 
      between 25-35 years old, well-dressed in casual modern style.
      The model is naturally interacting with, holding, or using the product.
      Setting: Modern, warm Latin American urban or home environment.
      The model's expression is genuine and happy, not overly posed.
      Shot style: Social media influencer photography, authentic and aspirational.
      Photorealistic, warm cinematic color grade, 4K quality.
      Important: Show the product clearly and prominently.
    `,
 
    campaign: `
      ${getSeasonPrompt(season)}
      ${productCtx}
      Shot composition: ${angle}.
      The product is the clear hero of the image.
      Shot style: Professional marketing campaign photography, festive but elegant.
      High production value, brand-ready, suitable for social media ads and digital campaigns.
      Photorealistic, 4K quality.
    `,
  };
 
  return prompts[template] || prompts.studio;
}
 
function getSeasonPrompt(season) {
  const seasons = {
    christmas: `
      Christmas holiday product campaign photography.
      Setting: Elegant Christmas scene with warm gold and red accents, subtle pine branches, 
      soft fairy lights bokeh in background, gift wrapping elements nearby.
      Color palette: Deep reds, gold, ivory white, forest green accents.
      Mood: Premium, festive, luxurious holiday campaign.
    `,
    valentines: `
      Valentine's Day product campaign photography.
      Setting: Romantic scene with soft pink and rose tones, rose petals, 
      velvet textures, candles with warm bokeh in background.
      Color palette: Deep rose, blush pink, burgundy, gold accents.
      Mood: Romantic, luxurious, aspirational Valentine's gift campaign.
    `,
    halloween: `
      Halloween product campaign photography.
      Setting: Stylish Halloween scene — pumpkins, autumn leaves, 
      moody dark atmosphere with orange and purple accent lighting.
      Color palette: Deep orange, black, purple, gold.
      Mood: Fun and stylish, not scary. Fashion-forward Halloween campaign.
    `,
    mothers: `
      Mother's Day product campaign photography.
      Setting: Elegant spring scene with soft florals — white roses, peonies, 
      soft pastel ribbons, warm natural light.
      Color palette: Blush pink, ivory, sage green, soft lavender.
      Mood: Tender, elegant, emotional. Premium Mother's Day gift campaign.
    `,
    blackfriday: `
      Black Friday promotional product campaign photography.
      Setting: Bold, high-energy commercial scene with dark dramatic background,
      subtle gold or neon accent lighting, modern minimal composition.
      Color palette: Deep black, gold, white, electric accent color.
      Mood: Powerful, exclusive, high-impact sale campaign.
    `,
    summer: `
      Summer product campaign photography.
      Setting: Bright, fresh summer scene — natural light, tropical or beach elements,
      vibrant colors, fresh fruits or flowers as props.
      Color palette: Bright coral, turquoise, sunny yellow, fresh white.
      Mood: Energetic, fresh, joyful. Summer lifestyle campaign.
    `,
  };
 
  return seasons[season] || seasons.christmas;
}
 
// ============================================================
// HANDLER PRINCIPAL
// ============================================================
export async function POST(request) {
  try {
    const { imageBase64, template, season, productDescription, variationIndex } =
      await request.json();
 
    // Validaciones básicas
    if (!imageBase64) {
      return Response.json({ error: "Imagen requerida" }, { status: 400 });
    }
    if (!["studio", "lifestyle", "inuse", "campaign"].includes(template)) {
      return Response.json({ error: "Template inválido" }, { status: 400 });
    }
 
    // Construir el prompt según template y variación
    const prompt = buildPrompt(
      template,
      productDescription || "",
      season || "christmas",
      variationIndex || 0
    );
 
    // Llamar a Gemini 2.5 Flash Image con la imagen de referencia
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-04-17",
      contents: [
        {
          role: "user",
          parts: [
            {
              // Imagen de referencia del producto del usuario
              inlineData: {
                mimeType: "image/jpeg",
                data: imageBase64,
              },
            },
            {
              text: `Use this product image as the exact reference. Generate a new professional photograph of this SAME product with the following requirements:\n\n${prompt}\n\nCRITICAL: The product must look identical to the reference image — same shape, colors, design, packaging, and details. Do not change or alter the product itself. Only change the setting, lighting, background, and context around it.`,
            },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: {
          aspectRatio: "1:1",
        },
      },
    });
 
    // Extraer la imagen generada de la respuesta
    let generatedImageBase64 = null;
    let mimeType = "image/jpeg";
 
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        generatedImageBase64 = part.inlineData.data;
        mimeType = part.inlineData.mimeType || "image/jpeg";
        break;
      }
    }
 
    if (!generatedImageBase64) {
      throw new Error("Gemini no devolvió imagen");
    }
 
    // Devolver como data URL para uso directo en el frontend
    const imageUrl = `data:${mimeType};base64,${generatedImageBase64}`;
 
    return Response.json({ imageUrl, success: true });
  } catch (error) {
    console.error("[ProductPhotoshoot API Error]:", error);
    return Response.json(
      { error: "Error generando imagen", details: error.message },
      { status: 500 }
    );
  }
}
