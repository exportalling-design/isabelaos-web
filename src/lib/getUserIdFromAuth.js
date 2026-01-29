// src/lib/getUserIdFromAuth.js
import { getSupabaseAdmin } from "./supabaseAdmin.js";

export async function getUserIdFromAuthHeader(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  const token = typeof h === "string" && h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return null;

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.getUser(token);
  if (error) return null;

  return data?.user?.id || null;
}