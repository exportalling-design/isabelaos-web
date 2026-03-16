// api/isabela-montaje-chat.js
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
      "Debes responder siempre en JSON válido con este formato:",
      "{",
      '  "ok": true,',
      '  "allowed": true,',
      '  "reply": "respuesta breve en español para el usuario",',
      '  "need_person_image": false,',
      '  "need_background_image": false,',
      '  "scene_mode": "uploaded_background|generated_scene",',
      '  "understood_intent": "resumen corto",',
      '  "final_prompt": "prompt final en inglés para el endpoint"',
      "}",
      "",
      "Reglas:",
      "- No pidas imagen principal si ya existe.",
      "- No pidas fondo si el usuario no lo necesita.",
      "- Si hay fondo subido, usa scene_mode=uploaded_background.",
      "- Si no hay fondo subido, usa scene_mode=generated_scene.",
      "- reply debe ser útil y natural.",
      "- final_prompt debe ser claro y listo para pasar al endpoint de generación.",
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

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = {
        ok: true,
        allowed: true,
        reply: rawText || "Entendido. Si está correcto, genera el montaje.",
        need_person_image: !hasPersonImage,
        need_background_image: false,
        scene_mode: hasBackgroundImage
          ? "uploaded_background"
          : "generated_scene",
        understood_intent: message,
        final_prompt: message,
      };
    }

    return res.status(200).json({
      ok: true,
      allowed: parsed?.allowed !== false,
      reply: parsed?.reply || "Entendido. Si está correcto, genera el montaje.",
      need_person_image: !!parsed?.need_person_image,
      need_background_image: !!parsed?.need_background_image,
      scene_mode:
        parsed?.scene_mode ||
        (hasBackgroundImage ? "uploaded_background" : "generated_scene"),
      understood_intent: parsed?.understood_intent || message,
      final_prompt: parsed?.final_prompt || message,
      raw: parsed,
      model: MONTAJE_VERTEX_MODEL,
      location: MONTAJE_VERTEX_LOCATION,
      projectId: GOOGLE_PROJECT_ID,
    });
  } catch (error) {
    console.error("ERROR /api/isabela-montaje-chat:", error);

    return res.status(error?.status || 500).json({
      ok: false,
      error: error?.message || "No se pudo interpretar la solicitud.",
      details: error?.details || null,
      model: error?.vertexModel || MONTAJE_VERTEX_MODEL,
      location: error?.vertexLocation || MONTAJE_VERTEX_LOCATION,
      vertexUrl: error?.vertexUrl || null,
      projectId: GOOGLE_PROJECT_ID,
    });
  }
}
