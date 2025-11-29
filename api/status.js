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
    return new Response("Method Not Allowed", {
      status: 405,
      headers: cors,
    });
  }

  try {
    // Sacar el id de la query: /api/status?id=XXXX
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("id");

    if (!jobId) {
      return new Response(
        JSON.stringify({ error: "Missing id" }),
        { status: 400, headers: cors }
      );
    }

    const RUNPOD_API_KEY = process.env.RP_API_KEY;
    const RUNPOD_ENDPOINT_ID = process.env.RP_ENDPOINT;

    if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT_ID) {
      return new Response(
        JSON.stringify({ error: "RunPod env vars not configured" }),
        { status: 500, headers: cors }
      );
    }

    // 👇 SIN new URL, URL completa directa
    const rpRes = await fetch(
      `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/status/${jobId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${RUNPOD_API_KEY}`,
        },
      }
    );

    const data = await rpRes.json();

    if (!rpRes.ok) {
      return new Response(
        JSON.stringify({ error: "RunPod status error", raw: data }),
        { status: rpRes.status, headers: cors }
      );
    }

    // data viene directo de RunPod
    return new Response(
      JSON.stringify({
        ok: true,
        status: data.status,
        output: data.output ?? null,
        raw: data,
      }),
      { status: 200, headers: cors }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Server error", details: String(e) }),
      { status: 500, headers: cors }
    );
  }
}
