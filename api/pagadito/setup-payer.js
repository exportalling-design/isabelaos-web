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

    const { card } = req.body || {};

    if (
      !card?.number ||
      !card?.expirationDate ||
      !card?.cvv ||
      !card?.cardHolderName
    ) {
      return res.status(400).json({ error: "missing_card_data" });
    }

    const auth = Buffer.from(`${uid}:${wsk}`).toString("base64");

    const response = await fetch("https://sandbox-api.pagadito.com/v1/setup-payer/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        "Authorization": `Basic ${auth}`,
      },
      body: JSON.stringify({
        card: {
          number: card.number,
          expirationDate: card.expirationDate,
          cvv: card.cvv,
          cardHolderName: card.cardHolderName,
        },
      }),
    });

    const rawText = await response.text();

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = {
        error: "invalid_pagadito_response",
        raw: rawText,
      };
    }

    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({
      error: "setup_payer_failed",
      message: error.message,
    });
  }
}
