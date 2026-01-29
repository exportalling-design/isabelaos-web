// lib/getUserIdFromAuth.js
import { createClient } from "@supabase/supabase-js";

/**
 * Lee Authorization: Bearer <token>
 * y devuelve el user.id real desde Supabase Auth.
 * Si no hay token o no es válido, lanza error.
 */
export async function getUserIdFromAuthHeader(req) {
  const auth = req.headers?.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) throw new Error("MISSING_AUTH_TOKEN");

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");

  // ✅ Cliente anon SOLO para validar token (NO writes)
  const sb = createClient(url, anon, { auth: { persistSession: false } });

  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user?.id) throw new Error("INVALID_AUTH_TOKEN");

  return data.user.id;
}