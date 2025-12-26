// /api/user-status.js
import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    // ----------------------------
    // 1) Leer user_id
    // ----------------------------
    const user_id =
      req.query.user_id ||
      req.query.userId ||
      (req.body && (req.body.user_id || req.body.userId));

    if (!user_id) {
      return res.status(400).json({ ok: false, error: "MISSING_USER_ID" });
    }

    // ----------------------------
    // 2) ENV: aceptar nombres server y VITE fallback
    // ----------------------------
    const SUPABASE_URL =
      process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;

    // Para user-status NO necesitas anon si usas service role,
    // pero lo dejamos por compatibilidad / logs.
    const SUPABASE_ANON_KEY =
      process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    const SUPABASE_SERVICE_ROLE_KEY =
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    const missing = [];
    if (!SUPABASE_URL) missing.push("SUPABASE_URL (o VITE_SUPABASE_URL)");
    if (!SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");

    if (missing.length) {
      return res.status(500).json({
        ok: false,
        error: "MISSING_ENV_VARS",
        missing,
        // te lo dejo visible para debug rápido
        hasAnon: Boolean(SUPABASE_ANON_KEY),
      });
    }

    // ----------------------------
    // 3) Cliente ADMIN (bypass RLS)
    // ----------------------------
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ----------------------------
    // 4) Leer wallet (public.user_wallet)
    // ----------------------------
    let balance = 0;

    const { data: walletRow, error: walletErr } = await supabase
      .from("user_wallet")
      .select("user_id,balance,updated_at")
      .eq("user_id", user_id)
      .maybeSingle();

    if (walletErr) {
      // Si el select falla por permisos/tablas, devolvemos el error claro
      return res.status(500).json({
        ok: false,
        error: "WALLET_SELECT_ERROR",
        details: walletErr.message || walletErr,
      });
    }

    // Si NO existe row, la creamos con 0 (o si quieres 50000)
    if (!walletRow) {
      const initialBalance = 0; // <-- si quieres 50000, cambia aquí

      const { error: insErr } = await supabase
        .from("user_wallet")
        .insert([{ user_id, balance: initialBalance }]);

      if (insErr) {
        return res.status(500).json({
          ok: false,
          error: "WALLET_INSERT_ERROR",
          details: insErr.message || insErr,
        });
      }

      balance = initialBalance;
    } else {
      balance = Number(walletRow.balance || 0);
    }

    // ----------------------------
    // 5) (Opcional) Contar generaciones HOY
    //    Si no existe la tabla, no revienta.
    // ----------------------------
    let todayCount = null;
    try {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setHours(23, 59, 59, 999);

      const { count, error: cntErr } = await supabase
        .from("generations")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user_id)
        .gte("created_at", start.toISOString())
        .lte("created_at", end.toISOString());

      if (!cntErr) todayCount = count ?? 0;
    } catch (_) {
      // ignora
    }

    // ----------------------------
    // 6) Respuesta
    // ----------------------------
    return res.status(200).json({
      ok: true,
      user_id,
      balance,
      todayCount, // puede ser null si no existe la tabla
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "USER_STATUS_FATAL",
      details: e?.message || String(e),
    });
  }
}
