import { useEffect, useState } from "react";

export default function BillingReturn() {
  const [msg, setMsg] = useState("Procesando tu suscripción...");

  useEffect(() => {
    const url = new URL(window.location.href);
    const subscription_id = url.searchParams.get("subscription_id");
    const tier = (url.searchParams.get("tier") || "basic").toLowerCase();

    if (!subscription_id) {
      setMsg("No se encontró subscription_id. Vuelve e intenta otra vez.");
      return;
    }

    (async () => {
      try {
        const r = await fetch("/api/activate-subscription", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscription_id, tier }),
        });

        const j = await r.json().catch(() => ({}));

        if (!r.ok || !j?.ok) {
          setMsg(`No se pudo activar. Estado: ${j?.status || "desconocido"}`);
          return;
        }

        setMsg("✅ Suscripción activa. Jades acreditados. Redirigiendo...");
        setTimeout(() => {
          window.location.href = "/#";
        }, 1200);
      } catch (e) {
        setMsg("Error inesperado activando suscripción.");
      }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-neutral-950 text-white grid place-items-center">
      <div className="max-w-md w-full p-6 rounded-xl bg-white/5 border border-white/10">
        <h2 className="text-xl font-semibold mb-2">IsabelaOS Studio</h2>
        <p className="text-white/80">{msg}</p>
      </div>
    </div>
  );
}
