// api/jades-pay.js
// ─────────────────────────────────────────────────────────────
// Paso 2: Recibe los tokens del iframe y llama customer
// Se llama DESPUÉS de que el frontend hizo el iframe de Cardinal
// ─────────────────────────────────────────────────────────────
import { requireUser }  from "./_auth.js";
import { createClient } from "@supabase/supabase-js";
import { JADE_PACKS }   from "../src/lib/pricing.js";

function getPagaditoBase() {
  return process.env.PAGADITO_ENV === "production"
    ? "https://app.pagadito.com/api/v1"
    : "https://sandbox-api.pagadito.com/v1";
}

function basicAuth(uid, wsk) {
  return "Basic " + Buffer.from(`${uid}:${wsk}`).toString("base64");
}

function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return req.socket?.remoteAddress || "127.0.0.1";
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("MISSING_SUPABASE_ENV");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(401).json({ ok: false, error: auth.error });
    const user = auth.user;

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const { pack, card, setupRequestId, referenceId, deviceFingerprintID } = body;

    if (!pack || !JADE_PACKS[pack]) return res.status(400).json({ ok: false, error: "INVALID_PACK" });
    if (!setupRequestId)           return res.status(400).json({ ok: false, error: "MISSING_SETUP_REQUEST_ID" });
    if (!referenceId)              return res.status(400).json({ ok: false, error: "MISSING_REFERENCE_ID" });

    const packInfo = JADE_PACKS[pack];
    const uid      = process.env.PAGADITO_UID;
    const wsk      = process.env.PAGADITO_WSK;
    if (!uid || !wsk) return res.status(500).json({ ok: false, error: "MISSING_PAGADITO_ENV" });

    const merchantTransactionId = `JADE-${pack}-${user.id}-${Date.now()}`;
    const fingerprint = String(deviceFingerprintID || "").trim() ||
      (String(Date.now()).slice(-8) + String(Math.floor(Math.random() * 100000000)).padStart(8, "0"));
    const clientIp = getClientIp(req);
    const siteUrl  = process.env.SITE_URL || "https://isabelaos.com";

    console.log(`[jades-pay] user=${user.id} pack=${pack} fingerprint=${fingerprint}`);

    const url = `${getPagaditoBase()}/customer/`;
    const r   = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json;charset=UTF-8",
        Authorization:   basicAuth(uid, wsk),
      },
      body: JSON.stringify({
        card: {
          number:         card.number.replace(/\s/g, ""),
          expirationDate: card.expirationDate,
          cvv:            card.cvv,
          cardHolderName: card.cardHolderName,
          firstName:      card.firstName,
          lastName:       card.lastName,
          billingAddress: {
            city:      "San Salvador",
            state:     "San Salvador",
            zip:       "",
            countryId: "222",
            line1:     card.line1 || "7a Calle Pte. Bis, 511 y 531",
            phone:     card.phone || "2264-7032",
          },
          email: card.email,
        },
        transaction: {
          merchantTransactionId,
          currencyId: "USD",
          transactionDetails: [{
            quantity:    "1",
            description: `IsabelaOS · ${packInfo.jades} Jades (Pack ${packInfo.label})`,
            amount:      String(packInfo.price_usd.toFixed(2)),
          }],
        },
        browserInfo: {
          deviceFingerprintID: fingerprint,
          customerIp:          clientIp,
        },
        consumerAuthenticationInformation: {
          setup_request_id: setupRequestId,
          referenceId:      referenceId,
          returnUrl:        `${siteUrl}/api/payment-return`,
        },
      }),
    });

    const data = await r.json().catch(() => null);
    console.log("[jades-pay] customer response:", data?.response_code, data?.response_message);

    // 3DS Challenge requerido
    if (data?.response_code === "PG402-05") {
      return res.status(200).json({
        ok:                 false,
        challenge_required: true,
        stepUpUrl:          data?.customer_reply?.stepUpUrl,
        accessToken:        data?.customer_reply?.accessToken,
        id_transaction:     data?.customer_reply?.id_transaction,
        request_id:         data?.request_id,
      });
    }

    if (!r.ok || data?.response_code !== "PG200-00") {
      console.log("[jades-pay] FAILED:", data?.response_code, data?.response_message);
      return res.status(r.status || 402).json({ ok: false, ...data });
    }

    // ── Acreditar Jades ───────────────────────────────────────
    const sb           = getSupabaseAdmin();
    const reference_id = data?.customer_reply?.payment_token || data?.request_id || merchantTransactionId;

    const { error: creditErr } = await sb.rpc("credit_jades_from_payment", {
      p_user_id:      user.id,
      p_amount:       packInfo.jades,
      p_reference_id: reference_id,
      p_reason:       `jade_pack:${pack}`,
    });

    if (creditErr) {
      console.error("[jades-pay] CREDIT_ERROR:", creditErr.message);
      return res.status(500).json({
        ok: false, error: "CREDIT_ERROR",
        detail: creditErr.message,
        note: "El pago se procesó pero falló el crédito. Contacta soporte.",
        reference_id,
      });
    }

    console.log("[jades-pay] ✅ Pago exitoso:", packInfo.jades, "jades acreditados");

    return res.status(200).json({
      ok:          true,
      pack,
      jades_added: packInfo.jades,
      price_usd:   packInfo.price_usd,
      reference_id,
    });

  } catch (e) {
    console.error("[jades-pay] SERVER_ERROR:", e?.message);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", detail: String(e?.message) });
  }
}

export const config = { runtime: "nodejs" };
