// /api/webhook.js
import { createClient } from "@supabase/supabase-js";
import getRawBody from "raw-body";

export const config = {
  api: { bodyParser: false }, // ✅ RAW body
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
  // PayPal manda headers en minúscula en Node/Vercel
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

export default async function handler(req, res) {
  try {
    // PayPal solo manda POST, pero respondemos 200 siempre para no reintentar por errores de método.
    if (req.method !== "POST") return res.status(200).json({ ok: true, ignored: true });

    must("SUPABASE_URL", SUPABASE_URL);
    must("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY);
    must("PAYPAL_CLIENT_ID", PAYPAL_CLIENT_ID);
    must("PAYPAL_CLIENT_SECRET", PAYPAL_CLIENT_SECRET);
    must("PAYPAL_WEBHOOK_ID", PAYPAL_WEBHOOK_ID);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1) Leer RAW body (NECESARIO para verificación)
    const raw = await getRawBody(req);
    const rawText = raw.toString("utf8");

    // 2) Parse del evento
    let event;
    try {
      event = JSON.parse(rawText);
    } catch {
      event = { parse_error: true, raw: rawText };
    }

    const eventId = event?.id || `no-id-${Date.now()}`;
    const eventType = event?.event_type || null;
    const resourceType = event?.resource_type || null;

    // ✅ 3) Idempotencia (EVITA DUPLICADOS)
    // Si ya existe en paypal_events_processed => ya fue manejado, respondemos 200 y ya.
    try {
      const { data: alreadyProcessed, error: peErr } = await supabase
        .from("paypal_events_processed")
        .select("event_id")
        .eq("event_id", eventId)
        .maybeSingle();

      if (peErr) {
        // No detenemos el webhook por esto, pero lo dejamos en logs
        console.warn("[PP_WEBHOOK] processed_check_error", peErr);
      } else if (alreadyProcessed) {
        console.log("[PP_WEBHOOK] duplicate_event_ignored", { id: eventId, eventType });
        return res.status(200).json({ ok: true, duplicate: true, verified: true });
      }
    } catch (e) {
      console.warn("[PP_WEBHOOK] processed_check_exception", String(e?.message || e));
    }

    // 4) Verificación PayPal (firma)
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

    // 5) Guardar RAW (sin sobrescribir: INSERT + ignore duplicates)
    // - PayPal puede reenviar el mismo event_id
    // - Si existe, no queremos que truene; queremos ignorarlo sin error.
    const insertPayload = {
      id: eventId,
      event_type: eventType,
      resource_type: resourceType,
      verified,
      error: verifyError,
      raw: event,        // ✅ según tus columnas: raw jsonb
      headers: req.headers, // ✅ headers jsonb
      payload: event,    // ✅ payload jsonb (si la tienes)
    };

    let storedRaw = false;

    try {
      const { error: rawErr } = await supabase
        .from("paypal_events_raw")
        .insert(insertPayload);

      if (rawErr) {
        // Si es duplicado, lo ignoramos (23505)
        const msg = String(rawErr?.message || rawErr);
        const code = rawErr?.code;

        if (code === "23505" || msg.toLowerCase().includes("duplicate")) {
          console.log("[PP_WEBHOOK] raw_duplicate_ignored", { id: eventId, eventType });
          storedRaw = false; // ya existía
        } else {
          console.error("[PP_WEBHOOK] raw_insert_error", rawErr);
          // Respondemos 200 igual para que PayPal no reintente infinito
          return res.status(200).json({
            ok: false,
            stored: false,
            step: "raw_insert",
            supabase_error: rawErr.message,
            verified,
          });
        }
      } else {
        storedRaw = true;
      }
    } catch (e) {
      console.error("[PP_WEBHOOK] raw_insert_exception", e);
      return res.status(200).json({ ok: false, stored: false, step: "raw_insert_exception", verified });
    }

    // 6) Marcar como procesado (evita re-procesar)
    // Aquí todavía NO hacemos lógica de suscripción/jades; solo marcamos idempotencia.
    try {
      const { error: procErr } = await supabase
        .from("paypal_events_processed")
        .insert({ event_id: eventId });

      if (procErr) {
        // Si llega duplicado aquí, también lo ignoramos.
        const msg = String(procErr?.message || procErr);
        const code = procErr?.code;
        if (code === "23505" || msg.toLowerCase().includes("duplicate")) {
          console.log("[PP_WEBHOOK] processed_duplicate_ignored", { id: eventId });
        } else {
          console.error("[PP_WEBHOOK] processed_insert_error", procErr);
          // Respondemos 200 igual
        }
      }
    } catch (e) {
      console.error("[PP_WEBHOOK] processed_insert_exception", e);
      // Respondemos 200 igual
    }

    console.log("[PP_WEBHOOK] ok", { id: eventId, verified, eventType, storedRaw });

    return res.status(200).json({ ok: true, stored: true, storedRaw, verified });
  } catch (e) {
    console.error("[PP_WEBHOOK] exception", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
}
```0