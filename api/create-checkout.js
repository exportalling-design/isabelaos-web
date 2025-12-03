// api/create-checkout.js
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req) {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS, GET",
    "access-control-allow-headers": "content-type",
  };

  // Preflight CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  // Si entras desde el navegador (GET), solo mostramos un mensaje simple
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({
        ok: true,
        message: "Endpoint de Stripe activo. Usa POST desde el frontend.",
      }),
      {
        status: 200,
        headers: {
          ...cors,
          "content-type": "application/json",
        },
      }
    );
  }

  // Solo aceptamos POST para crear el checkout
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: cors,
    });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price: process.env.STRIPE_PRICE_BASIC, // price_1SaNGd4xP9m1XMxvtFwXztG8
          quantity: 1,
        },
      ],
      success_url: `${process.env.SITE_URL}/?checkout=success`,
      cancel_url: `${process.env.SITE_URL}/?checkout=cancel`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: {
        ...cors,
        "content-type": "application/json",
      },
    });
  } catch (err) {
    console.error("Stripe error:", err);
    return new Response(
      JSON.stringify({ error: "Stripe error", details: err.message }),
      {
        status: 500,
        headers: {
          ...cors,
          "content-type": "application/json",
        },
      }
    );
  }
}
