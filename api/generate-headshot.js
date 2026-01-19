// pages/api/generate-headshot.js
// Lanza un job "headshot_pro" en RunPod (Serverless)
// + AUTH UNIFICADO (requireUser)
// + COBRO UNIFICADO (spend_jades) ANTES de generar

import { requireUser } from "../../api/_auth";

// =====================
// COSTOS (JADE)
// =====================
const COST_HEADSHOT_JADES = 1; // AJUSTA AQUÍ

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

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

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

    if (!body.image_b64) {
      return res.status(400).json({ ok: false, error: "Falta image_b64 en el cuerpo." });
    }

    const image_b64 = body.image_b64;
    const style = body.style || "corporate"; // corporate | influencer | creative

    // COBRO
    await spendJadesOrThrow(
      user_id,
      COST_HEADSHOT_JADES,
      "generation:headshot_pro",
      body.ref || null
    );

    const endpointId = process.env.RUNPOD_ENDPOINT_ID;
    const apiKey = process.env.RUNPOD_API_KEY;

    if (!endpointId || !apiKey) {
      return res.status(500).json({
        ok: false,
        error: "Faltan RUNPOD_ENDPOINT_ID o RUNPOD_API_KEY.",
      });
    }

    const url = `https://api.runpod.ai/v2/${endpointId}/run`;

    const rpRes = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: {
          action: "headshot_pro",
          image_b64,
          style,
          user_id,
        },
      }),
    });

    const data = await rpRes.json().catch(() => null);

    if (!rpRes.ok || !data || data.error) {
      console.error("Error RunPod generate-headshot:", data);
      return res.status(500).json({
        ok: false,
        error: data?.error || "Error al lanzar job en RunPod.",
      });
    }

    return res.status(200).json({
      ok: true,
      jobId: data.id,
      billed: { type: "JADE", amount: COST_HEADSHOT_JADES },
    });
  } catch (err) {
    const msg = err?.message || String(err);
    const code = err?.code || 500;
    console.error("Error en /api/generate-headshot:", err);
    return res.status(code).json({
      ok: false,
      error: msg,
    });
  }
}