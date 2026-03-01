// api/headshot-status.js
export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });

  try {
    const { jobId } = req.body || {};
    if (!jobId) return res.status(400).json({ ok: false, error: "Falta jobId" });

    const endpointId = process.env.RUNPOD_ENDPOINT_ID;
    const apiKey = process.env.RUNPOD_API_KEY;
    if (!endpointId || !apiKey) {
      return res.status(500).json({ ok: false, error: "Faltan RUNPOD_ENDPOINT_ID o RUNPOD_API_KEY" });
    }

    const url = `https://api.runpod.ai/v2/${endpointId}/status/${jobId}`;
    const r = await fetch(url, { headers: { authorization: `Bearer ${apiKey}` } });
    const data = await r.json().catch(() => null);

    if (!r.ok || !data) return res.status(500).json({ ok: false, error: "Error consultando status en RunPod" });

    const status = String(data.status || "").toUpperCase();
    if (status !== "COMPLETED") {
      return res.status(200).json({ ok: true, done: false, status: data.status });
    }

    const b64 = data?.output?.image_b64 || "";
    if (!b64) {
      return res.status(200).json({ ok: true, done: true, error: "COMPLETED pero sin output.image_b64" });
    }

    // ✅ aquí el fix: armar DataURL correcto
    const image_data_url = `data:image/jpeg;base64,${b64}`;

    // debug útil
    console.log("HEADSHOT b64 prefix:", b64.slice(0, 8), "len:", b64.length);

    return res.status(200).json({
      ok: true,
      done: true,
      image_data_url,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
