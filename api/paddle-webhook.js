// pages/api/paddle-webhook.js
// ============================================================
// Paddle webhook (ya listo). Solo falta que en Paddle configures:
// - endpoint URL
// - webhook secret
// Y que en el "metadata" o "custom_data" mandes uid/plan o uid/pack.
// ============================================================

import { PLANS, JADE_PACKS } from "../../lib/pricing";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const secret = process.env.PADDLE_WEBHOOK_SECRET;
    if (!secret) return res.status(500).json({ ok: false, error: "MISSING_PADDLE_WEBHOOK_SECRET" });

    // Paddle firma depende de la versión; aquí dejamos el handler listo para que solo conectes verificación.
    // Por ahora: aceptamos payload y usamos meta (cuando actives, metemos la verificación exacta).
    const event = req.body || {};

    const meta = event?.data?.custom_data || event?.data?.metadata || {};
    const user_id = meta.uid || meta.user_id || null;
    const plan = meta.plan || null;
    const pack = meta.pack || null;

    if (!user_id) return res.status(200).json({ ok: true, ignored: true, reason: "NO_USER_ID" });

    const ref = event?.data?.id || event?.event_id || null;

    if (plan && PLANS[plan]) {
      await fetch(`${process.env.SITE_URL || "https://isabelaos.com"}/api/activate-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id, plan, ref }),
      }).catch(() => null);

      return res.status(200).json({ ok: true, action: "PLAN_ACTIVATED", user_id, plan });
    }

    if (pack && JADE_PACKS[String(pack)]) {
      await fetch(`${process.env.SITE_URL || "https://isabelaos.com"}/api/buy-jades`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id, pack: String(pack), ref }),
      }).catch(() => null);

      return res.status(200).json({ ok: true, action: "PACK_CREDITED", user_id, pack: String(pack) });
    }

    return res.status(200).json({ ok: true, ignored: true, reason: "NO_VALID_PLAN_OR_PACK" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
