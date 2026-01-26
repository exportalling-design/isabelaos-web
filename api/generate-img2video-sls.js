// /api/generate-img2video-sls.js
import { runpodServerlessRun } from "./runpod-sls-client.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const apiKey = process.env.RUNPOD_SLS_API_KEY;
    const endpointId = process.env.RUNPOD_WAN22_I2V_ENDPOINT_ID;

    const { imageUrl, imageB64, prompt, negative, seconds, fps, seed } = req.body || {};

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing prompt" });
    }
    if (!imageUrl && !imageB64) {
      return res.status(400).json({ error: "Provide imageUrl or imageB64" });
    }

    const input = {
      mode: "i2v",
      prompt,
      negative: negative || "",
      seconds: seconds ?? 4,
      fps: fps ?? 16,
      seed: seed ?? -1,
      imageUrl: imageUrl || null,
      imageB64: imageB64 || null,
    };

    const rp = await runpodServerlessRun({ endpointId, apiKey, input });

    return res.status(200).json({
      ok: true,
      serverless: true,
      requestId: rp.id || rp.requestId || null,
      raw: rp,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}
