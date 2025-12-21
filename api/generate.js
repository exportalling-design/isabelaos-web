// /api/generate.js
export default async function handler(req, res) {
  // CORS básico
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const body = req.body || {};
    if (!body.prompt) {
      return res.status(400).json({ ok: false, error: "Missing prompt" });
    }

    // Mantengo tu lógica: RUNPOD_ENDPOINT_ID primero, luego RP_ENDPOINT
    const endpointId = process.env.RUNPOD_ENDPOINT_ID || process.env.RP_ENDPOINT;
    const apiKey = process.env.RP_API_KEY;

    if (!apiKey || !endpointId) {
      return res.status(500).json({
        ok: false,
        error: "Missing RP_API_KEY or RUNPOD_ENDPOINT_ID/RP_ENDPOINT",
      });
    }

    const base = `https://api.runpod.ai/v2/${endpointId}`;

    const rpRes = await fetch(`${base}/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
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

    const txt = await rpRes.text();

    if (!rpRes.ok) {
      return res.status(rpRes.status).json({
        ok: false,
        error: "RunPod run error",
        details: txt.slice(0, 1500),
      });
    }

    let data;
    try {
      data = JSON.parse(txt);
    } catch {
      return res.status(502).json({
        ok: false,
        error: "RunPod returned non-JSON",
        raw: txt.slice(0, 1500),
      });
    }

    const jobId = data?.id || data?.requestId || data?.jobId || data?.data?.id;
    if (!jobId) {
      return res.status(502).json({
        ok: false,
        error: "RunPod no devolvió ID",
        raw: data,
      });
    }

    return res.status(200).json({ ok: true, jobId });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      detail: String(e?.message || e),
    });
  }
}
