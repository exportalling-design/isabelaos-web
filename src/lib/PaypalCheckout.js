// src/lib/PaypalCheckout.js
import { supabase } from "./supabaseClient"; // <-- AJUSTA ESTA RUTA A TU PROYECTO

export async function startPaypalSubscription(tier) {
  // obtener token
  const { data } = await supabase.auth.getSession();
  const accessToken = data?.session?.access_token;
  if (!accessToken) throw new Error("NO_SESSION_TOKEN");

  const r = await fetch("/api/create-subscription", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ tier }),
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.ok) throw new Error(j?.error || "PAYPAL_CREATE_SUB_FAILED");
  if (!j?.approve_url) throw new Error("NO_APPROVE_URL_FROM_PAYPAL");
  window.location.href = j.approve_url;
}

export async function startPayPalSubscriptionRedirect(tier) {
  return startPaypalSubscription(tier);
}
export async function startPayPalSubscription(tier) {
  return startPaypalSubscription(tier);
}

// Packs
export async function verifyPaypalOrderAndGrantJades({ orderID, pack }) {
  const { data } = await supabase.auth.getSession();
  const accessToken = data?.session?.access_token;
  if (!accessToken) throw new Error("NO_SESSION_TOKEN");

  const r = await fetch("/api/paypal-verify-and-grant", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ orderID, pack }),
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.ok) throw new Error(j?.error || "PAYPAL_VERIFY_AND_GRANT_FAILED");
  return j;
}

