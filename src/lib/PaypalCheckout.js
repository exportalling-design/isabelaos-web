// src/lib/PaypalCheckout.js
import { supabase } from "./supabaseClient"; // ajusta si tu ruta es distinta

async function getAccessTokenOrThrow() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const accessToken = data?.session?.access_token;
  if (!accessToken) throw new Error("NO_SESSION_TOKEN");
  return accessToken;
}

// Suscripciones (redirect)
export async function startPaypalSubscription(tier) {
  const accessToken = await getAccessTokenOrThrow();

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

  // Redirect normal (móvil friendly)
  window.location.href = j.approve_url;
}

// Alias por compatibilidad (por si en tu app.jsx llamas el nombre viejo)
export async function startPayPalSubscriptionRedirect(tier) {
  return startPaypalSubscription(tier);
}

// Packs (ordenes one-time)
export async function verifyPaypalOrderAndGrantJades({ orderID, pack }) {
  const accessToken = await getAccessTokenOrThrow();

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