// /api/generate.js
// ============================================================
// IsabelaOS Studio - IMAGEN desde prompt (RunPod Endpoint)
// - NO ES pages/api (esto es Vercel Serverless Functions /api)
// - NO ES Edge runtime (Edge rompe imports tipo supabaseAdmin/pricing)
// - Responde JSON SIEMPRE (para evitar: Unexpected token 'A' ... not valid JSON)
//
// Flujo:
// 1) Valida input (prompt + user_id)
// 2) Lee suscripción (user_subscription) para saber si está active
// 3) Aplica "gratis del día" con checkAndConsumeFreeImage()
// 4) Si no hay gratis, cobra jades con RPC spend_jades (COSTS.img_prompt)
// 5) Lanza RunPod Endpoint /run
// 6) Devuelve { ok:true, jobId, billing, remaining_free_images }
//
// ENV esperadas:
// - RP_API_KEY (RunPod API Key)
// - RUNPOD_ENDPOINT_ID  (id del endpoint)  o  RP_ENDPOINT  (si ahí guardas el id)
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// ============================================================

import { sbAdmin } from "../lib/supabaseAdmin";
import { COSTS } from "../lib/pricing";
import { checkAndConsumeFreeImage } from "../lib/dailyUsage";

// ---------- CORS ----------
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ---------- JSON helpers ----------
function safeJson(res, status, payload) {
  setCors(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  // Vercel a veces ya lo trae en req.body, a veces no.
  if (req.body && typeof req.body === "object") return req.body;

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();

  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (e) {
    // devolvemos algo útil para debug
    return { __invalid_json: true, raw };
  }
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== "POST") {
    return safeJson(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const body = await readJsonBody(req);

    if (!body) {
      return safeJson(res, 400, { ok: false, error: "EMPTY_BODY" });
    }
    if (body.__invalid_json) {
      return safeJson(res, 400, {
        ok: false,
        error: "INVALID_JSON",
        detail: "Body no es JSON válido",
        raw_preview: String(body.raw || "").slice(0, 200),
      });
    }

    const prompt = (body.prompt || "").trim();
    if (!prompt) {
      return safeJson(res, 400, { ok: false, error: "MISSING_PROMPT" });
    }

    // IMPORTANTE: tú pediste tracking real server-side => requiere user_id
    const user_id = body.user_id || null;
    if (!user_id) {
      return safeJson(res, 401, {
        ok: false,
        error: "LOGIN_REQUIRED",
        note: "Para controlar gratis del día + cobros en servidor se requiere user_id.",
      });
    }

    const negative_prompt = body.negative_prompt || "";
    const width = Number(body.width || 512);
    const height = Number(body.height || 512);
    const steps = Number(body.steps || 22);

    // ---------- Supabase Admin ----------
    const sb = sbAdmin();

    // 1) Suscripción (para saber si está active)
    let isActive = false;
    let plan = null;

    const { data: sub, error: subErr } = await sb
      .from("user_subscription")
      .select("plan,status")
      .eq("user_id", user_id)
      .maybeSingle();

    if (subErr) {
      return safeJson(res, 500, { ok: false, error: "SUBSCRIPTION_ERROR", detail: subErr.message });
    }

    isActive = sub?.status === "active";
    plan = isActive ? sub?.plan : null;

    // 2) Gratis del día (solo imágenes)
    const free = await checkAndConsumeFreeImage(sb, user_id, isActive);

    // 3) Si NO usó gratis => cobra jades
    if (!free.used_free) {
      const cost = COSTS.img_prompt;

      const { error: spendErr } = await sb.rpc("spend_jades", {
        p_user_id: user_id,
        p_amount: cost,
        p_reason: "generation:img_prompt",
        p_ref: body.ref || null,
      });

      if (spendErr) {
        const msg = spendErr.message || "";

        if (msg.includes("INSUFFICIENT_JADES")) {
          return safeJson(res, 402, { ok: false, error: "INSUFFICIENT_JADES" });
        }

        return safeJson(res, 500, { ok: false, error: "RPC_ERROR", detail: msg });
      }
    }

    // ---------- RunPod Endpoint /run ----------
    const apiKey = process.env.RP_API_KEY || process.env.RUNPOD_API_KEY;
    const endpointId = process.env.RUNPOD_ENDPOINT_ID || process.env.RP_ENDPOINT; // aquí guardas el ID

    if (!apiKey || !endpointId) {
      return safeJson(res, 500, {
        ok: false,
        error: "MISSING_ENV",
        detail: "Falta RP_API_KEY o RUNPOD_ENDPOINT_ID (o RP_ENDPOINT).",
      });
    }

    const base = `https://api.runpod.ai/v2/${endpointId}`;

    const rp = await fetch(`${base}/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: {
          prompt,
          negative_prompt,
          width,
          height,
          steps,
          // metadata (no afecta el worker, pero te sirve para logs)
          user_id,
          plan,
        },
      }),
    });

    // IMPORTANTE: aquí RunPod a veces responde TEXTO/HTML en errores
    const rpText = await rp.text();
    let rpJson = null;
    try {
      rpJson = JSON.parse(rpText);
    } catch {
      rpJson = null;
    }

    if (!rp.ok) {
      // devolvemos JSON SIEMPRE
      return safeJson(res, rp.status, {
        ok: false,
        error: "RUNPOD_RUN_ERROR",
        status: rp.status,
        details_json: rpJson,
        details_text_preview: String(rpText || "").slice(0, 800),
      });
    }

    const data = rpJson || {};
    const jobId = data.id || data.requestId || data.jobId || data?.data?.id || null;

    if (!jobId) {
      return safeJson(res, 500, {
        ok: false,
        error: "RUNPOD_NO_ID",
        raw: data,
        raw_text_preview: String(rpText || "").slice(0, 800),
      });
    }

    // ✅ RESPUESTA FINAL
    return safeJson(res, 200, {
      ok: true,
      jobId,
      billing: free.used_free ? "FREE_DAILY" : "JADE",
      remaining_free_images: free.remaining_free,
    });
  } catch (e) {
    return safeJson(res, 500, { ok: false, error: "SERVER_ERROR", detail: String(e) });
  }
}
