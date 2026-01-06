// /api/_auth.js
import { createClient } from "@supabase/supabase-js";

/**
 * requireUser(req)
 * - Verifica JWT del usuario con Supabase (anon key)
 * - Devuelve { ok:true, user } o { ok:false, error, code }
 *
 * Requiere:
 * - SUPABASE_URL (o VITE_SUPABASE_URL)
 * - SUPABASE_ANON_KEY (o VITE_SUPABASE_ANON_KEY)
 */
export async function requireUser(req) {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const ANON_KEY =
      process.env.SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON;

    if (!SUPABASE_URL || !ANON_KEY) {
      return { ok: false, code: 500, error: "MISSING_SUPABASE_ANON_ENV" };
    }

    // 1) Token desde header Authorization
    const authHeader = req.headers?.authorization || req.headers?.Authorization || "";
    let token = "";
    if (authHeader.startsWith("Bearer ")) token = authHeader.slice(7).trim();

    // 2) (Opcional) Token desde cookie si existiera
    if (!token) {
      const cookie = req.headers?.cookie || "";
      // si alguna vez guardás sb-access-token como cookie:
      const m = cookie.match(/sb-access-token=([^;]+)/);
      if (m) token = decodeURIComponent(m[1]);
    }

    if (!token) return { ok: false, code: 401, error: "MISSING_AUTH_TOKEN" };

    const supabase = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return { ok: false, code: 401, error: "INVALID_TOKEN" };
    }

    return { ok: true, user: data.user };
  } catch (e) {
    return { ok: false, code: 500, error: e?.message