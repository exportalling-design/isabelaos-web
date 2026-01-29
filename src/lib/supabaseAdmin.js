// src/lib/supabaseAdmin.js
import { createClient } from "@supabase/supabase-js";

let _admin = null;

export function getSupabaseAdmin() {
  if (_admin) return _admin;

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL (or VITE_SUPABASE_URL)");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  _admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return _admin;
}

// ✅ compat: si ya lo usas en otros lados, sigue existiendo
export const supabaseAdmin = getSupabaseAdmin();