// src/components/BuyJadesModal.jsx
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

const COUNTRIES = [
  { id: "320", name: "Guatemala" },
  { id: "222", name: "El Salvador" },
  { id: "340", name: "Honduras" },
  { id: "558", name: "Nicaragua" },
  { id: "188", name: "Costa Rica" },
  { id: "591", name: "Panamá" },
  { id: "484", name: "México" },
  { id: "170", name: "Colombia" },
  { id: "604", name: "Perú" },
  { id: "152", name: "Chile" },
  { id: "032", name: "Argentina" },
  { id: "076", name: "Brasil" },
  { id: "840", name: "Estados Unidos" },
  { id: "724", name: "España" },
];

export function BuyJadesModal({ open, onClose, userId, onSuccess }) {
  const [selectedPack, setSelectedPack] = useState("popular");
  const [step,          setStep]          = useState("form");
  const [cardError,     setCardError]     = useState("");
  const [cardSuccess,   setCardSuccess]   = useState("");
  const [setupData,     setSetupData]     = useState(null);
  const [challengeData, setChallengeData] = useState(null);
  const [savedPack,     setSavedPack]     = useState(null);
  const [savedCard,     setSavedCard]     = useState(null);

  const iframeRef = useRef(null);
  const formRef   = useRef(null);

  const [card, setCard] = useState({
    cardHolderName: "",
    number:         "",
    expirationDate: "",
    cvv:            "",
    firstName:      "",
    lastName:       "",
    email:          "",
    phone:          "",
    city:           "",
    countryId:      "320",
    line1:          "",
  });
  const upd = (k, v) => setCard(p => ({ ...p, [k]: v }));

  useEffect(() => {
    const handler = (e) => {
      if (!e.data || e.data.source !== "isabelaos-pagadito-return") return;
      const transactionId = e.data.transactionId;
      if (transactionId) callValidate(transactionId);
      else { setCardError("La verificación del banco no devolvió un ID."); setStep("form"); }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [challengeData, savedPack, savedCard]);

  useEffect(() => {
    if (step !== "iframe" || !setupData) return;
    const t = setTimeout(() => {
      try { formRef.current?.submit(); } catch {}
      setTimeout(() => callJadesPay(), 3000);
    }, 500);
    return () => clearTimeout(t);
  }, [step, setupData]);

  if (!open) return null;
  const pack = JADE_PACKS[selectedPack];

  async function handlePay(e) {
    e.preventDefault();
    setCardError("");
    if (!card.number || !card.expirationDate || !card.cvv || !card.cardHolderName) { setCardError("Completa los datos de tarjeta."); return; }
    if (!card.firstName || !card.lastName || !card.email) { setCardError("Completa tu nombre y correo."); return; }
    if (!card.city) { setCardError("Ingresa tu ciudad."); return; }
    setStep("loading");
    try {
      const auth = await getAuthHeadersGlobal();
      const r    = await fetch("/api/jades-setup", { method: "POST", headers: { "Content-Type": "application/json", ...auth }, body: JSON.stringify({ pack: selectedPack, card }) });
      const j    = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.response_message || j?.error || "Error en setup.");
      setSavedPack(selectedPack); setSavedCard(card); setSetupData(j); setStep("iframe");
    } catch (err) { setCardError(err?.message || "Error iniciando el pago."); setStep("form"); }
  }

  async function callJadesPay() {
    try {
      const auth = await getAuthHeadersGlobal();
      const r    = await fetch("/api/jades-pay", { method: "POST", headers: { "Content-Type": "application/json", ...auth }, body: JSON.stringify({ pack: selectedPack, card, setupRequestId: setupData?.request_id, referenceId: setupData?.referenceId, deviceFingerprintID: setupData?.fingerprint || "" }) });
      const j    = await r.json().catch(() => null);
      if (j?.challenge_required) {
        if (!j.stepUpUrl || !j.accessToken) { setCardError("Tu banco requiere verificación pero no se recibió la URL."); setStep("form"); return; }
        setChallengeData(j); setStep("challenge");
        setTimeout(() => { try { document.getElementById("step_up_form")?.submit(); } catch {} }, 400);
        return;
      }
      if (!r.ok || !j?.ok) throw new Error(j?.response_message || j?.error || "Error en el pago.");
      setCardSuccess(`¡Listo! Se acreditaron ${j.jades_added} Jades.`); setStep("done");
      if (typeof onSuccess === "function") await onSuccess();
      setTimeout(() => { setCardSuccess(""); setStep("form"); onClose(); }, 2500);
    } catch (err) { setCardError(err?.message || "Error procesando pago."); setStep("form"); }
  }

  async function callValidate(transactionId) {
    setStep("validating");
    try {
      const auth = await getAuthHeadersGlobal();
      const r    = await fetch("/api/validate-process-card", { method: "POST", headers: { "Content-Type": "application/json", ...auth }, body: JSON.stringify({ pack: savedPack || selectedPack, card: savedCard || card, transactionId, id_transaction: challengeData?.id_transaction, setupRequestId: setupData?.request_id, referenceId: setupData?.referenceId }) });
      const j    = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.response_message || j?.error || "Error validando pago.");
      setCardSuccess(`¡Listo! Se acreditaron ${j.jades_added} Jades.`); setStep("done");
      if (typeof onSuccess === "function") await onSuccess();
      setTimeout(() => { setCardSuccess(""); setStep("form"); setChallengeData(null); onClose(); }, 2500);
    } catch (err) { setCardError(err?.message || "Error confirmando pago con el banco."); setStep("form"); }
  }

  function handleClose() {
    if (step === "loading" || step === "iframe" || step === "validating") return;
    setStep("form"); setCardError(""); setChallengeData(null); setSetupData(null); onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end" onClick={handleClose}>
      <div className="relative h-full w-full max-w-md overflow-y-auto border-l border-white/10 bg-[#06070B] p-6 shadow-2xl" onClick={e => e.stopPropagation()}>

        {step === "iframe" && setupData && (
          <div style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
            <iframe ref={iframeRef} name="collectionIframe" height="1" width="1" style={{ display: "none" }} />
            <form ref={formRef} method="POST" target="collectionIframe" action={setupData.deviceDataCollectionUrl}>
              <input type="hidden" name="JWT" value={setupData.accessToken} />
            </form>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Comprar Jades</h2>
            <p className="mt-1 text-xs text-neutral-400">1 Jade = $0.10 USD · Sin suscripción</p>
          </div>
          <button onClick={handleClose} disabled={step === "loading" || step === "iframe" || step === "validating"} className="rounded-xl border border-white/15 px-3 py-1.5 text-xs text-neutral-400 hover:bg-white/10 disabled:opacity-40">✕</button>
        </div>

        {(step === "loading" || step === "iframe" || step === "validating") && (
          <div className="mt-10 text-center space-y-4">
            <div className="text-4xl animate-pulse">💳</div>
            <p className="text-sm text-white font-semibold">
              {step === "loading" ? "Iniciando pago seguro..." : step === "iframe" ? "Verificando dispositivo..." : "Confirmando pago con el banco..."}
            </p>
            <p className="text-xs text-neutral-400">No cierres esta ventana</p>
            <div className="flex justify-center gap-1 mt-4">
              {[0,1,2,3,4].map(i => (<div key={i} className="h-2 w-2 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />))}
            </div>
          </div>
        )}

        {step === "challenge" && challengeData && (
          <div className="mt-6 space-y-4">
            <div className="rounded-2xl border border-yellow-400/30 bg-yellow-500/10 px-4 py-3">
              <p className="text-xs font-semibold text-yellow-300">🔐 Verificación del banco requerida</p>
              <p className="mt-1 text-xs text-neutral-400">Tu banco solicita confirmar la transacción. Completa la verificación en el formulario de abajo.</p>
            </div>
            <iframe name="stepUpIframe" id="step_up_iframe" height="500" width="100%" style={{ border: "none", borderRadius: "16px", background: "#fff" }} />
            <form id="step_up_form" method="POST" target="stepUpIframe" action={challengeData.stepUpUrl} style={{ display: "none" }}>
              <input type="hidden" name="JWT" value={challengeData.accessToken} />
              <input type="hidden" name="MD"  value={challengeData.id_transaction || ""} />
            </form>
            <p className="text-center text-[11px] text-neutral-500">Ingresa el código que te envió tu banco para completar el pago</p>
          </div>
        )}

        {step === "done" && cardSuccess && (
          <div className="mt-10 text-center space-y-4">
            <div className="text-5xl">✅</div>
            <p className="text-sm text-emerald-300 font-semibold">{cardSuccess}</p>
          </div>
        )}

        {step === "form" && (
          <>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {Object.entries(JADE_PACKS).map(([key, p]) => (
                <button key={key} type="button" onClick={() => setSelectedPack(key)}
                  className={`rounded-2xl border p-4 text-left transition ${selectedPack === key ? "border-cyan-400 bg-cyan-500/10" : "border-white/10 bg-black/40 hover:bg-black/50"}`}>
                  <div className="text-sm font-semibold text-white">{p.label}</div>
                  <div className="mt-1 text-xl font-bold text-cyan-300">{p.jades}J</div>
                  <div className="mt-1 text-xs text-neutral-400">${p.price_usd} USD</div>
                </button>
              ))}
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-[11px] text-neutral-300">
              <div className="font-semibold text-white">Con {pack.jades} Jades:</div>
              <div className="mt-2 space-y-1">
                <div>· <span className="font-semibold text-white">{pack.jades}</span> imágenes sin avatar</div>
                <div>· <span className="font-semibold text-white">{Math.floor(pack.jades / 2)}</span> imágenes con avatar</div>
                <div>· <span className="font-semibold text-white">{Math.floor(pack.jades / COSTS.vid_express_8s)}</span> videos Express 8s</div>
                <div>· <span className="font-semibold text-white">{Math.floor(pack.jades / 40)}</span> videos CineAI 5s</div>
              </div>
            </div>

            <form onSubmit={handlePay} className="mt-5 space-y-3">
              <div className="text-xs font-semibold text-white">Pagar ${pack.price_usd} USD · Pack {pack.label}</div>

              {[
                { label: "Nombre en tarjeta",     key: "cardHolderName",  ph: "Como aparece en la tarjeta" },
                { label: "Número de tarjeta",     key: "number",          ph: "1234 5678 9012 3456" },
                { label: "Vencimiento (MM/YYYY)", key: "expirationDate",  ph: "01/2030" },
                { label: "CVV",                   key: "cvv",             ph: "123" },
              ].map(({ label, key, ph }) => (
                <div key={key}>
                  <label className="text-[11px] text-neutral-400">{label}</label>
                  <input type="text" value={card[key]} onChange={e => upd(key, e.target.value)} placeholder={ph}
                    className="mt-1 w-full rounded-xl bg-black/60 px-3 py-2 text-xs text-white outline-none ring-1 ring-white/10 focus:ring-cyan-400" />
                </div>
              ))}

              <div className="border-t border-white/10 pt-3 text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">Datos del titular</div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-neutral-400">Nombre</label>
                  <input type="text" value={card.firstName} onChange={e => upd("firstName", e.target.value)} placeholder="John"
                    className="mt-1 w-full rounded-xl bg-black/60 px-3 py-2 text-xs text-white outline-none ring-1 ring-white/10 focus:ring-cyan-400" />
                </div>
                <div>
                  <label className="text-[11px] text-neutral-400">Apellido</label>
                  <input type="text" value={card.lastName} onChange={e => upd("lastName", e.target.value)} placeholder="Doe"
                    className="mt-1 w-full rounded-xl bg-black/60 px-3 py-2 text-xs text-white outline-none ring-1 ring-white/10 focus:ring-cyan-400" />
                </div>
              </div>

              {[
                { label: "Correo",     key: "email",  ph: "tu@email.com",             type: "email" },
                { label: "Teléfono",  key: "phone",  ph: "+502 1234-5678" },
                { label: "Ciudad",    key: "city",   ph: "Ciudad de Guatemala" },
                { label: "Dirección", key: "line1",  ph: "Zona 10, Calle Principal" },
              ].map(({ label, key, ph, type }) => (
                <div key={key}>
                  <label className="text-[11px] text-neutral-400">{label}</label>
                  <input type={type || "text"} value={card[key]} onChange={e => upd(key, e.target.value)} placeholder={ph}
                    className="mt-1 w-full rounded-xl bg-black/60 px-3 py-2 text-xs text-white outline-none ring-1 ring-white/10 focus:ring-cyan-400" />
                </div>
              ))}

              <div>
                <label className="text-[11px] text-neutral-400">País</label>
                <select value={card.countryId} onChange={e => upd("countryId", e.target.value)}
                  className="mt-1 w-full rounded-xl bg-black/60 px-3 py-2 text-xs text-white outline-none ring-1 ring-white/10 focus:ring-cyan-400">
                  {COUNTRIES.map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
                </select>
              </div>

              {cardError && (
                <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{cardError}</div>
              )}

              <button type="submit" className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white hover:opacity-90 transition-all">
                Pagar ${pack.price_usd} · {pack.jades} Jades
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
