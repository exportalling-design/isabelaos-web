export default async function handler(req, res) {
  const UID = process.env.PAGADITO_UID;
  const WSK = process.env.PAGADITO_WSK;

  const html = `
    <html>
      <body onload="document.forms[0].submit()">
        <form method="POST" action="https://sandbox.pagadito.com/">
          
          <input type="hidden" name="uid" value="${UID}" />
          <input type="hidden" name="wsk" value="${WSK}" />
          
          <input type="hidden" name="amount" value="5.00" />
          <input type="hidden" name="currency" value="USD" />
          <input type="hidden" name="description" value="Pago prueba IsabelaOS" />
          
          <input type="hidden" name="reference" value="TEST_${Date.now()}" />
          
          <input type="hidden" name="url_landing" value="https://isabelaos.com" />
          <input type="hidden" name="url_return" value="https://isabelaos.com/api/payment-return?token={value}&order_id={ern_value}" />

        </form>
      </body>
    </html>
  `;

  res.setHeader("Content-Type", "text/html");
  res.status(200).send(html);
}
