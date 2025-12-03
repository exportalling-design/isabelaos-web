// api/create-checkout.js
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Endpoint que redirige directo a Stripe Checkout
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).send("Method Not Allowed");
  }

  const priceId = process.env.STRIPE_PRICE_BASIC;
  const siteUrl = process.env.SITE_URL || "https://isabelaos.com";

  if (!process.env.STRIPE_SECRET_KEY || !priceId) {
    console.error("Faltan variables STRIPE_SECRET_KEY o STRIPE_PRICE_BASIC");
    return res
      .status(500)
      .send("Stripe no está configurado correctamente en el servidor.");
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${siteUrl}/?checkout=success`,
      cancel_url: `${siteUrl}/?checkout=cancel`,
    });

    // Redirigir al checkout de Stripe
    res.writeHead(303, { Location: session.url });
    res.end();
  } catch (err) {
    console.error("Error Stripe:", err);
    res
      .status(500)
      .send("Error al crear la sesión de pago: " + err.message);
  }
}
