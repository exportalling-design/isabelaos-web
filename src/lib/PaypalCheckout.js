// src/lib/PaypalCheckout.js
import { supabase } from "./supabaseClient"; // asegúrate que esta ruta es correcta

async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message || "SUPABASE_SESSION_ERROR");
  const token = data?.session?.access_token;
  if (!token) throw new Error("NO_SESSION_TOKEN");
  return token;
}

export async function startPaypalSubscription(tier) {
  const accessToken = await getAccessToken();

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

// Aliases (por compatibilidad)
export const startPayPalSubscription = startPaypalSubscription;
export const startPayPalSubscriptionRedirect = startPaypalSubscription;

// Packs
export async function verifyPaypalOrderAndGrantJades({ orderID, pack }) {
  const accessToken = await getAccessToken();

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