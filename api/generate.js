// api/generate.js  (NODEJS)
// Envía job a RunPod Serverless (FLUX) y regresa jobId
// ✅ Cobra 1 jade usando supabaseAdmin.rpc("spend_jades")
// ✅ NUEVO: acepta avatar seleccionado (id / trigger / lora_path)
// ✅ NO rompe tu flujo actual

import { supabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

function normalizeText(v) {
  return String(v || "").trim();
}

function normalizeOptional(v) {
  const s = String(v || "").trim();
  return s ? s : null;
}

export default async function handler(req, res) {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "content-type": "application/json; charset=utf-8",
  };

  if (req.method === "OPTIONS") {
    return res
      .status(204)
      .setHeader("access-control-allow-origin", "*")
      .end();
  }

  // aplicar headers CORS siempre
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "METHOD_NOT_ALLOWED",
    });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

    const endpointId = process.env.RUNPOD_ENDPOINT_ID || process.env.RP_ENDPOINT;
    const apiKey = process.env.RP_API_KEY;

    if (!apiKey || !endpointId) {
      return res.status(500).json({
        ok: false,
        error: "MISSING_RP_ENV",
        detail: "Falta RP_API_KEY o RUNPOD_ENDPOINT_ID/RP_ENDPOINT",
      });
    }

    // ---------------------------------------------------------
    // Auth usuario
    // ---------------------------------------------------------
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: "UNAUTHORIZED",
      });
    }

    // ---------------------------------------------------------
    // Input base del generador
    // ---------------------------------------------------------
    const prompt = normalizeText(body?.prompt);
    const negativePrompt = normalizeText(body?.negative_prompt);

    const width = Number(body?.width || 512);
    const height = Number(body?.height || 512);
    const steps = Number(body?.steps || 22);
    const seed = body?.seed ?? null;

    if (!prompt) {
      return res.status(400).json({
        ok: false,
        error: "MISSING_PROMPT",
      });
    }

    // ---------------------------------------------------------
    // Avatar opcional
    // ---------------------------------------------------------
    const avatarId = normalizeOptional(body?.avatar_id);
    const avatarName = normalizeOptional(body?.avatar_name);
    const avatarTrigger = normalizeOptional(body?.avatar_trigger);
    const avatarLoraPath = normalizeOptional(body?.avatar_lora_path);

    // Prompt efectivo:
    // si viene trigger, se lo prependemos al prompt para que el worker
    // pueda usarlo tal cual o ignorarlo si aún no carga LoRA
    const effectivePrompt = avatarTrigger
      ? `${avatarTrigger}, ${prompt}`
      : prompt;

    // ---------------------------------------------------------
    // Payload a RunPod
    // ---------------------------------------------------------
    // ✅ mantenemos tus campos actuales
    // ✅ agregamos info de avatar sin romper compatibilidad
    const input = {
      prompt,
      negative_prompt: negativePrompt,
      width,
      height,
      steps,
      seed,

      // debug / trazabilidad UI
      _ui_original_prompt: body?._ui_original_prompt,
      _ui_original_negative: body?._ui_original_negative,
      _ui_used_optimizer: body?._ui_used_optimizer,

      // NUEVO: prompt ya combinado con trigger si hay avatar
      effective_prompt: effectivePrompt,

      // NUEVO: avatar opcional
      avatar_id: avatarId,
      avatar_name: avatarName,
      avatar_trigger: avatarTrigger,
      avatar_lora_path: avatarLoraPath,

      // útil para auditoría interna
      user_id: userId,
    };

    // ---------------------------------------------------------
    // Cobro 1 jade
    // ---------------------------------------------------------
    const ref = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

    const { error: spendErr } = await supabaseAdmin.rpc("spend_jades", {
      p_user_id: userId,
      p_amount: 1,
      p_reason: avatarId ? "image_generate_avatar" : "image_generate",
      p_ref: ref,
    });

    if (spendErr) {
      return res.status(400).json({
        ok: false,
        error: "JADE_CHARGE_FAILED",
        details: spendErr.message,
      });
    }

    // ---------------------------------------------------------
    // Disparo a RunPod
    // ---------------------------------------------------------
    const runUrl = `https://api.runpod.ai/v2/${endpointId}/run`;

    const rp = await fetch(runUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input }),
    });

    if (!rp.ok) {
      const txt = await rp.text();

      return res.status(rp.status).json({
        ok: false,
        error: "RUNPOD_RUN_ERROR",
        details: txt,
      });
    }

    const data = await rp.json().catch(() => null);

    const jobId = data?.id || data?.jobId || data?.requestId || null;

    if (!jobId) {
      return res.status(500).json({
        ok: false,
        error: "NO_JOB_ID_RETURNED",
        raw: data,
      });
    }

    return res.status(200).json({
      ok: true,
      jobId,

      // útil para frontend/debug
      usedAvatar: !!avatarId,
      avatar: avatarId
        ? {
            id: avatarId,
            name: avatarName,
            trigger: avatarTrigger,
            lora_path: avatarLoraPath,
          }
        : null,

      raw: data,
    });
  } catch (e) {
    console.error("[generate]", e);

    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      details: String(e),
    });
  }
}

export const config = { runtime: "nodejs" };
