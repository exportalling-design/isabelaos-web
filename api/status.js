// api/status.js

export default async function handler(req) {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
  };

  // Preflight CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  if (req.method !== "GET") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: cors,
    });
  }

  // Sacar ?id= de la URL
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (!id) {
    return new Response(
      JSON.stringify({ error: "Missing id" }),
      { status: 400, headers: cors }
    );
  }

  const RP_API_KEY = process.env.RP_API_KEY;
  const RP_ENDPOINT = process.env.RP_ENDPOINT;

  if (!RP_API_KEY || !RP_ENDPOINT) {
    return new Response(
      JSON.stringify({ error: "RunPod env vars not configured" }),
      { status: 500, headers: cors }
    );
  }

  try {
    const base = `https://api.runpod.ai/v2/${RP_ENDPOINT}`;
    const rp = await fetch(`${base}/status/${id}`, {
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
          data,
        }),
        { status: rp.status, headers: cors }
      );
    }

    // Aquí miramos si el worker devolvió alguna URL en data.output
    const output = data.output || {};
    const outputUrl =
      output.url ||
      output.imageUrl ||
      output.image_url ||
      null;

    return new Response(
      JSON.stringify({
        status: data.status,
        outputUrl,
        raw: data,
      }),
      { status: 200, headers: cors }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({
        error: "Server error",
        details: String(e),
      }),
      { status: 500, headers: cors }
    );
  }
}
