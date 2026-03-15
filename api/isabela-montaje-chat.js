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

    const {
      message = "",
      hasPersonImage = false,
      hasBackgroundImage = false,
    } = req.body || {};

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
- Habla como Isabela, en español, de forma breve y clara.
- Tu respuesta debe sonar como una confirmación de lo que vas a hacer.
- Debes interpretar ubicación, tamaño e integración aunque el usuario lo diga de forma natural.
- Si el usuario pide correcciones como "más arriba", "más a la derecha", "más grande", "más pequeño", debes traducir eso en valores útiles.

IMPORTANTE:
- Si hay fondo subido, NO inventes un fondo nuevo.
- Si hay fondo subido, el modo debe ser "compose_existing_background".
- Si NO hay fondo subido, el modo debe ser "generate_background_then_compose".

Devuelve SIEMPRE este JSON si el mensaje sí pertenece al módulo:
{
  "allowed": true,
  "reply": "texto corto confirmando lo que entendiste y diciendo que si está correcto, den click en Generar montaje",
  "mode": "compose_existing_background | generate_background_then_compose",
  "subjectType": "person | product",
  "scenePrompt": "prompt visual limpio en inglés",
  "needsBackground": true,
  "x": 0.5,
  "y": 0.72,
  "scale": 0.55,
  "feather": 12,
  "blendMode": "seamless",
  "colorMatch": true,
  "shadow": true
}

Guía para x:
- izquierda = 0.25
- centro = 0.50
- derecha = 0.75

Guía para y:
- arriba = 0.30
- centro = 0.55
- abajo = 0.75

Guía para scale:
- muy pequeño = 0.35
- pequeño = 0.45
- normal = 0.55
- grande = 0.70
- muy grande = 0.85
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
    console.error("ERROR /api/isabela-montaje-chat:", err);

    return res.status(500).json({
      ok: false,
      reply: "Lo siento, no pude procesar tu solicitud en este momento.",
      error: err?.message || String(err),
      detail: err?.stack || err?.message || String(err),
    });
  }
}
