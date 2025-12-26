// /api/user_status.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const INITIAL_JADES = Number(process.env.INITIAL_JADES || 50000);

function getBearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  if (!h.startsWith("Bearer ")) return null;
  return h.slice("Bearer ".length).trim();
}

export default async function handler(req, res) {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Missing env vars: SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    // 1) Leer JWT del cliente
    const token = getBearer(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing Authorization Bearer token" });
    }

    // 2) Cliente "authed" con ANON + token (para validar el usuario)
    const authed = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await authed.auth.getUser();
    if (userErr || !userData?.user?.id) {
      return res.status(401).json({ ok: false, error: "Invalid session", details: userErr?.message });
    }

    const user = userData.user;
    const userId = user.id;

    // 3) Cliente ADMIN para DB (service role)
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 4) Leer/crear wallet
    //    OJO: si tu PK en user_wallet no es user_id, ajusta el onConflict.
    const { data: walletRows, error: wSelErr } = await admin
      .from("user_wallet")
      .select("user_id,balance,plan,updated_at,created_at")
      .eq("user_id", userId)
      .limit(1);

    if (wSelErr) {
      return res.status(500).json({ ok: false, error: "DB_READ_WALLET_ERROR", details: wSelErr.message });
    }

    let wallet = walletRows?.[0] || null;

    // Si no existe, lo creamos.
    if (!wallet) {
      // Importante: este insert SOLO va a funcionar si userId EXISTE en auth.users EN ESTE MISMO PROYECTO/DB.
      const { data: ins, error: wInsErr } = await admin
        .from("user_wallet")
        .insert([{ user_id: userId, balance: INITIAL_JADES, plan: "basic" }])
        .select("user_id,balance,plan,updated_at,created_at")
        .single();

      if (wInsErr) {
        return res.status(500).json({
          ok: false,
          error: "DB_CREATE_WALLET_ERROR",
          details: wInsErr.message,
          hint:
            "Si aquí sale FK error, ese userId no existe en auth.users en este proyecto/DB. Revisa que estés en el proyecto correcto y que ese usuario exista en Authentication > Users.",
        });
      }

      wallet = ins;
    }

    // 5) Respuesta unificada
    return res.status(200).json({
      ok: true,
      user: {
        id: userId,
        email: user.email,
        created_at: user.created_at,
      },
      status: {
        plan: wallet.plan || "basic",
        jades: Number(wallet.balance || 0),
      },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "USER_STATUS_FATAL", details: String(e?.message || e) });
  }
}
