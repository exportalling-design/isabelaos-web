// /api/generate.js
// --- Lanza el job en RunPod y devuelve jobId
// --- Cobra jades antes de generar (EDGE compatible)

import { requireUser } from "./_auth";

const COST_IMG_PROMPT_JADES = 1;

export default async function handler(req) {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "content-type": "application/json; charset=utf-8",
  };

  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  // Solo POST
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "METHOD_NOT_ALLOWED" }),
      { status: 405, headers: cors }
    );
  }

  try {
    const body = await req.json().catch(() => null);

    if (!body || !body.prompt) {
      return new Response(
        JSON.stringify({ ok: false, error: "MISSING_PROMPT" }),
        { status: 400, headers: cors }
      );
    }

    // =========================
    // 1) AUTH
    // =========================
    const auth = await requireUser(req);
    if (!auth.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: auth.error }),
        { status: auth.code || 401, headers: cors }
      );
    }

    const user_id = auth.user.id;

    // =========================
    // 2) COBRO JADES (RPC)
    // =========================
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return new Response(
        JSON.stringify({ ok: false, error: "MISSING_ENV" }),
        { status: 500, headers: cors }
      );
    }

    const rpcUrl = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/spend_jades`;

    const spend = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_user_id: user_id,
        p_amount: COST_IMG_PROMPT_JADES,
        p_reason: "generation:img_prompt",
        p_ref: body.ref || null,
      }),
    });

    if (!spend.ok) {
      const txt = await spend.text();
      if (txt.includes("INSUFFICIENT_JADES")) {
        return new Response(
          JSON.stringify({ ok: false, error: "INSUFFICIENT_JADES" }),
          { status: 402, headers: cors }
        );
      }
      return new Response(
        JSON.stringify({ ok: false, error: "RPC_SPEND_JADES_ERROR", details: txt }),
        { status: 500, headers: cors }
      );
    }

    // =========================
    // 3) RUNPOD
    // =========================
    const endpointId =
      process.env.RUNPOD_ENDPOINT_ID || process.env.RP_ENDPOINT;

    if (!process.env.RP_API_KEY || !endpointId) {
      return new Response(
        JSON.stringify({ ok: false, error: "MISSING_RP_ENV" }),
        { status: 500, headers: cors }
      );
    }

    const runpod = await fetch(
      `https://api.runpod.ai/v2/${endpointId}/run`,
      {
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
            user_id,
          },
        }),
      }
    );

    if (!runpod.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: "RUNPOD_RUN_ERROR" }),
        { status: runpod.status, headers: cors }
      );
    }

    const data = await runpod.json();
    const jobId = data.id || data.requestId || data.jobId;

    return new Response(
      JSON.stringify({
        ok: true,
        jobId,
        billed: { type: "JADE", amount: COST_IMG_PROMPT_JADES },
