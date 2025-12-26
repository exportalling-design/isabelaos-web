// /api/_auth.js
import { createClient } from "@supabase/supabase-js";

// ============================================================
// ENV
// - Usa SUPABASE_URL (Vercel) o VITE_SUPABASE_URL (fallback)
// - Service Role Key (solo server)
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ============================================================
// Crea un cliente admin (Service Role) SIN persistir sesión
// ============================================================
function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// ============================================================
// Lee el header Authorization de forma compatible:
// - Edge runtime: req.headers es un objeto Headers (tiene .get())
// - Node runtime: req.headers es un objeto normal { authorization: ... }
// ============================================================
function readAuthHeader(req) {
  // Edge / Web Fetch API style headers
  if (req?.headers && typeof req.headers.get === "function") {
    // "authorization" es case-insensitive, pero usamos el estándar
    return req.headers.get("authorization") || "";
  }

  // Node style headers
  const headers = req?.headers || {};
  return headers.authorization || headers.Authorization || "";
}

// ============================================================
// requireUser(req)
// - Espera: Authorization: Bearer <SUPABASE_JWT>
// - Valida token con sb.auth.getUser(token)
// - Devuelve: { ok, user, sb } o error 401
// ============================================================
export async function requireUser(req) {
  const authHeader = readAuthHeader(req);

  // Token formato "Bearer xxxxx"
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

  // Si no hay token, error
  if (!token) return { ok: false, code: 401, error: "MISSING_AUTH_TOKEN" };

  // Valida token contra Supabase (server-side)
  const sb = sbAdmin();
  const { data, error } = await sb.auth.getUser(token);

  // Token inválido o expirado
  if (error || !data?.user) {
    return { ok: false, code: 401, error: "INVALID_AUTH_TOKEN" };
  }

  // OK
  return { ok: true, user: data.user, sb };
}
