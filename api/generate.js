// /api/generate.js
// ============================================================
// IMAGEN desde prompt.
// - candado + gratis del día + cobro 1 jade si no hay gratis.
// - RunPod endpoint (run) => devuelve jobId
// ============================================================

import { sbAdmin } from "../lib/supabaseAdmin";
import { COSTS } from "../lib/pricing";
import { checkAndConsumeFreeImage } from "../lib/dailyUsage";

export default async function handler(req, res) {
  // CORS
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  try {
    // Body robusto (Vercel suele parsear JSON, pero por si viene string)
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = null;
      }
    }

    if (!body || !body.prompt) {
      return res.status(400).json({ error: "Missing prompt" });
    }

    const user_id = body.user_id || null;

    // Para tracking real de gratis del día (server-side) exigimos user_id
    if (!user_id) {
      return res.status(401).json({
        error: "LOGIN_REQUIRED",
        note: "Para controlar gratis del día en servidor, requiere user_id.",
      });
    }

    const sb = sbAdmin();

    // Suscripción (para saber si está activo)
    let isActive = false;
    let plan = null;

    const { data: sub, error: subErr } = await sb
      .from("user_subscription")
      .select("plan,status")
      .eq("user_id", user_id)
      .maybeSingle();

    if (subErr) {
      return res.status(500).json({ error: "SUBSCRIPTION_ERROR", detail: subErr.message });
    }

    isActive = sub?.status === "active";
    plan = isActive ? sub?.plan : null;

    // 1) GRATIS DEL DÍA (solo imágenes)
    const free = await checkAndConsumeFreeImage(sb, user_id, isActive);

    // 2) Si NO usó gratis => cobra jades
    if (!free.used_free) {
      const cost = COSTS.img_prompt; // <- tu pricing manda aquí

      const { error: rpcErr } = await sb.rpc("spend_jades", {
        p_user_id: user_id,
        p_amount: cost,
        p_reason: "generation:img_prompt",
        p_ref: body.ref || null,
      });

      if (rpcErr) {
        const msg = rpcErr.message || "";
        if (msg.includes("INSUFFICIENT_JADES")) {
          return res.status(402).json({ error: "INSUFFICIENT_JADES" });
        }
        return res.status(500).json({ error: "RPC_ERROR", detail: msg });
      }
    }

    // 3) Lanza RunPod
    const endpointId = process.env.RUNPOD_ENDPOINT_ID || process.env.RP_ENDPOINT;
    const apiKey = process.env.RP_API_KEY;

    if (!apiKey || !endpointId) {
      return res.status(500).json({ error: "Missing RP_API_KEY or endpointId" });
    }

    const base = `https://api.runpod.ai/v2/${endpointId}`;

    const rp = await fetch(`${base}/run`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        input: {
          prompt: body.prompt,
          negative_prompt: body.negative_prompt || "",
          width: body.width || 512,
          height: body.height || 512,
          steps: body.steps || 22,
          user_id,
          plan,
        },
      }),
    });

    if (!rp.ok) {
      const txt = await rp.text();
      return res.status(rp.status).json({ error: "RunPod run error", details: txt });
    }

    const data = await rp.json();
    const jobId = data.id || data.requestId || data.jobId || data.data?.id;

    if (!jobId) {
      return res.status(500).json({ error: "RunPod no devolvió ID", raw: data });
    }

    return res.status(200).json({
      ok: true,
      jobId,
      billing: free.used_free ? "FREE_DAILY" : "JADE",
      remaining_free_images: free.remaining_free,
    });
  } catch (e) {
    return res.status(500).json({ error: "Server error", details: String(e) });
  }
}
