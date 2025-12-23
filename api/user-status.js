// api/user-status.js
import { sbAdmin } from "../../lib/supabaseAdmin";

export default async function handler(req, res) {
  // CORS
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  // DEBUG helper (para saber hasta dónde llegó)
  const debug = {
    step: "start",
    hasReqUrl: !!req.url,
    host: req.headers?.host || null,
    xfProto: req.headers?.["x-forwarded-proto"] || null,
  };

  try {
    // 1) Construir URL robusta (NO usa localhost a ciegas)
    debug.step = "build_url";
    const proto = req.headers?.["x-forwarded-proto"] || "https";
    const host = req.headers?.host || "localhost";
    const path = req.url || ""; // <- si viniera undefined, no crashea
    const full = `${proto}://${host}${path}`;
    const url = new URL(full);

    debug.step = "read_user_id";
    const user_id =
      (req.query && req.query.user_id) ||
      url.searchParams.get("user_id") ||
      null;

    debug.user_id = user_id;

    if (!user_id) {
      return res.status(400).json({ ok: false, error: "MISSING_USER_ID", debug });
    }

    // 2) Inicializar Supabase Admin
    debug.step = "sb_admin_init";
    let sb;
    try {
      sb = sbAdmin();
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: "SB_ADMIN_INIT_FAILED",
        detail: String(e),
        debug,
      });
    }

    // 3) Leer subscription
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

    // 4) Leer wallet
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
        has_wallet_row: !!wallet,
        has_sub_row: !!sub,
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
