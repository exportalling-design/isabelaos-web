// api/isabela-montaje-chat.js
import { requireUser } from "./_auth.js";
import { vertexFetch } from "./_googleVertex.js";

function extractText(resp) {
  const parts =
    resp?.candidates?.[0]?.content?.parts ||
    resp?.candidates?.[0]?.content?.[0]?.parts ||
    [];
  return parts.map((p) => p.text || "").join("").trim();
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const auth = await requireUser(req);
    if (!auth.ok) {
      return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    }

    const { message = "", hasPersonImage = false, hasBackgroundImage = false } = req.body || {};

    const systemInstruction = `
Eres Isabela, la asistente interna del módulo "Montaje IA" de IsabelaOS.

Tu única función es ayudar con:
- montaje de una persona, avatar o producto en una escena
- uso de foto principal y fondo opcional
- interpretación de instrucciones visuales para este módulo

Reglas:
- Nunca respondas preguntas generales ni temas fuera del módulo.
- Si el usuario pregunta algo fuera del módulo, responde SOLO con este JSON:
{"allowed":false,"reply":"Lo siento, solo puedo ayudarte con funciones relacionadas con este módulo de montaje de imágenes."}

- Nunca menciones Gemini, Google, Vertex, APIs externas ni proveedores.
- Si el usuario sí está dentro del módulo, responde SOLO JSON válido.
- No uses markdown.
- Mantén el reply corto y natural, como Isabela.

Formato JSON si está permitido:
{
  "allowed": true,
  "reply": "texto corto para el usuario",
  "intent": "compose_with_background | generate_scene_from_subject | product_scene",
  "scenePrompt": "prompt visual corto y limpio en inglés para generar o montar",
  "subjectType": "person | product",
  "needsBackground": true/false
}
`;

    const body = {
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Mensaje del usuario: ${message}
Tiene imagen principal: ${hasPersonImage ? "sí" : "no"}
Tiene fondo subido: ${hasBackgroundImage ? "sí" : "no"}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    };

    const data = await vertexFetch(
      `/publishers/google/models/gemini-2.0-flash:generateContent`,
      body
    );

    const text = extractText(data);
    const parsed = safeParseJson(text);

    if (!parsed) {
      return res.status(200).json({
        ok: true,
        allowed: false,
        reply: "Lo siento, solo puedo ayudarte con funciones relacionadas con este módulo de montaje de imágenes.",
      });
    }

    return res.status(200).json({ ok: true, ...parsed });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      reply: "Lo siento, no pude procesar tu solicitud en este momento.",
      error: err?.message || String(err),
    });
  }
}
