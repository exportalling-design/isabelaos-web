// pages/api/generate-xmas.js
// Lanza un job especial "navidad_estudio" en RunPod
// para la Foto Navideña IA de estudio

export default async function handler(req, res) {
  // CORS básico
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader(
    "access-control-allow-methods",
    "POST, OPTIONS"
  );
  res.setHeader(
    "access-control-allow-headers",
    "content-type"
  );

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Solo aceptamos POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // En API routes de Next la data viene en req.body
    const body = req.body || {};

    if (!body.image_b64) {
      return res
        .status(400)
        .json({ error: "Falta image_b64 en el cuerpo." });
    }

    const image_b64 = body.image_b64;
    const description = body.description || "";

    // Usa EXACTAMENTE el mismo endpoint ID y API key que en /api/generate.js
    const endpointId = process.env.RUNPOD_ENDPOINT_ID;
    const apiKey = process.env.RUNPOD_API_KEY;

    if (!endpointId || !apiKey) {
      return res.status(500).json({
        error:
          "Faltan RUNPOD_ENDPOINT_ID o RUNPOD_API_KEY en las variables de entorno.",
      });
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
          action: "navidad_estudio", // 👈 NUEVO MODO
          image_b64,
          description,
        },
      }),
    });

    const data = await rpRes.json().catch(() => null);

    if (!rpRes.ok || !data || data.error) {
      console.error("Error RunPod generate-xmas:", data);
      return res.status(500).json({
        ok: false,
        error: data?.error || "Error al lanzar job en RunPod.",
      });
    }

    // RunPod responde algo tipo { id: "jobId", status: "IN_QUEUE", ... }
    return res.status(200).json({
      ok: true,
      jobId: data.id,
    });
  } catch (err) {
    console.error("Error en /api/generate-xmas:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || String(err),
    });
  }
}
