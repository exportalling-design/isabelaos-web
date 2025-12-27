// /api/webhook.js
import { createClient } from "@supabase/supabase-js";

export const config = {
  api: { bodyParser: false }, // NECESARIO para firma PayPal (raw body)
};

// ---- helpers: leer raw body ----
async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function getHeader(req, name) {
  const key = Object.keys(req.headers).find(
    (k) => k.toLowerCase() === name.toLowerCase()
  );
  return key ? req.headers[key] : undefined;
}

// ---- PayPal: token ----
async function getPayPalAccessToken() {
  const isLive = (process.env.PAYPAL_ENV || "sandbox") === "live";
  const base = isLive
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_SECRET;
  if (!clientId || !secret)
    throw new Error("Missing PAYPAL_CLIENT_ID / PAYPAL_SECRET");

  const auth = Buffer.from(`${clientId}:${secret}`).toString("base64");

  const r = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await r.json();
  if (!r.ok)
    throw new Error(`PayPal token error: ${r.status} ${JSON.stringify(data)}`);
  return { base, token: data.access_token };
}

// ---- PayPal: verify webhook signature ----
async function verifyPayPalSignature({ rawBody, headers }) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error("Missing PAYPAL_WEBHOOK_ID");

  const { base, token } = await getPayPalAccessToken();

  const payload = {
    auth_algo: headers["paypal-auth-algo"],
    cert_url: headers["paypal-cert-url"],
    transmission_id: headers["paypal-transmission-id"],
    transmission_sig: headers["paypal-transmission-sig"],
    transmission_time: headers["paypal-transmission-time"],
    webhook_id: webhookId,
    webhook_event: JSON.parse(rawBody.toString("utf8")),
  };

  // headers mínimos requeridos
  for (const k of [
    "paypal-auth-algo",
    "paypal-cert-url",
    "paypal-transmission-id",
    "paypal-transmission-sig",
    "paypal-transmission-time",
  ]) {
    if (!headers[k]) throw new Error(`Missing required PayPal header: ${k}`);
  }

  const r = await fetch(`${base}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await r.json();
  if (!r.ok)
    throw new Error(`Verify signature error: ${r.status} ${JSON.stringify(data)}`);

  return data.verification_status === "SUCCESS";
}

// ---- Supabase admin client ----
function supabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // SOLO server-side
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

// ---- PayPal: lookup order (para recuperar custom_id / invoice_id) ----
async function getPayPalOrder(orderId) {
  if (!orderId) throw new Error("Missing orderId for PayPal order lookup");

  const { base, token } = await getPayPalAccessToken();

  const r = await fetch(`${base}/v2/checkout/orders/${orderId}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await r.json();
  if (!r.ok)
    throw new Error(
      `PayPal order lookup error: ${r.status} ${JSON.stringify(data)}`
    );

  return data;
}

// ---- extraer user_id y reference_id del evento (robusto) ----
async function extractMetaRobust(event) {
  const r = event?.resource || {};

  // Intento directo (cuando venga)
  let userId =
    r.custom_id ||
    r?.subscriber?.payer_id || // fallback (NO recomendado para tu sistema)
    null;

  let referenceId =
    r.invoice_id ||
    r.reference_id ||
    r.id || // fallback
    null;

  // Para CAPTURE/Sale: a veces trae order_id dentro de supplementary_data
  const orderId =
    r?.supplementary_data?.related_ids?.order_id ||
    r?.supplementary_data?.related_ids?.orderId ||
    null;

  // Si faltó algo importante, consultamos la orden para sacar purchase_units[0].custom_id / invoice_id
  if ((!userId || !referenceId) && orderId) {
    const order = await getPayPalOrder(orderId);
    const pu = order?.purchase_units?.[0] || {};

    userId = userId || pu.custom_id || null;
    referenceId =
      referenceId || pu.invoice_id || pu.reference_id || referenceId || null;
  }

  return { userId, referenceId, orderId };
}

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const rawBody = await readRawBody(req);

    // Normalizar headers PayPal a minúsculas
    const headers = {
      "paypal-auth-algo": getHeader(req, "paypal-auth-algo"),
      "paypal-cert-url": getHeader(req, "paypal-cert-url"),
      "paypal-transmission-id": getHeader(req, "paypal-transmission-id"),
      "paypal-transmission-sig": getHeader(req, "paypal-transmission-sig"),
      "paypal-transmission-time": getHeader(req, "paypal-transmission-time"),
    };

    // 1) Verificar firma
    const valid = await verifyPayPalSignature({ rawBody, headers });
    if (!valid) return res.status(400).json({ ok: false, error: "Invalid signature" });

    const event = JSON.parse(rawBody.toString("utf8"));
    const sb = supabaseAdmin();

    // 2) Idempotencia por event.id
    // REQUIERE tabla: paypal_events (la creamos abajo)
    if (event?.id) {
      const { data: existing, error: exErr } = await sb
        .from("paypal_events")
        .select("id")
        .eq("id", event.id)
        .maybeSingle();

      if (exErr) throw new Error(`paypal_events read error: ${JSON.stringify(exErr)}`);

      if (existing) {
        // ya procesado
        return res.status(200).json({ ok: true, status: "duplicate_ignored" });
      }

      const { error: insErr } = await sb.from("paypal_events").insert({
        id: event.id,
        event_type: event.event_type || null,
        resource_type: event.resource_type || null,
        raw: event,
      });
      if (insErr) throw new Error(`paypal_events insert error: ${JSON.stringify(insErr)}`);
    }

    // 3) Procesar por tipo
    const type = event.event_type;
    const resource = event.resource || {};

    // 🔥 Parche: extracción robusta (incluye lookup de ORDER para conseguir custom_id / invoice_id)
    const { userId, referenceId } = await extractMetaRobust(event);

    // ⚠️ Regla: para acreditar jades, necesitas userId.
    // userId debe venir como UUID en custom_id desde tu checkout.
    const mustHaveUser = [
      "PAYMENT.CAPTURE.COMPLETED",
      "BILLING.SUBSCRIPTION.PAYMENT.COMPLETED",
      "PAYMENT.SALE.COMPLETED",
    ];

    if (mustHaveUser.includes(type) && !userId) {
      return res.status(200).json({
        ok: false,
        status: "missing_user",
        note: "No custom_id/userId in event (or in the parent Order). Configure checkout to send custom_id=user_uuid on purchase_units[0].custom_id.",
      });
    }

    // ---- A) Pago único (packs) ----
    if (type === "PAYMENT.CAPTURE.COMPLETED") {
      // Aquí decides cuántos jades dar según lo comprado.
      // Recomendado: guardar el pack en invoice_id/referenceId (ej: "pack_500")
      // y mapearlo a cantidad.
      const map = {
        pack_50: 50,
        pack_100: 100,
        pack_500: 500,
        pack_1000: 1000,
      };

      const packKey = referenceId; // idealmente invoice_id = "pack_500"
      const amount = map[packKey] || null;

      if (!amount) {
        return res.status(200).json({
          ok: false,
          status: "unknown_pack",
          got_referenceId: referenceId,
          note: "Set purchase_units[0].invoice_id (or referenceId) to a known pack key (pack_50/100/500/1000) or implement your own mapping.",
        });
      }

      const { error } = await sb.rpc("credit_jades_from_payment", {
        p_user_id: userId,
        p_amount: amount,
        p_reference_id: `pp_${event.id}`, // referencia única por evento
      });
      if (error) throw new Error(`credit_jades_from_payment error: ${JSON.stringify(error)}`);

      return res.status(200).json({ ok: true, status: "credited_pack", amount });
    }

    // ---- B) Pago de suscripción (recarga mensual) ----
    // En PayPal a veces viene como BILLING.SUBSCRIPTION.PAYMENT.COMPLETED
    if (type === "BILLING.SUBSCRIPTION.PAYMENT.COMPLETED") {
      // Aquí decides jades del plan.
      // Ideal: mapear por plan_id si viene en el evento.
      const subscriptionId = resource?.billing_agreement_id || resource?.id || null;
      const planId = resource?.plan_id || null;

      const planMap = {
        // "P-XXXXXXXXXXXX": 300,  // Basic
        // "P-YYYYYYYYYYYY": 1000, // Pro
      };

      const amount = planId ? planMap[planId] : null;

      if (!amount) {
        return res.status(200).json({
          ok: false,
          status: "unknown_plan",
          got_planId: planId,
          note: "Add your PayPal plan_id mapping to planMap for monthly jade credit.",
        });
      }

      const { error } = await sb.rpc("credit_jades_from_payment", {
        p_user_id: userId,
        p_amount: amount,
        p_reference_id: `sub_${subscriptionId || event.id}_${event.id}`,
      });
      if (error) throw new Error(`credit_jades_from_payment error: ${JSON.stringify(error)}`);

      return res.status(200).json({ ok: true, status: "credited_subscription", amount });
    }

    // ---- C) Reembolso PayPal (opcional manejar) ----
    if (type === "PAYMENT.CAPTURE.REFUNDED") {
      // Aquí normalmente NO refund de jades automático si el usuario ya los gastó.
      // Puedes marcar un ticket/flag para soporte.
      return res.status(200).json({ ok: true, status: "refund_received_logged" });
    }

    // Default: aceptar y loguear
    return res.status(200).json({ ok: true, status: "ignored_event", type });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}