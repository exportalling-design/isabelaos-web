export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
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
    const jobId = data.id || data.requestId || data.data?.id;

    if (!jobId) {
      return new Response(
        JSON.stringify({ error: "RunPod no devolvió ID", raw: data }),
        { status: 500, headers: cors }
      );
    }

    let statusData;
    const start = Date.now();
    const TIMEOUT = 60000;

    while (true) {
      const st = await fetch(`${base}/status/${jobId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${process.env.RP_API_KEY}` },
      });

      statusData = await st.json();

      if (!st.ok) {
        return new Response(
          JSON.stringify({
            error: "RunPod status error",
            statusData,
          }),
          { status: st.status, headers: cors }
        );
      }

      const status = statusData.status;

      if (status === "COMPLETED") break;

      if (status === "FAILED" || status === "CANCELLED") {
        return new Response(
          JSON.stringify({ error: "Job falló", statusData }),
          { status: 500, headers: cors }
        );
      }

      if (Date.now() - start > TIMEOUT) {
        return new Response(
          JSON.stringify({ error: "Timeout", statusData }),
          { status: 504, headers: cors }
        );
      }

      await new Promise((r) => setTimeout(r, 2000));
    }

    return new Response(
      JSON.stringify({ ok: true, output: statusData.output || {} }),
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
