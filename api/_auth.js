// /api/_auth.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

export async function requireUser(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token) return { ok: false, code: 401, error: "MISSING_AUTH_TOKEN" };

  const sb = sbAdmin();
  const { data, error } = await sb.auth.getUser(token);

  if (error || !data?.user) {
    return { ok: false, code: 401, error: "INVALID_AUTH_TOKEN" };
  }

  return { ok: true, user: data.user, sb };
}

