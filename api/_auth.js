// /api/_auth.js
// ============================================================
// Auth helper (Supabase Admin) para APIs.
// Lee Bearer token del header "Authorization: Bearer <token>"
// y valida el usuario con supabase.auth.getUser(token).
// ============================================================

import { createClient } from "@supabase/supabase-js";

// Soporta ambas formas de env (por si estás mezclando Vite/Vercel)
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Crea cliente admin (service role)
function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

/**
 * requireUser(req)
 * - Devuelve { ok:true, user, sb } si el token es válido
 * - Devuelve { ok:false, code, error } si no
 */
export async function requireUser(req) {
  try {
    const headers = req.headers || {};
    const authHeader = headers.authorization || headers.Authorization || "";

    // Espera: "Bearer xxxxx"
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) return { ok: false, code: 401, error: "MISSING_AUTH_TOKEN" };

    const sb = sbAdmin();

    const { data, error } = await sb.auth.getUser(token);

    if (error || !data?.user) {
      return { ok: false, code: 401, error: "INVALID_AUTH_TOKEN" };
    }

    return { ok: true, user: data.user, sb };
  } catch (e) {
    // Si esto falla, lo verás en logs de Vercel
    console.error("[AUTH] requireUser crashed:", e);
    return { ok: false, code: 500, error: "AUTH_INTERNAL_ERROR" };
  }
}
