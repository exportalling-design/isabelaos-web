import { supabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

function normalizeText(v) {
  return String(v || "").trim();
}

function normalizeOptional(v) {
  const s = String(v || "").trim();
  return s ? s : null;
}

function normalizeStringArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((v) => String(v || "").trim()).filter(Boolean);
}

export default async function handler(req, res) {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "content-type": "application/json; charset=utf-8",
  };

  if (req.method === "OPTIONS") {
    return res.status(204).setHeader("access-control-allow-origin", "*").end();
  }

  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
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

    const userId = await getUserIdFromAuthHeader(req);

    if (!userId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }

    const prompt = normalizeText(body?.prompt);
    const negativePrompt = normalizeText(body?.negative_prompt);

    const width = Number(body?.width || 512);
    const height = Number(body?.height || 512);
    const steps = Number(body?.steps || 22);
    const seed = body?.seed ?? null;

    if (!prompt) {
      return res.status(400).json({ ok: false, error: "MISSING_PROMPT" });
    }

    const avatarId = normalizeOptional(body?.avatar_id);
    const avatarName = normalizeOptional(body?.avatar_name);
    const avatarAnchorUrls = normalizeStringArray(body?.avatar_anchor_urls);
    const avatarAnchorPaths = normalizeStringArray(body?.avatar_anchor_paths);

    const input = {
      action: "generate",
      prompt,
      effective_prompt: prompt,
      negative_prompt: negativePrompt,
      width,
      height,
      steps,
      seed,

      _ui_original_prompt: body?._ui_original_prompt,
      _ui_original_negative: body?._ui_original_negative,
      _ui_used_optimizer: body?._ui_used_optimizer,

      avatar_id: avatarId,
      avatar_name: avatarName,
      avatar_anchor_urls: avatarAnchorUrls,
      avatar_anchor_paths: avatarAnchorPaths,

      user_id: userId,
    };

    const ref = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

    const { error: spendErr } = await supabaseAdmin.rpc("spend_jades", {
      p_user_id: userId,
      p_amount: 1,
      p_reason: avatarId ? "image_generate_anchor" : "image_generate",
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
      usedAvatar: !!avatarId,
      avatar: avatarId
        ? {
            id: avatarId,
            name: avatarName,
            anchor_urls: avatarAnchorUrls,
            anchor_paths: avatarAnchorPaths,
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
