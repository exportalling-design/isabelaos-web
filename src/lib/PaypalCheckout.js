// src/lib/PaypalCheckout.js

// ============================================================
// PayPal helpers (client)
// - Suscripciones: crea y redirige a approve_url
// - Packs (pago único): helper para verificar + acreditar jades
//   llamando /api/paypal-verify-and-grant
// ============================================================

// ✅ Suscripciones (redirect)
export async function startPaypalSubscription(tier) {
  const r = await fetch("/api/create-subscription", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tier }),
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.ok) {
    throw new Error(j?.error || "PAYPAL_CREATE_SUB_FAILED");
  }

  if (!j?.approve_url) {
    throw new Error("NO_APPROVE_URL_FROM_PAYPAL");
  }

  // ✅ Redirect directo (sin popup)
  window.location.href = j.approve_url;
}

// ✅ Alias compatible (si App.jsx importa este nombre)
export async function startPayPalSubscriptionRedirect(tier) {
  return startPaypalSubscription(tier);
}

// ✅ Alias extra por si lo llamaste distinto en algún lado
export async function startPayPalSubscription(tier) {
  return startPaypalSubscription(tier);
}

// ============================================================
// ✅ PACKS / PAGO ÚNICO: verificar order + acreditar jades
// Requiere:
// - orderID (PayPal order id)
// - pack: "small" | "medium" | "big" (según tu JADE_PACKS server-side)
// - accessToken: token del user (Bearer) para requireUser
// ============================================================
export async function verifyPaypalOrderAndGrantJades({ orderID, pack, accessToken }) {
  if (!orderID) throw new Error("MISSING_ORDER_ID");
  if (!pack) throw new Error("MISSING_PACK");
  if (!accessToken) throw new Error("MISSING_ACCESS_TOKEN");

  const r = await fetch("/api/paypal-verify-and-grant", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ orderID, pack }),
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.ok) {
    throw new Error(j?.error || "PAYPAL_VERIFY_AND_GRANT_FAILED");
  }

  return j; // { ok, orderID, pack, granted, jades, paidUSD }
}