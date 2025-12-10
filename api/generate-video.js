// /api/generate-video.js

export default async function handler(req, res) {
  console.log("📩 /api/generate-video recibido:", req.method, req.body);

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Método no permitido" });
    }

    const baseUrl = process.env.VIDEO_WORKER_URL;
    console.log("🔧 VIDEO_WORKER_URL =", baseUrl);

    if (!baseUrl) {
      console.log("❌ ERROR: Falta VIDEO_WORKER_URL en variables de entorno");
      return res.status(500).json({
        ok: false,
        error: "VIDEO_WORKER_URL no está configurado en Vercel",
      });
    }

    // Nos aseguramos de NO duplicar barras y agregar /api/video
    const workerUrl = `${baseUrl.replace(/\/$/, "")}/api/video`;
    console.log("🌐 Enviando solicitud al worker de RunPod:", workerUrl);

    // El cuerpo que llega desde el frontend trae prompt, aspectRatio, etc.
    // FastAPI solo usa `prompt` (y opcionalmente `seed`), el resto lo ignora.
    const response = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: req.body.prompt,
        seed: req.body.seed || null,
      }),
    });

    console.log("📥 Respuesta del worker:", response.status);

    const data = await response.json().catch((e) => {
      console.log("⚠️ Error al parsear JSON del worker:", e);
      return null;
    });

    console.log("📦 Contenido devuelto por worker:", data);

    // Esperamos algo como:
    // { status: "ok", filename: "COG5B_API_....mp4", url: "/output/archivo.mp4" }
    if (!response.ok || !data || data.status !== "ok") {
      return res.status(500).json({
        ok: false,
        error: "El worker devolvió un error",
        detalles: data,
      });
    }

    // Proxy limpio hacia el frontend
    return res.status(200).json({
      ok: true,
      filename: data.filename,
      videoUrl: data.url,
      raw: data,
    });
  } catch (err) {
    console.log("💥 ERROR EN /api/generate-video:", err);
    return res.status(500).json({
      ok: false,
      error: "Error inesperado en /api/generate-video",
      detalles: String(err),
    });
  }
}
