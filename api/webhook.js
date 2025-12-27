// /api/webhook.js
import { createClient } from "@supabase/supabase-js";

export const config = {
  api: { bodyParser: false },
};

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

function supabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function getPayPalAccessToken() {
  const env = (process.env.PAYPAL_ENV || "sandbox").toLowerCase();
  const isLive = env === "live";

  const base = isLive
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret =
    process.env.PAYPAL_CLIENT_SECRET || process.env.PAYPAL_SECRET || null;

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

  return { base, token: data.access_token, env };
}

async function verifyPayPalSignature({ rawBody, headers }) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error("Missing PAYPAL_WEBHOOK_ID");

  const { base, token } = await getPayPalAccessToken();

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

function extractMeta(event) {
  const r = event?.resource || {};
  const userId = r.custom_id || null;
  const referenceId = r.invoice_id || r.reference_id || r.id || null;
  return { userId, referenceId };
}

export default async function handler(req, res) {
  // GET para salud
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

  const sb = supabaseAdmin();
  let event = null;

  try {
    const rawBody = await readRawBody(req);

    const headers = {
      "paypal-auth-algo": getHeader(req, "paypal-auth-algo"),
      "paypal-cert-url": getHeader(req, "paypal-cert-url"),
      "paypal-transmission-id": getHeader(req, "paypal-transmission-id"),
      "paypal-transmission-sig": getHeader(req, "paypal-transmission-sig"),
      "paypal-transmission-time": getHeader(req, "paypal-transmission-time"),
    };

    event = JSON.parse(rawBody.toString("utf8"));

    console.log("[PP_WEBHOOK] received event.id=", event?.id, "type=", event?.event_type);

    // ✅ PARCHE: guardar SIEMPRE el evento raw (aunque falle firma)
    if (event?.id) {
      await sb
        .from("paypal_events_raw")
        .upsert({
          id: event.id,
          event_type: event.event_type || null,
          resource_type: event.resource_type || null,
          verified: false,
          error: null,
          raw: event,
        });
    }

    // 1) verificar firma
    let valid = false;
    try {
      valid = await verifyPayPalSignature({ rawBody, headers });
    } catch (sigErr) {
      const msg = String(sigErr?.message || sigErr);
      console.error("[PP_WEBHOOK] signature ERROR:", msg);

      if (event?.id) {
        await sb
          .from("paypal_events_raw")
          .update({ error: msg, verified: false })
          .eq("id", event.id);
      }

      // 400 porque firma falló (por eso PayPal te marca que llegó pero tú lo rechazas)
      return res.status(400).json({ ok: false, error: "Invalid signature", detail: msg });
    }

    console.log("[PP_WEBHOOK] signature valid =", valid);

    if (!valid) {
      if (event?.id) {
        await sb
          .from("paypal_events_raw")
          .update({ error: "verification_status != SUCCESS", verified: false })
          .eq("id", event.id);
      }
      return res.status(400).json({ ok: false, error: "Invalid signature" });
    }

    // ✅ si firma OK, marcar raw como verified
    if (event?.id) {
      await sb
        .from("paypal_events_raw")
        .update({ verified: true, error: null })
        .eq("id", event.id);
    }

    // 2) idempotencia + tabla final paypal_events
    if (event?.id) {
      const { data: existing } = await sb
        .from("paypal_events")
        .select("id")
        .eq("id", event.id)
        .maybeSingle();

      if (!existing) {
        const { error: insErr } = await sb.from("paypal_events").insert({
          id: event.id,
          event_type: event.event_type || null,
          resource_type: event.resource_type || null,
          raw: event,
        });
        if (insErr) throw new Error(`paypal_events insert error: ${JSON.stringify(insErr)}`);
      }
    }

    // 3) lógica de negocio (packs)
    const type = event.event_type;
    const { userId, referenceId } = extractMeta(event);

    if (type === "PAYMENT.CAPTURE.COMPLETED") {
      const map = { pack_50: 50, pack_100: 100, pack_500: 500, pack_1000: 1000 };
      const packKey = referenceId;
      const amount = map[packKey] || null;

      // Tu invoice_id actual NO es pack_500 => no acredita, pero ya quedará logged.
      if (!amount) {
        return res.status(200).json({
          ok: true,
          status: "payment_received_but_unknown_pack",
          got_referenceId: referenceId,
          tip: "Envía invoice_id=pack_50/100/500/1000 desde tu checkout si quieres acreditación automática.",
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
    const msg = String(e?.message || e);
    console.error("[PP_WEBHOOK] ERROR:", msg);

    // si alcanzamos a parsear event, guardamos el error
    try {
      if (event?.id) {
        await sb
          .from("paypal_events_raw")
          .upsert({
            id: event.id,
            event_type: event.event_type || null,
            resource_type: event.resource_type || null,
            verified: false,
            error: msg,
            raw: event,
          });
      }
    } catch {}

    return res.status(500).json({ ok: false, error: msg });
  }
}