// pages/api/generate.js
import { requireUser, getActivePlan, getTodayImageCount, spendJades } from "../../lib/apiAuth";

export default async function handler(req, res) {
  // CORS básico (si lo necesitás)
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const { sb, user } = await requireUser(req);

    const body = req.body || {};
    if (!body.prompt) return res.status(400).json({ ok: false, error: "Missing prompt" });

    const sub = await getActivePlan(sb, user.id);

    // ✅ Reglas:
    // - Si tiene sub activa: cobra jades por img_prompt (1)
    // - Si NO tiene sub activa: solo FREE_DAILY_IMAGES gratis; luego bloquea
    const freeLimit = parseInt(process.env.FREE_DAILY_IMAGES || "3", 10);

    let billing = { mode: "free" };

    if (sub.plan) {
      // cobra
      const ref = `img:${Date.now()}`;
      const spent = await spendJades(sb, user.id, "img_prompt", ref);
      billing = { mode: "jades", cost: spent.cost, new_balance: spent.new_balance };
    } else {
      const cnt = await getTodayImageCount(sb, user.id);
      if (cnt >= freeLimit) {
        return res.status(403).json({ ok: false, error: "FREE_LIMIT_REACHED", freeLimit });
      }
    }

    // RunPod endpoint (tu lógica actual)
    const endpointId = process.env.RUNPOD_ENDPOINT_ID || process.env.RP_ENDPOINT;
    const apiKey = process.env.RP_API_KEY;

    if (!apiKey || !endpointId) {
      return res.status(500).json({ ok: false, error: "Missing RP_API_KEY or endpointId" });
    }

    const base = `https://api.runpod.ai/v2/${endpointId}`;

    const rp = await fetch(`${base}/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: {
          prompt: body.prompt,
          negative_prompt: body.negative_prompt || "",
          width: body.width || 512,
          height: body.height || 512,
          steps: body.steps || 22,
        },
      }),
    });

    if (!rp.ok) {
      const txt = await rp.text().catch(() => "");
      return res.status(rp.status).json({ ok: false, error: "RunPod run error", details: txt });
    }

    const data = await rp.json();
    const jobId = data.id || data.requestId || data.jobId || data.data?.id;
    if (!jobId) return res.status(500).json({ ok: false, error: "RunPod no devolvió ID", raw: data });

    // guarda en generations (opcional pero recomendado)
    try {
      await sb.from("generations").insert({
        user_id: user.id,
        kind: "img_prompt",
        job_id: jobId,
        prompt: body.prompt,
      });
    } catch {}

    return res.status(200).json({ ok: true, jobId, billing, plan: sub.plan });
  } catch (e) {
    const code = e.statusCode || 500;
    return res.status(code).json({ ok: false, error: String(e.message || e) });
  }
}
