// src/lib/PaypalCheckout.js
// ============================================================
// IsabelaOS Studio - PayPal Checkout Helpers (redirect flow)
// - startPaypalSubscription(tier): crea suscripción en backend y redirige a PayPal approve_url
// - verifyPaypalOrderAndGrantJades({ orderID, pack }): valida pago de pack y acredita jades
// ============================================================

import { supabase } from "./supabaseClient"; // ✅ ajusta la ruta si tu archivo está en otra carpeta

function stringifyDetails(details) {
  try {
    if (!details) return "";
    if (typeof details === "string") return details;
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

async function getSessionTokenOrThrow() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message || "SUPABASE_SESSION_ERROR");
  const accessToken = data?.session?.access_token;
  if (!accessToken) throw new Error("NO_SESSION_TOKEN");
  return accessToken;
}

// ---------------------------------------------------------
// ✅ SUBSCRIPTION (redirect) - sin SDK, sin popup
// ---------------------------------------------------------
export async function startPaypalSubscription(tier) {
  const accessToken = await getSessionTokenOrThrow();

  const r = await fetch("/api/create-subscription", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ tier }),
  });

  const j = await r.json().catch(() => ({}));

  if (!r.ok || !j?.ok) {
    const extra = j?.details ? `\n\nDETAILS:\n${stringifyDetails(j.details)}` : "";
    throw new Error((j?.error || "PAYPAL_CREATE_SUB_FAILED") + extra);
  }

  if (!j?.approve_url) {
    throw new Error(
      "NO_APPROVE_URL_FROM_PAYPAL" +
        (j?.details ? `\n\nDETAILS:\n${stringifyDetails(j.details)}` : "")
    );
  }

  // ✅ redirige al approve
  window.location.href = j.approve_url;
}

// Aliases (por compatibilidad con llamadas viejas)
export async function startPayPalSubscriptionRedirect(tier) {
  return startPaypalSubscription(tier);
}
export async function startPayPalSubscription(tier) {
  return startPaypalSubscription(tier);
}

// ---------------------------------------------------------
// ✅ PACKS (one-time order) - validar y acreditar jades
// ---------------------------------------------------------
export async function verifyPaypalOrderAndGrantJades({ orderID, pack }) {
  const accessToken = await getSessionTokenOrThrow();

  if (!orderID) throw new Error("MISSING_ORDER_ID");
  if (!pack) throw new Error("MISSING_PACK");

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
    const extra = j?.details ? `\n\nDETAILS:\n${stringifyDetails(j.details)}` : "";
    throw new Error((j?.error || "PAYPAL_VERIFY_AND_GRANT_FAILED") + extra);
  }

  return j;
}