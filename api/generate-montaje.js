// api/generate-montaje.js
import { requireUser } from "./_auth.js";
import { vertexFetch } from "./_googleVertex.js";

// =====================
// COSTOS (JADE)
// =====================
const COST_MONTAJE_JADES = 8;

// =====================
// SUPABASE JADE HELPERS
// =====================
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
    // no romper si el refund falla
  }
}

// =====================
// TEXT HELPERS
// =====================
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

// =====================
// ISABELA INTERPRETER
// =====================
// Si hay fondo subido, Isabela solo interpreta colocación/integración.
// Si NO hay fondo, Isabela devuelve prompt para generar escena.
async function callIsabelaInterpreter(prompt, hasBackgroundImage) {
  const systemInstruction = `
Eres Isabela, asistente interna del módulo "Montaje IA" de IsabelaOS.

Tu única función es ayudar a montar:
- una persona
- un avatar
- o un producto
dentro de una escena.

Nunca respondas cosas fuera del módulo.
Si el usuario pregunta algo fuera del módulo, responde SOLO este JSON:
{"allowed":false,"reply":"Lo siento, solo puedo ayudarte con funciones relacionadas con este módulo de montaje de imágenes."}

IMPORTANTE:
- Nunca menciones Gemini, Google, Vertex, APIs externas ni proveedores.
- Devuelve SOLO JSON válido.
- No uses markdown.

Si hay fondo subido por el usuario:
devuelve ESTE formato:
{
  "allowed": true,
  "reply": "texto corto para el usuario",
  "mode": "compose_existing_background",
  "subjectType": "person | product",
  "x": 0.5,
  "y": 0.72,
  "scale": 0.55,
  "feather": 12,
  "blendMode": "seamless",
  "colorMatch": true,
  "shadow": true
}

Si NO hay fondo subido:
devuelve ESTE formato:
{
  "allowed": true,
  "reply": "texto corto para el usuario",
  "mode": "generate_background_then_compose",
  "subjectType": "person | product",
  "scenePrompt": "clean English prompt to create a realistic background or full realistic scene"
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

// =====================
// GOOGLE HELPERS (solo cuando NO hay fondo)
// =====================
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

// =====================
// RUNPOD HELPERS (para compose_scene local)
// =====================
function getRunpodConfig() {
  const endpointId = process.env.RUNPOD_ENDPOINT_ID;
  const apiKey = process.env.RUNPOD_API_KEY;

  if (!endpointId || !apiKey) {
    throw new Error("Faltan RUNPOD_ENDPOINT_ID o RUNPOD_API_KEY.");
  }

  return { endpointId, apiKey };
}

async function runpodRun(input) {
  const { endpointId, apiKey } = getRunpodConfig();

  const url = `https://api.runpod.ai/v2/${endpointId}/run`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ input }),
  });

  const data = await r.json().catch(() => null);

  if (!r.ok || !data || data.error) {
    throw new Error(data?.error || "RUNPOD_RUN_FAILED");
  }

  if (!data.id) {
    throw new Error("RUNPOD_NO_JOB_ID");
  }

  return data.id;
}

async function runpodWaitForImage(jobId, maxSeconds = 160) {
  const { endpointId, apiKey } = getRunpodConfig();
  const started = Date.now();

  while (true) {
    if ((Date.now() - started) / 1000 > maxSeconds) {
      throw new Error("RUNPOD_TIMEOUT");
    }

    const url = `https://api.runpod.ai/v2/${endpointId}/status/${jobId}`;
    const r = await fetch(url, {
      headers: {
        authorization: `Bearer ${apiKey}`,
      },
    });

    const data = await r.json().catch(() => null);

    if (!r.ok || !data) {
      throw new Error("RUNPOD_STATUS_FAILED");
    }

    const status = String(data.status || "").toUpperCase();

    if (status === "FAILED" || status === "CANCELLED") {
      throw new Error(data?.output?.error || data?.error || "RUNPOD_FAILED");
    }

    if (status === "COMPLETED") {
      if (data?.output?.error) {
        throw new Error(data.output.error);
      }

      const imageDataUrl =
        data?.output?.image_data_url ||
        data?.output?.data_url ||
        null;

      const imageB64 =
        data?.output?.image_b64 ||
        data?.output?.result_b64 ||
        data?.output?.resultBase64 ||
        data?.output?.image_base64 ||
        data?.output?.image ||
        "";

      if (imageDataUrl) return imageDataUrl;
      if (imageB64) return `data:image/jpeg;base64,${imageB64}`;

      throw new Error("RUNPOD_COMPLETED_WITHOUT_IMAGE");
    }

    await new Promise((r) => setTimeout(r, 1400));
  }
}

// =====================
// MAIN
// =====================
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

    // COBRO
    await spendJadesOrThrow(user_id, COST_MONTAJE_JADES, "generation:montaje_ia", ref);

    // Interpreta con Isabela
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

    // ==========================================================
    // CASO 1: HAY FONDO -> USAR COMPOSITOR LOCAL EXACTO
    // ==========================================================
    if (background_image) {
      const input = {
        action: "compose_scene",

        // imágenes
        fg_image_b64: person_image,
        bg_image_b64: background_image,

        // parámetros interpretados por Isabela
        x: interpreted?.x ?? 0.5,
        y: interpreted?.y ?? 0.72,
        scale: interpreted?.scale ?? 0.55,
        feather: interpreted?.feather ?? 12,
        mode: interpreted?.blendMode || "seamless",
        color_match:
          typeof interpreted?.colorMatch === "boolean" ? interpreted.colorMatch : true,
        shadow:
          typeof interpreted?.shadow === "boolean" ? interpreted.shadow : true,
      };

      const jobId = await runpodRun(input);
      const image_data_url = await runpodWaitForImage(jobId, 180);

      return res.status(200).json({
        ok: true,
        jobId,
        billed: { type: "JADE", amount: COST_MONTAJE_JADES },
        image_data_url,
        isabela_reply:
          interpreted?.reply || "Listo. Preparé tu montaje usando el fondo que subiste.",
      });
    }

    // ==========================================================
    // CASO 2: NO HAY FONDO -> USAR GOOGLE PARA GENERAR ESCENA
    // ==========================================================
    let finalPrompt = interpreted?.scenePrompt || "";
    const subjectType =
      interpreted?.subjectType === "product"
        ? "SUBJECT_TYPE_PRODUCT"
        : "SUBJECT_TYPE_PERSON";

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
      ((pred?.mimeType && pred?.bytesBase64Encoded) ? pred.bytesBase64Encoded : null) ||
      pred?.image?.bytesBase64Encoded ||
      "";

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
        interpreted?.reply || "Listo. Preparé tu montaje.",
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
