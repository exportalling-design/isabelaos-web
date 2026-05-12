// api/templates/generate-profile.js
// Genera hoja de referencia de personaje con Gemini imagen generation
// Si Gemini falla, devuelve la foto original para que el frontend la use
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("content-type", "application/json; charset=utf-8");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const userId = await getUserIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  const { faceBase64, faceMime, isFace = true } = body;

  if (!faceBase64 || !faceMime) {
    return res.status(400).json({ ok: false, error: "Missing faceBase64 or faceMime" });
  }

  const geminiKey = process.env.GEMINI_API_KEY;

  // Prompt para hoja de referencia de personaje
  const prompt = isFace
    ? `Create a professional CHARACTER REFERENCE SHEET for this person's face. 
Output a single image showing 4 portrait views arranged in a 2x2 grid on a clean white background:
- Top-left: FRONT VIEW - exact frontal face, neutral expression
- Top-right: 3/4 LEFT - face turned 45 degrees to the left
- Bottom-left: LEFT PROFILE - pure side view 90 degrees
- Bottom-right: 3/4 RIGHT - face turned 45 degrees to the right

STRICT RULES:
• Preserve EXACT facial features: skin tone, eye shape/color, nose, lips, jaw, hair
• Neutral expression in all views
• Soft even studio lighting, white background
• Label each view with small text: "FRONT", "3/4 L", "PROFILE L", "3/4 R"
• Output ONLY the reference sheet image, no other text`
    : `Create a professional CHARACTER BODY REFERENCE SHEET for this person.
Output a single image showing 4 full-body views arranged in a 2x2 grid on a clean white background:
- Top-left: FRONT VIEW
- Top-right: 3/4 LEFT view  
- Bottom-left: BACK VIEW
- Bottom-right: 3/4 RIGHT view

STRICT RULES:
• Preserve EXACT body proportions, height, build
• Neutral standing pose in all views
• Soft studio lighting, white background
• Label each view
• Output ONLY the reference sheet image`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: faceMime, data: faceBase64 } },
              { text: prompt },
            ],
          }],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("[generate-profile] Gemini HTTP error:", response.status, errText);
      // Fallback: return the original photo as the "profile"
      return res.status(200).json({
        ok: true,
        profile: { base64: faceBase64, mimeType: faceMime },
        fallback: true,
      });
    }

    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts || [];

    for (const part of parts) {
      if (part.inlineData?.mimeType?.startsWith("image/")) {
        return res.status(200).json({
          ok: true,
          profile: {
            base64: part.inlineData.data,
            mimeType: part.inlineData.mimeType,
          },
          fallback: false,
        });
      }
      // Also check camelCase variant
      if (part.inline_data?.mime_type?.startsWith("image/")) {
        return res.status(200).json({
          ok: true,
          profile: {
            base64: part.inline_data.data,
            mimeType: part.inline_data.mime_type,
          },
          fallback: false,
        });
      }
    }

    console.error("[generate-profile] Gemini returned no image, parts:", JSON.stringify(parts).slice(0, 300));

    // Fallback: return original photo
    return res.status(200).json({
      ok: true,
      profile: { base64: faceBase64, mimeType: faceMime },
      fallback: true,
    });

  } catch (err) {
    console.error("[generate-profile] error:", err.message);
    // Always fallback instead of failing — the video will still work
    return res.status(200).json({
      ok: true,
      profile: { base64: faceBase64, mimeType: faceMime },
      fallback: true,
    });
  }
}

export const config = { runtime: "nodejs" };
