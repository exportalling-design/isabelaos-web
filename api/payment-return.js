export default async function handler(req, res) {
  const transactionId = req.query?.TransactionId || req.query?.transactionId || "";

  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>IsabelaOS · Verificación 3D Secure</title>
        <style>
          body {
            margin: 0;
            font-family: Arial, sans-serif;
            background: #06070B;
            color: white;
            display: grid;
            place-items: center;
            min-height: 100vh;
          }
          .box {
            width: min(92vw, 520px);
            border: 1px solid rgba(255,255,255,0.12);
            background: rgba(0,0,0,0.55);
            border-radius: 24px;
            padding: 24px;
          }
          .muted { color: #a3a3a3; font-size: 12px; }
          .id { margin-top: 10px; word-break: break-all; font-size: 12px; color: #67e8f9; }
        </style>
      </head>
      <body>
        <div class="box">
          <h2>Verificación 3D Secure completada</h2>
          <p class="muted">
            Ya puedes cerrar esta ventana o volver al panel de IsabelaOS Studio.
          </p>
          <div class="id">TransactionId: ${transactionId || "(vacío)"}</div>
        </div>

        <script>
          try {
            if (window.parent && window.parent !== window) {
              window.parent.postMessage(
                {
                  source: "isabelaos-pagadito-return",
                  transactionId: "${transactionId || ""}"
                },
                "*"
              );
            }

            if (window.opener) {
              window.opener.postMessage(
                {
                  source: "isabelaos-pagadito-return",
                  transactionId: "${transactionId || ""}"
                },
                "*"
              );
            }
          } catch (e) {}
        </script>
      </body>
    </html>
  `;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(html);
}
