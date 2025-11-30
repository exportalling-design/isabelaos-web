// api/status.js
// Devuelve el estado de un job de RunPod (solo imágenes)

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const { id } = req.query;
  if (!id) {
    res.status(400).json({ ok: false, error: "Missing id" });
    return;
  }

  const endpointId = process.env.RUNPOD_ENDPOINT_ID;
  const apiKey = process.env.RUNPOD_API_KEY;

  if (!endpointId || !apiKey) {
    res.status(500).json({
      ok: false,
      error: "RunPod env vars not configured",
    });
    return;
  }

  try {
    // Endpoint clásico de status de RunPod v2
    const url = `https://api.runpod.ai/v2/${endpointId}/status/${id}`;

    const rpRes = await fetch(url, {
      method: "GET",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
    });

    const text = await rpRes.text();

    if (!rpRes.ok) {
      console.error("[STATUS] RunPod error:", rpRes.status, text);
      res.status(500).json({
        ok: false,
        error: "RunPod status failed",
        statusCode: rpRes.status,
        body: text,
      });
      return;
    }

    const data = JSON.parse(text || "{}");

    // data.status: IN_QUEUE | IN_PROGRESS | COMPLETED | FAILED
    // data.output: { image_b64: "..." } cuando COMPLETED
    const status = data.status || "UNKNOWN";
    const output = data.output || null;

    res.status(200).json({
      ok: true,
      status,
      output,   // mantiene el formato que ya usábamos: { image_b64: ... }
      raw: data,
    });
  } catch (err) {
    console.error("[STATUS] Exception:", err);
    res.status(500).json({
      ok: false,
      error: "Status handler exception",
      message: String(err),
    });
  }
}

