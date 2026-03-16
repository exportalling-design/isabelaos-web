// api/isabela-montaje-chat.js
import {
  vertexFetch,
  extractTextFromVertexResponse,
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

function getUserMessage(body) {
  return (
    body?.message ||
    body?.prompt ||
    body?.userMessage ||
    body?.text ||
    ""
  );
}

function buildContents({ message, chatHistory }) {
  const history = normalizeHistory(chatHistory);

  if (message?.trim()) {
    history.push({
      role: "user",
      parts: [{ text: message.trim() }],
    });
  }

  return history;
}

export default async function handler(req, res) {
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

    const message = String(getUserMessage(body) || "").trim();
    const chatHistory = body?.chatHistory || body?.history || [];

    if (!message) {
      return res.status(400).json({
        ok: false,
        error: "Falta el mensaje del usuario.",
      });
    }

    const contents = buildContents({
      message,
      chatHistory,
    });

    const systemInstruction = {
      role: "system",
      parts: [
        {
          text: [
            "Eres Isabela, asistente de montaje de IsabelaOS Studio.",
            "Responde siempre en español.",
            "Tu trabajo es entender la intención del usuario para crear un montaje visual.",
            "Responde breve, clara y útil.",
            "Si faltan datos, pide solo los mínimos necesarios.",
            "Si el usuario solo saluda, responde con saludo corto y pregunta qué montaje desea.",
            "No inventes imágenes subidas ni resultados existentes.",
            "No uses markdown complejo.",
          ].join("\n"),
        },
      ],
    };

    const model = "gemini-2.5-flash";
    const location = "global";

    const data = await vertexFetch({
      model,
      location,
      projectId: VERTEX_PROJECT_ID,
      contents,
      systemInstruction,
      generationConfig: {
        temperature: 0.4,
        topP: 0.9,
        maxOutputTokens: 300,
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
      model,
      location,
      projectId: VERTEX_PROJECT_ID,
    });
  } catch (error) {
    console.error("ERROR /api/isabela-montaje-chat:", error);

    return res.status(error?.status || 500).json({
      ok: false,
      error: error?.message || "No se pudo procesar la solicitud.",
      details: error?.details || null,
      model: error?.vertexModel || "gemini-2.5-flash",
      location: error?.vertexLocation || "global",
      projectId: VERTEX_PROJECT_ID,
      vertexUrl: error?.vertexUrl || null,
    });
  }
}
