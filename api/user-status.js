// /api/user-status.js
import { requireUser } from "./_auth.js";

// -------------------------------
// Mapeo PayPal plan_id -> plan (basic/pro)
// -------------------------------
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
    const sb = auth.sb; // ✅ admin client del helper

    // ===================================================
    // 1) Jades desde profiles.jade_balance
    // ===================================================
    const { data: profRow, error: profErr } = await sb
      .from("profiles")
      .select("jade_balance, plan, updated_at")
      .eq("id", user_id)
      .maybeSingle();

    if (profErr) {
      return res.status(500).json({
        ok: false,
        error: "PROFILES_SELECT_ERROR",
        details: profErr.message || profErr,
      });
    }

    const jades = Number(profRow?.jade_balance || 0);
    const profile_plan = profRow?.plan || "free";

    // ===================================================
    // 2) Última suscripción desde paypal_subscriptions
    // ===================================================
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
      jades,
      plan,
      subscription_status,

      // extras debug (opcional)
      profile: {
        plan: profile_plan,
        jade_balance: jades,
        updated_at: profRow?.updated_at || null,
      },
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