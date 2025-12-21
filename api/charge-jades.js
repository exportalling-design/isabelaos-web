// pages/api/charge-jades.js
import { requireUser, spendJades } from "../../lib/apiAuth";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const { sb, user } = await requireUser(req);
    const { kind, ref } = req.body || {};

    if (!kind) return res.status(400).json({ ok: false, error: "MISSING_KIND" });

    const out = await spendJades(sb, user.id, kind, ref || null);
    return res.status(200).json({ ok: true, kind, cost: out.cost, new_balance: out.new_balance });
  } catch (e) {
    const code = e.statusCode || 500;
    return res.status(code).json({ ok: false, error: String(e.message || e) });
  }
}
