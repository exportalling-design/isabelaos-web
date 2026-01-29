// src/lib/supabaseAdmin.js
import { createClient } from "@supabase/supabase-js";

export function getSupabaseAdmin() {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL) throw new Error("SUPABASE_URL missing");
  if (!SERVICE_ROLE) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");

  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
