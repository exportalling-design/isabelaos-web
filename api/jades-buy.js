// api/jades-buy.js
// ─────────────────────────────────────────────────────────────
// Endpoint para comprar packs de Jades con Pagadito.
// Flujo: setup-payer → customer → credit_jades_from_payment
// Se llama desde el panel de billing del usuario logueado.
// ─────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";
import { requireUser }  from "./_auth.js";
import { JADE_PACKS }   from "../src/lib/pricing.js";
 
// ── URL base según entorno ────────────────────────────────────
// PAGADITO_ENV=production → producción real
// cualquier otro valor    → sandbox
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
 
async function pagaditoPost(path, body, uid, wsk) {
  const base = getPagaditoBase();
  const r    = await fetch(`${base}/${path}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      Authorization:  basicAuth(uid, wsk),
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { ok: r.ok, status: r.status, data: json };
}
 
// ── Supabase admin client ─────────────────────────────────────
function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("MISSING_SUPABASE_ENV");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
 
export default async function handler(req, res) {
  // Solo POST
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }
 
  try {
    // ── 1. Autenticar usuario ─────────────────────────────────
    const auth = await requireUser(req);
    if (!auth.ok) {
      return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    }
    const user = auth.user;
 
    // ── 2. Validar pack solicitado ────────────────────────────
    const { pack, card } = req.body || {};
 
    if (!pack || !JADE_PACKS[pack]) {
      return res.status(400).json({ ok: false, error: "INVALID_PACK",
        valid_packs: Object.keys(JADE_PACKS) });
    }
 
    const packInfo = JADE_PACKS[pack];
 
    // ── 3. Validar datos de tarjeta ───────────────────────────
    if (!card?.number || !card?.expirationDate || !card?.cvv || !card?.cardHolderName) {
      return res.status(400).json({ ok: false, error: "MISSING_CARD_FIELDS" });
    }
    if (!card?.firstName || !card?.lastName || !card?.email) {
      return res.status(400).json({ ok: false, error: "MISSING_PERSONAL_FIELDS" });
    }
 
    // ── 4. Credenciales Pagadito ──────────────────────────────
    const uid = process.env.PAGADITO_UID;
    const wsk = process.env.PAGADITO_WSK;
    if (!uid || !wsk) {
      return res.status(500).json({ ok: false, error: "MISSING_PAGADITO_ENV" });
    }
 
    // ── 5. Setup-payer ────────────────────────────────────────
    const setup = await pagaditoPost("setup-payer", {
      card: {
        number:         card.number,
        expirationDate: card.expirationDate,
        cvv:            card.cvv,
        cardHolderName: card.cardHolderName,
      },
    }, uid, wsk);
 
    if (!setup.ok || setup?.data?.response_code !== "PG200-00") {
      return res.status(setup.status || 400).json({
        ok: false, stage: "setup-payer", ...setup.data,
      });
    }
 
    // ID único e idempotente para esta transacción
    const merchantTransactionId = `JADE-${pack}-${user.id}-${Date.now()}`;
 
    // ── 6. Customer (cargo real) ──────────────────────────────
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
        returnUrl:        `${process.env.SITE_URL || "https://www.isabelaos.com"}/api/payment-return`,
      },
    }, uid, wsk);
 
    // 3D Secure challenge requerido
    if (customer?.data?.response_code === "PG402-05") {
      return res.status(200).json({
        ok:                false,
        challenge_required: true,
        stage:             "customer",
        response_code:     customer.data.response_code,
        response_message:  customer.data.response_message,
        challenge:         customer.data.customer_reply || null,
        setup: {
          request_id:              setup.data.request_id,
          referenceId:             setup.data.referenceId,
          accessToken:             setup.data.accessToken || null,
          deviceDataCollectionUrl: setup.data.deviceDataCollectionUrl || null,
        },
      });
    }
 
    if (!customer.ok || customer?.data?.response_code !== "PG200-00") {
      return res.status(customer.status || 402).json({
        ok: false, stage: "customer", ...customer.data,
      });
    }
 
    // ── 7. Acreditar Jades en Supabase ────────────────────────
    const sb          = getSupabaseAdmin();
    const reference_id = customer?.data?.customer_reply?.payment_token ||
                         customer?.data?.request_id                     ||
                         merchantTransactionId;
 
    const { error: creditErr } = await sb.rpc("credit_jades_from_payment", {
      p_user_id:     user.id,
      p_amount:      packInfo.jades,
      p_reference_id: reference_id,
      p_reason:      `jade_pack:${pack}`,
    });
 
    if (creditErr) {
      // El pago se procesó pero falló el crédito — loguear para revisión manual
      console.error("[jades-buy] CREDIT_ERROR después de pago exitoso:", {
        user_id:    user.id,
        pack,
        jades:      packInfo.jades,
        reference_id,
        error:      creditErr.message,
      });
      return res.status(500).json({
        ok:    false,
        error: "CREDIT_ERROR",
        detail: creditErr.message,
        note:  "El pago se procesó pero falló el crédito. Contacta soporte con tu ID de transacción.",
        reference_id,
      });
    }
 
    // ── 8. Respuesta exitosa ──────────────────────────────────
    return res.status(200).json({
      ok:           true,
      pack,
      jades_added:  packInfo.jades,
      price_usd:    packInfo.price_usd,
      reference_id,
      payment:      customer.data,
    });
 
  } catch (e) {
    console.error("[jades-buy] SERVER_ERROR:", e);
    return res.status(500).json({
      ok:     false,
      error:  "SERVER_ERROR",
      detail: String(e?.message || e),
    });
  }
}
 
export const config = { runtime: "nodejs" };
