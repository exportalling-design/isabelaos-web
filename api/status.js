// api/status.js
export const config = {
  runtime: "edge",
};

export default async function handler(req) {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
  };

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: cors });
  }

  try {
    const url = new URL(req.url);
    const jobId = url.searchParams.get("id");

    if (!jobId) {
      return new Response(
        JSON.stringify({ error: "Missing id" }),
        { status: 400, headers: cors }
      );
    }

    // 🔴 IMPORTANTE: usar los mismos nombres que /api/generate
    const RP_API_KEY = process.env.RP_API_KEY;
    const RP_ENDPOINT = process.env.RP_ENDPOINT;

    if (!RP_API_KEY || !RP_ENDPOINT) {
      return new Response(
        JSON.stringify({ error: "RunPod env vars not configured" }),
        { status: 500, headers: cors }
      );
    }

    const base = `https://api.runpod.ai/v2/${RP_ENDPOINT}`;

    const rp = await fetch(`${base}/status/${jobId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${RP_API_KEY}`,
      },
    });

    const data = await rp.json();

    if (!rp.ok) {
      return new Response(
        JSON.stringify({
          error: "RunPod status error",
          statusData: data,
        }),
        { status: rp.status, headers: cors }
      );
    }

    // Normalizamos un poco la respuesta para el cliente
    const status = data.status || "UNKNOWN";
    const output = data.output || {};
    const outputUrl =
      output.image_url || output.url || output.outputUrl || null;

    return new Response(
      JSON.stringify({
        status,
        outputUrl,
        raw: data,
      }),
      { status: 200, headers: cors }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({
        error: "Server error in /api/status",
        details: String(e),
      }),
      { status: 500, headers: cors }
    );
  }
}

