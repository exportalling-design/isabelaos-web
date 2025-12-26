// /api/user-status.js
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

export default async function handler(req, res) {
  try {
    // ----------------------------
    // 1) AUTH: user_id SOLO desde token
    // ----------------------------
    const auth = await requireUser(req);
    if (!auth.ok) {
      return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    }
    const user_id = auth.user.id;

    // ----------------------------
    // 2) ENV
    // ----------------------------
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

    // ----------------------------
    // 3) Leer wallet (SOLO LECTURA)
    // ----------------------------
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

    // ----------------------------
    // 4) (Opcional) contar HOY
    // ----------------------------
    let todayCount = null;
    try {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end = new Date(); end.setHours(23, 59, 59, 999);

      const { count, error: cntErr } = await supabase
        .from("generations")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user_id)
        .gte("created_at", start.toISOString())
        .lte("created_at", end.toISOString());

      if (!cntErr) todayCount = count ?? 0;
    } catch (_) {}

    // ----------------------------
    // 5) Respuesta (clave: jades)
    // ----------------------------
    return res.status(200).json({
      ok: true,
      user_id,
      jades: balance,   // ✅ lo que debe leer la UI
      balance,          // opcional
      todayCount,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "USER_STATUS_FATAL",
      details: e?.message || String(e),
    });
  }
}
