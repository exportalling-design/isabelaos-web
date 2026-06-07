// src/lib/pricing.js
// ─────────────────────────────────────────────────────────────
// ÚNICA fuente de verdad para packs, costos y límites.
// ─────────────────────────────────────────────────────────────

// Packs de Jades — compra única, sin suscripción
// 1 Jade ≈ $0.10 USD
export const JADE_PACKS = {
  starter: { jades: 50,  price_usd: 5,  label: "Starter" },
  popular: { jades: 150, price_usd: 13, label: "Popular" },
  pro:     { jades: 350, price_usd: 28, label: "Pro"     },
  studio:  { jades: 800, price_usd: 60, label: "Studio"  },
};

// Costos por generación en Jades
// Basado en precios reales de EvoLink con margen 5x
// EvoLink Seedance 2.0 Fast:
//   480p → ~$0.024/s  |  720p → ~$0.052/s
// 1 Jade = $0.10 USD  →  5x margen
export const COSTS = {
  // Imágenes
  img_prompt:       1,    // Imagen sin avatar (FLUX texto)
  img_anchor:       2,    // Imagen con avatar/anchor

  // CineAI — Seedance 2.0 Fast 480p (precio justo 5x margen)
  cineai_480_5s:    2,    // 480p 5s  → $0.12 real → 2 Jades ($0.20)
  cineai_480_10s:   3,    // 480p 10s → $0.24 real → 3 Jades ($0.30)
  cineai_480_15s:   4,    // 480p 15s → $0.36 real → 4 Jades ($0.40)

  // CineAI — Seedance 2.0 Fast 720p
  cineai_720_5s:    5,    // 720p 5s  → $0.26 real → 5 Jades ($0.50)
  cineai_720_10s:   9,    // 720p 10s → $0.52 real → 9 Jades ($0.90)
  cineai_720_15s:   13,   // 720p 15s → $0.78 real → 13 Jades ($1.30)

  // Plantillas épicas — 480p 10s con referencia de rostro
  template_480:     30,   // ~$0.24 real + overhead → 30 Jades ($3.00)
  template_720:     60,   // ~$0.52 real + overhead → 60 Jades ($6.00)

  // Legacy — mantener compatibilidad
  vid_express_8s:   18,
  vid_express_audio: 4,
  vid_standard_10s: 17,
  vid_standard_15s: 24,
  vid_standard_audio: 4,
};

// Límites gratis por día
export const FREE_LIMITS = {
  guest_images_per_day:  parseInt(process.env.FREE_IMAGES_GUEST_PER_DAY  || "3", 10),
  active_images_per_day: parseInt(process.env.FREE_IMAGES_ACTIVE_PER_DAY || "5", 10),
};

// PLANES — compatibilidad
export const PLANS = {
  basic: { price_usd: 19, included_jades: 100 },
  pro:   { price_usd: 39, included_jades: 300 },
};
