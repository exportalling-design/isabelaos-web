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
  const startedAt = Date.now();

  try {
    const auth = await requireUser(req);
    if (!auth.ok) {
      return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    }

    const user_id = auth.user.id;
    const sb = auth.sb; // admin client (por tu helper)

    // 1) Balance desde profiles (tu wallet real)
    const { data: profRow, error: profErr } = await sb
      .from("profiles")
      .select("jade_balance, plan, updated_at, created_at, email")
      .eq("id", user_id)
      .maybeSingle();

    if (profErr) {
      console.error("[USER_STATUS] PROFILES_SELECT_ERROR", profErr);
      return res.status(500).json({
        ok: false,
        error: "PROFILES_SELECT_ERROR",
        details: profErr.message || String(profErr),
      });
    }

    const jades = Number(profRow?.jade_balance || 0);
    const profile_plan = profRow?.plan || "free";

    // 2) Última suscripción por user_id (requiere que webhook guarde user_id)
    const { data: subRow, error: subErr } = await sb
      .from("paypal_subscriptions")
      .select("status, plan_id, updated_at, subscription_id, payer_id, custom_id, user_id")
      .eq("user_id", user_id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subErr) {
      console.error("[USER_STATUS] SUBSCRIPTION_SELECT_ERROR", subErr);
      return res.status(500).json({
        ok: false,
        error: "SUBSCRIPTION_SELECT_ERROR",
        details: subErr.message || String(subErr),
      });
    }

    const subscription_status = subRow?.status || "none";
    const plan = planFromPayPalPlanId(subRow?.plan_id) || null;

    console.log("[USER_STATUS] ok", {
      user_id,
      email: profRow?.email,
      jades,
      profile_plan,
      subscription_status,
      plan,
      ms: Date.now() - startedAt,
    });

    return res.status(200).json({
      ok: true,
      user_id,
      jades,
      plan,
      subscription_status,
      profile: {
        email: profRow?.email || null,
        plan: profile_plan,
        jade_balance: jades,
        updated_at: profRow?.updated_at || null,
        created_at: profRow?.created_at || null,
      },
      paypal: subRow
        ? {
            subscription_id: subRow.subscription_id,
            plan_id: subRow.plan_id,
            status: subRow.status,
            updated_at: subRow.updated_at,
            payer_id: subRow.payer_id,
            custom_id: subRow.custom_id,
            user_id: subRow.user_id,
          }
        : null,
    });
  } catch (e) {
    console.error("[USER_STATUS] FATAL", e);
    return res.status(500).json({
      ok: false,
      error: "USER_STATUS_FATAL",
      details: e?.message || String(e),
    });
  }
}