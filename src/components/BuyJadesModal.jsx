// BuyJadesModal — con soporte completo 3DS Challenge
// Flujo:
//   1. handlePay → /api/jades-setup → iframe Cardinal (fingerprint)
//   2. callJadesPay → /api/jades-pay
//      a. PG200-00 → acredita Jades, done
//      b. PG402-05 → challenge_required → muestra iframe stepUp
//   3. payment-return.js → postMessage con TransactionId
//   4. callValidate → /api/validate-process-card → acredita Jades, done

import { useEffect, useState, useRef } from "react";
import { JADE_PACKS, COSTS } from "../lib/pricing";

async function getAuthHeadersGlobal() {
  try {
    const { supabase } = await import("../lib/supabaseClient");
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  } catch { return {}; }
}

export function BuyJadesModal({ open, onClose, userId, onSuccess }) {
  const [selectedPack, setSelectedPack] = useState("popular");
  // step: "form" | "loading" | "iframe" | "challenge" | "validating" | "done" | "error"
  const [step,        setStep]        = useState("form");
  const [cardError,   setCardError]   = useState("");
  const [cardSuccess, setCardSuccess] = useState("");
  const [setupData,   setSetupData]   = useState(null);   // tokens de jades-setup
  const [challengeData, setChallengeData] = useState(null); // datos de challenge 3DS
  const [savedPack,   setSavedPack]   = useState(null);   // pack guardado para validate
  const [savedCard,   setSavedCard]   = useState(null);   // card guardada para validate

  const iframeRef    = useRef(null);  // iframe fingerprint Cardinal
  const formRef      = useRef(null);  // form POST a Cardinal
  const challengeRef = useRef(null);  // iframe del challenge StepUp

  const [card, setCard] = useState({
    cardHolderName: "",
    number:         "",
    expirationDate: "",
    cvv:            "",
    firstName:      "",
    lastName:       "",
    email:          "",
    phone:          "",
    line1:          "7a Calle Pte. Bis, 511 y 531",
  });
  const upd = (k, v) => setCard(p => ({ ...p, [k]: v }));

  // ── Escuchar mensaje de payment-return (challenge completado) ──
  useEffect(() => {
    const handler = (e) => {
      if (!e.data || e.data.source !== "isabelaos-pagadito-return") return;
      const transactionId = e.data.transactionId;
      if (transactionId) {
        callValidate(transactionId);
      } else {
        setCardError("La verificación del banco no devolvió un ID de transacción.");
        setStep("form");
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [challengeData, savedPack, savedCard]);

  // ── Auto-submit iframe fingerprint ──
  useEffect(() => {
    if (step !== "iframe" || !setupData) return;
    const t = setTimeout(() => {
      try { formRef.current?.submit(); } catch {}
      // Después de 3s continuar con el pago
      setTimeout(() => callJadesPay(), 3000);
    }, 500);
    return () => clearTimeout(t);
  }, [step, setupData]);

  if (!open) return null;
  const pack = JADE_PACKS[selectedPack];

  // ── PASO 1: setup-payer ──
  async function handlePay(e) {
    e.preventDefault();
    setCardError("");
    if (!card.number || !card.expirationDate || !card.cvv || !card.cardHolderName) {
      setCardError("Completa los datos de tarjeta."); return;
    }
    if (!card.firstName || !card.lastName || !card.email) {
      setCardError("Completa tu nombre y correo."); return;
    }
    setStep("loading");
    try {
      const auth = await getAuthHeadersGlobal();
      const r    = await fetch("/api/jades-setup", {
        method:  "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body:    JSON.stringify({ pack: selectedPack, card }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.response_message || j?.error || "Error en setup.");
      setSavedPack(selectedPack);
      setSavedCard(card);
      setSetupData(j);
      setStep("iframe");
    } catch (err) {
      setCardError(err?.message || "Error iniciando el pago.");
      setStep("form");
    }
  }

  // ── PASO 2: customer (jades-pay) ──
  async function callJadesPay() {
    try {
      const auth = await getAuthHeadersGlobal();
      const r    = await fetch("/api/jades-pay", {
        method:  "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body:    JSON.stringify({
          pack:               selectedPack,
          card,
          setupRequestId:     setupData?.request_id,
          referenceId:        setupData?.referenceId,
          deviceFingerprintID: setupData?.fingerprint || "",
        }),
      });
      const j = await r.json().catch(() => null);

      // ── Challenge 3DS requerido ──
      if (j?.challenge_required) {
        if (!j.stepUpUrl || !j.accessToken) {
          setCardError("Tu banco requiere verificación pero no se recibió la URL del challenge.");
          setStep("form");
          return;
        }
        setChallengeData(j);
        setStep("challenge");
        // Auto-submit el form del challenge en el iframe
        setTimeout(() => {
          try { document.getElementById("step_up_form")?.submit(); } catch {}
        }, 400);
        return;
      }

      if (!r.ok || !j?.ok) throw new Error(j?.response_message || j?.error || "Error en el pago.");
      setCardSuccess(`¡Listo! Se acreditaron ${j.jades_added} Jades.`);
      setStep("done");
      if (typeof onSuccess === "function") await onSuccess();
      setTimeout(() => { setCardSuccess(""); setStep("form"); onClose(); }, 2500);
    } catch (err) {
      setCardError(err?.message || "Error procesando pago.");
      setStep("form");
    }
  }

  // ── PASO 3: validate-process-card (después del challenge) ──
  async function callValidate(transactionId) {
    setStep("validating");
    try {
      const auth = await getAuthHeadersGlobal();
      const r    = await fetch("/api/validate-process-card", {
        method:  "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body:    JSON.stringify({
          pack:          savedPack || selectedPack,
          card:          savedCard || card,
          transactionId,
          id_transaction: challengeData?.id_transaction,
          setupRequestId: setupData?.request_id,
          referenceId:    setupData?.referenceId,
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.response_message || j?.error || "Error validando pago.");
      setCardSuccess(`¡Listo! Se acreditaron ${j.jades_added} Jades.`);
      setStep("done");
      if (typeof onSuccess === "function") await onSuccess();
      setTimeout(() => { setCardSuccess(""); setStep("form"); setChallengeData(null); onClose(); }, 2500);
    } catch (err) {
      setCardError(err?.message || "Error confirmando pago con el banco.");
      setStep("form");
    }
  }

  function handleClose() {
    if (step === "loading" || step === "iframe" || step === "validating") return;
    setStep("form");
    setCardError("");
    setChallengeData(null);
    setSetupData(null);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end" onClick={handleClose}>
      <div
        className="relative h-full w-full max-w-md overflow-y-auto border-l border-white/10 bg-[#06070B] p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Iframe fingerprint Cardinal (oculto) ── */}
        {step === "iframe" && setupData && (
          <div style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
            <iframe ref={iframeRef} name="collectionIframe" height="1" width="1" style={{ display: "none" }} />
            <form ref={formRef} method="POST" target="collectionIframe" action={setupData.deviceDataCollectionUrl}>
              <input type="hidden" name="JWT" value={setupData.accessToken} />
            </form>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Comprar Jades</h2>
            <p className="mt-1 text-xs text-neutral-400">1 Jade = $0.10 USD · Sin suscripción</p>
          </div>
          <button
            onClick={handleClose}
            disabled={step === "loading" || step === "iframe" || step === "validating"}
            className="rounded-xl border border-white/15 px-3 py-1.5 text-xs text-neutral-400 hover:bg-white/10 disabled:opacity-40"
          >✕</button>
        </div>

        {/* ── Estados de carga ── */}
        {(step === "loading" || step === "iframe" || step === "validating") && (
          <div className="mt-10 text-center space-y-4">
            <div className="text-4xl animate-pulse">💳</div>
            <p className="text-sm text-white font-semibold">
              {step === "loading"    ? "Iniciando pago seguro..."
               : step === "iframe"  ? "Verificando dispositivo..."
               : "Confirmando pago con el banco..."}
            </p>
            <p className="text-xs text-neutral-400">No cierres esta ventana</p>
            <div className="flex justify-center gap-1 mt-4">
              {[0,1,2,3,4].map(i => (
                <div key={i} className="h-2 w-2 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        )}

        {/* ── Challenge 3DS: iframe del banco ── */}
        {step === "challenge" && challengeData && (
          <div className="mt-6 space-y-4">
            <div className="rounded-2xl border border-yellow-400/30 bg-yellow-500/10 px-4 py-3">
              <p className="text-xs font-semibold text-yellow-300">🔐 Verificación del banco requerida</p>
              <p className="mt-1 text-xs text-neutral-400">Tu banco solicita confirmar la transacción. Completa la verificación en el formulario de abajo.</p>
            </div>

            {/* iframe StepUp del banco */}
            <iframe
              ref={challengeRef}
              name="stepUpIframe"
              id="step_up_iframe"
              height="500"
              width="100%"
              style={{ border: "none", borderRadius: "16px", background: "#fff" }}
            />
            {/* Form que se auto-submite en el iframe */}
            <form
              id="step_up_form"
              method="POST"
              target="stepUpIframe"
              action={challengeData.stepUpUrl}
              style={{ display: "none" }}
            >
              <input type="hidden" name="JWT" value={challengeData.accessToken} />
              <input type="hidden" name="MD"  value={challengeData.id_transaction || ""} />
            </form>

            <p className="text-center text-[11px] text-neutral-500">
              Ingresa el código que te envió tu banco para completar el pago
            </p>
          </div>
        )}

        {/* ── Done ── */}
        {step === "done" && cardSuccess && (
          <div className="mt-10 text-center space-y-4">
            <div className="text-5xl">✅</div>
            <p className="text-sm text-emerald-300 font-semibold">{cardSuccess}</p>
          </div>
        )}

        {/* ── Formulario ── */}
        {step === "form" && (
          <>
            {/* Selector de pack */}
            <div className="mt-5 grid grid-cols-2 gap-3">
              {Object.entries(JADE_PACKS).map(([key, p]) => (
                <button
                  key={key} type="button" onClick={() => setSelectedPack(key)}
                  className={`rounded-2xl border p-4 text-left transition ${
                    selectedPack === key
                      ? "border-cyan-400 bg-cyan-500/10"
                      : "border-white/10 bg-black/40 hover:bg-black/50"
                  }`}
                >
                  <div className="text-sm font-semibold text-white">{p.label}</div>
                  <div className="mt-1 text-xl font-bold text-cyan-300">{p.jades}J</div>
                  <div className="mt-1 text-xs text-neutral-400">${p.price_usd} USD</div>
                </button>
              ))}
            </div>

            {/* Info del pack */}
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-[11px] text-neutral-300">
              <div className="font-semibold text-white">Con {pack.jades} Jades:</div>
              <div className="mt-2 space-y-1">
                <div>· <span className="font-semibold text-white">{pack.jades}</span> imágenes sin avatar</div>
                <div>· <span className="font-semibold text-white">{Math.floor(pack.jades / 2)}</span> imágenes con avatar</div>
                <div>· <span className="font-semibold text-white">{Math.floor(pack.jades / COSTS.vid_express_8s)}</span> videos Express 8s</div>
                <div>· <span className="font-semibold text-white">{Math.floor(pack.jades / 40)}</span> videos CineAI 5s</div>
              </div>
            </div>

            {/* Formulario de tarjeta */}
            <form onSubmit={handlePay} className="mt-5 space-y-3">
              <div className="text-xs font-semibold text-white">Pagar ${pack.price_usd} USD · Pack {pack.label}</div>
              {[
                { label: "Nombre en tarjeta",    key: "cardHolderName",  ph: "JOHN DOE" },
                { label: "Número de tarjeta",    key: "number",          ph: "4000000000002701" },
                { label: "Vencimiento (MM/YYYY)",key: "expirationDate",  ph: "01/2030" },
                { label: "CVV",                  key: "cvv",             ph: "123" },
                { label: "Nombre",               key: "firstName",       ph: "John" },
                { label: "Apellido",             key: "lastName",        ph: "Doe" },
                { label: "Correo",               key: "email",           ph: "tu@email.com" },
                { label: "Teléfono",             key: "phone",           ph: "2264-7032" },
                { label: "Dirección",            key: "line1",           ph: "7a Calle Pte. Bis, 511 y 531" },
              ].map(({ label, key, ph }) => (
                <div key={key}>
                  <label className="text-[11px] text-neutral-400">{label}</label>
                  <input
                    type={key === "email" ? "email" : "text"}
                    value={card[key]}
                    onChange={e => upd(key, e.target.value)}
                    placeholder={ph}
                    className="mt-1 w-full rounded-xl bg-black/60 px-3 py-2 text-xs text-white outline-none ring-1 ring-white/10 focus:ring-cyan-400"
                  />
                </div>
              ))}

              {cardError && (
                <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {cardError}
                </div>
              )}

              <button
                type="submit"
                className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white hover:opacity-90 transition-all"
              >
                Pagar ${pack.price_usd} · {pack.jades} Jades
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
