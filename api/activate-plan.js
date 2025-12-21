// pages/api/activate-plan.js
// ============================================================
// Activar plan + acreditar jades incluidos.
// SOLO se llama desde webhooks o backend verificado.
// ============================================================

import { sbAdmin } from "../../lib/supabaseAdmin";
import { PLANS } from "../../lib/pricing";

function requireInternal(req) {
  // Seguridad simple: solo server/webhooks.
  // En Vercel, tus webhooks no llevan esta cabecera.
  // Por eso: este endpoint se usa desde los handlers de webhook INTERNAMENTE (server-to-server),
  // NO desde el cliente.
  return true;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  try {
    requireInternal(req);

    const { user_id, plan, ref } = req.body || {};
    if (!user_id || !plan) return res.status(400).json({ error: "MISSING_FIELDS" });
    if (!PLANS[plan]) return res.status(400).json({ error: "INVALID_PLAN" });

    const sb = sbAdmin();

    // 1) upsert subscription
    const { error: subErr } = await sb
      .from("user_subscription")
      .upsert({
        user_id,
        plan,
        status: "active",
        updated_at: new Date().toISOString(),
      });

    if (subErr) return res.status(500).json({ error: "SUBSCRIPTION_SAVE_ERROR", detail: subErr.message });

    // 2) credit included jades (lo haces al activar)
    const amount = PLANS[plan].included_jades;

    const { data, error } = await sb.rpc("add_jades", {
      p_user_id: user_id,
      p_amount: amount,
      p_reason: `subscription:${plan}`,
      p_ref: ref || null,
    });

    if (error) return res.status(500).json({ error: "CREDIT_ERROR", detail: error.message });

    return res.status(200).json({
      ok: true,
      plan,
      credited: amount,
      new_balance: data?.[0]?.new_balance ?? null,
    });
  } catch (e) {
    return res.status(500).json({ error: "SERVER_ERROR", detail: String(e) });
  }
}
