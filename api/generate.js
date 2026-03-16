// api/generate.js  (NODEJS)
// Envía job a RunPod Serverless (FLUX) y regresa jobId
// ✅ Cobra 1 jade usando supabaseAdmin.rpc("spend_jades")
// ✅ Acepta avatar seleccionado (id / trigger / lora_path)
// ✅ Agrega action: "generate" para que el worker de RunPod sepa qué ejecutar
// ✅ Mantiene compatibilidad con tu flujo actual

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

  // Aplicar headers CORS siempre
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

    // Si viene trigger del avatar, lo agregamos al prompt efectivo
    const effectivePrompt = avatarTrigger
      ? `${avatarTrigger}, ${prompt}`
      : prompt;

    // ---------------------------------------------------------
    // Payload a RunPod
    // ---------------------------------------------------------
    // ✅ IMPORTANTE:
    // action: "generate" era lo que faltaba para que tu worker
    // no devolviera UNKNOWN_ACTION
    const input = {
      action: "generate",

      // Prompt original del usuario
      prompt,

      // Prompt efectivo con trigger del avatar, por si el worker lo usa
      effective_prompt: effectivePrompt,

      negative_prompt: negativePrompt,
      width,
      height,
      steps,
      seed,

      // Debug / trazabilidad UI
      _ui_original_prompt: body?._ui_original_prompt,
      _ui_original_negative: body?._ui_original_negative,
      _ui_used_optimizer: body?._ui_used_optimizer,

      // Avatar opcional
      avatar_id: avatarId,
      avatar_name: avatarName,
      avatar_trigger: avatarTrigger,
      avatar_lora_path: avatarLoraPath,

      // Auditoría interna
      user_id: userId,
    };

    console.log("[generate] endpointId:", endpointId);
    console.log("[generate] userId:", userId);
    console.log("[generate] usedAvatar:", !!avatarId);
    console.log(
      "[generate] input preview:",
      JSON.stringify(
        {
          action: input.action,
          prompt: input.prompt,
          effective_prompt: input.effective_prompt,
          negative_prompt: input.negative_prompt,
          width: input.width,
          height: input.height,
          steps: input.steps,
          avatar_id: input.avatar_id,
          avatar_name: input.avatar_name,
          avatar_trigger: input.avatar_trigger,
          avatar_lora_path: input.avatar_lora_path,
        },
        null,
        2
      )
    );

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
      console.error("[generate] JADE_CHARGE_FAILED:", spendErr);

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

      console.error("[generate] RUNPOD_RUN_ERROR:", txt);

      return res.status(rp.status).json({
        ok: false,
        error: "RUNPOD_RUN_ERROR",
        details: txt,
      });
    }

    const data = await rp.json().catch(() => null);

    console.log("[generate] RunPod raw response:", JSON.stringify(data, null, 2));

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
    console.error("[generate] SERVER_ERROR:", e);

    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      details: String(e),
    });
  }
}

export const config = { runtime: "nodejs" };
