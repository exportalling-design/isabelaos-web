export default async function handler(req, res) {
  try {
    const RUNPOD_API_KEY = process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY;
    if (!RUNPOD_API_KEY) return res.status(400).json({ ok:false, error:"Missing RUNPOD_API_KEY" });

    const r = await fetch("https://rest.runpod.io/v1/gpuTypes", {
      headers: {
        Authorization: `Bearer ${RUNPOD_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    const t = await r.text();
    if (!r.ok) return res.status(r.status).json({ ok:false, error:t });

    const j = JSON.parse(t);

    // Filtra solo NVIDIA y los que nos interesan
    const wanted = ["H100", "A100", "RTX 6000 Ada", "6000 Ada", "A100 SXM", "A100 PCIe"];
    const out = (j || [])
      .map(x => ({
        id: x.id,
        displayName: x.displayName || x.name,
        memoryInGb: x.memoryInGb,
        securePrice: x.securePrice,
      }))
      .filter(x => wanted.some(k => String(x.displayName || "").includes(k)));

    return res.status(200).json({ ok:true, gpus: out });
  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e?.message || e) });
  }
}