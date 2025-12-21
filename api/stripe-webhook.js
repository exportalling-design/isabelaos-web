// pages/api/stripe-webhook.js
import Stripe from "stripe";
import { sbAdmin } from "../../lib/apiAuth";

export const config = {
  api: { bodyParser: false },
};

function buffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    readable.on("end", () => resolve(Buffer.concat(chunks)));
    readable.on("error", reject);
  });
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PLAN_JADES = { basic: 100, pro: 300 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const sig = req.headers["stripe-signature"];
    const rawBody = await buffer(req);

    const event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    // Solo nos importa cuando Stripe confirma pago/subscription
    if (
      event.type !== "checkout.session.completed" &&
      event.type !== "invoice.paid"
    ) {
      return res.status(200).json({ ok: true, ignored: event.type });
    }

    const sb = sbAdmin();

    // checkout.session.completed tiene metadata
    // invoice.paid a veces no trae metadata; pero trae customer/subscription
    let user_id = null;
    let plan = null;
    let ref = `stripe:${event.id}`;

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      user_id = session?.metadata?.user_id || session?.client_reference_id || null;
      plan = session?.metadata?.plan || null;
    } else if (event.type === "invoice.paid") {
      const invoice = event.data.object;
      user_id = invoice?.subscription_details?.metadata?.user_id || invoice?.metadata?.user_id || null;
      plan = invoice?.subscription_details?.metadata?.plan || invoice?.metadata?.plan || null;
    }

    if (!user_id || !plan || !PLAN_JADES[plan]) {
      // Si no viene info, no activamos (evita errores)
      return res.status(200).json({ ok: true, warning: "missing user_id/plan in metadata" });
    }

    // 1) upsert subscription active
    const { error: subErr } = await sb
      .from("user_subscription")
      .upsert({
        user_id,
        plan,
        status: "active",
        updated_at: new Date().toISOString(),
      });

    if (subErr) throw subErr;

    // 2) credit included jades (idempotencia recomendada por ref=event.id)
    const { error: creditErr } = await sb.rpc("add_jades", {
      p_user_id: user_id,
      p_amount: PLAN_JADES[plan],
      p_reason: `subscription:${plan}`,
      p_ref: ref,
    });

    if (creditErr) throw creditErr;

    return res.status(200).json({ ok: true, activated: { user_id, plan } });
  } catch (e) {
    console.error("Stripe webhook error:", e);
    return res.status(400).send(`Webhook Error: ${e.message || String(e)}`);
  }
}
