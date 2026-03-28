// api/generate-montaje.js
// ─────────────────────────────────────────────────────────────
// Generación de montaje IA con Gemini 2.5 Flash Image.
//
// Usa GOOGLE_API_KEY (Google AI Studio) directamente.
// NO usa Vertex AI para no interferir con Veo3/GOOGLE_LOCATION.
//
// FLUJO A — gemini_edit (ACTIVO):
//   Edita imagen con Gemini 2.5 Flash Image.
//   Soporta: cartoonizar, estilo studio, agregar personas,
//   cambiar fondo con IA, mejorar foto, etc.
//   Devuelve imagen base64 en la respuesta JSON.
//
// FLUJO B — compose_scene (PENDIENTE RunPod):
//   Recorta con rembg y monta sobre fondo real.
//   Activar cuando rp_handler.py esté deployado.
// ─────────────────────────────────────────────────────────────
import { requireUser } from "./_auth.js";
import { createClient } from "@supabase/supabase-js";
 
// ── Modelo para edición de imágenes ──────────────────────────
// Usa Google AI Studio API (generativelanguage.googleapis.com)
// NO usa Vertex AI — eso es solo para Veo3
const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image-preview";
const GEMINI_API_BASE    = "https://generativelanguage.googleapis.com/v1beta";
 
// ── Supabase admin ────────────────────────────────────────────
function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("MISSING_SUPABASE_ENV");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
 
// ── Costos en Jades ───────────────────────────────────────────
const JADE_COSTS = {
  gemini_edit:   5,
  compose_scene: 8,
};
 
// ── Llamada a Gemini con imagen de salida ─────────────────────
async function callGeminiImageEdit({ prompt, personImageBase64, personMimeType, backgroundImageBase64, backgroundMimeType }) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("MISSING_GEMINI_API_KEY — agrega GEMINI_API_KEY en Vercel");
 
  const url = `${GEMINI_API_BASE}/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`;
 
  // Construir partes — primero imagen(s), luego el texto
  const parts = [];
 
  parts.push({
    inline_data: {
      mime_type: personMimeType || "image/jpeg",
      data:      personImageBase64,
    },
  });
 
  if (backgroundImageBase64) {
    parts.push({
      inline_data: {
        mime_type: backgroundMimeType || "image/jpeg",
        data:      backgroundImageBase64,
      },
    });
  }
 
  parts.push({ text: prompt });
 
  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      temperature:        0.4,
      topP:               0.9,
    },
  };
 
  console.log(`[generate-montaje] llamando Gemini Image API con modelo ${GEMINI_IMAGE_MODEL}`);
 
  const r = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
 
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Gemini API error ${r.status}: ${txt.slice(0, 400)}`);
  }
 
  return r.json();
}
 
// ── Extraer imagen de la respuesta ────────────────────────────
function extractImageFromResponse(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part?.inlineData?.data || part?.inline_data?.data) {
      const pd = part.inlineData || part.inline_data;
      return { base64: pd.data, mimeType: pd.mimeType || pd.mime_type || "image/jpeg" };
    }
  }
  return null;
}
 
function extractTextFromResponse(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.filter((p) => p?.text).map((p) => p.text).join("\n").trim();
}
 
// ── Handler principal ─────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
 
  try {
    // Auth
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    const user = auth.user;
 
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
 
    const editType              = String(body?.edit_type || "gemini_edit");
    const prompt                = String(body?.final_prompt || body?.prompt || "").trim();
    const personImageBase64     = body?.person_image || null;
    const personMimeType        = body?.person_mime_type || "image/jpeg";
    const backgroundImageBase64 = body?.background_image || null;
    const backgroundMimeType    = body?.background_mime_type || "image/jpeg";
 
    if (!prompt)            return res.status(400).json({ ok: false, error: "MISSING_PROMPT" });
    if (!personImageBase64) return res.status(400).json({ ok: false, error: "MISSING_PERSON_IMAGE" });
 
    // Descontar Jades
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
        return res.status(402).json({
          ok: false, error: "INSUFFICIENT_JADES",
          detail: `Necesitas ${jadeCost} jades para este montaje.`,
          required: jadeCost,
        });
      }
      return res.status(400).json({ ok: false, error: "JADE_CHARGE_FAILED", detail: spendErr.message });
    }
 
    console.log(`[generate-montaje] user=${user.id} type=${editType} cost=${jadeCost}J`);
 
    // ── FLUJO A: Gemini edit ──────────────────────────────────
    if (editType === "gemini_edit") {
      const enrichedPrompt = [
        "You are a professional photo editor.",
        "Edit the provided image according to these instructions:",
        prompt,
        "",
        "Requirements:",
        "- Maintain photorealistic quality",
        "- Keep natural lighting and shadows",
        "- Return ONLY the edited image",
      ].join("\n");
 
      const geminiData  = await callGeminiImageEdit({
        prompt: enrichedPrompt,
        personImageBase64, personMimeType,
        backgroundImageBase64, backgroundMimeType,
      });
 
      const imageResult = extractImageFromResponse(geminiData);
      const textResult  = extractTextFromResponse(geminiData);
 
      console.log(`[generate-montaje] hasImage=${!!imageResult} text=${textResult?.slice(0, 80)}`);
 
      if (!imageResult) {
        return res.status(422).json({
          ok:    false,
          error: "GEMINI_NO_IMAGE_OUTPUT",
          detail: "Gemini no generó una imagen. Intenta ser más específico.",
          gemini_text: textResult || "",
        });
      }
 
      // Subir imagen a Storage y guardar URL en biblioteca del usuario
      try {
        const sb2    = getSupabaseAdmin();
        const mime   = imageResult.mimeType || "image/jpeg";
        const ext    = mime.includes("png") ? "png" : "jpg";
        const fname  = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const path   = `${user.id}/${fname}`;
 
        // Convertir base64 a Buffer
        const imgBuffer = Buffer.from(imageResult.base64, "base64");
 
        const { error: upErr } = await sb2.storage
          .from("generations")
          .upload(path, imgBuffer, { contentType: mime, upsert: false });
 
        let imageUrl = `data:${mime};base64,${imageResult.base64}`; // fallback
        if (!upErr) {
          const { data: pub } = sb2.storage.from("generations").getPublicUrl(path);
          if (pub?.publicUrl) imageUrl = pub.publicUrl;
        }
 
        await sb2.from("generations").insert({
          user_id:         user.id,
          image_url:       imageUrl,
          prompt:          prompt,
          negative_prompt: "",
          width:           0,
          height:          0,
          steps:           0,
        });
        console.log("[generate-montaje] imagen guardada en biblioteca:", imageUrl.slice(0, 60));
      } catch (saveErr) {
        console.error("[generate-montaje] error guardando en biblioteca:", saveErr?.message);
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
 
    // ── FLUJO B: compose_scene (pendiente RunPod) ─────────────
    if (editType === "compose_scene") {
      return res.status(503).json({
        ok:    false,
        error: "COMPOSE_SCENE_UNAVAILABLE",
        detail: "La composición profesional está en mantenimiento.",
      });
    }
 
    return res.status(400).json({ ok: false, error: "INVALID_EDIT_TYPE" });
 
  } catch (e) {
    console.error("[generate-montaje] SERVER_ERROR:", e?.message || e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", detail: String(e?.message || e) });
  }
}
 
export const config = { runtime: "nodejs" };
