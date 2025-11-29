export default async function handler(req, res) {
  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ ok: false, error: "Missing jobId" });
    }

    const RUNPOD_ENDPOINT = process.env.RUNPOD_ENDPOINT_ID;
    const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;

    const url = `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT}/status/${id}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `${RUNPOD_API_KEY}`
      }
    });

    const json = await response.json();
    return res.status(200).json(json);

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.toString() });
  }
}

