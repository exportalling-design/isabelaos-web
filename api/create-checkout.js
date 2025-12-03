// api/create-checkout.js
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Vercel Serverless Function estilo Node.js (req, res)
 */
export default async function handler(req, res) {
  // CORS básico
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    // Preflight
    return res.status(200).end();
  }

  if (req.method === "GET") {
    // Para probar rápido en el navegador
    return res.status(200).json({
      ok: true,
      message:
        "Endpoint de Stripe activo. Usa POST desde el frontend para crear el checkout.",
    });
  }

  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const priceId = process.env.STRIPE_PRICE_BASIC;
    const siteUrl = process.env.SITE_URL || "https://isabelaos.com";

    if (!process.env.STRIPE_SECRET_KEY || !priceId) {
      console.error("Faltan variables de Stripe en Vercel");
      return res.status(500).json({
        error:
          "Configuración de Stripe incompleta en el servidor.",
      });
    }

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

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err);
    return res.status(500).json({
      error: "Stripe error",
      details: err.message,
    });
  }
}
