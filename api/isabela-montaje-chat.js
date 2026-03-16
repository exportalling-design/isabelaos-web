// api/isabela-montaje-chat.js
// Chat del montaje para IsabelaOS Studio
// Cambiado a Vertex global + gemini-2.0-flash-001

import {
  vertexFetch,
  extractTextFromVertexResponse,
  VERTEX_GEMINI_MODEL,
  VERTEX_LOCATION,
  VERTEX_PROJECT_ID,
} from "./_googleVertex.js";

function normalizeHistory(chatHistory) {
  if (!Array.isArray(chatHistory)) return [];

  return chatHistory
    .map((item) => {
      const role =
        item?.role === "assistant" || item?.role === "model"
          ? "model"
          : "user";

      const text =
        typeof item?.text === "string"
          ? item.text
          : typeof item?.content === "string"
          ? item.content
          : typeof item?.message === "string"
          ? item.message
          : "";

      if (!text.trim()) return null;

      return {
        role,
        parts: [{ text: text.trim() }],
      };
    })
    .filter(Boolean);
}

function buildContents({ message, chatHistory }) {
  const history = normalizeHistory(chatHistory);

  if (typeof message === "string" && message.trim()) {
    history.push({
      role: "user",
      parts: [{ text: message.trim() }],
    });
  }

  return history;
}

function getUserMessage(body) {
  return (
    body?.message ||
    body?.prompt ||
    body?.userMessage ||
    body?.text ||
    ""
  );
}

export async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed",
    });
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};

    const message = getUserMessage(body);
    const chatHistory = body?.chatHistory || body?.history || [];

    if (!message || !String(message).trim()) {
      return res.status(400).json({
        ok: false,
        error: "Falta el mensaje del usuario.",
      });
    }

    const contents = buildContents({
      message: String(message),
      chatHistory,
    });

    const systemInstruction = {
      parts: [
        {
          text: [
            "Eres Isabela, asistente de montaje de IsabelaOS Studio.",
            "Tu tarea es conversar con el usuario en español y confirmar claramente lo que entendiste para crear un montaje.",
            "Debes responder breve, útil y concreta.",
            "Si faltan detalles, pide solo lo mínimo necesario.",
            "Cuando el usuario solo salude, responde con un saludo corto y pregunta qué montaje desea.",
            "No inventes archivos, imágenes ni resultados ya generados.",
            "No uses markdown complejo.",
          ].join("\n"),
        },
      ],
    };

    const data = await vertexFetch({
      contents,
      systemInstruction,
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 350,
        topP: 0.9,
      },
    });

    const reply =
      extractTextFromVertexResponse(data) ||
      "Entendido. Cuéntame cómo quieres el montaje.";

    return res.status(200).json({
      ok: true,
      reply,
      message: reply,
      assistant: reply,
      model: VERTEX_GEMINI_MODEL,
      location: VERTEX_LOCATION,
      projectId: VERTEX_PROJECT_ID,
      raw: data,
    });
  } catch (error) {
    console.error("ERROR /api/isabela-montaje-chat:", error);

    return res.status(error?.status || 500).json({
      ok: false,
      error: error?.message || "No se pudo procesar la solicitud.",
      details: error?.details || null,
      model: VERTEX_GEMINI_MODEL,
      location: VERTEX_LOCATION,
    });
  }
}

export default handler;
