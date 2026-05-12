// api/templates/generate-profile.js
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
  const { faceBase64, faceMime } = body;

  if (!faceBase64 || !faceMime) {
    return res.status(400).json({ ok: false, error: "Missing faceBase64 or faceMime" });
  }

  try {
    const geminiKey = process.env.GEMINI_API_KEY;
    const prompt = `You are a professional character reference artist. Given this face photo, create a multi-angle character reference sheet image showing 4 views in a 2x2 grid on a clean white background:
- Top-left: Front view (0°)
- Top-right: 3/4 left view (45°)
- Bottom-left: Side profile left (90°)
- Bottom-right: 3/4 right view (135°)
CRITICAL RULES: Do NOT alter any facial features. Preserve exact skin tone, eye color and shape, nose, lips, jawline, hair color and style. No accessories, no glasses, neutral expression, soft neutral studio lighting, clean white background. Output ONLY the reference sheet image, no text.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${geminiKey}`,
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
          generationConfig: { response_modalities: ["IMAGE", "TEXT"] },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini error ${response.status}: ${err}`);
    }

    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts || [];

    for (const part of parts) {
      if (part.inline_data?.mime_type?.startsWith("image/")) {
        return res.status(200).json({
          ok: true,
          profile: {
            base64: part.inline_data.data,
            mimeType: part.inline_data.mime_type,
          },
        });
      }
    }

    throw new Error("Gemini did not return an image");

  } catch (err) {
    console.error("[generate-profile] error:", err.message);
    return res.status(500).json({ ok: false, error: "Error generating profile sheet" });
  }
}

export const config = { runtime: "nodejs" };
