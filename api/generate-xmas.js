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

    if (!body || !body.image || !body.prompt) {
      return new Response(
        JSON.stringify({ error: "Missing image or prompt" }),
        { status: 400, headers: cors }
      );
    }

    const endpoint = process.env.VITE_RUNPOD_XMAS_ENDPOINT;
    const apiKey = process.env.VITE_RUNPOD_API_KEY;

    if (!endpoint || !apiKey) {
      return new Response(
        JSON.stringify({ error: "Missing RunPod ENV variables" }),
        { status: 500, headers: cors }
      );
    }

    const runpodURL = `https://api.runpod.ai/v2/${endpoint}/run`;

    const runpodRes = await fetch(runpodURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: {
          action: "generate_xmas",
          image: body.image,
          prompt: body.prompt,
        },
      }),
    });

    if (!runpodRes.ok) {
      return new Response(
        JSON.stringify({
          error: "RunPod error",
          status: runpodRes.status
        }),
        { status: 500, headers: cors }
      );
    }

    const data = await runpodRes.json();

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: cors,
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: cors }
    );
  }
}

