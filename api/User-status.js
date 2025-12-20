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

    // 1️⃣ Obtener suscripción
    const { data: sub, error: subErr } = await supabaseAdmin
      .from("user_subscription")
      .select("plan, status")
      .eq("user_id", user_id)
      .single();

    if (subErr && subErr.code !== "PGRST116") {
      // PGRST116 = no rows found (usuario sin plan)
      return res.status(500).json({
        ok: false,
        error: "SUBSCRIPTION_ERROR",
        detail: subErr.message,
      });
    }

    // 2️⃣ Obtener balance de jades
    const { data: balanceData, error: balErr } = await supabaseAdmin
      .rpc("get_jade_balance", { p_user_id: user_id });

    if (balErr) {
      return res.status(500).json({
        ok: false,
        error: "BALANCE_ERROR",
        detail: balErr.message,
      });
    }

    const jades = balanceData?.[0]?.balance ?? 0;

    return res.status(200).json({
      ok: true,
      plan: sub?.status === "active" ? sub.plan : null,
      subscription_status: sub?.status || "none",
      jades,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      detail: String(e),
    });
  }
}
