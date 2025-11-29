// api/status.js
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ error: 'Missing id' });
  }

  const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
  const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;

  if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT_ID) {
    return res
      .status(500)
      .json({ error: 'RunPod env vars not configured' });
  }

  const base = `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}`;

  try {
    const rp = await fetch(`${base}/status/${id}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${RUNPOD_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const statusData = await rp.json();

    if (!rp.ok) {
      return res.status(500).json({
        error: 'RunPod status error',
        statusData,
      });
    }

    // Devolvemos EXACTAMENTE lo que diga RunPod
    return res.status(200).json(statusData);
  } catch (e) {
    console.error('Error en /api/status:', e);
    return res.status(500).json({
      error: 'Server error',
      details: String(e),
    });
  }
}

