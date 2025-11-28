// api/generate.js  --- SOLO lanza el job en RunPod y devuelve jobId

export default async function handler(req) {
  // CORS básico
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };

  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  // Solo aceptamos POST
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: cors });
  }

  try {
    const body = await req.json().catch(() => null);

    if (!body || !body.prompt) {
      return new Response(
        JSON.stringify({ error: "Missing prompt" }),
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
      body: JSON.stringify({
        input: {
          prompt: body.prompt,
          negative_prompt: body.negative_prompt || "",
          width: body.width || 512,
          height: body.height || 512,
          steps: body.steps || 22,
        },
      }),
    });

    if (!rp.ok) {
      const txt = await rp.text();
      return new Response(
        JSON.stringify({ error: "RunPod run error", details: txt }),
        { status: rp.status, headers: cors }
      );
    }

    const data = await rp.json();

    // Distintos nombres posibles para el ID
    const jobId = data.id || data.requestId || data.jobId || data.data?.id;

    if (!jobId) {
      return new Response(
        JSON.stringify({ error: "RunPod no devolvió ID", raw: data }),
        { status: 500, headers: cors }
      );
    }

    // AQUÍ ya no hacemos polling, solo devolvemos el ID
    return new Response(
      JSON.stringify({ ok: true, jobId }),
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
