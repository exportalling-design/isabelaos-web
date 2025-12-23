// /api/user-status.js
import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  // CORS
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  // ✅ Debug seguro (NO expone user_id/correos)
  const debug = {
    step: "start",
    hasUrl: !!process.env.SUPABASE_URL,
    hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    hasAnonKey: !!process.env.SUPABASE_ANON_KEY,
    host: req.headers?.host || null,
    xfProto: req.headers?.["x-forwarded-proto"] || null,
  };

  try {
    debug.step = "build_url";
    const proto = req.headers?.["x-forwarded-proto"] || "https";
    const host = req.headers?.host || "localhost";
    const path = req.url || "/";
    const url = new URL(`${proto}://${host}${path}`);

    // ---------------------------------------------------------
    // ✅ CAMBIO: funciona para todos
    // 1) Acepta user_id por query ?user_id=
    // 2) O si NO viene, lo toma del JWT en Authorization: Bearer <token>
    // ---------------------------------------------------------
    debug.step = "read_user_id";
    let user_id = url.searchParams.get("user_id");

    if (!user_id) {
      debug.step = "read_auth_header";
      const authHeader = req.headers?.authorization || req.headers?.Authorization || "";
      const token = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice("Bearer ".length).trim()
        : null;

      if (token) {
        debug.step = "verify_jwt_get_user";
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const ANON_KEY = process.env.SUPABASE_ANON_KEY;

        if (!SUPABASE_URL || !ANON_KEY) {
          return res.status(500).json({
            ok: false,
            error: "MISSING_SUPABASE_ENV",
            debug,
          });
        }

        const sbAuth = createClient(SUPABASE_URL, ANON_KEY, {
          auth: { persistSession: false },
        });

        const { data: userData, error: userErr } = await sbAuth.auth.getUser(token);

        if (userErr || !userData?.user?.id) {
          return res.status(401).json({
            ok: false,
            error: "UNAUTHORIZED",
            detail: userErr?.message || "INVALID_TOKEN",
            debug,
          });
        }

        user_id = userData.user.id;
      }
    }

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
        // ✅ CAMBIO: NO exponemos user_id (ni correos si alguien lo mandaba)
        user_id: null,
        has_sub_row: !!sub,
        has_wallet_row: !!wallet,
      },
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      detail: String(e),
      debug: {
        ...debug,
        user_id: null, // ✅ no exponer nada sensible
      },
    });
  }
}
