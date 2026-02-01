// /api/generate.js  (EDGE)
// Envia job a RunPod Serverless (FLUX) y regresa jobId
export default async function handler(req) {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "content-type": "application/json; charset=utf-8",
  };

  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "METHOD_NOT_ALLOWED" }), {
      status: 405,
      headers: cors,
    });
  }

  try {
    const body = await req.json().catch(() => null);

    const endpointId = process.env.RUNPOD_ENDPOINT_ID || process.env.RP_ENDPOINT;
    const apiKey = process.env.RP_API_KEY;

    if (!apiKey || !endpointId) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "MISSING_RP_ENV",
          detail: "Falta RP_API_KEY o RUNPOD_ENDPOINT_ID/RP_ENDPOINT",
        }),
        { status: 500, headers: cors }
      );
    }

    // Tu frontend manda: prompt, negative_prompt, width, height, steps
    const input = {
      prompt: String(body?.prompt || "").trim(),
      negative_prompt: String(body?.negative_prompt || "").trim(),
      width: Number(body?.width || 512),
      height: Number(body?.height || 512),
      steps: Number(body?.steps || 22),
      seed: body?.seed ?? null,

      // Debug opcional (no rompe)
      _ui_original_prompt: body?._ui_original_prompt,
      _ui_original_negative: body?._ui_original_negative,
      _ui_used_optimizer: body?._ui_used_optimizer,
    };

    if (!input.prompt) {
      return new Response(JSON.stringify({ ok: false, error: "MISSING_PROMPT" }), {
        status: 400,
        headers: cors,
      });
    }

// ---------------------------------------------------------
// ✅ COBRO DE 1 JADE (ÚNICO CAMBIO)
// ---------------------------------------------------------
const auth = req.headers.get("authorization") || "";
if (!auth.toLowerCase().startsWith("bearer ")) {
  return new Response(JSON.stringify({ ok: false, error: "MISSING_AUTH" }), {
    status: 401,
    headers: cors,
  });
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON) {
  return new Response(JSON.stringify({ ok: false, error: "MISSING_SUPABASE_ENV" }), {
    status: 500,
    headers: cors,
  });
}

const rpcRes = await fetch(
  `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/spend_jades`,
  {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON,
      authorization: auth, // JWT del usuario
      "content-type": "application/json",
    },
    body: JSON.stringify({
      amount: 1,
      reason: "image_generate",
      meta: {
        width: input.width,
        height: input.height,
        steps: input.steps,
      },
    }),
  }
);

if (!rpcRes.ok) {
  const txt = await rpcRes.text();
  return new Response(
    JSON.stringify({
      ok: false,
      error: "JADE_CHARGE_FAILED",
      details: txt,
    }),
    { status: 402, headers: cors }
  );
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
      return new Response(JSON.stringify({ ok: false, error: "RUNPOD_RUN_ERROR", details: txt }), {
        status: rp.status,
        headers: cors,
      });
    }

    const data = await rp.json();

    // RunPod normalmente devuelve id en "id"
    const jobId = data?.id || data?.jobId || data?.requestId || null;

    if (!jobId) {
      return new Response(
        JSON.stringify({ ok: false, error: "NO_JOB_ID_RETURNED", raw: data }),
        { status: 500, headers: cors }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        jobId,
        raw: data,
      }),
      { status: 200, headers: cors }
    );
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "SERVER_ERROR", details: String(e) }), {
      status: 500,
      headers: cors,
    });
  }
}

export const config = { runtime: "edge" };
