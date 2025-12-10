export default async function handler(req, res) {
  console.log("📩 /api/generate-video recibido:", req.method, req.body);

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Método no permitido" });
    }

    const workerUrl = process.env.VIDEO_WORKER_URL;

    console.log("🔧 VIDEO_WORKER_URL =", workerUrl);

    if (!workerUrl) {
      console.log("❌ ERROR: Falta VIDEO_WORKER_URL en variables de entorno");
      return res.status(500).json({
        ok: false,
        error: "VIDEO_WORKER_URL no está configurado en Vercel"
      });
    }

    console.log("🌐 Enviando solicitud al worker de RunPod...");

    const response = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body)
    });

    console.log("📥 Respuesta del worker:", response.status);

    const data = await response.json().catch((e) => {
      console.log("⚠️ Error al parsear JSON:", e);
      return null;
    });

    console.log("📦 Contenido devuelto por worker:", data);

    if (!response.ok || !data) {
      return res.status(500).json({
        ok: false,
        error: "El worker devolvió un error",
        detalles: data
      });
    }

    return res.status(200).json({
      ok: true,
      jobId: data.jobId,
      raw: data
    });

  } catch (err) {
    console.log("💥 ERROR EN generate-video.js:", err);
    return res.status(500).json({
      ok: false,
      error: "Error inesperado en /api/generate-video",
      detalles: String(err)
    });
  }
}
