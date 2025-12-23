// api/user-status.js
import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  // CORS
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  const debug = {
    step: "start",
    hasUrl: !!process.env.SUPABASE_URL,
    hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    host: req.headers?.host || null,
    xfProto: req.headers?.["x-forwarded-proto"] || null,
  };

  try {
    debug.step = "build_url";
    const proto = req.headers?.["x-forwarded-proto"] || "https";
    const host = req.headers?.host || "localhost";
    const path = req.url || "/";
    const url = new URL(`${proto}://${host}${path}`);

    debug.step = "read_user_id";
    const user_id = url.searchParams.get("user_id");
    debug.user_id = user_id || null;

    if (!user_id) {
      return res.status(400).json({ ok: false, error: "MISSING_USER_ID", debug });
    }

    debug.step = "init_supabase";
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({
        ok: false,
        error: "MISSING_SUPABASE_ENV",
        debug,
      });
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    debug.step = "fetch_subscription";
    const { data: sub, error: subErr } = await sb
      .from("user_subscription")
      .select("plan, status")
      .eq("user_id", user_id)
      .maybeSingle();

    if (subErr) {
      return res.status(500).json({
        ok: false,
        error: "SUBSCRIPTION_ERROR",
        detail: subErr.message,
        debug,
      });
    }

    debug.step = "fetch_wallet";
    const { data: wallet, error: walletErr } = await sb
      .from("user_wallet")
      .select("balance")
      .eq("user_id", user_id)
      .maybeSingle();

    if (walletErr) {
      return res.status(500).json({
        ok: false,
        error: "WALLET_ERROR",
        detail: walletErr.message,
        debug,
      });
    }

    debug.step = "ok";
    const active = sub?.status === "active";

    return res.status(200).json({
      ok: true,
      plan: active ? sub?.plan : null,
      subscription_status: sub?.status || "none",
      jades: wallet?.balance ?? 0,
      is_active: active,
      debug: {
        ...debug,
        has_sub_row: !!sub,
        has_wallet_row: !!wallet,
      },
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      detail: String(e),
      debug,
    });
  }
}
