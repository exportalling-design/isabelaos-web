// /api/user-status.js
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

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

    return res.status(200).json({
      ok: true,
      user_id,
      jades: balance,  // ✅ clave que leerá la UI
      balance,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "USER_STATUS_FATAL",
      details: e?.message || String(e),
    });
  }
}
