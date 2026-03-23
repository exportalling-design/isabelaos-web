export default async function handler(req, res) {
  try {
    const UID = process.env.PAGADITO_UID;
    const WSK = process.env.PAGADITO_WSK;

    const response = await fetch("https://sandbox.pagadito.com/api/REST", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        operation: "initiate",
        uid: UID,
        wsk: WSK,

        amount: "5.00",
        currency: "USD",
        description: "Pago prueba IsabelaOS",

        reference: "TEST_" + Date.now(),

        url_landing: "https://isabelaos.com",
        url_return:
          "https://isabelaos.com/api/payment-return?token={value}&order_id={ern_value}",
      }),
    });

    const data = await response.json();

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({
      error: "pagadito_error",
      message: error.message,
    });
  }
}
