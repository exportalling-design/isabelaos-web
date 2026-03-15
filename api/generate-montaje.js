// api/generate-montaje.js
import { requireUser } from "./_auth.js";
import { vertexFetch } from "./_googleVertex.js";

// =====================
// COSTOS (JADE)
// =====================
const COST_MONTAJE_JADES = 8;

async function spendJadesOrThrow(user_id, amount, reason, ref = null) {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  const rpcUrl = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/spend_jades`;

  const r = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_user_id: user_id,
      p_amount: amount,
      p_reason: reason,
      p_ref: ref,
    }),
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    if ((t || "").includes("INSUFFICIENT_JADES")) {
      const err = new Error("INSUFFICIENT_JADES");
      err.code = 402;
      throw err;
    }
    const err = new Error("RPC_SPEND_JADES_ERROR: " + t.slice(0, 300));
    err.code = 500;
    throw err;
  }

  return true;
}

async function refundJadesSafe(user_id, amount, reason, ref = null) {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const rpcUrl = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/refund_jades`;

    await fetch(rpcUrl, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_user_id: user_id,
        p_amount: amount,
        p_reason: reason,
        p_ref: ref,
      }),
    });
  } catch {
    // no explotar si el refund falla
  }
}

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

async function callIsabelaInterpreter(prompt, hasBackgroundImage) {
  const systemInstruction = `
Eres Isabela, asistente interna del módulo Montaje IA de IsabelaOS.
Tu salida debe ser SOLO JSON válido.
No uses markdown.

Devuelve:
{
  "allowed": true,
  "reply": "texto corto para el usuario",
  "subjectType": "person | product",
  "scenePrompt": "prompt visual final en inglés, limpio y detallado para crear una escena realista",
  "needsBackground": true/false
}

Si el mensaje no pertenece al módulo, devuelve:
{"allowed":false,"reply":"Lo siento, solo puedo ayudarte con funciones relacionadas con este módulo de montaje de imágenes."}
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
            text: `Instrucción del usuario: ${prompt}
Hay fondo subido: ${hasBackgroundImage ? "sí" : "no"}`,
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

  return safeParseJson(extractText(data));
}

async function describeBackgroundImage(backgroundB64) {
  const body = {
    systemInstruction: {
      parts: [
        {
          text:
            "Describe this background image in one short English sentence for image generation. Only return plain text. Focus on place, lighting, atmosphere, camera perspective. No markdown.",
        },
      ],
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: "image/png",
              data: backgroundB64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
    },
  };

  const data = await vertexFetch(
    `/publishers/google/models/gemini-2.0-flash:generateContent`,
    body
  );

  return extractText(data);
}

export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  let user_id = null;
  let ref = null;

  try {
    const auth = await requireUser(req);
    if (!auth.ok) {
      return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    }

    user_id = auth.user.id;

    const body = req.body || {};
    const person_image = body.person_image;
    const background_image = body.background_image || null;
    const userPrompt = String(body.prompt || "").trim();
    ref = body.ref || `montajeia-${Date.now()}`;

    if (!person_image) {
      return res.status(400).json({
        ok: false,
        error: "Debes enviar person_image.",
      });
    }

    if (!userPrompt) {
      return res.status(400).json({
        ok: false,
        error: "Debes escribir una instrucción para Isabela.",
      });
    }

    await spendJadesOrThrow(user_id, COST_MONTAJE_JADES, "generation:montaje_ia", ref);

    const interpreted = await callIsabelaInterpreter(userPrompt, !!background_image);

    if (!interpreted?.allowed) {
      await refundJadesSafe(user_id, COST_MONTAJE_JADES, "refund:montaje_ia_not_allowed", ref);
      return res.status(200).json({
        ok: false,
        error:
          interpreted?.reply ||
          "Lo siento, solo puedo ayudarte con funciones relacionadas con este módulo de montaje de imágenes.",
      });
    }

    let finalPrompt = interpreted.scenePrompt || "";
    let subjectType = interpreted.subjectType === "product" ? "SUBJECT_TYPE_PRODUCT" : "SUBJECT_TYPE_PERSON";

    if (background_image) {
      const bgDescription = await describeBackgroundImage(background_image);
      finalPrompt = `${finalPrompt}. Use a realistic scene matching this uploaded background: ${bgDescription}. Keep the subject natural, well integrated, realistic lighting, realistic scale, photo realism.`;
    }

    const imagenBody = {
      instances: [
        {
          prompt: finalPrompt,
          referenceImages: [
            {
              referenceType: "REFERENCE_TYPE_SUBJECT",
              referenceId: 1,
              referenceImage: {
                bytesBase64Encoded: person_image,
              },
              subjectImageConfig: {
                subjectDescription:
                  subjectType === "SUBJECT_TYPE_PRODUCT"
                    ? "main product"
                    : "main person",
                subjectType,
              },
            },
          ],
        },
      ],
      parameters: {
        sampleCount: 1,
        language: "en",
        addWatermark: false,
        outputOptions: {
          mimeType: "image/jpeg",
          compressionQuality: 92,
        },
      },
    };

    const imagenResp = await vertexFetch(
      `/publishers/google/models/imagen-3.0-capability-001:predict`,
      imagenBody
    );

    const pred = imagenResp?.predictions?.[0] || {};
    const imageB64 =
      pred?.bytesBase64Encoded ||
      pred?.mimeType && pred?.bytesBase64Encoded
        ? pred.bytesBase64Encoded
        : pred?.image?.bytesBase64Encoded || "";

    if (!imageB64) {
      await refundJadesSafe(user_id, COST_MONTAJE_JADES, "refund:montaje_ia_no_image", ref);
      return res.status(500).json({
        ok: false,
        error: "No pude completar el montaje con esas imágenes.",
      });
    }

    return res.status(200).json({
      ok: true,
      jobId: `google-sync-${Date.now()}`,
      billed: { type: "JADE", amount: COST_MONTAJE_JADES },
      image_data_url: `data:image/jpeg;base64,${imageB64}`,
      isabela_reply:
        interpreted.reply || "Listo. Preparé tu montaje.",
    });
  } catch (err) {
    if (user_id && ref) {
      await refundJadesSafe(user_id, COST_MONTAJE_JADES, "refund:montaje_ia_failed", ref);
    }

    return res.status(500).json({
      ok: false,
      error: "Lo siento, no pude generar el montaje. Intenta cambiar las imágenes o la descripción.",
      detail: err?.message || String(err),
    });
  }
}
