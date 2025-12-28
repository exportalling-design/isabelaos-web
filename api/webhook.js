// /api/webhook.js
import { createClient } from "@supabase/supabase-js";
import getRawBody from "raw-body";

export const config = { api: { bodyParser: false } };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID;
const PAYPAL_MODE = (process.env.PAYPAL_MODE || "sandbox").toLowerCase();

const PAYPAL_API_BASE =
  PAYPAL_MODE === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

function must(name, val) {
  if (!val) throw new Error(`Missing env: ${name}`);
  return val;
}

function isDuplicateKeyError(err) {
  return err?.code === "23505" || (typeof err?.message === "string" && err.message.includes("duplicate key"));
}

function isUuid(s) {
  return typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
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
  const j = await r.json().catch(() => ({}));
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

  const j = await r.json().catch(() => ({}));
  const ok = r.ok && j?.verification_status === "SUCCESS";
  return { verified: ok, error: ok ? null : `verify_failed: ${JSON.stringify(j)}` };
}

async function upsertPaypalSubscription({ supabase, resource, statusOverride = null }) {
  // PayPal subscription object suele venir en event.resource
  // Campos típicos:
  // resource.id (subscription_id)
  // resource.status
  // resource.plan_id
  // resource.subscriber.payer_id
  // resource.custom_id (si tú lo mandas al crear)
  const subscription_id = resource?.id || null;
  if (!subscription_id) return { ok: false, reason: "no_subscription_id" };

  const status = statusOverride || resource?.status || null;
  const plan_id = resource?.plan_id || null;
  const payer_id = resource?.subscriber?.payer_id || resource?.payer?.payer_id || null;

  const custom_id = resource?.custom_id || null;
  const user_id = isUuid(custom_id) ? custom_id : null;

  const row = {
    subscription_id,
    status,
    plan_id,
    payer_id,
    user_id,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("paypal_subscriptions")
    .upsert(row, { onConflict: "subscription_id" });

  if (error) return { ok: false, error };
  return { ok: true, subscription_id, user_id, status, plan_id, payer_id };
}

async function syncUserSubscription({ supabase, user_id, plan_id, status, subscription_id }) {
  if (!user_id) return { ok: false, reason: "no_user_id" };

  // mapeo simple plan_id -> plan interno
  // AJUSTA esto a tus planes reales (IDs de PayPal)
  let plan = "basic";
  if (plan_id) {
    // ejemplo:
    // if (plan_id === "P-XXXXX") plan = "pro";
    plan = "basic";
  }

  const normalizedStatus =
    status === "ACTIVE" ? "active" :
    status === "CANCELLED" ? "cancelled" :
    status === "SUSPENDED" ? "suspended" :
    status ? status.toLowerCase() : "unknown";

  const row = {
    user_id,
    plan,
    status: normalizedStatus,
    paypal_subscription_id: subscription_id || null,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("user_subscription")
    .upsert(row, { onConflict: "user_id" });

  if (error) return { ok: false, error };
  return { ok: true };
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

    // Verificación firma
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

    // Idempotencia por evento
    const { data: alreadyProcessed } = await supabase
      .from("paypal_events_processed")
      .select("event_id")
      .eq("event_id", eventId)
      .maybeSingle();

    if (alreadyProcessed?.event_id) {
      console.log("[PP_WEBHOOK] ya_procesado", { id: eventId, tipo: eventType });
      return res.status(200).json({ ok: true, already_processed: true, verified });
    }

    // Guardar RAW (no reventar duplicado)
    const insertPayload = {
      id: eventId,
      event_type: eventType,
      resource_type: resourceType,
      verified,
      error: verifyError,
      raw: event,
      headers: req.headers,
      payload: event,
      received_at: new Date().toISOString(),
    };

    const { error: rawInsertErr } = await supabase.from("paypal_events_raw").insert(insertPayload);
    if (rawInsertErr && !isDuplicateKeyError(rawInsertErr)) {
      console.error("[PP_WEBHOOK] raw_insert_error", rawInsertErr);
      return res.status(200).json({ ok: false, stored: false, verified, supabase_error: rawInsertErr.message });
    }

    // ---- PROCESAR SUSCRIPCIONES ----
    // Si no viene resource, no hacemos nada más.
    const resource = event?.resource || null;

    if (eventType && eventType.startsWith("BILLING.SUBSCRIPTION.") && resource) {
      // CREATED / ACTIVATED / CANCELLED / SUSPENDED etc.
      const subRes = await upsertPaypalSubscription({ supabase, resource });
      if (!subRes.ok) {
        console.error("[PP_WEBHOOK] subscription_upsert_failed", subRes);
      } else {
        // Si tenemos user_id (custom_id UUID), sincronizamos user_subscription
        await syncUserSubscription({
          supabase,
          user_id: subRes.user_id,
          plan_id: subRes.plan_id,
          status: subRes.status,
          subscription_id: subRes.subscription_id,
        });
      }
    }

    // Marcar evento procesado
    const { error: processedErr } = await supabase
      .from("paypal_events_processed")
      .insert({ event_id: eventId });

    if (processedErr && !isDuplicateKeyError(processedErr)) {
      console.error("[PP_WEBHOOK] processed_insert_error", processedErr);
    }

    console.log("[PP_WEBHOOK] stored", { id: eventId, verified, eventType });

    return res.status(200).json({ ok: true, stored: true, verified });
  } catch (e) {
    console.error("[PP_WEBHOOK] exception", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
}