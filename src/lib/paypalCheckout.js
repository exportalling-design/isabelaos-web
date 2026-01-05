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