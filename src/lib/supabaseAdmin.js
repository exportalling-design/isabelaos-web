// lib/supabaseAdmin.js
import { createClient } from "@supabase/supabase-js";

export function sbAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("Missing SUPABASE_URL (o VITE_SUPABASE_URL)");
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  // ✅ sin sesión persistente (server)
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}