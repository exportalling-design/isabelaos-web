// /api/webhook.js
import { createClient } from "@supabase/supabase-js";
import getRawBody from "raw-body";

export const config = {
  api: { bodyParser: false }, // ✅ RAW body (necesario para firma PayPal)
};

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

function pickPaypalHeaders(h) {
  // Vercel/Node headers vienen en minúsculas
  return {
    "paypal-transmission-id": h["paypal-transmission-id"],
    "paypal-transmission-time": h["paypal-transmission-time"],
    "paypal-cert-url": h["paypal-cert-url"],
    "paypal-auth-algo": h["paypal-auth-algo"],
    "paypal-transmission-sig": h["paypal-transmission-sig"],
    "content-type": h["content-type"],
  };
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
  const h = pickPaypalHeaders(headers);

  const transmissionId = h["paypal-transmission-id"];
  const transmissionTime = h["paypal-transmission-time"];
  const certUrl = h["paypal-cert-url"];
  const authAlgo = h["paypal-auth-algo"];
  const transmissionSig = h["paypal-transmission-sig"];

  // En sandbox a veces el simulator no manda headers “reales”
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

function isDuplicateKeyError(err) {
  // Postgres duplicate key: 23505
  return (
    err?.code === "23505" ||
    (typeof err?.message === "string" && err.message.includes("duplicate key"))
  );
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(200).json({ ok: true, ignored: true });
    }

    must("SUPABASE_URL", SUPABASE_URL);
    must("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY);
    must("PAYPAL_CLIENT_ID", PAYPAL_CLIENT_ID);
    must("PAYPAL_CLIENT_SECRET", PAYPAL_CLIENT_SECRET);
    must("PAYPAL_WEBHOOK_ID", PAYPAL_WEBHOOK_ID);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1) RAW body
    const raw = await getRawBody(req);
    const rawText = raw.toString("utf8");

    // 2) Parse
    let event;
    try {
      event = JSON.parse(rawText);
    } catch {
      event = { parse_error: true, raw: rawText };
    }

    const eventId = event?.id || `no-id-${Date.now()}`;
    const eventType = event?.event_type || null;
    const resourceType = event?.resource_type || null;

    // 3) Verificación firma (puede fallar en simulator)
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

    // 4) IDempotencia de “procesamiento” (no repetir lógica 2 veces)
    //    Si ya marcamos este event_id como procesado, salimos sin error.
    const { data: alreadyProcessed, error: processedCheckErr } = await supabase
      .from("paypal_events_processed")
      .select("event_id")
      .eq("event_id", eventId)
      .maybeSingle();

    if (processedCheckErr) {
      console.error("[PP_WEBHOOK] processed_check_error", processedCheckErr);
      // No crashear; seguimos igual.
    }

    if (alreadyProcessed?.event_id) {
      console.log("[PP_WEBHOOK] already_processed", { id: eventId, eventType });
      return res.status(200).json({ ok: true, stored: true, verified, already_processed: true });
    }

    // 5) Guardar RAW (sin reventar por duplicado)
    const insertPayload = {
      id: eventId,
      event_type: eventType,
      resource_type: resourceType,
      verified,
      error: verifyError,
      raw: event,        // jsonb
      headers: req.headers, // jsonb
      payload: event,    // jsonb (si ya lo tienes en tu tabla)
      received_at: new Date().toISOString(), // timestamptz (si existe; si no existe, Supabase lo ignora si está bien configurado)
    };

    // OJO: si tu tabla NO tiene raw/payload a la vez, deja solo el que exista.
    // Como tú dijiste que tiene raw Jsonb, headers Jsonb, payload Jsonb, está OK.

    const { error: rawInsertErr } = await supabase
      .from("paypal_events_raw")
      .insert(insertPayload);

    if (rawInsertErr && !isDuplicateKeyError(rawInsertErr)) {
      console.error("[PP_WEBHOOK] raw_insert_error", rawInsertErr);
      return res.status(200).json({
        ok: false,
        stored: false,
        verified,
        supabase_error: rawInsertErr.message,
      });
    }

    if (rawInsertErr && isDuplicateKeyError(rawInsertErr)) {
      // Duplicado: lo ignoramos (PayPal reintenta)
      console.log("[PP_WEBHOOK] raw_duplicate_ignored", { id: eventId, eventType });
    } else {
      console.log("[PP_WEBHOOK] raw_stored", { id: eventId, verified, eventType });
    }

    // 6) Marcar procesado (idempotencia real)
    const { error: processedInsertErr } = await supabase
      .from("paypal_events_processed")
      .insert({ event_id: eventId });

    if (processedInsertErr && !isDuplicateKeyError(processedInsertErr)) {
      console.error("[PP_WEBHOOK] processed_insert_error", processedInsertErr);
      // Respondemos 200 igual para que PayPal no spamee reintentos
      return res.status(200).json({
        ok: true,
        stored: true,
        verified,
        processed_mark_error: processedInsertErr.message,
      });
    }

    return res.status(200).json({ ok: true, stored: true, verified, processed: true });
  } catch (e) {
    console.error("[PP_WEBHOOK] exception", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
}