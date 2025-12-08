// api/generate-xmas.js
// FOTO NAVIDEÑA: llama a RunPod y devuelve image_b64 directo

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export default async function handler(req) {
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

    if (!body || !body.image_b64) {
      return new Response(
        JSON.stringify({ error: "Falta image_b64 en el cuerpo." }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const image_b64 = body.image_b64;
    const description = body.description || "";
    const userId = body.userId || "";
    const email = body.email || "";
    const plan = body.plan || "";

    const endpointId =
      process.env.RUNPOD_ENDPOINT_ID || process.env.RP_ENDPOINT;
    const apiKey =
      process.env.RUNPOD_API_KEY || process.env.RP_API_KEY;

    if (!endpointId || !apiKey) {
      return new Response(
        JSON.stringify({
          error:
            "Faltan RUNPOD_ENDPOINT_ID/RP_ENDPOINT o RUNPOD_API_KEY/RP_API_KEY.",
        }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const url = `https://api.runpod.ai/v2/${endpointId}/runsync`;

    const rpRes = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: {
          action: "navidad_estudio",
          image_b64,
          description,
          meta: { userId, email, plan, from: "xmas_photo" },
        },
      }),
    });

    const data = await rpRes.json().catch(() => null);

    if (!rpRes.ok || !data || data.error) {
      return new Response(
        JSON.stringify({
          error: data?.error || "Error en runsync de RunPod",
          raw: data,
        }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const output = data.output || data;
    const resultB64 =
      output?.image_b64 ||
      output?.image ||
      output?.output_image ||
      (Array.isArray(output) && output[0]?.image_b64) ||
      null;

    if (!resultB64) {
      return new Response(
        JSON.stringify({
          error: "RunPod no devolvió image_b64",
          raw: data,
        }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, image_b64: resultB64 }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err?.message || String(err) }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
}

export const config = {
  runtime: "edge",
};
