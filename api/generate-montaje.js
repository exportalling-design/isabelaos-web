// api/generate-montaje.js
// ─────────────────────────────────────────────────────────────
// Generación de montaje IA.
//
// FLUJO A — gemini_edit (ACTIVO):
//   Edita la imagen directamente con Gemini 2.0 Flash.
//   Soporta: cartoonizar, estilo studio, agregar personas,
//   cambiar fondo con IA, mejorar foto, etc.
//   Devuelve imagen base64 en la respuesta JSON.
//
// FLUJO B — compose_scene (PENDIENTE RunPod):
//   Recorta con rembg y monta sobre fondo real.
//   Activar cuando rp_handler.py esté deployado.
// ─────────────────────────────────────────────────────────────
import { GOOGLE_PROJECT_ID } from "./_googleVertex.js";
import { requireUser } from "./_auth.js";
import { createClient } from "@supabase/supabase-js";

// ── Supabase admin para descontar jades ──────────────────────
function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("MISSING_SUPABASE_ENV");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ── Costo en Jades por tipo de edición ──────────────────────
const JADE_COSTS = {
  gemini_edit:    5,   // Edición con Gemini
  compose_scene:  8,   // Composición profesional (futuro)
};

// ── Llamada directa a Gemini con soporte de imagen de salida ─
// Usamos la API de Vertex AI con responseModalities para obtener
// imagen generada directamente en base64
async function callGeminiWithImageOutput({ prompt, personImageBase64, personMimeType, backgroundImageBase64, backgroundMimeType }) {
  const accessToken = await getGoogleAccessToken();
  // Para location=global la URL base cambia a aiplatform.googleapis.com (sin prefijo regional)
  const baseHost = LOCATION === "global"
    ? "https://aiplatform.googleapis.com"
    : `https://${LOCATION}-aiplatform.googleapis.com`;
  const url = `${baseHost}/v1/projects/${GOOGLE_PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`;

  // Construir partes de la imagen
  const imageParts = [
    {
      inlineData: {
        mimeType: personMimeType || "image/jpeg",
        data:     personImageBase64,
      },
    },
  ];

  if (backgroundImageBase64) {
    imageParts.push({
      inlineData: {
        mimeType: backgroundMimeType || "image/jpeg",
        data:     backgroundImageBase64,
      },
    });
  }

  const body = {
    contents: [
      {
        role:  "user",
        parts: [
          ...imageParts,
          { text: prompt },
        ],
      },
    ],
    generationConfig: {
      temperature:      0.4,
      topP:             0.9,
      maxOutputTokens:  4096,
      responseModalities: ["TEXT", "IMAGE"], // Solicitar imagen de vuelta
    },
  };

  const r = await fetch(url, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      Authorization:   `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Gemini API error ${r.status}: ${txt.slice(0, 300)}`);
  }

  return r.json();
}

// ── Obtener access token de Google ───────────────────────────
async function getGoogleAccessToken() {
  const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
                          process.env.VERTEX_AI_CREDENTIALS;
  if (!credentialsJson) throw new Error("MISSING_GOOGLE_CREDENTIALS");

  const credentials = JSON.parse(credentialsJson);
  const now         = Math.floor(Date.now() / 1000);

  // JWT para Google OAuth2
  const header  = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss:   credentials.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud:   "https://oauth2.googleapis.com/token",
    iat:   now,
    exp:   now + 3600,
  };

  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const signingInput = `${encode(header)}.${encode(payload)}`;

  const { createSign } = await import("crypto");
  const sign    = createSign("RSA-SHA256");
  sign.update(signingInput);
  const signature = sign.sign(credentials.private_key, "base64url");
  const jwt       = `${signingInput}.${signature}`;

  const tokenRes  = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion:  jwt,
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error("No se pudo obtener access token de Google.");
  return tokenData.access_token;
}

// ── Extraer imagen base64 de la respuesta de Gemini ──────────
function extractImageFromGeminiResponse(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part?.inlineData?.data) {
      return {
        base64:   part.inlineData.data,
        mimeType: part.inlineData.mimeType || "image/jpeg",
      };
    }
  }
  return null;
}

function extractTextFromGeminiResponse(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.filter((p) => p?.text).map((p) => p.text).join("\n").trim();
}

const MODEL    = "gemini-2.5-flash-image-preview";
const LOCATION = "global";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    // ── Auth ─────────────────────────────────────────────────
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    const user = auth.user;

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

    const editType             = String(body?.edit_type || "gemini_edit");
    const prompt               = String(body?.final_prompt || body?.prompt || "").trim();
    const personImageBase64    = body?.person_image || null;
    const personMimeType       = body?.person_mime_type || "image/jpeg";
    const backgroundImageBase64 = body?.background_image || null;
    const backgroundMimeType   = body?.background_mime_type || "image/jpeg";

    if (!prompt)           return res.status(400).json({ ok: false, error: "MISSING_PROMPT" });
    if (!personImageBase64) return res.status(400).json({ ok: false, error: "MISSING_PERSON_IMAGE" });

    // ── Verificar Jades ───────────────────────────────────────
    const jadeCost = JADE_COSTS[editType] || JADE_COSTS.gemini_edit;
    const sb       = getSupabaseAdmin();
    const ref      = `montaje-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const { error: spendErr } = await sb.rpc("spend_jades", {
      p_user_id: user.id,
      p_amount:  jadeCost,
      p_reason:  `montaje_${editType}`,
      p_ref:     ref,
    });

    if (spendErr) {
      if ((spendErr.message || "").includes("INSUFFICIENT_JADES")) {
        return res.status(402).json({ ok: false, error: "INSUFFICIENT_JADES",
          detail: `Necesitas ${jadeCost} jades para este montaje.`, required: jadeCost });
      }
      return res.status(400).json({ ok: false, error: "JADE_CHARGE_FAILED", detail: spendErr.message });
    }

    console.log(`[generate-montaje] user=${user.id} type=${editType} cost=${jadeCost}J`);

    // ── FLUJO A: Gemini edit (ACTIVO) ─────────────────────────
    if (editType === "gemini_edit") {
      // Construir prompt enriquecido para Gemini
      const enrichedPrompt = [
        "You are a professional photo editor.",
        "Edit the provided image according to these instructions:",
        prompt,
        "",
        "Requirements:",
        "- Maintain photorealistic quality",
        "- Keep natural lighting and shadows",
        "- Output a high quality edited image",
        "- Return ONLY the edited image, no text explanation needed",
      ].join("\n");

      const geminiData = await callGeminiWithImageOutput({
        prompt:               enrichedPrompt,
        personImageBase64,
        personMimeType,
        backgroundImageBase64,
        backgroundMimeType,
      });

      const imageResult = extractImageFromGeminiResponse(geminiData);
      const textResult  = extractTextFromGeminiResponse(geminiData);

      console.log(`[generate-montaje] gemini result: hasImage=${!!imageResult} text=${textResult?.slice(0, 100)}`);

      if (!imageResult) {
        // Gemini no devolvió imagen — puede que el prompt no sea de edición de imagen
        return res.status(422).json({
          ok:    false,
          error: "GEMINI_NO_IMAGE_OUTPUT",
          detail: "Gemini no generó una imagen. Intenta ser más específico en tu instrucción.",
          gemini_text: textResult || "",
        });
      }

      return res.status(200).json({
        ok:        true,
        mode:      "gemini_edit",
        image_b64: imageResult.base64,
        mime_type: imageResult.mimeType,
        jade_cost: jadeCost,
        ref,
      });
    }

    // ── FLUJO B: compose_scene (PENDIENTE RunPod) ─────────────
    if (editType === "compose_scene") {
      // TODO: cuando rp_handler.py esté deployado, conectar aquí
      // Por ahora devolver error claro
      return res.status(503).json({
        ok:    false,
        error: "COMPOSE_SCENE_UNAVAILABLE",
        detail: "La composición profesional está en mantenimiento. Usa edición con IA mientras tanto.",
      });
    }

    return res.status(400).json({ ok: false, error: "INVALID_EDIT_TYPE", edit_type: editType });

  } catch (e) {
    console.error("[generate-montaje] SERVER_ERROR:", e?.message || e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", detail: String(e?.message || e) });
  }
}

export const config = { runtime: "nodejs" };

