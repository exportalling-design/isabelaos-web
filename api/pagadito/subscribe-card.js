import { requireUser } from "../_auth.js";
import { PLANS } from "../../src/lib/pricing.js";

function getClientIp(req) {
  const xfwd = req.headers["x-forwarded-for"];
  if (xfwd) return String(xfwd).split(",")[0].trim();
  return req.socket?.remoteAddress || "127.0.0.1";
}

function basicAuth(uid, wsk) {
  return "Basic " + Buffer.from(`${uid}:${wsk}`).toString("base64");
}

async function pagaditoPost(path, body) {
  const uid = process.env.PAGADITO_UID;
  const wsk = process.env.PAGADITO_WSK;

  if (!uid || !wsk) {
    throw new Error("Missing PAGADITO_UID / PAGADITO_WSK");
  }

  const r = await fetch(`https://sandbox-api.pagadito.com/v1/${path}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      Authorization: basicAuth(uid, wsk),
    },
    body: JSON.stringify(body),
  });

  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  return { ok: r.ok, status: r.status, data: json };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const auth = await requireUser(req);
    if (!auth.ok) {
      return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    }

    const user = auth.user;
    const { plan, card } = req.body || {};

    if (!user?.id) {
      return res.status(401).json({ ok: false, error: "NO_USER" });
    }

    if (!plan || !PLANS[plan]) {
      return res.status(400).json({ ok: false, error: "INVALID_PLAN" });
    }

    if (!card?.number || !card?.expirationDate || !card?.cvv || !card?.cardHolderName) {
      return res.status(400).json({ ok: false, error: "MISSING_CARD_FIELDS" });
    }

    const setup = await pagaditoPost("setup-payer", {
      card: {
        number: card.number,
        expirationDate: card.expirationDate,
        cvv: card.cvv,
        cardHolderName: card.cardHolderName,
      },
    });

    if (!setup.ok || setup?.data?.response_code !== "PG200-00") {
      return res.status(setup.status || 400).json({
        ok: false,
        stage: "setup-payer",
        ...setup.data,
      });
    }

    const merchantTransactionId = `ISO-${plan}-${user.id}-${Date.now()}`;

    const customer = await pagaditoPost("customer", {
      card: {
        number: card.number,
        expirationDate: card.expirationDate,
        cvv: card.cvv,
        cardHolderName: card.cardHolderName,
        firstName: card.firstName,
        lastName: card.lastName,
        billingAddress: {
          city: card.billingAddress?.city || "",
          state: card.billingAddress?.state || "",
          zip: card.billingAddress?.zip || "",
          countryId: card.billingAddress?.countryId || "320",
          line1: card.billingAddress?.line1 || "",
          phone: card.billingAddress?.phone || "",
        },
        email: card.email,
      },
      transaction: {
        merchantTransactionId,
        currencyId: "USD",
        transactionDetails: [
          {
            quantity: "1",
            description: `Subscription ${plan}`,
            amount: String(PLANS[plan].price_usd.toFixed(2)),
          },
        ],
      },
      browserInfo: {
        deviceFingerprintID: "1234567890123456",
        customerIp: getClientIp(req),
      },
      consumerAuthenticationInformation: {
        setup_request_id: setup.data.request_id,
        referenceId: setup.data.referenceId,
        returnUrl: `${process.env.SITE_URL || "https://www.isabelaos.com"}/api/payment-return`,
      },
    });

    if (customer?.data?.response_code === "PG402-05") {
      return res.status(200).json({
        ok: false,
        challenge_required: true,
        stage: "customer",
        response_code: customer.data.response_code,
        response_message: customer.data.response_message,
        challenge: customer.data.customer_reply || null,
        setup: {
          request_id: setup.data.request_id,
          referenceId: setup.data.referenceId,
          accessToken: setup.data.accessToken || null,
          deviceDataCollectionUrl: setup.data.deviceDataCollectionUrl || null,
        },
      });
    }

    if (!customer.ok || customer?.data?.response_code !== "PG200-00") {
      return res.status(customer.status || 402).json({
        ok: false,
        stage: "customer",
        ...customer.data,
      });
    }

    const activateResp = await fetch(
      `${process.env.SITE_URL || "https://www.isabelaos.com"}/api/activate-plan`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: user.id,
          plan,
          ref:
            customer?.data?.customer_reply?.payment_token ||
            customer?.data?.request_id ||
            merchantTransactionId,
        }),
      }
    );

    const activateJson = await activateResp.json().catch(() => null);

    if (!activateResp.ok || !activateJson?.ok) {
      return res.status(500).json({
        ok: false,
        error: "ACTIVATE_PLAN_FAILED",
        detail: activateJson || null,
        payment: customer.data,
      });
    }

    return res.status(200).json({
      ok: true,
      plan,
      payment: customer.data,
      activation: activateJson,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      detail: String(e?.message || e),
    });
  }
}
