// pages/api/generate-video.js

export default async function handler(req, res) {
  console.log("📩 /api/generate-video recibido:", req.method, req.body);

  // Solo aceptamos POST
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    const workerBase = process.env.VIDEO_WORKER_URL;
    console.log("🔧 VIDEO_WORKER_URL =", workerBase);

    if (!workerBase) {
      console.log("❌ ERROR: Falta VIDEO_WORKER_URL en variables de entorno");
      return res.status(500).json({
        ok: false,
        error: "VIDEO_WORKER_URL no está configurado en Vercel",
      });
    }

    // Construimos la URL completa hacia FastAPI dentro del pod
    const url = workerBase.endsWith("/")
      ? `${workerBase}api/video`
      : `${workerBase}/api/video`;

    console.log("🌐 Enviando solicitud al pod de RunPod:", url);

    // Mandamos todo el body tal cual (prompt, negative, aspectRatio, etc.)
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });

    console.log("📥 Status del pod:", response.status);

    const data = await response.json().catch((e) => {
      console.log("⚠️ Error al parsear JSON del pod:", e);
      return null;
    });

    console.log("📦 Contenido devuelto por el pod:", data);

    // FastAPI devolverá: { status: "ok" | "error", filename, url }
    if (!response.ok || !data || data.status !== "ok") {
      return res.status(500).json({
        ok: false,
        error: "El worker devolvió un error",
        detalles: data,
      });
    }

    // Enviamos a la web una respuesta simple con la URL del video
    return res.status(200).json({
      ok: true,
      filename: data.filename,
      videoUrl: data.url,
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
