export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const uid = process.env.PAGADITO_UID;
    const wsk = process.env.PAGADITO_WSK;

    if (!uid || !wsk) {
      return res.status(500).json({ error: "missing_pagadito_env" });
    }

    const {
      card,
      transaction,
      browserInfo,
      consumerAuthenticationInformation,
    } = req.body || {};

    if (!card || !transaction || !browserInfo || !consumerAuthenticationInformation) {
      return res.status(400).json({ error: "missing_required_fields" });
    }

    const auth = Buffer.from(`${uid}:${wsk}`).toString("base64");

    const response = await fetch("https://sandbox-api.pagadito.com/v1/customer/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        card,
        transaction,
        browserInfo,
        consumerAuthenticationInformation,
      }),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({
      error: "customer_payment_failed",
      message: error.message,
    });
  }
}
