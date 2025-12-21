// pages/api/generate.js
// ============================================================
// IMAGEN desde prompt.
// Antes era: lanzar RunPod y devolver jobId.
// Ahora: candado + gratis del día + cobro 1 jade si no hay gratis.
// ============================================================

import { sbAdmin } from "../../lib/supabaseAdmin";
import { COSTS } from "../../lib/pricing";
import { checkAndConsumeFreeImage } from "../../lib/dailyUsage";

export default async function handler(req) {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };

  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: cors });

  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.prompt) {
      return new Response(JSON.stringify({ error: "Missing prompt" }), { status: 400, headers: cors });
    }

    const user_id = body.user_id || null;

    // Si no hay user_id => invitado: le aplican gratis guest (por día)
    // Si hay user_id => verificamos plan + gratis active
    const sb = sbAdmin();

    let isActive = false;
    let plan = null;

    if (user_id) {
      const { data: sub } = await sb
        .from("user_subscription")
        .select("plan,status")
        .eq("user_id", user_id)
        .maybeSingle();

      isActive = sub?.status === "active";
      plan = isActive ? sub?.plan : null;
    }

    // 1) GRATIS DEL DÍA (solo imágenes)
    // - invitado: usa daily_usage con user_id = "guest:<ip_hash>" si querés.
    //   Para no inventar IP hashing ahora, si no hay user_id, devolvemos candado inmediato (o frontend controla).
    //   PERO vos pediste "server real": entonces exigimos user_id para tracking real.
    if (!user_id) {
      return new Response(
        JSON.stringify({ error: "LOGIN_REQUIRED", note: "Para controlar gratis del día en servidor, requiere user_id." }),
        { status: 401, headers: cors }
      );
    }

    const free = await checkAndConsumeFreeImage(sb, user_id, isActive);

    if (!free.used_free) {
      // 2) Si no hay gratis, se cobra 1 jade (img_prompt)
      const cost = COSTS.img_prompt;

      const { error } = await sb.rpc("spend_jades", {
        p_user_id: user_id,
        p_amount: cost,
        p_reason: "generation:img_prompt",
        p_ref: body.ref || null,
      });

      if (error) {
        if ((error.message || "").includes("INSUFFICIENT_JADES")) {
          return new Response(JSON.stringify({ error: "INSUFFICIENT_JADES" }), { status: 402, headers: cors });
        }
        return new Response(JSON.stringify({ error: "RPC_ERROR", detail: error.message }), { status: 500, headers: cors });
      }
    }

    // 3) Lanza RunPod (igual que antes)
    const endpointId = process.env.RUNPOD_ENDPOINT_ID || process.env.RP_ENDPOINT;
    const apiKey = process.env.RP_API_KEY;

    if (!apiKey || !endpointId) {
      return new Response(JSON.stringify({ error: "Missing RP_API_KEY or endpointId" }), { status: 500, headers: cors });
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
          // (opcional) metadata
          user_id,
          plan,
        },
      }),
    });

    if (!rp.ok) {
      const txt = await rp.text();
      return new Response(JSON.stringify({ error: "RunPod run error", details: txt }), { status: rp.status, headers: cors });
    }

    const data = await rp.json();
    const jobId = data.id || data.requestId || data.jobId || data.data?.id;

    if (!jobId) {
      return new Response(JSON.stringify({ error: "RunPod no devolvió ID", raw: data }), { status: 500, headers: cors });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        jobId,
        billing: free.used_free ? "FREE_DAILY" : "JADE",
        remaining_free_images: free.remaining_free,
      }),
      { status: 200, headers: cors }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: "Server error", details: String(e) }), { status: 500, headers: cors });
  }
}

export const config = { runtime: "edge" };
