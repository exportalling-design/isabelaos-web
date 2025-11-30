// api/status.js
// Consulta el estado de un job en RunPod y devuelve la info tal como la usabas antes.

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const { id } = req.query || {};
    const jobId = Array.isArray(id) ? id[0] : id;

    if (!jobId) {
      res.status(400).json({ ok: false, error: "Missing job id" });
      return;
    }

    const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
    const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;

    if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT_ID) {
      // 👀 mensaje distinto para saber que este archivo nuevo sí se desplegó
      res.status(500).json({
        ok: false,
        error: "RunPod config missing in isabelaos-web (status.js)",
      });
      return;
    }

    const url = `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/status/${jobId}`;

    const rpRes = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${RUNPOD_API_KEY}`,
      },
    });

    const rpJson = await rpRes.json();

    if (!rpRes.ok) {
      res.status(500).json({
        ok: false,
        error: "RunPod status error",
        raw: rpJson,
      });
      return;
    }

    const runpodStatus = rpJson.status || rpJson.jobStatus || "UNKNOWN";
    const output = rpJson.output || null;

    // Forma parecida a lo que veías en PowerShell:
    // ok  runpodStatus  output  raw
    res.status(200).json({
      ok: true,
      runpodStatus,
      output,
      raw: rpJson,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: `Exception in status: ${err.message}`,
    });
  }
}


