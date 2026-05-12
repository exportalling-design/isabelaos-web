// api/templates/generate-profile.js
// Genera hoja de referencia de personaje con Gemini
// Usa el mismo modelo y patrón que generate-montaje.js (que sí funciona)
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image-preview";
const GEMINI_API_BASE    = "https://generativelanguage.googleapis.com/v1beta";

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

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: "MISSING_GEMINI_API_KEY" });
  }

  const prompt = isFace
    ? `You are a professional character reference artist.
Look at this face photo and create a CHARACTER REFERENCE SHEET image.

Output a single image showing this EXACT person from 4 angles arranged in a 2x2 grid on a clean WHITE background:
- TOP LEFT: Front view (0° - looking straight at camera)
- TOP RIGHT: 3/4 left view (face turned ~45° to the left)
- BOTTOM LEFT: Left profile (90° - pure side view)
- BOTTOM RIGHT: 3/4 right view (face turned ~45° to the right)

CRITICAL RULES:
- Preserve EXACTLY: skin tone, eye shape/color, nose, lips, jawline, hair color and style
- Neutral expression in all 4 views
- Soft even studio lighting, pure white background
- Small label under each view: FRONT / 3/4 L / PROFILE L / 3/4 R
- All 4 views same size in a clean 2x2 grid
- Output ONLY the reference sheet image`
    : `You are a professional character reference artist.
Create a BODY REFERENCE SHEET showing this person's full body from 4 angles in a 2x2 grid on white background:
- TOP LEFT: Front view
- TOP RIGHT: 3/4 left
- BOTTOM LEFT: Back view
- BOTTOM RIGHT: 3/4 right
Preserve exact body proportions and build. Label each view. Pure white background.
Output ONLY the reference sheet image.`;

  // Misma estructura exacta que generate-montaje.js
  const parts = [
    {
      inline_data: {
        mime_type: faceMime,
        data: faceBase64,
      },
    },
    { text: prompt },
  ];

  const requestBody = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      temperature: 0.4,
      topP: 0.9,
    },
  };

  try {
    const url = `${GEMINI_API_BASE}/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`;
    console.log(`[generate-profile] calling Gemini ${GEMINI_IMAGE_MODEL} isFace=${isFace}`);

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!r.ok) {
      const txt = await r.text();
      console.error(`[generate-profile] Gemini error ${r.status}:`, txt.slice(0, 300));
      // Devolver null — el frontend usará el Canvas como fallback
      return res.status(200).json({ ok: true, profile: null, fallback: true });
    }

    const data = await r.json();

    // Extraer imagen — mismo patrón que generate-montaje.js
    const responseParts = data?.candidates?.[0]?.content?.parts || [];
    for (const part of responseParts) {
      const imgData = part?.inlineData || part?.inline_data;
      if (imgData?.data) {
        console.log(`[generate-profile] SUCCESS — image found`);
        return res.status(200).json({
          ok: true,
          profile: {
            base64: imgData.data,
            mimeType: imgData.mimeType || imgData.mime_type || "image/jpeg",
          },
          fallback: false,
        });
      }
    }

    console.error("[generate-profile] Gemini returned no image. Parts:", JSON.stringify(responseParts).slice(0, 300));
    return res.status(200).json({ ok: true, profile: null, fallback: true });

  } catch (err) {
    console.error("[generate-profile] exception:", err.message);
    return res.status(200).json({ ok: true, profile: null, fallback: true });
  }
}

export const config = { runtime: "nodejs" };
