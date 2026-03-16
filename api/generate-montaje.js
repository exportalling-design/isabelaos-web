// api/generate-montaje.js
import { vertexFetch, GOOGLE_PROJECT_ID } from "./_googleVertex.js";

const MONTAJE_VERTEX_MODEL = "gemini-2.5-flash";
const MONTAJE_VERTEX_LOCATION = "global";

function fileToInlinePart(file, fallbackMime = "image/jpeg") {
  if (!file?.base64) return null;

  return {
    inlineData: {
      mimeType: file.mimeType || fallbackMime,
      data: file.base64,
    },
  };
}

function getPromptFromBody(body) {
  return (
    body?.prompt ||
    body?.message ||
    body?.description ||
    body?.instructions ||
    ""
  ).trim();
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

    const prompt = getPromptFromBody(body);

    const mainImage =
      body?.mainImage ||
      body?.subjectImage ||
      body?.image ||
      null;

    const backgroundImage =
      body?.backgroundImage ||
      body?.bgImage ||
      body?.sceneImage ||
      null;

    if (!prompt) {
      return res.status(400).json({
        ok: false,
        error: "Falta la descripción del montaje.",
      });
    }

    if (!mainImage?.base64) {
      return res.status(400).json({
        ok: false,
        error: "Falta la imagen principal.",
      });
    }

    const parts = [
      {
        text: [
          "Eres una asistente de composición visual para IsabelaOS Studio.",
          "Tu tarea es analizar la imagen principal y, si existe, la imagen de fondo.",
          "Debes devolver una respuesta JSON simple y útil para crear el montaje.",
          "No generes markdown.",
          "No expliques de más.",
          "Devuelve únicamente JSON válido.",
          "",
          "Formato exacto esperado:",
          "{",
          '  "ok": true,',
          '  "understood_prompt": "texto corto",',
          '  "subject_description": "descripción visual del sujeto",',
          '  "scene_description": "descripción visual de la escena final",',
          '  "edit_plan": ["paso 1", "paso 2", "paso 3"],',
          '  "final_prompt": "prompt final en inglés para generar o editar la imagen"',
          "}",
          "",
          `Solicitud del usuario: ${prompt}`,
        ].join("\n"),
      },
      fileToInlinePart(mainImage, "image/jpeg"),
    ].filter(Boolean);

    if (backgroundImage?.base64) {
      parts.push(fileToInlinePart(backgroundImage, "image/jpeg"));
    }

    const data = await vertexFetch({
      model: MONTAJE_VERTEX_MODEL,
      location: MONTAJE_VERTEX_LOCATION,
      projectId: GOOGLE_PROJECT_ID,
      contents: [
        {
          role: "user",
          parts,
        },
      ],
      generationConfig: {
        temperature: 0.4,
        topP: 0.9,
        maxOutputTokens: 1200,
      },
    });

    const rawText =
      data?.candidates?.[0]?.content?.parts?.map((p) => p?.text || "").join("\n").trim() ||
      "";

    let parsed = null;

    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = {
        ok: true,
        understood_prompt: prompt,
        subject_description: "",
        scene_description: "",
        edit_plan: [],
        final_prompt: rawText,
      };
    }

    return res.status(200).json({
      ok: true,
      analysis: parsed,
      raw: data,
      model: MONTAJE_VERTEX_MODEL,
      location: MONTAJE_VERTEX_LOCATION,
      projectId: GOOGLE_PROJECT_ID,
    });
  } catch (error) {
    console.error("ERROR /api/generate-montaje:", error);

    return res.status(error?.status || 500).json({
      ok: false,
      error: error?.message || "No se pudo generar el montaje.",
      details: error?.details || null,
      model: error?.vertexModel || MONTAJE_VERTEX_MODEL,
      location: error?.vertexLocation || MONTAJE_VERTEX_LOCATION,
      vertexUrl: error?.vertexUrl || null,
      projectId: GOOGLE_PROJECT_ID,
    });
  }
}
