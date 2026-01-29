// lib/supabaseAdmin.js
import { createClient } from "@supabase/supabase-js";

/**
 * sbAdmin()
 * Cliente admin usando SERVICE_ROLE.
 * - Bypassea RLS (necesario para inserts/updates de jobs y billing).
 * - NO lo uses en frontend.
 */
export function sbAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("Missing SUPABASE_URL (o VITE_SUPABASE_URL)");
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, key);
}

/**
 * ✅ Alias para compatibilidad (tu video-status importaba este nombre).
 * Así no revientan rutas por un import que no existe.
 */
export function getSupabaseAdmin() {
  return sbAdmin();
}