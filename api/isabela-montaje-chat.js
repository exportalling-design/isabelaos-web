import {
  vertexFetch,
  extractTextFromVertexResponse,
  GOOGLE_PROJECT_ID,
} from "./_googleVertex.js";

const MONTAJE_VERTEX_MODEL = "gemini-2.5-flash";
const MONTAJE_VERTEX_LOCATION = "global";

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

function buildContents({ message, chatHistory, contextText }) {
  const history = normalizeHistory(chatHistory);

  if (contextText) {
    history.unshift({
      role: "user",
      parts: [{ text: contextText }],
    });
  }

  if (message?.trim()) {
    history.push({
      role: "user",
      parts: [{ text: message.trim() }],
    });
  }

  return history;
}

// 🔥 Limpia JSON aunque venga sucio
function safeParseJSON(text) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

// 🔥 ESTA ES LA CLAVE (lo que te faltaba)
function extractHumanText(obj) {
  if (!obj || typeof obj !== "object") return "";

  const priorityKeys = [
    "reply",
    "respuesta",
    "message",
    "mensaje",
    "greeting",
    "saludo",
    "next_step_instruction",
    "instruccion_siguiente",
    "understanding_confirmation",
    "confirmacion_entendimiento",
    "necesidad_informacion",
  ];

  // 1. busca claves importantes
  for (const key of priorityKeys) {
    if (typeof obj[key] === "string" && obj[key].trim()) {
      return obj[key].trim();
    }
  }

  // 2. busca dentro de objetos anidados
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const nested = extractHumanText(value);
      if (nested) return nested;
    }
  }

  // 3. fallback: junta todos los strings
  const values = Object.values(obj)
    .filter((v) => typeof v === "string" && v.trim())
    .map((v) => v.trim());

  if (values.length) {
    return values.join(" ");
  }

  return "";
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
    const chatHistory = body?.chatHistory || [];

    if (!message) {
      return res.status(400).json({
        ok: false,
        error: "Falta el mensaje del usuario.",
      });
    }

    const hasPersonImage = !!body?.hasPersonImage;
    const hasBackgroundImage = !!body?.hasBackgroundImage;

    const contextText = [
      "CONTEXTO DEL MÓDULO:",
      "- Este módulo es para montaje visual.",
      "- Si hay imagen principal, el sujeto ya fue subido.",
      "- Si hay imagen de fondo, el montaje debe colocarse sobre ese fondo exacto.",
      "- Si no hay fondo, la escena se debe inferir desde el texto del usuario.",
      "- Tu trabajo es conversar, confirmar lo entendido y proponer un final_prompt útil para el endpoint.",
      `- Hay imagen principal subida: ${hasPersonImage ? "sí" : "no"}`,
      `- Hay fondo subido: ${hasBackgroundImage ? "sí" : "no"}`,
      "",
      "Responde SIEMPRE en JSON válido.",
    ].join("\n");

    const contents = buildContents({
      message,
      chatHistory,
      contextText,
    });

    const data = await vertexFetch({
      model: MONTAJE_VERTEX_MODEL,
      location: MONTAJE_VERTEX_LOCATION,
      projectId: GOOGLE_PROJECT_ID,
      contents,
      generationConfig: {
        temperature: 0.35,
        topP: 0.9,
        maxOutputTokens: 900,
      },
    });

    const rawText = extractTextFromVertexResponse(data);
    const parsed = safeParseJSON(rawText);

    // 🔥 AQUÍ ESTÁ EL FIX REAL
    const reply =
      extractHumanText(parsed) ||
      (typeof rawText === "string" ? rawText.trim() : "") ||
      "Entendido. Si está correcto, genera el montaje.";

    return res.status(200).json({
      ok: true,
      allowed: parsed?.allowed !== false,
      reply: String(reply),
      need_person_image: !!parsed?.need_person_image,
      need_background_image: !!parsed?.need_background_image,
      scene_mode:
        parsed?.scene_mode ||
        (hasBackgroundImage ? "uploaded_background" : "generated_scene"),
      understood_intent:
        parsed?.understood_intent ||
        parsed?.intent ||
        parsed?.intencion ||
        message,
      final_prompt: parsed?.final_prompt || message,
    });
  } catch (error) {
    console.error("ERROR /api/isabela-montaje-chat:", error);

    return res.status(error?.status || 500).json({
      ok: false,
      error: error?.message || "No se pudo interpretar la solicitud.",
    });
  }
}
