// /api/paypal-verify-and-grant.js
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

const PAYPAL_MODE = (process.env.PAYPAL_MODE || "sandbox").toLowerCase();
const PAYPAL_BASE =
  PAYPAL_MODE === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

// 🔒 Catálogo SERVER-SIDE: NO confiar en jadesAmount del cliente.
// Tu UI manda "pack": "small" | "medium" | "big" (o como querrás).
const JADE_PACKS = {
  small: { jades: 1000, usd: 5.0 },
  medium: { jades: 3000, usd: 10.0 },
  big: { jades: 8000, usd: 20.0 },
};

function must(name, val) {
  if (!val) throw new Error(`Missing env: ${name}`);
  return val;
}

function readOrderAmountUSD(orderJson) {
  // Order v2: purchase_units[0].amount.value
  const v = orderJson?.purchase_units?.[0]?.amount?.value;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
    }

    // 1) AUTH
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    const user_id = auth.user.id;

    const { orderID, pack } = req.body || {};
    if (!orderID) return res.status(400).json({ ok: false, error: "MISSING_ORDER_ID" });

    const packKey = String(pack || "").toLowerCase();
    const packDef = JADE_PACKS[packKey];
    if (!packDef) {
      return res.status(400).json({
        ok: false,
        error: "INVALID_PACK",
        allowed: Object.keys(JADE_PACKS),
      });
    }

    // 2) ENV
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
    const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;

    must("SUPABASE_URL (o VITE_SUPABASE_URL)", SUPABASE_URL);
    must("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
    must("PAYPAL_CLIENT_ID", PAYPAL_CLIENT_ID);
    must("PAYPAL_CLIENT_SECRET", PAYPAL_CLIENT_SECRET);

    // 3) PayPal access token
    const tokenRes = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    if (!tokenRes.ok) {
      const t = await tokenRes.text().catch(() => "");
      return res.status(500).json({ ok: false, error: "PAYPAL_TOKEN_ERROR", details: t });
    }

    const { access_token } = await tokenRes.json();

    // 4) Verify order
    const orderRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${orderID}`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const orderJson = await orderRes.json().catch(() => ({}));
    if (!orderRes.ok) {
      return res.status(400).json({ ok: false, error: "PAYPAL_ORDER_LOOKUP_FAIL", details: orderJson });
    }

    // ✅ V2 Orders: status COMPLETED
    if (orderJson?.status !== "COMPLETED") {
      return res.status(400).json({
        ok: false,
        error: "PAYPAL_NOT_COMPLETED",
        status: orderJson?.status || null,
      });
    }

    // ✅ Validar monto (anti fraude)
    const paidUSD = readOrderAmountUSD(orderJson);
    if (paidUSD == null) {
      return res.status(400).json({ ok: false, error: "PAYPAL_AMOUNT_MISSING" });
    }

    // tolerancia por decimales
    const expectedUSD = Number(packDef.usd);
    if (Math.abs(paidUSD - expectedUSD) > 0.01) {
      return res.status(400).json({
        ok: false,
        error: "PAYPAL_AMOUNT_MISMATCH",
        expectedUSD,
        paidUSD,
      });
    }

    // 5) Grant jades (idempotente por ref = orderID)
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const amount = Number(packDef.jades);

    // 🔁 usa el MISMO RPC que tu webhook oficial: add_jades
    const { error: creditErr } = await supabase.rpc("add_jades", {
      p_user_id: user_id,
      p_amount: amount,
      p_reason: `payment:paypal:${packKey}`,
      p_ref: `pporder:${orderID}`,
    });

    if (creditErr) {
      return res.status(500).json({
        ok: false,
        error: "ADD_JADES_RPC_ERROR",
        details: creditErr.message || creditErr,
      });
    }

    // 6) Leer balance actualizado
    const { data: w, error: werr } = await supabase
      .from("user_wallet")
      .select("balance, updated_at")
      .eq("user_id", user_id)
      .maybeSingle();

    if (werr) {
      return res.status(500).json({ ok: false, error: "WALLET_READ_ERROR", details: werr.message || werr });
    }

    return res.status(200).json({
      ok: true,
      orderID,
      pack: packKey,
      granted: amount,
      jades: Number(w?.balance || 0),
      paidUSD,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "FATAL", details: e?.message || String(e) });
  }
}