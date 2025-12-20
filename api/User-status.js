// /api/user-status.js
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const user_id = req.query.user_id;

    if (!user_id) {
      return res.status(400).json({
        ok: false,
        error: "MISSING_USER_ID",
      });
    }

    // 1️⃣ Suscripción
    const { data: sub, error: subErr } = await supabaseAdmin
      .from("user_subscription")
      .select("plan, status")
      .eq("user_id", user_id)
      .single();

    if (subErr && subErr.code !== "PGRST116") {
      return res.status(500).json({
        ok: false,
        error: "SUBSCRIPTION_ERROR",
        detail: subErr.message,
      });
    }

    // 2️⃣ Wallet (jades)
    const { data: wallet, error: walletErr } = await supabaseAdmin
      .from("user_wallet")
      .select("balance")
      .eq("user_id", user_id)
      .single();

    if (walletErr && walletErr.code !== "PGRST116") {
      return res.status(500).json({
        ok: false,
        error: "WALLET_ERROR",
        detail: walletErr.message,
      });
    }

    return res.status(200).json({
      ok: true,
      plan: sub?.status === "active" ? sub.plan : null,
      subscription_status: sub?.status || "none",
      jades: wallet?.balance ?? 0,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      detail: String(e),
    });
  }
}
