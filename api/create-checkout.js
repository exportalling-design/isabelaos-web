// pages/api/create-checkout.js
import Stripe from "stripe";
import { requireUser } from "../../lib/apiAuth";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const { user } = await requireUser(req);

    const { plan } = req.body || {};
    if (!plan || !["basic", "pro"].includes(plan)) {
      return res.status(400).json({ ok: false, error: "INVALID_PLAN" });
    }

    const siteUrl = process.env.SITE_URL || "https://isabelaos.com";
    const priceId =
      plan === "basic"
        ? process.env.STRIPE_PRICE_ID_BASIC
        : process.env.STRIPE_PRICE_ID_PRO;

    if (!process.env.STRIPE_SECRET_KEY || !priceId) {
      return res.status(500).json({ ok: false, error: "STRIPE_NOT_CONFIGURED" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${siteUrl}/?checkout=success`,
      cancel_url: `${siteUrl}/?checkout=cancel`,
      client_reference_id: user.id,
      metadata: {
        user_id: user.id,
        plan,
      },
    });

    return res.status(200).json({ ok: true, url: session.url });
  } catch (e) {
    const code = e.statusCode || 500;
    return res.status(code).json({ ok: false, error: String(e.message || e) });
  }
}
