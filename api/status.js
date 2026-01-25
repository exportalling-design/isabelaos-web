// /api/flux/status.js
export default async function handler(req) {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "content-type": "application/json; charset=utf-8",
  };

  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  if (req.method !== "GET" && req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "METHOD_NOT_ALLOWED" }), {
      status: 405,
      headers: cors,
    });
  }

  try {
    let jobId = null;

    if (req.method === "GET") {
      const url = new URL(req.url);
      jobId = url.searchParams.get("id");
    } else {
      const body = await req.json().catch(() => null);
      jobId = body?.jobId;
    }

    if (!jobId) {
      return new Response(JSON.stringify({ ok: false, error: "MISSING_JOB_ID" }), {
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

    const statusUrl = `https://api.runpod.ai/v2/${endpointId}/status/${jobId}`;

    const rp = await fetch(statusUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!rp.ok) {
      const txt = await rp.text();
      return new Response(JSON.stringify({ ok: false, error: "RUNPOD_STATUS_ERROR", details: txt }), {
        status: rp.status,
        headers: cors,
      });
    }

    const data = await rp.json();

    // ✅ Normalizamos: el frontend espera output.image_b64
    const out = data?.output || null;
    const image_b64 =
      out?.image_b64 ||
      out?.imageB64 ||
      out?.imageBase64 ||
      null;

    const normalizedOutput = out
      ? { ...out, image_b64 }
      : null;

    return new Response(
      JSON.stringify({
        ok: true,
        status: data?.status || null,
        delayTime: data?.delayTime ?? null,
        executionTime: data?.executionTime ?? null,
        output: normalizedOutput,
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
