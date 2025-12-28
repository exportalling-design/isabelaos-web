// pages/api/activate-plan.js
// ============================================================
// Activar plan + acreditar jades incluidos.
// SOLO se llama desde webhooks o backend verificado.
// ============================================================

import { sbAdmin } from "../../lib/supabaseAdmin";
import { PLANS } from "../../lib/pricing";

function requireInternal(req) {
  // Si luego querés, aquí metés una verificación real (secret header).
  // Por ahora lo dejamos igual que tu código.
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

    if (subErr) {
      return res.status(500).json({ error: "SUBSCRIPTION_SAVE_ERROR", detail: subErr.message });
    }

    // 2) credit included jades usando TU función final
    const amount = PLANS[plan].included_jades;

    // ref debe ser un identificador idempotente (ej: "ppsub:SUBSCRIPTION_ID:first")
    const reference_id = ref || `subscription:${plan}:${user_id}:${Date.now()}`;

    const { error: creditErr } = await sb.rpc("credit_jades_from_payment", {
      p_user_id: user_id,
      p_amount: amount,
      p_reference_id: reference_id,
      p_reason: `subscription:${plan}`,
    });

    if (creditErr) {
      return res.status(500).json({ error: "CREDIT_ERROR", detail: creditErr.message });
    }

    return res.status(200).json({
      ok: true,
      plan,
      credited: amount,
      reference_id,
    });
  } catch (e) {
    return res.status(500).json({ error: "SERVER_ERROR", detail: String(e?.message || e) });
  }
}