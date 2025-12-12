export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });

  try {
    const workerBase = process.env.VIDEO_WORKER_URL; // ej: https://xxxx-8000.proxy.runpod.net
    if (!workerBase) return res.status(500).json({ ok: false, error: "Falta VIDEO_WORKER_URL" });

    const url = workerBase.endsWith("/") ? `${workerBase}api/video` : `${workerBase}/api/video`;

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });

    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
