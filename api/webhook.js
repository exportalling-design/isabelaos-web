
// /api/webhook.js
import { createClient } from "@supabase/supabase-js";

export const config = {
  api: { bodyParser: false }, // NECESARIO para firma PayPal (raw body)
};

// -----------------------------
// helpers
// -----------------------------
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

// -----------------------------
// PayPal token
// -----------------------------
function getPayPalBase() {
  // ✅ parche: no dependemos de PAYPAL_ENV
  // Usa PAYPAL_MODE="live" si quieres producción. Si no existe, sandbox.
  const mode = (process.env.PAYPAL_MODE || "sandbox").toLowerCase();
  const isLive = mode === "live";
  return isLive
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function getPayPalAccessToken() {
  const base = getPayPalBase();

  const clientId = process.env.PAYPAL_CLIENT_ID;
  // ✅ parche: tú lo tienes como PAYPAL_CLIENT_SECRET
  const secret =
    process.env.PAYPAL_CLIENT_SECRET ||
    process.env.PAYPAL_SECRET; // compat

  if (!clientId || !secret) {
    throw new Error("Missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET");
  }

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
  if (!r.ok) throw new Error(`PayPal token error: ${r.status} ${JSON.stringify(data)}`);
  return { base, token: data.access_token };
}

// -----------------------------
// PayPal verify webhook signature
// -----------------------------
async function verifyPayPalSignature({ rawBody, headers }) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error("Missing PAYPAL_WEBHOOK_ID");

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

  const r = await fetch(`${base}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await r.json();
  if (!r.ok) throw new Error(`Verify signature error: ${r.status} ${JSON.stringify(data)}`);

  return data.verification_status === "SUCCESS";
}

// -----------------------------
// Supabase admin client
// -----------------------------
function supabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // SOLO server-side
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

// -----------------------------
// extraer user_id y reference_id del evento
// -----------------------------
function extractMeta(event) {
  const r = event?.resource || {};
  const userId = r.custom_id || null;

  // ✅ en tu payload real viene invoice_id y custom_id sí existe.
  const referenceId =
    r.invoice_id ||
    r.reference_id ||
    r.id ||
    null;

  return { userId, referenceId };
}

// -----------------------------
// MAIN
// -----------------------------
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const sb = (() => {
    try { return supabaseAdmin(); } catch { return null; }
  })();

  let rawBody;
  let event;
  let headers;
  let verified = false;
  let errMsg = null;

  try {
    rawBody = await readRawBody(req);
    event = JSON.parse(rawBody.toString("utf8"));

    // Normalizar headers PayPal a minúsculas
    headers = {
      "paypal-auth-algo": getHeader(req, "paypal-auth-algo"),
      "paypal-cert-url": getHeader(req, "paypal-cert-url"),
      "paypal-transmission-id": getHeader(req, "paypal-transmission-id"),
      "paypal-transmission-sig": getHeader(req, "paypal-transmission-sig"),
      "paypal-transmission-time": getHeader(req, "paypal-transmission-time"),
    };

    // 1) Verificar firma
    verified = await verifyPayPalSignature({ rawBody, headers });

  } catch (e) {
    verified = false;
    errMsg = String(e?.message || e);
  }

  // ✅ PARCHE CLAVE: siempre loguear en paypal_events_raw (la que tú creaste)
  // Así aunque falle firma/ENV, lo verás en Supabase con el error.
  try {
    if (sb && event?.id) {
      const insertPayload = {
        id: event.id,
        event_type: event.event_type || null,
        resource_type: event.resource_type || null,
        verified,
        error: errMsg,
        raw: event,
      };

      // upsert = idempotencia
      const { error: upErr } = await sb
        .from("paypal_events_raw")
        .upsert(insertPayload, { onConflict: "id" });

      if (upErr) {
        // Si falla el log, igual respondemos, pero te avisamos en response
        return res.status(200).json({
          ok: false,
          status: "logged_failed",
          verified,
          error: errMsg,
          supabase_error: upErr,
        });
      }
    }
  } catch (logErr) {
    // no reventar la función por logging
  }

  // Si firma inválida => 400 (y ya quedó registrado en paypal_events_raw con error)
  if (!verified) {
    return res.status(400).json({ ok: false, error: errMsg || "Invalid signature" });
  }

  // A partir de aquí: firma OK, puedes procesar de forma definitiva
  try {
    if (!sb) throw new Error("Supabase admin not available (missing env vars)");

    const type = event.event_type;
    const { userId, referenceId } = extractMeta(event);

    // Para acreditar jades necesitas userId (uuid) desde custom_id
    const mustHaveUser = ["PAYMENT.CAPTURE.COMPLETED"];
    if (mustHaveUser.includes(type) && !userId) {
      return res.status(200).json({
        ok: false,
        status: "missing_user",
        note: "No custom_id/userId in event. Configure checkout to send custom_id=user_uuid.",
      });
    }

    // A) Pago único (packs)
    if (type === "PAYMENT.CAPTURE.COMPLETED") {
      // 👇 IMPORTANTE:
      // Tu invoice_id real se ve así:
      // "3942619:fdv09c49-a3g6-4cbf-1358-f6d241dacea2"
      // Entonces NO va a matchear pack_50 directo.
      //
      // Solución definitiva: manda invoice_id como "pack_50" (o usa un prefijo).
      // Mientras, hacemos un parser por si viene "pack_50:xxxx".
      const map = {
        pack_50: 50,
        pack_100: 100,
        pack_500: 500,
        pack_1000: 1000,
      };

      const ref = String(referenceId || "");
      const firstToken = ref.split(":")[0]; // "pack_50:xxxx" => "pack_50"
      const amount = map[firstToken] || null;

      if (!amount) {
        return res.status(200).json({
          ok: true,
          status: "captured_but_no_pack_mapping",
          got_invoice_id: referenceId,
          note:
            "Set invoice_id to 'pack_50' (o 'pack_50:algo') para acreditar automático, o implementa tu propio mapping por amount/order_id.",
        });
      }

      // ✅ usa tu RPC existente
      const { error } = await sb.rpc("credit_jades_from_payment", {
        p_user_id: userId,
        p_amount: amount,
        p_reference_id: `pp_${event.id}`, // id único
      });
      if (error) throw new Error(`credit_jades_from_payment error: ${JSON.stringify(error)}`);

      return res.status(200).json({ ok: true, status: "credited_pack", amount });
    }

    // Default: evento verificado, pero no manejado
    return res.status(200).json({ ok: true, status: "verified_ignored_event", type });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}