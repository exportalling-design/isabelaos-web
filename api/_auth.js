// /api/_auth.js
import { createClient } from "@supabase/supabase-js";

// ============================================================
// ENV
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ============================================================
// Supabase admin client (server-side only)
// ============================================================
function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY)
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// ============================================================
// Leer headers compatible con:
// - Edge Runtime (Headers.get)
// - Node Runtime (objeto plano)
// ============================================================
function getHeader(req, name) {
  const headers = req?.headers;

  // Edge / Fetch API
  if (headers && typeof headers.get === "function") {
    return headers.get(name) || "";
  }

  // Node / Serverless
  if (headers && typeof headers === "object") {
    const key = String(name).toLowerCase();
    return headers[key] || headers[name] || "";
  }

  return "";
}

// ============================================================
// requireUser
// ============================================================
export async function requireUser(req) {
  const authHeader = getHeader(req, "authorization");

  const token =
    authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

  if (!token) {
    return { ok: false, code: 401, error: "MISSING_AUTH_TOKEN" };
  }

  const sb = sbAdmin();
  const { data, error } = await sb.auth.getUser(token);

  if (error || !data?.user) {
    return { ok: false, code: 401, error: "INVALID_AUTH_TOKEN" };
  }

  return { ok: true, user: data.user, sb };
}
