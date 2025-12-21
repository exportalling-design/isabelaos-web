// lib/pricing.js
// ============================================================
// ÚNICA fuente de verdad para planes, packs y costos.
// NO tocar en otros archivos: todo importa desde aquí.
// ============================================================

export const PLANS = {
  basic: { price_usd: 19, included_jades: 100 },
  pro: { price_usd: 39, included_jades: 300 },
};

export const JADE_PACKS = {
  "100": { jades: 100, price_usd: 10 },
  "300": { jades: 300, price_usd: 27 },
};

// Costos por generación (en jades)
export const COSTS = {
  img_prompt: 1,
  vid_prompt: 10,
  vid_img2vid: 12,
  xmas_photo: 2,
};

// Límites gratis por día (si no hay suscripción activa)
export const FREE_LIMITS = {
  guest_images_per_day: parseInt(process.env.FREE_IMAGES_GUEST_PER_DAY || "3", 10),
  active_images_per_day: parseInt(process.env.FREE_IMAGES_ACTIVE_PER_DAY || "5", 10),
};
