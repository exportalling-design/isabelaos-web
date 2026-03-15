// api/montaje-status.js
// Consulta el estado de un job de RunPod para Montaje IA
// Devuelve image_data_url listo para el frontend

export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const { jobId } = req.body || {};
    if (!jobId) {
      return res.status(400).json({ ok: false, error: "Falta jobId" });
    }

    const endpointId = process.env.RUNPOD_ENDPOINT_ID;
    const apiKey = process.env.RUNPOD_API_KEY;

    if (!endpointId || !apiKey) {
      return res.status(500).json({
        ok: false,
        error: "Faltan RUNPOD_ENDPOINT_ID o RUNPOD_API_KEY",
      });
    }

    const url = `https://api.runpod.ai/v2/${endpointId}/status/${jobId}`;
    const r = await fetch(url, {
      headers: {
        authorization: `Bearer ${apiKey}`,
      },
    });

    const data = await r.json().catch(() => null);

    if (!r.ok || !data) {
      return res.status(500).json({
        ok: false,
        error: "Error consultando status en RunPod",
      });
    }

    const status = String(data.status || "").toUpperCase();

    // Aún sigue procesando
    if (status !== "COMPLETED" && status !== "FAILED" && status !== "CANCELLED") {
      return res.status(200).json({
        ok: true,
        done: false,
        status: data.status,
      });
    }

    // Falló
    if (status === "FAILED" || status === "CANCELLED") {
      const workerError =
        data?.output?.error ||
        data?.error ||
        "No se pudo completar la generación.";

      return res.status(200).json({
        ok: false,
        done: true,
        error: workerError,
        status,
      });
    }

    // Completed pero con error lógico
    if (data?.output?.error) {
      return res.status(200).json({
        ok: false,
        done: true,
        error: data.output.error,
        status,
      });
    }

    // Intenta varias llaves por compatibilidad
    const imageDataUrl =
      data?.output?.image_data_url ||
      data?.output?.data_url ||
      null;

    const imageB64 =
      data?.output?.image_b64 ||
      data?.output?.result_b64 ||
      data?.output?.resultBase64 ||
      data?.output?.image_base64 ||
      data?.output?.image ||
      "";

    if (imageDataUrl) {
      return res.status(200).json({
        ok: true,
        done: true,
        image_data_url: imageDataUrl,
      });
    }

    if (imageB64) {
      const finalDataUrl = `data:image/jpeg;base64,${imageB64}`;

      console.log("MONTAJE b64 prefix:", imageB64.slice(0, 8), "len:", imageB64.length);

      return res.status(200).json({
        ok: true,
        done: true,
        image_data_url: finalDataUrl,
      });
    }

    return res.status(200).json({
      ok: false,
      done: true,
      error: "COMPLETED pero sin imagen en la salida.",
      status,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
}
