// pages/api/activate-plan.js
import { sbAdmin } from "../../lib/apiAuth";

const PLAN_JADES = { basic: 100, pro: 300 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    // ✅ Protege este endpoint con una llave secreta
    const secret = req.headers["x-internal-secret"];
    if (!process.env.INTERNAL_ACTIVATE_SECRET || secret !== process.env.INTERNAL_ACTIVATE_SECRET) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }

    const { user_id, plan, ref } = req.body || {};
    if (!user_id || !plan) return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });
    if (!PLAN_JADES[plan]) return res.status(400).json({ ok: false, error: "INVALID_PLAN" });

    const sb = sbAdmin();

    const { error: subErr } = await sb
      .from("user_subscription")
      .upsert({
        user_id,
        plan,
        status: "active",
        updated_at: new Date().toISOString(),
      });

    if (subErr) return res.status(500).json({ ok: false, error: "SUBSCRIPTION_SAVE_ERROR", detail: subErr.message });

    const { data, error } = await sb.rpc("add_jades", {
      p_user_id: user_id,
      p_amount: PLAN_JADES[plan],
      p_reason: `subscription:${plan}`,
      p_ref: ref || null,
    });

    if (error) return res.status(500).json({ ok: false, error: "CREDIT_ERROR", detail: error.message });

    return res.status(200).json({
      ok: true,
      plan,
      credited: PLAN_JADES[plan],
      new_balance: data?.[0]?.new_balance ?? null,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", detail: String(e) });
  }
}
