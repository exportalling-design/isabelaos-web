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
  const env = (process.env.PAYPAL_ENV || "sandbox").toLowerCase();
  const isLive = env === "live";

  const base = isLive
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

  const clientId = process.env.PAYPAL_CLIENT_ID;

  // ✅ PARCHE: PayPal lo llama Client Secret
  const secret =
    process.env.PAYPAL_CLIENT_SECRET ||
    process.env.PAYPAL_SECRET ||
    null;

  if (!clientId || !secret) {
    throw new Error(
      "Missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET (or PAYPAL_SECRET)"
    );
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

  return { base, token: data.access_token, env };
}

// ---- PayPal: verify webhook signature ----
async function verifyPayPalSignature({ rawBody, headers }) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error("Missing PAYPAL_WEBHOOK_ID");

  const { base, token } = await getPayPalAccessToken();

  // headers mínimos requeridos por PayPal
  for (const k of [
    "paypal-auth-algo",
    "paypal-cert-url",
    "paypal-transmission-id",
    "paypal-transmission-sig",
    "paypal-transmission-time",
  ]) {
    if (!headers[k]) throw new Error(`Missing required PayPal header: ${k}`);
  }

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

// ---- Supabase admin client ----
function supabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // SOLO server-side
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

// ---- extraer user_id y reference_id del evento ----
function extractMeta(event) {
  const r = event?.resource || {};

  const userId = r.custom_id || null;

  const referenceId =
    r.invoice_id ||
    r.reference_id ||
    r.id ||
    null;

  return { userId, referenceId };
}

export default async function handler(req, res) {
  // ✅ PARCHE: permitir GET para probar que el endpoint vive
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      route: "/api/webhook",
      note: "PayPal envía POST. Si ves esto, el endpoint está vivo.",
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    const rawBody = await readRawBody(req);

    const headers = {
      "paypal-auth-algo": getHeader(req, "paypal-auth-algo"),
      "paypal-cert-url": getHeader(req, "paypal-cert-url"),
      "paypal-transmission-id": getHeader(req, "paypal-transmission-id"),
      "paypal-transmission-sig": getHeader(req, "paypal-transmission-sig"),
      "paypal-transmission-time": getHeader(req, "paypal-transmission-time"),
    };

    const event = JSON.parse(rawBody.toString("utf8"));

    // ✅ DEBUG: logs en Vercel
    console.log("[PP_WEBHOOK] received event.id=", event?.id, "type=", event?.event_type);
    console.log("[PP_WEBHOOK] headers keys=", Object.keys(headers).reduce((acc, k) => {
      acc[k] = !!headers[k];
      return acc;
    }, {}));

    // 1) Verificar firma (si falla, NO insertará nada en paypal_events)
    const valid = await verifyPayPalSignature({ rawBody, headers });
    console.log("[PP_WEBHOOK] signature valid =", valid);

    if (!valid) return res.status(400).json({ ok: false, error: "Invalid signature" });

    const sb = supabaseAdmin();

    // 2) Idempotencia + guardar evento
    if (event?.id) {
      const { data: existing, error: exErr } = await sb
        .from("paypal_events")
        .select("id")
        .eq("id", event.id)
        .maybeSingle();

      if (exErr) throw new Error(`paypal_events read error: ${JSON.stringify(exErr)}`);

      if (existing) {
        return res.status(200).json({ ok: true, status: "duplicate_ignored" });
      }

      const { error: insErr } = await sb.from("paypal_events").insert({
        id: event.id,
        event_type: event.event_type || null,
        resource_type: event.resource_type || null,
        raw: event,
      });

      if (insErr) throw new Error(`paypal_events insert error: ${JSON.stringify(insErr)}`);
      console.log("[PP_WEBHOOK] inserted paypal_events id =", event.id);
    }

    // 3) Procesar por tipo
    const type = event.event_type;
    const { userId, referenceId } = extractMeta(event);

    if (type === "PAYMENT.CAPTURE.COMPLETED") {
      const map = {
        pack_50: 50,
        pack_100: 100,
        pack_500: 500,
        pack_1000: 1000,
      };

      // OJO: tu invoice_id actual es tipo "3942619:fdv0..."
      // Eso NO matchea pack_500, por eso te daría unknown_pack.
      const packKey = referenceId;
      const amount = map[packKey] || null;

      if (!userId) {
        return res.status(200).json({
          ok: false,
          status: "missing_user",
          note: "custom_id debe ser el UUID del usuario (y ya lo está llegando).",
        });
      }

      if (!amount) {
        return res.status(200).json({
          ok: true,
          status: "payment_received_but_unknown_pack",
          got_referenceId: referenceId,
          tip: "Si quieres packs automáticos, envía invoice_id=pack_50/100/500/1000 desde tu checkout.",
        });
      }

      const { error } = await sb.rpc("credit_jades_from_payment", {
        p_user_id: userId,
        p_amount: amount,
        p_reference_id: `pp_${event.id}`,
      });

      if (error) throw new Error(`credit_jades_from_payment error: ${JSON.stringify(error)}`);

      return res.status(200).json({ ok: true, status: "credited_pack", amount });
    }

    return res.status(200).json({ ok: true, status: "ignored_event", type });
  } catch (e) {
    console.error("[PP_WEBHOOK] ERROR:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}