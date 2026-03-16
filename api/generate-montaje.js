// api/generate-montaje.js
import { vertexFetch, GOOGLE_PROJECT_ID } from "./_googleVertex.js";

const MONTAJE_VERTEX_MODEL = "gemini-2.5-flash";
const MONTAJE_VERTEX_LOCATION = "global";

function getPromptFromBody(body) {
  return (
    body?.isabelaPlan?.final_prompt ||
    body?.isabelaPlan?.raw?.final_prompt ||
    body?.prompt ||
    body?.message ||
    body?.description ||
    body?.instructions ||
    ""
  ).trim();
}

function normalizeBase64Image(base64, mimeType = "image/jpeg") {
  if (!base64) return null;

  return {
    inlineData: {
      mimeType,
      data: base64,
    },
  };
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

    const personImageBase64 =
      body?.person_image ||
      body?.mainImage?.base64 ||
      body?.subjectImage?.base64 ||
      body?.image?.base64 ||
      null;

    const personMimeType =
      body?.mainImage?.mimeType ||
      body?.subjectImage?.mimeType ||
      body?.image?.mimeType ||
      "image/jpeg";

    const backgroundImageBase64 =
      body?.background_image ||
      body?.backgroundImage?.base64 ||
      body?.bgImage?.base64 ||
      body?.sceneImage?.base64 ||
      null;

    const backgroundMimeType =
      body?.backgroundImage?.mimeType ||
      body?.bgImage?.mimeType ||
      body?.sceneImage?.mimeType ||
      "image/jpeg";

    if (!prompt) {
      return res.status(400).json({
        ok: false,
        error: "Falta la instrucción o prompt del montaje.",
      });
    }

    if (!personImageBase64) {
      return res.status(400).json({
        ok: false,
        error: "Falta la imagen principal.",
      });
    }

    const montajeMode =
      backgroundImageBase64 || body?.isabelaPlan?.scene_mode === "uploaded_background"
        ? "uploaded_background"
        : "generated_scene";

    // Vertex aquí SOLO interpreta y deja plan/prompt limpio.
    const parts = [
      {
        text: [
          "You are a visual montage planning assistant for IsabelaOS Studio.",
          "You are NOT the compositor. The real montage is executed by the server endpoint.",
          "Your task is only to produce a clean final prompt and composition plan.",
          "",
          `Montage mode: ${montajeMode}`,
          montageMode === "uploaded_background"
            ? "Use the uploaded background as the exact target scene."
            : "No uploaded background exists. Infer the final scene from the prompt.",
          "",
          "Return JSON only:",
          "{",
          '  "ok": true,',
          '  "scene_mode": "uploaded_background|generated_scene",',
          '  "subject_description": "short visual description",',
          '  "scene_description": "short scene description",',
          '  "edit_plan": ["step 1", "step 2", "step 3"],',
          '  "final_prompt": "final English prompt for the montage pipeline"',
          "}",
          "",
          `User request: ${prompt}`,
        ].join("\n"),
      },
      normalizeBase64Image(personImageBase64, personMimeType),
    ].filter(Boolean);

    if (backgroundImageBase64) {
      parts.push(normalizeBase64Image(backgroundImageBase64, backgroundMimeType));
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
        temperature: 0.3,
        topP: 0.9,
        maxOutputTokens: 1200,
      },
    });

    const rawText =
      data?.candidates?.[0]?.content?.parts
        ?.map((p) => p?.text || "")
        .join("\n")
        .trim() || "";

    let analysis;
    try {
      analysis = JSON.parse(rawText);
    } catch {
      analysis = {
        ok: true,
        scene_mode: montajeMode,
        subject_description: "",
        scene_description: "",
        edit_plan: [],
        final_prompt: rawText || prompt,
      };
    }

    const finalPrompt = analysis?.final_prompt || prompt;

    // Aquí decides el flujo real del montaje.
    // Más adelante aquí conectas:
    // - tu endpoint serverless propio de composición
    // - o RunPod / worker
    // - o montaje local exacto con fondo subido
    //
    // Por ahora devolvemos el plan completo listo para ejecutar.

    return res.status(200).json({
      ok: true,
      mode: montajeMode,
      finalPrompt,
      analysis,
      received: {
        hasPersonImage: !!personImageBase64,
        hasBackgroundImage: !!backgroundImageBase64,
      },
      model: MONTAJE_VERTEX_MODEL,
      location: MONTAJE_VERTEX_LOCATION,
      projectId: GOOGLE_PROJECT_ID,
    });
  } catch (error) {
    console.error("ERROR /api/generate-montaje:", error);

    return res.status(error?.status || 500).json({
      ok: false,
      error: error?.message || "ERROR_GENERATION",
      details: error?.details || null,
      model: error?.vertexModel || MONTAJE_VERTEX_MODEL,
      location: error?.vertexLocation || MONTAJE_VERTEX_LOCATION,
      vertexUrl: error?.vertexUrl || null,
      projectId: GOOGLE_PROJECT_ID,
    });
  }
}
