// /api/generate-video-sls.js
import { runpodServerlessRun } from "./runpod-sls-client.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const apiKey = process.env.RUNPOD_SLS_API_KEY;
    const endpointId = process.env.RUNPOD_WAN22_T2V_ENDPOINT_ID;

    const { prompt, negative, seconds, fps, seed, width, height } = req.body || {};

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing prompt" });
    }

    // Input que le mandas al worker (ajústalo a tu worker real)
    const input = {
      mode: "t2v",
      prompt,
      negative: negative || "",
      seconds: seconds ?? 4,
      fps: fps ?? 16,
      seed: seed ?? -1,
      width: width ?? 768,
      height: height ?? 432,
    };

    const rp = await runpodServerlessRun({ endpointId, apiKey, input });

    // rp típicamente devuelve { id, status: "IN_QUEUE" ... }
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
