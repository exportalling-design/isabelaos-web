// api/paypal-verify-and-grant.js
// Verifica el pago con PayPal y acredita Jades
import { supabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

const PAYPAL_MODE = (process.env.PAYPAL_MODE || "sandbox").toLowerCase();
const PAYPAL_BASE = PAYPAL_MODE === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

// Precios actuales — deben coincidir con JADE_PACKS en pricing.js
const JADE_PACKS = {
  starter: { jades: 50,  usd: 5.0,  label: "Starter" },
  popular: { jades: 150, usd: 13.0, label: "Popular" },
  pro:     { jades: 350, usd: 28.0, label: "Pro" },
  studio:  { jades: 800, usd: 60.0, label: "Studio" },
};

export default async function handler(req, res) {
  res.setHeader("content-type", "application/json; charset=utf-8");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const { orderID, pack } = body;

    if (!orderID) return res.status(400).json({ ok: false, error: "MISSING_ORDER_ID" });

    const packKey = String(pack || "").toLowerCase();
    const packDef = JADE_PACKS[packKey];
    if (!packDef) return res.status(400).json({ ok: false, error: "INVALID_PACK", allowed: Object.keys(JADE_PACKS) });

    // 1. Obtener access token de PayPal
    const tokenRes = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!tokenRes.ok) {
      const t = await tokenRes.text().catch(() => "");
      return res.status(500).json({ ok: false, error: "PAYPAL_TOKEN_ERROR", details: t });
    }
    const { access_token } = await tokenRes.json();

    // 2. Verificar la orden
    const orderRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${orderID}`, {
      headers: { "Authorization": `Bearer ${access_token}` },
    });
    const orderJson = await orderRes.json().catch(() => ({}));
    if (!orderRes.ok) return res.status(400).json({ ok: false, error: "PAYPAL_ORDER_LOOKUP_FAIL" });

    // 3. Verificar que está COMPLETED (ya capturado por el SDK del frontend)
    if (orderJson?.status !== "COMPLETED") {
      return res.status(400).json({ ok: false, error: "PAYPAL_NOT_COMPLETED", status: orderJson?.status });
    }

    // 4. Verificar monto — anti fraude
    const paidUSD = Number(orderJson?.purchase_units?.[0]?.amount?.value);
    if (Math.abs(paidUSD - packDef.usd) > 0.01) {
      return res.status(400).json({ ok: false, error: "PAYPAL_AMOUNT_MISMATCH", expected: packDef.usd, paid: paidUSD });
    }

    // 5. Acreditar Jades — idempotente por ref = orderID
    const ref = `paypal:${orderID}`;
    const { error: creditErr } = await supabaseAdmin.rpc("spend_jades", {
      p_user_id: userId,
      p_amount:  -packDef.jades, // negativo = acreditar
      p_reason:  `payment:paypal:${packKey}`,
      p_ref:     ref,
    });

    // Si spend_jades no soporta negativos, usar add_jades si existe
    // Intentar con credit_jades_from_payment como alternativa
    if (creditErr) {
      console.log("[paypal-verify] spend_jades failed, trying credit_jades_from_payment:", creditErr.message);
      const { error: creditErr2 } = await supabaseAdmin.rpc("credit_jades_from_payment", {
        p_user_id: userId,
        p_amount:  packDef.jades,
        p_reason:  `payment:paypal:${packKey}`,
        p_ref:     ref,
      });
      if (creditErr2) {
        console.error("[paypal-verify] both RPCs failed:", creditErr2.message);
        return res.status(500).json({ ok: false, error: "CREDIT_ERROR", detail: creditErr2.message });
      }
    }

    // 6. Leer balance actualizado
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("jade_balance")
      .eq("id", userId)
      .single();

    console.log(`[paypal-verify] OK userId=${userId} pack=${packKey} jades=${packDef.jades} orderID=${orderID}`);

    return res.status(200).json({
      ok:      true,
      orderID,
      pack:    packKey,
      granted: packDef.jades,
      jades:   profile?.jade_balance ?? null,
      paidUSD,
    });

  } catch (e) {
    console.error("[paypal-verify] error:", e.message);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", detail: e?.message });
  }
}

export const config = { runtime: "nodejs" };
