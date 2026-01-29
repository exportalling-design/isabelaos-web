// lib/getUserIdFromAuth.js
import { getSupabaseAdmin } from "./supabaseAdmin.js";

export async function getUserIdFromAuthHeader(req) {
  const auth = req.headers?.authorization || req.headers?.Authorization || "";
  const token = String(auth).startsWith("Bearer ") ? String(auth).slice(7) : null;
  if (!token) return null;

  const admin = getSupabaseAdmin();

  // Valida el JWT con Supabase Admin
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user?.id) return null;

  return data.user.id;
}