// lib/dailyUsage.js
// ============================================================
// Enforce real en servidor: "gratis del día" de imágenes.
// Tabla requerida: daily_usage (ver SQL abajo).
// ============================================================

import { FREE_LIMITS } from "./pricing";

function todayISO() {
  // YYYY-MM-DD
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// consume 1 "free image" si hay cupo.
// retorna: { ok:true, used_free:true/false, remaining_free:n }
export async function checkAndConsumeFreeImage(sb, user_id, isActiveUser) {
  const day = todayISO();
  const limit = isActiveUser
    ? FREE_LIMITS.active_images_per_day
    : FREE_LIMITS.guest_images_per_day;

  // Si limit = 0, no hay gratis.
  if (!limit || limit <= 0) {
    return { ok: true, used_free: false, remaining_free: 0 };
  }

  // Upsert: si no existe, crear; si existe, leer y sumar.
  // (Para evitar carreras, lo ideal es RPC. Pero esto funciona estable con poco tráfico.)
  const { data: row, error: readErr } = await sb
    .from("daily_usage")
    .select("user_id, day, free_images_used")
    .eq("user_id", user_id)
    .eq("day", day)
    .maybeSingle();

  if (readErr) throw readErr;

  const used = row?.free_images_used ?? 0;
  if (used >= limit) {
    return { ok: true, used_free: false, remaining_free: 0 };
  }

  const next = used + 1;

  const { error: upErr } = await sb
    .from("daily_usage")
    .upsert({ user_id, day, free_images_used: next }, { onConflict: "user_id,day" });

  if (upErr) throw upErr;

  return { ok: true, used_free: true, remaining_free: Math.max(0, limit - next) };
}
