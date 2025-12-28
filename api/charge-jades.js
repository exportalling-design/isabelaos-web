// pages/api/charge-jades.js
import { sbAdmin } from "../../lib/supabaseAdmin";
import { COSTS } from "../../lib/pricing";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  try {
    const { user_id, kind, amount, ref } = req.body || {};
    if (!user_id) return res.status(400).json({ error: "MISSING_FIELDS" });

    // ✅ Compat: si viene amount directo, úsalo. Si viene kind, usa COSTS[kind]
    let cost = null;
    if (amount != null) cost = Number(amount);
    else if (kind) cost = COSTS[kind];

    if (!cost || !Number.isFinite(cost) || cost <= 0) {
      return res.status(400).json({ error: "INVALID_COST" });
    }

    const sb = sbAdmin();

    const { data, error } = await sb.rpc("spend_jades", {
      p_user_id: user_id,
      p_amount: cost,
      p_reason: kind ? `generation:${kind}` : "spend",
      p_ref: ref || null,
    });

    if (error) {
      if ((error.message || "").includes("INSUFFICIENT_JADES")) {
        return res.status(402).json({ error: "INSUFFICIENT_JADES" });
      }
      return res.status(500).json({ error: "RPC_ERROR", detail: error.message });
    }

    return res.status(200).json({ ok: true, cost, new_balance: data?.[0]?.new_balance ?? null });
  } catch (e) {
    return res.status(500).json({ error: "SERVER_ERROR", detail: String(e) });
  }
}