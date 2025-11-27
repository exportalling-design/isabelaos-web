export default async function handler(req) {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: cors });
  }

  try {
    const body = await req.json();
    if (!body?.prompt) {
      return Response.json(
        { error: "Missing prompt" },
        { status: 400, headers: cors }
      );
    }

    const base = `https://api.runpod.ai/v2/${process.env.RP_ENDPOINT}`;
    const rp = await fetch(`${base}/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RP_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!rp.ok) {
      return Response.json(
        { error: "RunPod run error", details: await rp.text() },
        { status: rp.status, headers: cors }
      );
    }

    const data = await rp.json();
    const jobId = data.id || data.requestId || data.data?.id;
    if (!jobId) {
      return Response.json(
        { error: "RunPod no devolvió ID", raw: data },
        { status: 500, headers: cors }
      );
    }

    return Response.json({ jobId }, { headers: cors });
  } catch (err) {
    return Response.json(
      { error: err?.message || "Server error" },
      { status: 500, headers: cors }
    );
  }
}

export const config = {
  runtime: "edge",
};
