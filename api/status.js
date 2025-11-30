
// api/status.js
// Consulta el estado de un job en RunPod y devuelve un JSON simple para el frontend.

export default async function handler(req, res) {
  try {
    const { id: jobId } = req.query;

    if (!jobId) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing jobId parameter" });
    }

    const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
    const RUNPOD_ENDPOINT = process.env.RUNPOD_ENDPOINT; // mismo nombre que usa generate.js

    if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT) {
      console.error(
        "[status] RunPod env vars not configured (RUNPOD_API_KEY / RUNPOD_ENDPOINT)"
      );
      return res.status(500).json({
        ok: false,
        error: "RunPod env vars not configured",
      });
    }

    const url = `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT}/status/${jobId}`;

    const rpRes = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RUNPOD_API_KEY}`,
      },
    });

    const data = await rpRes.json();

    // Log útil para depurar
    console.log("[status] RunPod response:", {
      status: data.status,
      id: data.id,
    });

    // Respuesta simplificada para el frontend
    return res.status(200).json({
      ok: true,
      status: data.status, // IN_QUEUE, IN_PROGRESS, COMPLETED, FAILED...
      output: data.output ?? null,
      raw: data,
    });
  } catch (err) {
    console.error("[status] Error:", err);
    return res.status(500).json({
      ok: false,
      error: String(err),
    });
  }
}

