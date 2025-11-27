export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, negative_prompt, width, height, steps } = req.body || {};

  if (!prompt) {
    return res.status(400).json({ error: 'Missing prompt' });
  }

  const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
  const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;

  if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT_ID) {
    return res.status(500).json({ error: 'RunPod env vars not configured' });
  }

  try {
    // 1) Lanzar job en RunPod
    const runResponse = await fetch(
      `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/run`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${RUNPOD_API_KEY}`,
        },
        body: JSON.stringify({
          input: {
            prompt,
            negative_prompt: negative_prompt || '',
            width: width || 512,
            height: height || 512,
            steps: steps || 22,
          },
        }),
      }
    );

    const runData = await runResponse.json();

    if (!runResponse.ok) {
      console.error('RunPod /run error:', runData);
      return res
        .status(500)
        .json({ error: 'Error al lanzar el job en RunPod', details: runData });
    }

    const jobId = runData.id;
    if (!jobId) {
      return res
        .status(500)
        .json({ error: 'RunPod no devolvió un job ID válido', runData });
    }

    // 2) Polling de estado
    let statusData = null;
    const startTime = Date.now();
    const TIMEOUT_MS = 60_000; // 60s

    while (true) {
      const statusResponse = await fetch(
        `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/status/${jobId}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${RUNPOD_API_KEY}`,
          },
        }
      );

      statusData = await statusResponse.json();

      if (!statusResponse.ok) {
        console.error('RunPod /status error:', statusData);
        return res
          .status(500)
          .json({ error: 'Error al consultar el estado en RunPod', statusData });
      }

      const status = statusData.status;

      if (status === 'COMPLETED') break;

      if (status === 'FAILED' || status === 'CANCELLED') {
        return res.status(500).json({
          error: 'Job falló en RunPod',
          status,
          statusData,
        });
      }

      if (Date.now() - startTime > TIMEOUT_MS) {
        return res.status(504).json({
          error: 'Job en RunPod tardó demasiado (timeout)',
          statusData,
        });
      }

      await new Promise((r) => setTimeout(r, 2000));
    }

    const output = statusData.output || {};
    return res.status(200).json({
      ok: true,
      output,
    });
  } catch (err) {
    console.error('Error general en /api/generate:', err);
    return res.status(500).json({
      error: 'Error interno del servidor al llamar RunPod',
      details: String(err),
    });
  }
}
