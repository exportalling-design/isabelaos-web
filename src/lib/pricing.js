// src/lib/pricing.js
// ─────────────────────────────────────────────────────────────
// ÚNICA fuente de verdad para packs, costos y límites.
// Importar desde aquí en todos los demás archivos.
// ─────────────────────────────────────────────────────────────

// Packs de Jades — compra única, sin suscripción
// 1 Jade = $0.10 USD
export const JADE_PACKS = {
  starter: { jades: 50,  price_usd: 5,  label: "Starter"  },
  popular: { jades: 150, price_usd: 13, label: "Popular"  },
  pro:     { jades: 350, price_usd: 28, label: "Pro"      },
  studio:  { jades: 800, price_usd: 60, label: "Studio"   },
};

// Costos por generación en Jades
export const COSTS = {
  img_prompt:       1,   // Imagen sin avatar (FLUX texto)
  img_anchor:       2,   // Imagen con avatar/anchor
  vid_express_8s:   18,  // Veo3 Fast 8s (sin audio)
  vid_express_audio:4,   // Audio Layer sobre Express
  vid_standard_10s: 17,  // WAN 10s
  vid_standard_15s: 24,  // WAN 15s
  vid_standard_audio:4,  // Audio Layer sobre Standard
};

// Límites gratis por día para usuarios sin Jades
export const FREE_LIMITS = {
  guest_images_per_day:  parseInt(process.env.FREE_IMAGES_GUEST_PER_DAY  || "3",  10),
  active_images_per_day: parseInt(process.env.FREE_IMAGES_ACTIVE_PER_DAY || "5",  10),
};

// PLANES — se mantiene por compatibilidad con activate-plan.js y webhooks existentes
// Eventualmente se puede eliminar cuando migremos completamente a packs
export const PLANS = {
  basic: { price_usd: 19, included_jades: 100 },
  pro:   { price_usd: 39, included_jades: 300 },
};
