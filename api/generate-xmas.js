// api/generate-xmas.js
// Endpoint ESPECIAL para foto navideña desde imagen subida

const XMAS_PROMPT_BASE =
  "christmas studio portrait, cozy warm lighting, decorated christmas tree, gifts, professional photography, premium studio setup, ultra realistic, 8k, cinematic lighting, detailed skin, perfect composition";

const XMAS_NEGATIVE =
  "distorted, blurry, bad hands, bad faces, low quality, watermark, text, logo, extra limbs, overexposed";

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
        JSON.stringify({ error: "Falta init_image_b64 (foto en base64)." }),
        { status: 400, headers: { ...cors, "content-type": "application/json" } }
      );
    }

    const { init_image_b64, extraPrompt } = body;

    const prompt =
      XMAS_PROMPT_BASE + (extraPrompt ? `, ${extraPrompt}` : "");

    const input = {
      mode: "xmas_photo",
      init_image_b64,
      prompt,
      negative_prompt: XMAS_NEGATIVE,
      steps: 30,
      strength: 0.6,
      width: 768,
      height: 1024,
    };

    const endpointId = process.env.RP_ENDPOINT; // mismo que usas en /api/generate
    const apiKey = process.env.RUNPOD_API_KEY;

    if (!endpointId || !apiKey) {
      return new Response(
        JSON.stringify({ error: "Faltan RP_ENDPOINT o RUNPOD_API_KEY." }),
        { status: 500, headers: { ...cors, "content-type": "application/json" } }
      );
    }

    const rpRes = await fetch(
      `https://api.runpod.ai/v2/${endpointId}/run`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ input }),
      }
    );

    const rpJson = await rpRes.json();

    if (!rpRes.ok || rpJson.error) {
      console.error("Error RunPod Xmas:", rpJson);
      return new Response(
        JSON.stringify({
          error: rpJson.error || "Error al crear job en RunPod (Navidad).",
        }),
        { status: 500, headers: { ...cors, "content-type": "application/json" } }
      );
    }

    // Igual que /api/generate: devolvemos jobId
    return new Response(
      JSON.stringify({ ok: true, jobId: rpJson.id }),
      { status: 200, headers: { ...cors, "content-type": "application/json" } }
    );
  } catch (err) {
    console.error("Error en /api/generate-xmas:", err);
    return new Response(
      JSON.stringify({ error: "Error interno en generate-xmas." }),
      { status: 500, headers: { ...cors, "content-type": "application/json" } }
    );
  }
}
