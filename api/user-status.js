// /api/user-status.js
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

// Map plan_id -> label
function planFromPayPalPlanId(plan_id) {
  const basic = process.env.PAYPAL_PLAN_ID_BASIC;
  const pro = process.env.PAYPAL_PLAN_ID_PRO;
  if (plan_id && basic && plan_id === basic) return "basic";
  if (plan_id && pro && plan_id === pro) return "pro";
  return null;
}

// Normaliza status PayPal a "active"/"none"/"inactive"
function normalizeSubStatus(ppStatus) {
  const s = String(ppStatus || "").toLowerCase();
  if (!s) return "none";
  if (["active"].includes(s)) return "active";
  // V2 típicos: ACTIVE, SUSPENDED, CANCELLED, EXPIRED
  if (["suspended", "cancelled", "canceled", "expired"].includes(s)) return "inactive";
  return "inactive";
}

export default async function handler(req, res) {
  try {
    const auth = await requireUser(req);
    if (!auth.ok) {
      return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    }

    const user_id = auth.user.id;

    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({
        ok: false,
        error: "MISSING_ENV_VARS",
        missing: [
          !SUPABASE_URL ? "SUPABASE_URL (o VITE_SUPABASE_URL)" : null,
          !SERVICE_KEY ? "SUPABASE_SERVICE_ROLE_KEY" : null,
        ].filter(Boolean),
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // -------------------------
    // Wallet (jades)
    // -------------------------
    const { data: walletRow, error: walletErr } = await supabase
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

    // -------------------------
    // Subscription status (PayPal)
    // -------------------------
    // Tomamos la más reciente por updated_at
    const { data: subRow, error: subErr } = await supabase
      .from("paypal_subscriptions")
      .select("status,plan_id,updated_at,subscription_id")
      .eq("user_id", user_id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subErr) {
      return res.status(500).json({
        ok: false,
        error: "SUB_SELECT_ERROR",
        details: subErr.message || subErr,
      });
    }

    const plan = planFromPayPalPlanId(subRow?.plan_id || null);
    const subscription_status = normalizeSubStatus(subRow?.status || null);

    return res.status(200).json({
      ok: true,
      user_id,
      // ✅ lo que tu UI está esperando
      plan: plan, // "basic" | "pro" | null
      subscription_status, // "active" | "inactive" | "none"
      jades: balance,
      // extra por debug
      balance,
      paypal: subRow
        ? {
            subscription_id: subRow.subscription_id,
            status: subRow.status,
            plan_id: subRow.plan_id,
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