// /api/jades-spend.js
import { sbAdmin } from "../lib/supabaseAdmin";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  try {
    const { user_id, amount, reason, ref } = req.body || {};
    if (!user_id || !amount) return res.status(400).json({ error: "MISSING_FIELDS" });

    const sb = sbAdmin();

    const { data, error } = await sb.rpc("spend_jades", {
      p_user_id: user_id,
      p_amount: Number(amount),
      p_reason: reason || "spend",
      p_ref: ref || null,
    });

    if (error) {
      if ((error.message || "").includes("INSUFFICIENT_JADES")) {
        return res.status(402).json({ error: "INSUFFICIENT_JADES" });
      }
      return res.status(500).json({ error: "RPC_ERROR", detail: error.message });
    }

    return res.status(200).json({
      ok: true,
      spent: Number(amount),
      new_balance: data?.[0]?.new_balance ?? null,
    });
  } catch (e) {
    return res.status(500).json({ error: "SERVER_ERROR", detail: String(e) });
  }
}