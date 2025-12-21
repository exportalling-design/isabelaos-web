// /api/generate.js
// --- Lanza el job en RunPod y devuelve jobId
// --- + CANDADO DE COBRO (jades) ANTES de generar (EDGE compatible)

const COST_IMG_PROMPT_JADES = 1; // <- AJUSTA AQUÍ si tu costo real es otro

export default async function handler(req) {
  // CORS + JSON header
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "content-type": "application/json; charset=utf-8",
  };

  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  // Solo POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "METHOD_NOT_ALLOWED" }), {
      status: 405,
      headers: cors,
    });
  }

  try {
    const body = await req.json().catch(() => null);

    if (!body || !body.prompt) {
      return new Response(JSON.stringify({ ok: false, error: "MISSING_PROMPT" }), {
        status: 400,
        headers: cors,
      });
    }

    // =========================
    // 1) CANDADO: LOGIN + COBRO
    // =========================
    const user_id = body.user_id || null;
    if (!user_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "LOGIN_REQUIRED", note: "Se requiere user_id para aplicar cobro/candado." }),
        { status: 401, headers: cors }
      );
    }

    // ENV Supabase (service role) para cobrar
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "MISSING_ENV",
          detail: "Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en Vercel.",
        }),
        { status: 500, headers: cors }
      );
    }

    // Cobra jades antes de generar (RPC spend_jades)
    // OJO: esto asume que tu RPC existe y devuelve error con mensaje INSUFFICIENT_JADES.
    const rpcUrl = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/spend_jades`;

    const spendRes = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_user_id: user_id,
        p_amount: COST_IMG_PROMPT_JADES,
        p_reason: "generation:img_prompt",
        p_ref: body.ref || null,
      }),
    });

    if (!spendRes.ok) {
      const spendTxt = await spendRes.text();

      // Si tu RPC tira ese texto/mensaje, lo interpretamos:
      if ((spendTxt || "").includes("INSUFFICIENT_JADES")) {
        return new Response(JSON.stringify({ ok: false, error: "INSUFFICIENT_JADES" }), {
          status: 402,
          headers: cors,
        });
      }

      // Otro error RPC
      return new Response(
        JSON.stringify({ ok: false, error: "RPC_SPEND_JADES_ERROR", details: spendTxt }),
        { status: 500, headers: cors }
      );
    }

    // =========================
    // 2) RUNPOD (igual que antes)
    // =========================
    const endpointId = process.env.RUNPOD_ENDPOINT_ID || process.env.RP_ENDPOINT;

    if (!process.env.RP_API_KEY || !endpointId) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "MISSING_RP_ENV",
          detail: "Falta RP_API_KEY o endpointId (RUNPOD_ENDPOINT_ID / RP_ENDPOINT).",
        }),
        { status: 500, headers: cors }
      );
    }

    const base = `https://api.runpod.ai/v2/${endpointId}`;

    const rp = await fetch(`${base}/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RP_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: {
          prompt: body.prompt,
          negative_prompt: body.negative_prompt || "",
          width: body.width || 512,
          height: body.height || 512,
          steps: body.steps || 22,
          // metadata opcional
          user_id,
        },
      }),
    });

    if (!rp.ok) {
      const txt = await rp.text();
      return new Response(
        JSON.stringify({ ok: false, error: "RUNPOD_RUN_ERROR", details: txt }),
        { status: rp.status, headers: cors }
      );
    }

    const data = await rp.json();

    const jobId = data.id || data.requestId || data.jobId || data.data?.id;

    if (!jobId) {
      return new Response(
        JSON.stringify({ ok: false, error: "RUNPOD_NO_ID", raw: data }),
        { status: 500, headers: cors }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        jobId,
        billed: { type: "JADE", amount: COST_IMG_PROMPT_JADES },
      }),
      { status: 200, headers: cors }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: "SERVER_ERROR", details: String(e) }),
      { status: 500, headers: cors }
    );
  }
}

export const config = {
  runtime: "edge",
};
