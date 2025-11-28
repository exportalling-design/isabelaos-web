// api/generate.js
export default async function handler(req) {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };

  // Preflight CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: cors });
  }

  try {
    const body = await req.json();

    if (!body?.prompt) {
      return new Response(
        JSON.stringify({ error: "Missing prompt" }),
        { status: 400, headers: cors }
      );
    }

    const base = `https://api.runpod.ai/v2/${process.env.RP_ENDPOINT}`;

    // 1) Lanzar job en RunPod (solo /run, sin hacer polling aquí)
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

    // JobId puede venir en diferentes campos
    const jobId = data.id || data.requestId || data.data?.id;

    if (!jobId) {
      return new Response(
        JSON.stringify({ error: "RunPod no devolvió ID", raw: data }),
        { status: 500, headers: cors }
      );
    }

    // Devolvemos rápido el ID, sin esperar al resultado
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
