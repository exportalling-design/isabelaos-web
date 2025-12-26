// /api/paypal-verify-and-grant.js
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

const PAYPAL_BASE = "https://api-m.paypal.com"; // si es sandbox: https://api-m.sandbox.paypal.com

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok:false, error:"METHOD_NOT_ALLOWED" });

    // 1) AUTH
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok:false, error: auth.error });
    const user_id = auth.user.id;

    const { orderID, jadesAmount } = req.body || {};
    if (!orderID) return res.status(400).json({ ok:false, error:"MISSING_ORDER_ID" });

    // 2) ENV
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
    const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;

    if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ ok:false, error:"MISSING_SUPABASE_ENV" });
    if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) return res.status(500).json({ ok:false, error:"MISSING_PAYPAL_ENV" });

    // 3) PayPal access token
    const tokenRes = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      return res.status(500).json({ ok:false, error:"PAYPAL_TOKEN_ERROR", details: t });
    }

    const { access_token } = await tokenRes.json();

    // 4) Verify order
    const orderRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${orderID}`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const orderJson = await orderRes.json();
    if (!orderRes.ok) return res.status(400).json({ ok:false, error:"PAYPAL_ORDER_LOOKUP_FAIL", details: orderJson });

    // Importante: status COMPLETED
    if (orderJson.status !== "COMPLETED") {
      return res.status(400).json({ ok:false, error:"PAYPAL_NOT_COMPLETED", status: orderJson.status });
    }

    // 5) Grant jades
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const amount = Number(jadesAmount || 50000); // aquí defines paquete según plan
    const { data, error } = await supabase.rpc("grant_jades", {
      p_user_id: user_id,
      p_amount: amount,
      p_reason: "payment:paypal",
      p_ref: orderID,
    });

    if (error) return res.status(500).json({ ok:false, error:"GRANT_JADES_RPC_ERROR", details: error.message });

    // 6) Leer balance actualizado
    const { data: w } = await supabase
      .from("user_wallet")
      .select("balance")
      .eq("user_id", user_id)
      .maybeSingle();

    return res.status(200).json({ ok:true, granted: amount, jades: Number(w?.balance || 0) });
  } catch (e) {
    return res.status(500).json({ ok:false, error:"FATAL", details: e?.message || String(e) });
  }
}
