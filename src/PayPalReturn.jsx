import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";

export default function PayPalReturn() {
  const [status, setStatus] = useState("Procesando retorno de PayPal...");

  useEffect(() => {
    (async () => {
      try {
        // PayPal a veces regresa con subscription_id o con token
        const url = new URL(window.location.href);
        const subscription_id =
          url.searchParams.get("subscription_id") ||
          url.searchParams.get("subscriptionId") ||
          url.searchParams.get("ba_token") ||
          url.searchParams.get("token");

        if (!subscription_id) {
          setStatus("No vino subscription_id/token en el retorno.");
          return;
        }

        // guardamos temporalmente para debugging (opcional)
        localStorage.setItem("paypal_last_subscription", subscription_id);

        setStatus("Listo. PayPal aprobó. Esperando confirmación por webhook para acreditar jades…");
      } catch (e) {
        setStatus("Error en retorno: " + (e?.message || String(e)));
      }
    })();
  }, []);

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#05060A", color: "white" }}>
      <div style={{ maxWidth: 520, padding: 20, border: "1px solid rgba(255,255,255,.12)", borderRadius: 18 }}>
        <h2>PayPal Return</h2>
        <p style={{ opacity: 0.8 }}>{status}</p>
        <button
          onClick={() => (window.location.href = "/")}
          style={{ marginTop: 14, padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,.2)", background: "transparent", color: "white" }}
        >
          Volver al inicio
        </button>
      </div>
    </div>
  );
}