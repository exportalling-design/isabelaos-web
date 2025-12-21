// pages/api/paypal-webhook.js
// ============================================================
// Webhook PayPal: aquí se traduce pago -> activate-plan / buy-jades.
// 1) Validar webhook (PAYPAL_WEBHOOK_ID)
// 2) Leer metadata (user_id, plan o pack) desde custom_id o invoice_id
// ============================================================

import crypto from "crypto";
import { sbAdmin } from "../../lib/supabaseAdmin";
import { PLANS, JADE_PACKS } from "../../lib/pricing";

// PayPal endpoint base
function paypalBase() {
  const mode = process.env.PAYPAL_MODE || "live";
  return mode === "sandbox"
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";
}

async function paypalAccessToken() {
  const base = paypalBase();
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_SECRET;
  if (!id || !secret) throw new Error("Missing PAYPAL_CLIENT_ID / PAYPAL_SECRET");

  const r = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const j = await r.json();
  if (!r.ok) throw new Error(`PayPal token error: ${r.status} ${JSON.stringify(j)}`);
  return j.access_token;
}

// Valida la firma del webhook según PayPal (webhook verification API)
async function verifyWebhook(reqBody, headers) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error("Missing PAYPAL_WEBHOOK_ID");

  const token = await paypalAccessToken();
  const base = paypalBase();

  const payload = {
    auth_algo: headers["paypal-auth-algo"],
    cert_url: headers["paypal-cert-url"],
    transmission_id: headers["paypal-transmission-id"],
    transmission_sig: headers["paypal-transmission-sig"],
    transmission_time: headers["paypal-transmission-time"],
    webhook_id: webhookId,
    webhook_event: reqBody,
  };

  const r = await fetch(`${base}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`verify-webhook-signature failed: ${r.status} ${JSON.stringify(j)}`);

  return j.verification_status === "SUCCESS";
}

export default async function handler(req, res) {
  // PayPal manda POST
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const event = req.body;

    // 1) Verify signature
    const ok = await verifyWebhook(event, req.headers);
    if (!ok) return res.status(400).json({ ok: false, error: "INVALID_WEBHOOK_SIGNATURE" });

    // 2) Extraer metadata (depende de cómo armaste la compra en frontend)
    // Recomendado: guardar algo como "user_id|plan:basic" en custom_id.
    const resource = event?.resource || {};
    const custom = resource?.custom_id || resource?.invoice_id || "";

    // Parse simple:
    // custom_id: "uid=xxx;plan=basic" o "uid=xxx;pack=100"
    const parts = String(custom).split(";").map(s => s.trim());
    const meta = {};
    for (const p of parts) {
      const [k, v] = p.split("=").map(x => x.trim());
      if (k && v) meta[k] = v;
    }

    const user_id = meta.uid || meta.user_id || null;
    const plan = meta.plan || null;
    const pack = meta.pack || null;

    if (!user_id) {
      // no activamos nada si no tenemos user_id
      return res.status(200).json({ ok: true, ignored: true, reason: "NO_USER_ID_IN_METADATA" });
    }

    const sb = sbAdmin();

    // 3) Distinguir plan vs pack
    const ref = resource?.id || event?.id || null;

    if (plan && PLANS[plan]) {
      // activar plan + acreditar jades
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
