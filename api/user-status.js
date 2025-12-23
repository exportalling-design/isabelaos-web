// api/user-status.js
import { sbAdmin } from "../lib/supabaseAdmin";

export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const url = new URL(req.url, "http://localhost");
    const user_id =
      (req.query && req.query.user_id) ||
      url.searchParams.get("user_id") ||
      null;

    if (!user_id) {
      return res.status(400).json({ ok: false, error: "MISSING_USER_ID" });
    }

    const sb = sbAdmin();

    const { data: sub, error: subErr } = await sb
      .from("user_subscription")
      .select("plan, status")
      .eq("user_id", user_id)
      .maybeSingle();

    if (subErr) {
      return res.status(500).json({ ok: false, error: "SUBSCRIPTION_ERROR", detail: subErr.message });
    }

    const { data: wallet, error: walletErr } = await sb
      .from("user_wallet")
      .select("balance")
      .eq("user_id", user_id)
      .maybeSingle();

    if (walletErr) {
      return res.status(500).json({ ok: false, error: "WALLET_ERROR", detail: walletErr.message });
    }

    const active = sub?.status === "active";

    return res.status(200).json({
      ok: true,
      plan: active ? sub?.plan : null,
      subscription_status: sub?.status || "none",
      jades: wallet?.balance ?? 0,
      is_active: active,
      debug: {
        has_wallet_row:
