// pages/api/user-status.js
import { requireUser, getActivePlan } from "../../lib/apiAuth";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const { sb, user } = await requireUser(req);

    const sub = await getActivePlan(sb, user.id);

    const { data: wallet, error: walletErr } = await sb
      .from("user_wallet")
      .select("balance")
      .eq("user_id", user.id)
      .single();

    if (walletErr && walletErr.code !== "PGRST116") {
      return res.status(500).json({ ok: false, error: "WALLET_ERROR", detail: walletErr.message });
    }

    return res.status(200).json({
      ok: true,
      user_id: user.id,
      plan: sub.plan,
      subscription_status: sub.status,
      jades: wallet?.balance ?? 0,
    });
  } catch (e) {
    const code = e.statusCode || 500;
    return res.status(code).json({ ok: false, error: String(e.message || e) });
  }
}
