// api/payment-return.js
// ─────────────────────────────────────────────────────────────
// returnUrl del challenge 3DS de Pagadito.
// El banco redirige aquí dentro del iframe con ?TransactionId=xxx
// Esta página lo reenvía al padre (BuyJadesModal) via postMessage
// para que llame a /api/validate-process-card
// ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Pagadito puede enviar TransactionId por GET o POST
  const transactionId =
    req.query?.TransactionId ||
    req.query?.transactionId ||
    req.body?.TransactionId  ||
    req.body?.transactionId  ||
    "";

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>IsabelaOS · Verificando pago...</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: Arial, sans-serif;
        background: #06070B;
        color: white;
        display: grid;
        place-items: center;
        min-height: 100vh;
        padding: 20px;
      }
      .box {
        width: min(92vw, 480px);
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(0,0,0,0.55);
        border-radius: 24px;
        padding: 28px 24px;
        text-align: center;
      }
      h2 { font-size: 18px; margin-bottom: 10px; }
      .muted { color: #a3a3a3; font-size: 13px; line-height: 1.5; }
      .spinner {
        width: 36px; height: 36px;
        border: 3px solid rgba(34,211,238,0.2);
        border-top-color: #22d3ee;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        margin: 0 auto 16px;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>
  </head>
  <body>
    <div class="box">
      <div class="spinner"></div>
      <h2>Verificando pago...</h2>
      <p class="muted">Confirmando con IsabelaOS Studio. No cierres esta ventana.</p>
    </div>
    <script>
      (function() {
        var txId = ${JSON.stringify(transactionId)};
        var payload = {
          source: "isabelaos-pagadito-return",
          transactionId: txId
        };
        // Enviar al padre (iframe dentro de BuyJadesModal)
        try {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage(payload, "*");
          }
        } catch(e) {}
        // También al opener por si se abrió en ventana nueva
        try {
          if (window.opener) {
            window.opener.postMessage(payload, "*");
          }
        } catch(e) {}
      })();
    </script>
  </body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(html);
}
