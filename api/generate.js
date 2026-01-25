// /api/flux/generate.js
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
    if (!body?.prompt) {
      return new Response(JSON.stringify({ ok: false, error: "MISSING_PROMPT" }), {
        status: 400,
        headers: cors,
      });
    }

    const endpointId = process.env.RUNPOD_FLUX_ENDPOINT_ID;
    const apiKey = process.env.RP_API_KEY;

    if (!apiKey || !endpointId) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "MISSING_RP_ENV",
          detail: "Falta RP_API_KEY o RUNPOD_FLUX_ENDPOINT_ID",
        }),
        { status: 500, headers: cors }
      );
    }

    const runUrl = `https://api.runpod.ai/v2/${endpointId}/run`;

    // ✅ Mantén el payload igual a lo que tu rp_handler.py espera:
    // prompt, negative_prompt, width, height, steps
    const payload = {
      input: {
        prompt: String(body.prompt || ""),
        negative_prompt: String(body.negative_prompt || ""),
        width: Number(body.width || 1024),
        height: Number(body.height || 1024),
        steps: Number(body.steps || 28),

        // opcionales (no rompen el handler si no los usas)
        guidance_scale: body.guidance_scale != null ? Number(body.guidance_scale) : undefined,
        seed: body.seed != null ? Number(body.seed) : undefined,
      },
    };

    const rp = await fetch(runUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!rp.ok) {
      const txt = await rp.text();
      return new Response(JSON.stringify({ ok: false, error: "RUNPOD_RUN_ERROR", details: txt }), {
        status: rp.status,
        headers: cors,
      });
    }

    const data = await rp.json();
    // RunPod normalmente devuelve { id: "jobId", status: "IN_QUEUE", ... }
    const jobId = data?.id || data?.jobId || null;

    if (!jobId) {
      return new Response(JSON.stringify({ ok: false, error: "NO_JOB_ID_FROM_RUNPOD", raw: data }), {
        status: 500,
        headers: cors,
      });
    }

    return new Response(JSON.stringify({ ok: true, jobId, raw: data }), {
      status: 200,
      headers: cors,
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "SERVER_ERROR", details: String(e) }), {
      status: 500,
      headers: cors,
    });
  }
}

export const config = { runtime: "edge" };
