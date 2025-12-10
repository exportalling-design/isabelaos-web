// api/generateVideo.js – Función serverless en Vercel
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { prompt, seed } = req.body || {};

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Prompt requerido." });
    }

    const workerUrl = process.env.VIDEO_WORKER_URL;
    if (!workerUrl) {
      return res
        .status(500)
        .json({ error: "VIDEO_WORKER_URL no está configurado en Vercel." });
    }

    const rpRes = await fetch(`${workerUrl}/api/video`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        seed: seed ?? 1234,
      }),
    });

    const data = await rpRes.json().catch(() => ({}));

    if (!rpRes.ok) {
      console.error("Video worker error:", data);
      return res
        .status(500)
        .json({ error: "Error en el video worker.", detail: data });
    }

    // Por ahora devolvemos tal cual lo que responde el pod:
    //  { status, filename, url }
    return res.status(200).json(data);
  } catch (err) {
    console.error("generateVideo error:", err);
    return res.status(500).json({ error: "Error interno en generateVideo." });
  }
}
