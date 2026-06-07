// api/redeem-promo.js
// Canjea un código promocional y acredita Jades al usuario
import { supabaseAdmin }           from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader }  from "../src/lib/getUserIdFromAuth.js";

export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("content-type", "application/json; charset=utf-8");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const userId = await getUserIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  const { code } = body;

  if (!code || String(code).trim().length < 3) {
    return res.status(400).json({ ok: false, error: "Código inválido" });
  }

  const { data, error } = await supabaseAdmin.rpc("redeem_promo_code", {
    p_user_id: userId,
    p_code:    String(code).trim().toUpperCase(),
  });

  if (error) {
    console.error("[redeem-promo] RPC error:", error.message);
    return res.status(500).json({ ok: false, error: "Error procesando el código" });
  }

  if (!data?.ok) {
    const msgs = {
      INVALID_CODE:   "Código no válido o inactivo.",
      EXPIRED_CODE:   "Este código ha expirado.",
      CODE_EXHAUSTED: "Este código ya fue usado.",
      ALREADY_USED:   "Ya canjeaste este código.",
    };
    return res.status(400).json({
      ok: false,
      error: msgs[data?.error] || "Código no válido.",
    });
  }

  console.log("[redeem-promo] userId=" + userId + " code=" + code + " jades=" + data.jades);
  return res.status(200).json({ ok: true, jades: data.jades });
}

export const config = { runtime: "nodejs" };
