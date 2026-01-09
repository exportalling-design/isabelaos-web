// src/lib/PaypalCheckout.js
import { supabase } from "./supabaseClient";

async function getAccessTokenOrThrow() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const accessToken = data?.session?.access_token;
  if (!accessToken) throw new Error("NO_SESSION_TOKEN");
  return accessToken;
}

// ✅ Nuevo helper: sacar user_id del session
async function getUserIdOrThrow() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const userId = data?.session?.user?.id;
  if (!userId) throw new Error("NO_SESSION_USER");
  return userId;
}

// Suscripciones (redirect)
export async function startPaypalSubscription(tier) {
  const accessToken = await getAccessTokenOrThrow();
  const user_id = await getUserIdOrThrow(); // ✅

  const r = await fetch("/api/create-subscription", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    // ✅ AQUÍ está el cambio importante
    body: JSON.stringify({ tier, user_id }),
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.ok) throw new Error(j?.error || "PAYPAL_CREATE_SUB_FAILED");
  if (!j?.approve_url) throw new Error("NO_APPROVE_URL_FROM_PAYPAL");

  window.location.href = j.approve_url;
}

export async function startPayPalSubscriptionRedirect(tier) {
  return startPaypalSubscription(tier);
}