// api/generate-xmas.js --- Lanza job "xmas_photo" (Foto Navideña IA) y devuelve jobId

export default async function handler(req) {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };

  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: cors,
    });
  }

  try {
    const body = await req.json().catch(() => null);

    if (!body || !body.init_image_b64) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Missing init_image_b64 (foto base) en el cuerpo del request.",
        }),
        { status: 400, headers: cors }
      );
    }

    const {
      init_image_b64,
      extra_prompt,
      width,
      height,
      steps,
      strength,
      guidance_scale,
      seed,
    } = body;

    const RP_ENDPOINT_ID = process.env.RP_ENDPOINT_ID;
    const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;

    if (!RP_ENDPOINT_ID || !RUNPOD_API_KEY) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Faltan RP_ENDPOINT_ID o RUNPOD_API_KEY en las variables de entorno.",
        }),
        { status: 500, headers: cors }
      );
    }

    const base = `https://api.runpod.ai/v2/${RP_ENDPOINT_ID}`;

    const runRes = await fetch(`${base}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RUNPOD_API_KEY}`,
      },
      body: JSON.stringify({
        input: {
          action: "xmas_photo",
          init_image_b64,
          extra_prompt: extra_prompt || "",
          width: Number(width) || 768,
          height: Number(height) || 1024,
          steps: Number(steps) || 30,
          strength: strength !== undefined ? Number(strength) : 0.6,
          guidance_scale:
            guidance_scale !== undefined ? Number(guidance_scale) : 7.5,
          seed: seed ?? null,
        },
      }),
    });

    const data = await runRes.json().catch(() => null);

    if (!runRes.ok || !data || !data.id) {
      console.error("Error RunPod /run xmas_photo:", data);
      return new Response(
        JSON.stringify({
          ok: false,
          error: data?.error || "Error lanzando job navideño en RunPod",
        }),
        { status: 500, headers: cors }
      );
    }

    // Devolvemos el jobId al frontend
    return new Response(
      JSON.stringify({ ok: true, jobId: data.id }),
      { status: 200, headers: cors }
    );
  } catch (err) {
    console.error("Error en /api/generate-xmas:", err);
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: cors }
    );
  }
}

