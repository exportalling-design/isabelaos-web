// /api/paypal/webhook.js
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

// =====================
// ENV
// =====================
const {
  PAYPAL_CLIENT_ID,
  PAYPAL_SECRET,
  PAYPAL_WEBHOOK_ID,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

function requiredEnv() {
  const missing = [];
  for (const k of [
    "PAYPAL_CLIENT_ID",
    "PAYPAL_SECRET",
    "PAYPAL_WEBHOOK_ID",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]) {
    if (!process.env[k]) missing.push(k);
  }
  if (missing.length) {
    throw new Error("Missing env vars: " + missing.join(", "));
  }
}

function supabaseAdmin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// PayPal: obtener token OAuth2
async function getPaypalAccessToken() {
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString(
    "base64"
  );

  const res = await fetch("https://api-m.sandbox.paypal.com/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error("PayPal OAuth failed: " + t);
  }
  const data = await res.json();
  return data.access_token;
}

// PayPal: verificar firma del webhook
async function verifyPaypalWebhookSignature({
  accessToken,
  headers,
  rawBody,
  webhookEvent,
}) {
  // PayPal headers (pueden venir en minúsculas en node)
  const transmissionId = headers["paypal-transmission-id"];
  const transmissionTime = headers["paypal-transmission-time"];
  const certUrl = headers["paypal-cert-url"];
  const authAlgo = headers["paypal-auth-algo"];
  const transmissionSig = headers["paypal-transmission-sig"];

  if (
    !transmissionId ||
    !transmissionTime ||
    !certUrl ||
    !authAlgo ||
    !transmissionSig
  ) {
    throw new Error("Missing PayPal signature headers");
  }

  const body = {
    auth_algo: authAlgo,
    cert_url: certUrl,
    transmission_id: transmissionId,
    transmission_sig: transmissionSig,
    transmission_time: transmissionTime,
    webhook_id: PAYPAL_WEBHOOK_ID,
    webhook_event: webhookEvent,
  };

  const res = await fetch(
    "https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const t = await res.text();
    throw new Error("PayPal verify failed: " + t);
  }

  const data = await res.json();
  return data.verification_status === "SUCCESS";
}

// Helper: parsea JSON con raw body intacto
async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// =====================
// MAIN HANDLER
// =====================
export default async function handler(req, res) {
  try {
    requiredEnv();

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const raw = await readRawBody(req);
    const rawText = raw.toString("utf8");

    let event;
    try {
      event = JSON.parse(rawText);
    } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }

    // 1) Verificar firma PayPal (SEGURIDAD)
    const accessToken = await getPaypalAccessToken();

    const ok = await verifyPaypalWebhookSignature({
      accessToken,
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), v])
      ),
      rawBody: rawText,
      webhookEvent: event,
    });

    if (!ok) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    // 2) Procesar evento
    // Evento recomendado para acreditar: PAYMENT.CAPTURE.COMPLETED
    if (event.event_type !== "PAYMENT.CAPTURE.COMPLETED") {
      return res.status(200).json({ ok: true, ignored: event.event_type });
    }

    // PayPal payload
    const resource = event.resource || {};
    const captureId = resource.id; // referencia única
    const customId = resource.custom_id; // aquí debemos meter user_id desde el frontend
    const amountValue = resource.amount?.value; // "5.00"
    const currency = resource.amount?.currency_code;

    if (!captureId || !customId || !amountValue) {
      return res.status(400).json({
        error: "Missing captureId/custom_id/amount",
        captureId,
        customId,
        amountValue,
      });
    }

    // 3) Convertir $ a jades (define tu tabla aquí)
    // EJEMPLO: $5 = 100 jades, $10 = 250 jades, $20 = 600 jades
    const usd = Number(amountValue);
    if (!Number.isFinite(usd) || usd <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    let jades = 0;
    if (usd === 5) jades = 100;
    else if (usd === 10) jades = 250;
    else if (usd === 20) jades = 600;
    else {
      // fallback (si quieres permitir montos raros)
      jades = Math.round(usd * 20); // $1 => 20 jades (ajústalo)
    }

    // 4) Idempotencia: evitar doble acreditación si PayPal reintenta webhook
    // Si ya existe una transacción con reference_id=captureId y reason='purchase', no acredites de nuevo.
    const sb = supabaseAdmin();

    const { data: exists, error: exErr } = await sb
      .from("jade_transactions")
      .select("id")
      .eq("reference_id", captureId)
      .eq("reason", "purchase")
      .limit(1);

    if (exErr) throw exErr;

    if (exists && exists.length > 0) {
      return res.status(200).json({ ok: true, duplicate: true });
    }

    // 5) Acreditar con tu función SQL (atómico por DB)
    const { error: rpcErr } = await sb.rpc("credit_jades_from_payment", {
      p_user_id: customId,
      p_amount: jades,
      p_reference_id: captureId,
    });

    if (rpcErr) throw rpcErr;

    return res.status(200).json({
      ok: true,
      credited: jades,
      user_id: customId,
      captureId,
      currency,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Server error" });
  }
}