// api/status.js  --- Consulta el estado de un job de RunPod

export default async function handler(req) {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
  };

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
        JSON.stringify({ error: "Missing id parameter" }),
        { status: 400, headers: cors }
      );
    }

    const base = `https://api.runpod.ai/v2/${process.env.RP_ENDPOINT}`;

    const st = await fetch(`${base}/status/${jobId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.RP_API_KEY}`,
      },
    });

    const statusData = await st.json();

    if (!st.ok) {
      return new Response(
        JSON.stringify({ error: "RunPod status error", statusData }),
        { status: st.status, headers: cors }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        runpodStatus: statusData.status,
        output: statusData.output || null,
        raw: statusData,
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

export const config = {
  runtime: "edge",
};

