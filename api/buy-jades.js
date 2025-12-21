// pages/api/buy-jades.js
import { requireUser } from "../../lib/apiAuth";

const PACKS = { "100": 100, "300": 300 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const { sb, user } = await requireUser(req);
    const { pack, ref } = req.body || {};

    const amount = PACKS[String(pack)];
    if (!amount) return res.status(400).json({ ok: false, error: "INVALID_PACK" });

    const { data, error } = await sb.rpc("add_jades", {
      p_user_id: user.id,
      p_amount: amount,
      p_reason: `jade_pack:${amount}`,
      p_ref: ref || null,
    });

    if (error) return res.status(500).json({ ok: false, error: "CREDIT_ERROR", detail: error.message });

    return res.status(200).json({ ok: true, pack: amount, new_balance: data?.[0]?.new_balance ?? null });
  } catch (e) {
    const code = e.statusCode || 500;
    return res.status(code).json({ ok: false, error: String(e.message || e) });
  }
}
