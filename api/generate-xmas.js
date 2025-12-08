// api/generate-xmas.js
// Lanza un job especial "navidad_estudio" en RunPod
// para la Foto Navideña IA de estudio

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

    // Usa EXACTAMENTE el mismo endpoint ID y API key que en /api/generate.js.
    // Soporta ambos nombres de variables por si acaso:
    const endpointId =
      process.env.RUNPOD_ENDPOINT_ID || process.env.RP_ENDPOINT;
    const apiKey =
      process.env.RUNPOD_API_KEY || process.env.RP_API_KEY;

    if (!endpointId || !apiKey) {
      return new Response(
        JSON.stringify({
          error:
            "Faltan RUNPOD_ENDPOINT_ID/RP_ENDPOINT o RUNPOD_API_KEY/RP_API_KEY en las variables de entorno.",
        }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const url = `https://api.runpod.ai/v2/${endpointId}/run`;

    const rpRes = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: {
          action: "navidad_estudio", // 👈 modo navideño en tu worker
          image_b64,
          description,
        },
      }),
    });

    const data = await rpRes.json().catch(() => null);

    if (!rpRes.ok || !data || data.error) {
      console.error("Error RunPod generate-xmas:", data);
      return new Response(
        JSON.stringify({
          ok: false,
          error: data?.error || "Error al lanzar job en RunPod.",
        }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // RunPod responde algo tipo { id: "jobId", status: "IN_QUEUE", ... }
    return new Response(
      JSON.stringify({
        ok: true,
        jobId: data.id,
      }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error en /api/generate-xmas:", err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: err?.message || String(err),
      }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
}

// Igual que generate.js (Edge Runtime)
export const config = {
  runtime: "edge",
};
