// api/generate-montaje.js
// Lanza un job en RunPod (Serverless)
// + AUTH (requireUser)
// + COBRO (spend_jades) ANTES de generar
// + Nuevo nombre para el módulo: Montaje IA

import { requireUser } from "./_auth.js";

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

export default async function handler(req, res) {
  // CORS básico
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    // AUTH
    const auth = await requireUser(req);
    if (!auth.ok) {
      return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    }

    const user_id = auth.user.id;
    const body = req.body || {};

    const endpointId = process.env.RUNPOD_ENDPOINT_ID;
    const apiKey = process.env.RUNPOD_API_KEY;

    if (!endpointId || !apiKey) {
      return res.status(500).json({
        ok: false,
        error: "Faltan RUNPOD_ENDPOINT_ID o RUNPOD_API_KEY.",
      });
    }

    // =====================
    // MODO NUEVO: MONTAJE IA
    // =====================
    // Caso 1: montaje con 2 imágenes (persona + fondo)
    const hasPersonAndBg = !!body.person_image && !!body.background_image;

    // Caso 2: fallback legacy de transformación con 1 sola imagen
    const hasSingleImage = !!body.image_b64;

    if (!hasPersonAndBg && !hasSingleImage) {
      return res.status(400).json({
        ok: false,
        error: "Debes enviar person_image + background_image, o image_b64.",
      });
    }

    let action = "";
    let input = {};

    if (hasPersonAndBg) {
      action = "compose_scene";

      input = {
        action,
        fg_image_b64: body.person_image,
        bg_image_b64: body.background_image,
        user_id,

        // prompt libre de Isabela
        prompt: body.prompt,

        // parámetros opcionales del montaje
        x: body.x,
        y: body.y,
        scale: body.scale,
        feather: body.feather,
        mode: body.blend_mode || body.mode || "seamless",
        color_match: body.color_match,
      };
    } else {
      // =====================
      // FALLBACK LEGACY
      // =====================
      const mode = String(body.mode || "product_studio").toLowerCase();

      action =
        mode === "anime_identity"
          ? "transform_anime_identity"
          : "headshot_pro";

      input = {
        action,
        image_b64: body.image_b64,
        user_id,

        prompt: body.prompt,
        negative_prompt: body.negative_prompt,

        steps: body.steps,
        guidance: body.guidance,
        strength: body.strength,
        max_side: body.max_side,
        seed: body.seed,
      };
    }

    // COBRO
    await spendJadesOrThrow(
      user_id,
      COST_MONTAJE_JADES,
      `generation:montaje_ia`,
      body.ref || null
    );

    const url = `https://api.runpod.ai/v2/${endpointId}/run`;

    const rpRes = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ input }),
    });

    const data = await rpRes.json().catch(() => null);

    if (!rpRes.ok || !data || data.error) {
      console.error("Error RunPod generate-montaje:", data);
      return res.status(500).json({
        ok: false,
        error: data?.error || "Error al lanzar job en RunPod.",
      });
    }

    return res.status(200).json({
      ok: true,
      jobId: data.id,
      billed: { type: "JADE", amount: COST_MONTAJE_JADES },
      action,
    });
  } catch (err) {
    const msg = err?.message || String(err);
    const code = err?.code || 500;
    console.error("Error en /api/generate-montaje:", err);

    return res.status(code).json({
      ok: false,
      error: msg,
    });
  }
}
