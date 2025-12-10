export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Método no permitido" });
    }

    const {
      prompt,
      negative_prompt,
      aspect_ratio,
      duration,
      quality,
      optimized_prompt,
      optimized_negative
    } = req.body;

    const workerUrl = process.env.VIDEO_WORKER_URL;

    if (!workerUrl) {
      return res.status(500).json({
        ok: false,
        error: "Falta VIDEO_WORKER_URL en variables de entorno"
      });
    }

    const response = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        negative_prompt,
        aspect_ratio,
        duration,
        quality,
        optimized_prompt,
        optimized_negative
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        ok: false,
        error: data.error || "Error en worker de video"
      });
    }

    return res.status(200).json({
      ok: true,
      jobId: data.jobId
    });

  } catch (err) {
    console.error("Error en generate-video:", err);
    return res.status(500).json({
      ok: false,
      error: "Error inesperado en /api/generate-video"
    });
  }
}
