// api/jades-buy.js
// ─────────────────────────────────────────────────────────────
// Endpoint para comprar packs de Jades con Pagadito.
// Flujo: setup-payer → customer → credit_jades_from_payment
// ─────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";
import { requireUser }  from "./_auth.js";
import { JADE_PACKS }   from "../src/lib/pricing.js";
 
function getPagaditoBase() {
  return process.env.PAGADITO_ENV === "production"
    ? "https://app.pagadito.com/api/v1"
    : "https://sandbox-api.pagadito.com/v1";
}
 
function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return req.socket?.remoteAddress || "127.0.0.1";
}
 
function basicAuth(uid, wsk) {
  return "Basic " + Buffer.from(`${uid}:${wsk}`).toString("base64");
}
 
// ── Wrapper con logs para cada llamada a Pagadito ─────────────
async function pagaditoPost(step, body, uid, wsk) {
  const base = getPagaditoBase();
  const url  = `${base}/${step}/`;
 
  console.log(`[pagadito:${step}] → ${url}`);
  console.log(`[pagadito:${step}] ENV=${process.env.PAGADITO_ENV || "sandbox"}`);
 
  let r, text, json;
  try {
    r    = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        Authorization:  basicAuth(uid, wsk),
      },
      body: JSON.stringify(body),
    });
    text = await r.text();
  } catch (fetchErr) {
    console.error(`[pagadito:${step}] FETCH_ERROR:`, fetchErr.message);
    throw fetchErr;
  }
 
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
 
  console.log(`[pagadito:${step}] HTTP=${r.status} code=${json?.response_code || "N/A"} msg=${json?.response_message || "N/A"}`);
 
  return { ok: r.ok, status: r.status, data: json };
}
 
function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("MISSING_SUPABASE_ENV");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
 
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }
 
  try {
    // ── 1. Auth ───────────────────────────────────────────────
    const auth = await requireUser(req);
    if (!auth.ok) {
      console.log("[jades-buy] AUTH_FAILED:", auth.error);
      return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    }
    const user = auth.user;
    console.log("[jades-buy] user:", user.id);
 
    // ── 2. Validar pack ───────────────────────────────────────
    const { pack, card } = req.body || {};
    console.log("[jades-buy] pack:", pack);
 
    if (!pack || !JADE_PACKS[pack]) {
      return res.status(400).json({ ok: false, error: "INVALID_PACK", valid_packs: Object.keys(JADE_PACKS) });
    }
    const packInfo = JADE_PACKS[pack];
    console.log("[jades-buy] packInfo:", packInfo);
 
    // ── 3. Validar tarjeta ────────────────────────────────────
    if (!card?.number || !card?.expirationDate || !card?.cvv || !card?.cardHolderName) {
      console.log("[jades-buy] MISSING_CARD_FIELDS");
      return res.status(400).json({ ok: false, error: "MISSING_CARD_FIELDS" });
    }
    if (!card?.firstName || !card?.lastName || !card?.email) {
      console.log("[jades-buy] MISSING_PERSONAL_FIELDS");
      return res.status(400).json({ ok: false, error: "MISSING_PERSONAL_FIELDS" });
    }
    console.log("[jades-buy] card number ends:", card.number?.slice(-4));
    console.log("[jades-buy] card expiry:", card.expirationDate);
 
    // ── 4. Credenciales ───────────────────────────────────────
    const uid = process.env.PAGADITO_UID;
    const wsk = process.env.PAGADITO_WSK;
    if (!uid || !wsk) {
      console.error("[jades-buy] MISSING_PAGADITO_ENV");
      return res.status(500).json({ ok: false, error: "MISSING_PAGADITO_ENV" });
    }
    console.log("[jades-buy] UID prefix:", uid?.slice(0, 8));
 
    // ── 5. setup-payer ────────────────────────────────────────
    console.log("[jades-buy] llamando setup-payer...");
    const setup = await pagaditoPost("setup-payer", {
      card: {
        number:         card.number,
        expirationDate: card.expirationDate,
        cvv:            card.cvv,
        cardHolderName: card.cardHolderName,
      },
    }, uid, wsk);
 
    console.log("[jades-buy] setup-payer result:", JSON.stringify(setup.data).slice(0, 300));
 
    if (!setup.ok || setup?.data?.response_code !== "PG200-00") {
      return res.status(setup.status || 400).json({
        ok: false, stage: "setup-payer", ...setup.data,
      });
    }
 
    const merchantTransactionId = `JADE-${pack}-${user.id}-${Date.now()}`;
    console.log("[jades-buy] merchantTransactionId:", merchantTransactionId);
 
    // ── 6. customer ───────────────────────────────────────────
    console.log("[jades-buy] llamando customer...");
    const customer = await pagaditoPost("customer", {
      card: {
        number:         card.number,
        expirationDate: card.expirationDate,
        cvv:            card.cvv,
        cardHolderName: card.cardHolderName,
        firstName:      card.firstName,
        lastName:       card.lastName,
        billingAddress: {
          city:      card.billingAddress?.city      || "",
          state:     card.billingAddress?.state     || "",
          zip:       card.billingAddress?.zip       || "",
          countryId: card.billingAddress?.countryId || "320",
          line1:     card.billingAddress?.line1     || "",
          phone:     card.billingAddress?.phone     || "",
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
        deviceFingerprintID: "1234567890123456",
        customerIp:          getClientIp(req),
      },
      consumerAuthenticationInformation: {
        setup_request_id: setup.data.request_id,
        referenceId:      setup.data.referenceId,
        returnUrl: `${process.env.SITE_URL || "https://www.isabelaos.com"}/api/payment-return`,
      },
    }, uid, wsk);
 
    console.log("[jades-buy] customer result:", JSON.stringify(customer.data).slice(0, 300));
 
    // 3D Secure challenge
    if (customer?.data?.response_code === "PG402-05") {
      console.log("[jades-buy] 3DS challenge requerido");
      return res.status(200).json({
        ok: false, challenge_required: true, stage: "customer",
        response_code:    customer.data.response_code,
        response_message: customer.data.response_message,
        challenge:        customer.data.customer_reply || null,
        setup: {
          request_id:              setup.data.request_id,
          referenceId:             setup.data.referenceId,
          accessToken:             setup.data.accessToken || null,
          deviceDataCollectionUrl: setup.data.deviceDataCollectionUrl || null,
        },
      });
    }
 
    if (!customer.ok || customer?.data?.response_code !== "PG200-00") {
      console.log("[jades-buy] customer failed:", customer.data?.response_code, customer.data?.response_message);
      return res.status(customer.status || 402).json({
        ok: false, stage: "customer", ...customer.data,
      });
    }
 
    // ── 7. Acreditar Jades ────────────────────────────────────
    const sb = getSupabaseAdmin();
    const reference_id = customer?.data?.customer_reply?.payment_token ||
                         customer?.data?.request_id ||
                         merchantTransactionId;
 
    console.log("[jades-buy] acreditando jades:", packInfo.jades, "ref:", reference_id);
 
    const { error: creditErr } = await sb.rpc("credit_jades_from_payment", {
      p_user_id:      user.id,
      p_amount:       packInfo.jades,
      p_reference_id: reference_id,
      p_reason:       `jade_pack:${pack}`,
    });
 
    if (creditErr) {
      console.error("[jades-buy] CREDIT_ERROR:", creditErr.message);
      return res.status(500).json({
        ok: false, error: "CREDIT_ERROR",
        detail: creditErr.message,
        note: "El pago se procesó pero falló el crédito. Contacta soporte.",
        reference_id,
      });
    }
 
    console.log("[jades-buy] ✅ pago exitoso, jades acreditados:", packInfo.jades);
 
    // ── 8. Éxito ──────────────────────────────────────────────
    return res.status(200).json({
      ok: true, pack,
      jades_added: packInfo.jades,
      price_usd:   packInfo.price_usd,
      reference_id,
      payment:     customer.data,
    });
 
  } catch (e) {
    console.error("[jades-buy] SERVER_ERROR:", e?.message || e);
    return res.status(500).json({
      ok: false, error: "SERVER_ERROR",
      detail: String(e?.message || e),
    });
  }
}
 
export const config = { runtime: "nodejs" };
 
