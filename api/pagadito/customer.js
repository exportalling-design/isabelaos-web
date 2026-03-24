export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const body = req.body;

    const UID = process.env.PAGADITO_UID;
    const WSK = process.env.PAGADITO_WSK;

    const auth = Buffer.from(`${UID}:${WSK}`).toString("base64");

    const response = await fetch(
      "https://sandbox-api.pagadito.com/v1/customer/",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify(body),
      }
    );

    const text = await response.text();

    try {
      const json = JSON.parse(text);
      return res.status(response.status).json(json);
    } catch (e) {
      return res.status(500).json({
        error: "invalid_pagadito_response",
        raw: text,
      });
    }
  } catch (err) {
    return res.status(500).json({
      error: "customer_failed",
      message: err.message,
    });
  }
}
