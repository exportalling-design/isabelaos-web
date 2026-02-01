// api/generate.js  (NODEJS)
// Envia job a RunPod Serverless (FLUX) y regresa jobId
// ✅ Cobra 1 jade usando supabaseAdmin.rpc("spend_jades") (igual a video)

import { supabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

export default async function handler(req, res) {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "content-type": "application/json; charset=utf-8",
  };

  if (req.method === "OPTIONS") return res.status(204).setHeader("access-control-allow-origin", "*").end();

  // aplica headers CORS siempre
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const endpointId = process.env.RUNPOD_ENDPOINT_ID || process.env.RP_ENDPOINT;
    const apiKey = process.env.RP_API_KEY;

    if (!apiKey || !endpointId) {
      return res.status(500).json({
        ok: false,
        error: "MISSING_RP_ENV",
        detail: "Falta RP_API_KEY o RUNPOD_ENDPOINT_ID/RP_ENDPOINT",
      });
    }

    // ✅ NO CAMBIAMOS TU INPUT
    const input = {
      prompt: String(body?.prompt || "").trim(),
      negative_prompt: String(body?.negative_prompt || "").trim(),
      width: Number(body?.width || 512),
      height: Number(body?.height || 512),
      steps: Number(body?.steps || 22),
      seed: body?.seed ?? null,

      _ui_original_prompt: body?._ui_original_prompt,
      _ui_original_negative: body?._ui_original_negative,
      _ui_used_optimizer: body?._ui_used_optimizer,
    };

    if (!input.prompt) {
      return res.status(400).json({ ok: false, error: "MISSING_PROMPT" });
    }

    // ---------------------------------------------------------
    // ✅ COBRO 1 JADE (IGUAL A VIDEO)
    // ---------------------------------------------------------
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const ref = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

    const { error: spendErr } = await supabaseAdmin.rpc("spend_jades", {
      p_user_id: userId,
      p_amount: 1,
      p_reason: "image_generate",
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
      return res.status(rp.status).json({ ok: false, error: "RUNPOD_RUN_ERROR", details: txt });
    }

    const data = await rp.json().catch(() => null);

    const jobId = data?.id || data?.jobId || data?.requestId || null;
    if (!jobId) {
      return res.status(500).json({ ok: false, error: "NO_JOB_ID_RETURNED", raw: data });
    }

    return res.status(200).json({ ok: true, jobId, raw: data });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", details: String(e) });
  }
}

export const config = { runtime: "nodejs" };