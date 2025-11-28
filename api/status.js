// api/status.js
export default async function handler(req) {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("id");

    if (!jobId) {
      return new Response(
        JSON.stringify({ error: "Missing job id" }),
        { status: 400, headers: cors }
      );
    }

    const base = `https://api.runpod.ai/v2/${process.env.RP_ENDPOINT}`;
    const rp = await fetch(`${base}/status/${jobId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.RP_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    const data = await rp.json();

    if (!rp.ok) {
      return new Response(
        JSON.stringify({ error: "RunPod status error", data }),
        { status: rp.status, headers: cors }
      );
    }

    const status = data.status;
    const outputUrl =
      data.output?.image_path ||
      data.output?.imageUrl ||
      null;

    return new Response(
      JSON.stringify({
        ok: true,
        runpodStatus: status,   // 👈 ESTA es la propiedad del estado
        outputUrl,              // 👈 aquí viene la imagen
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

