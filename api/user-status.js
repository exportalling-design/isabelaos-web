// /api/user-status.js
import { requireUser } from "./_auth.js";

function planFromPayPalPlanId(plan_id) {
  const basic = process.env.PAYPAL_PLAN_ID_BASIC;
  const pro = process.env.PAYPAL_PLAN_ID_PRO;
  if (plan_id && basic && plan_id === basic) return "basic";
  if (plan_id && pro && plan_id === pro) return "pro";
  return null;
}

export default async function handler(req, res) {
  try {
    const auth = await requireUser(req);
    if (!auth.ok) {
      return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    }

    const user_id = auth.user.id;
    const sb = auth.sb; // ✅ ya es admin client por tu helper

    // 1) Wallet (jades)
    const { data: walletRow, error: walletErr } = await sb
      .from("user_wallet")
      .select("balance,updated_at")
      .eq("user_id", user_id)
      .maybeSingle();

    if (walletErr) {
      return res.status(500).json({
        ok: false,
        error: "WALLET_SELECT_ERROR",
        details: walletErr.message || walletErr,
      });
    }

    const balance = Number(walletRow?.balance || 0);

    // 2) Última suscripción (si existe)
    const { data: subRow, error: subErr } = await sb
      .from("paypal_subscriptions")
      .select("status, plan_id, updated_at, subscription_id")
      .eq("user_id", user_id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subErr) {
      return res.status(500).json({
        ok: false,
        error: "SUBSCRIPTION_SELECT_ERROR",
        details: subErr.message || subErr,
      });
    }

    const subscription_status = subRow?.status || "none";
    const plan = planFromPayPalPlanId(subRow?.plan_id) || null;

    return res.status(200).json({
      ok: true,
      user_id,

      // ✅ lo que usa tu UI
      jades: balance,
      plan,
      subscription_status,

      // (extras por si querés debug)
      balance,
      paypal: subRow
        ? {
            subscription_id: subRow.subscription_id,
            plan_id: subRow.plan_id,
            status: subRow.status,
            updated_at: subRow.updated_at,
          }
        : null,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "USER_STATUS_FATAL",
      details: e?.message || String(e),
    });
  }
}