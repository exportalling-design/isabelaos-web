// /api/status.js  (EDGE)
// Consulta /status/:id en RunPod y normaliza output.image_b64
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

    // Normalización para que tu UI siga leyendo output.image_b64
    const out = data?.output || null;
    const image_b64 =
      out?.image_b64 ||
      out?.imageBase64 ||
      out?.imageB64 ||
      null;

    const imageUrl = out?.imageUrl || out?.url || null;

    return new Response(
      JSON.stringify({
        ok: true,
        status: data?.status,
        delayTime: data?.delayTime,
        executionTime: data?.executionTime,
        output: out
          ? {
              ...out,
              image_b64, // ✅ clave esperada por tu frontend
              imageUrl,
            }
          : null,
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
