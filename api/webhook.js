// api/webhook.js
import { createClient } from "@supabase/supabase-js";
import getRawBody from "raw-body";

export const config = { api: { bodyParser: false } };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID;
const PAYPAL_MODE = (process.env.PAYPAL_MODE || "sandbox").toLowerCase(); // sandbox | live

const PAYPAL_API_BASE =
  PAYPAL_MODE === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

function must(name, val) {
  if (!val) throw new Error(`Missing env: ${name}`);
  return val;
}

async function paypalAccessToken() {
  const basic = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64");
  const r = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`PayPal token error: ${r.status} ${JSON.stringify(j)}`);
  return j.access_token;
}

async function verifyWebhookSignature({ event, headers }) {
  const transmissionId = headers["paypal-transmission-id"];
  const transmissionTime = headers["paypal-transmission-time"];
  const certUrl = headers["paypal-cert-url"];
  const authAlgo = headers["paypal-auth-algo"];
  const transmissionSig = headers["paypal-transmission-sig"];

  if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) {
    return { verified: false, error: "Missing PayPal signature headers" };
  }

  const accessToken = await paypalAccessToken();

  const payload = {
    auth_algo: authAlgo,
    cert_url: certUrl,
    transmission_id: transmissionId,
    transmission_sig: transmissionSig,
    transmission_time: transmissionTime,
    webhook_id: PAYPAL_WEBHOOK_ID,
    webhook_event: event,
  };

  const r = await fetch(`${PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const j = await r.json();
  const ok = r.ok && j?.verification_status === "SUCCESS";
  return { verified: ok, error: ok ? null : `verify_failed: ${JSON.stringify(j)}` };
}

function isSubscriptionEvent(eventType) {
  // PayPal Subscriptions (v1/v2 webhooks)
  // Ejemplos: BILLING.SUBSCRIPTION.CREATED / ACTIVATED / UPDATED / CANCELLED / SUSPENDED / EXPIRED
  return typeof eventType === "string" && eventType.startsWith("BILLING.SUBSCRIPTION.");
}

function toTimestamptzSafe(val) {
  if (!val) return null;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Extrae datos “lo más estándar posible” de resource (varía por evento)
 */
function extractSubscriptionFields(event) {
  const r = event?.resource || {};
  const subscriptionId = r?.id || r?.billing_agreement_id || null;

  // En muchos eventos v2:
  const planId = r?.plan_id || r?.plan?.id || null;
  const status = r?.status || null;

  // subscriber / payer
  const payerId =
    r?.subscriber?.payer_id ||
    r?.subscriber?.payer?.payer_id ||
    r?.payer?.payer_id ||
    null;

  const subscriberEmail =
    r?.subscriber?.email_address ||
    r?.subscriber?.payer?.email_address ||
    null;

  // custom_id: CLAVE si tú lo mandas cuando creas la suscripción (ideal: user_id)
  const customId = r?.custom_id || r?.custom || null;

  const startTime = toTimestamptzSafe(r?.start_time);
  const nextBillingTime = toTimestamptzSafe(r?.billing_info?.next_billing_time);

  return {
    subscriptionId,
    status,
    planId,
    payerId,
    customId,
    subscriberEmail,
    startTime,
    nextBillingTime,
  };
}

async function markProcessedOnce(supabase, eventId) {
  // Idempotencia dura: si ya fue procesado, no repetimos lógica de negocio
  const { error } = await supabase
    .from("paypal_events_processed")
    .insert({ event_id: eventId });

  if (!error) return { firstTime: true };

  // Si es duplicate key => ya procesado
  // PostgREST típicamente devuelve código 23505 en detalles; pero no siempre.
  const msg = String(error?.message || "");
  const dup =
    msg.includes("duplicate") ||
    msg.includes("already exists") ||
    msg.includes("23505");

  if (dup) return { firstTime: false };
  throw error;
}

async function upsertSubscriptionState(supabase, event) {
  const eventId = event?.id || null;
  const eventType = event?.event_type || null;

  const {
    subscriptionId,
    status,
    planId,
    payerId,
    customId,
    subscriberEmail,
    startTime,
    nextBillingTime,
  } = extractSubscriptionFields(event);

  if (!subscriptionId) {
    console.warn("[PP_WEBHOOK] subscription event without subscriptionId", { eventId, eventType });
    return { ok: false, reason: "missing_subscription_id" };
  }

  const nowIso = new Date().toISOString();

  const row = {
    subscription_id: subscriptionId,
    status,
    plan_id: planId,
    payer_id: payerId,
    custom_id: customId,
    subscriber_email: subscriberEmail,
    start_time: startTime,
    next_billing_time: nextBillingTime,
    last_event_id: eventId,
    last_event_type: eventType,
    last_event_at: nowIso,
    payload: event?.resource || event, // guardamos resource completo
    updated_at: nowIso,
  };

  const { error } = await supabase
    .from("paypal_subscriptions")
    .upsert(row, { onConflict: "subscription_id" });

  if (error) throw error;

  return { ok: true, subscriptionId, status, planId };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(200).json({ ok: true, ignored: true });

    must("SUPABASE_URL", SUPABASE_URL);
    must("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY);
    must("PAYPAL_CLIENT_ID", PAYPAL_CLIENT_ID);
    must("PAYPAL_CLIENT_SECRET", PAYPAL_CLIENT_SECRET);
    must("PAYPAL_WEBHOOK_ID", PAYPAL_WEBHOOK_ID);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // RAW body
    const raw = await getRawBody(req);
    const rawText = raw.toString("utf8");

    let event;
    try {
      event = JSON.parse(rawText);
    } catch {
      event = { parse_error: true, raw: rawText };
    }

    const eventId = event?.id || `no-id-${Date.now()}`;
    const eventType = event?.event_type || null;
    const resourceType = event?.resource_type || null;

    // 1) Verificación best-effort (sandbox puede fallar)
    let verified = false;
    let verifyError = null;

    try {
      const v = await verifyWebhookSignature({ event, headers: req.headers });
      verified = v.verified;
      verifyError = v.error;
    } catch (e) {
      verified = false;
      verifyError = `verify_exception: ${String(e?.message || e)}`;
    }

    // 2) Guardar SIEMPRE el raw (auditoría)
    //    OJO: tu tabla ya tiene raw, headers, payload. Guardamos lo que ya usas.
    const insertPayload = {
      // IMPORTANTE: no usamos "id" como PK aquí, tu tabla ya permite repetidos (como acabas de ver)
      id: eventId,
      event_type: eventType,
      resource_type: resourceType,
      verified,
      error: verifyError,
      raw: event,          // si prefieres rawText, puedes cambiarlo a { rawText }
      headers: req.headers,
      payload: event,
      // received_at lo maneja default en DB si lo tienes, si no, lo puedes agregar aquí:
      // received_at: new Date().toISOString(),
    };

    const rawInsert = await supabase.from("paypal_events_raw").insert(insertPayload);
    if (rawInsert.error) {
      console.error("[PP_WEBHOOK] raw_insert_error", rawInsert.error);
      // respondemos 200 igual, pero dejamos log
    }

    // 3) Lógica de negocio (SUSCRIPCIONES primero)
    //    Idempotencia por event_id (no se ejecuta 2 veces)
    let business = { ran: false };

    try {
      const { firstTime } = await markProcessedOnce(supabase, eventId);
      if (!firstTime) {
        business = { ran: false, skipped: true, reason: "already_processed" };
      } else {
        if (isSubscriptionEvent(eventType)) {
          const r = await upsertSubscriptionState(supabase, event);
          business = { ran: true, type: "subscription", result: r };
        } else {
          business = { ran: false, skipped: true, reason: "not_subscription_event" };
        }
      }
    } catch (e) {
      console.error("[PP_WEBHOOK] business_error", e);
      business = { ran: false, error: String(e?.message || e) };
      // Igual devolvemos 200 para que PayPal no reintente infinito
    }

    console.log("[PP_WEBHOOK] ok", { eventId, eventType, verified, business });

    return res.status(200).json({
      ok: true,
      stored: true,
      verified,
      eventId,
      eventType,
      business,
    });
  } catch (e) {
    console.error("[PP_WEBHOOK] exception", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
}