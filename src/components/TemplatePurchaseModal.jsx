// src/components/TemplatePurchaseModal.jsx
// Modal de compra directo para plantillas épicas
// Opción 1: $5 USD = 30 Jades (exacto para 1 video)
// Opción 2: $13 USD = 150 Jades (suscripción/pack popular)
// Opción 3: $28 USD = 350 Jades (pro)
// Usa PayPal y Pagadito igual que BuyJadesModal

import { useEffect, useState, useRef } from "react";

async function getAuthHeadersGlobal() {
  try {
    const { supabase } = await import("../lib/supabaseClient");
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch { return {}; }
}

const PAYPAL_CLIENT_ID = import.meta.env.VITE_PAYPAL_CLIENT_ID;

const PLANS = [
  {
    id:       "single",
    price:    5,
    jades:    30,
    label:    { es: "Este video",        en: "This video" },
    sub:      { es: "Exacto para 1 plantilla épica", en: "Exact for 1 epic template" },
    badge:    null,
    hot:      false,
  },
  {
    id:       "popular",
    price:    13,
    jades:    150,
    label:    { es: "Pack Popular",      en: "Popular Pack" },
    sub:      { es: "5 plantillas épicas + imágenes", en: "5 epic templates + images" },
    badge:    { es: "RECOMENDADO",       en: "RECOMMENDED" },
    hot:      true,
  },
  {
    id:       "pro",
    price:    28,
    jades:    350,
    label:    { es: "Pack Pro",          en: "Pro Pack" },
    sub:      { es: "11 plantillas + imágenes + avatares", en: "11 templates + images + avatars" },
    badge:    null,
    hot:      false,
  },
];

const COUNTRIES = [
  { id: "320", name: "Guatemala" }, { id: "222", name: "El Salvador" },
  { id: "340", name: "Honduras" },  { id: "558", name: "Nicaragua" },
  { id: "188", name: "Costa Rica" },{ id: "591", name: "Panamá" },
  { id: "484", name: "México" },    { id: "170", name: "Colombia" },
  { id: "604", name: "Perú" },      { id: "152", name: "Chile" },
  { id: "032", name: "Argentina" }, { id: "076", name: "Brasil" },
  { id: "840", name: "Estados Unidos" }, { id: "724", name: "España" },
];

const ACCENT = "#ff5a00";
const GOLD   = "#ffb300";

export default function TemplatePurchaseModal({ open, onClose, onSuccess, tmplLabel, lang = "en" }) {
  const isEs = lang === "es";
  const [selectedPlan,   setSelectedPlan]   = useState("single");
  const [payMethod,      setPayMethod]      = useState("paypal");
  const [step,           setStep]           = useState("form");
  const [ppLoaded,       setPpLoaded]       = useState(false);
  const [ppError,        setPpError]        = useState("");
  const [cardError,      setCardError]      = useState("");
  const [cardSuccess,    setCardSuccess]    = useState("");
  const [setupData,      setSetupData]      = useState(null);
  const [challengeData,  setChallengeData]  = useState(null);
  const [savedPlan,      setSavedPlan]      = useState(null);
  const [savedCard,      setSavedCard]      = useState(null);

  const paypalBtnRef = useRef(null);
  const ppRendered   = useRef(false);
  const iframeRef    = useRef(null);
  const formRef      = useRef(null);

  const [card, setCard] = useState({
    cardHolderName: "", number: "", expirationDate: "", cvv: "",
    firstName: "", lastName: "", email: "", phone: "",
    city: "", countryId: "320", line1: "",
  });
  const upd = (k, v) => setCard(p => ({ ...p, [k]: v }));

  const plan = PLANS.find(p => p.id === selectedPlan);

  // Mapear plan a pack key para reutilizar endpoints existentes
  const packKey = selectedPlan === "single" ? "single_template" : selectedPlan;

  // Cargar PayPal SDK
  useEffect(() => {
    if (!open || !PAYPAL_CLIENT_ID) return;
    if (window.paypal) { setPpLoaded(true); return; }
    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&currency=USD&intent=capture&disable-funding=credit,card`;
    script.onload  = () => setPpLoaded(true);
    script.onerror = () => setPpError(isEs ? "No se pudo cargar PayPal." : "Could not load PayPal.");
    document.head.appendChild(script);
  }, [open]);

  // Renderizar botón PayPal
  useEffect(() => {
    if (payMethod !== "paypal" || !ppLoaded || !paypalBtnRef.current || !open) return;
    if (ppRendered.current) { paypalBtnRef.current.innerHTML = ""; ppRendered.current = false; }

    window.paypal.Buttons({
      style: { layout: "vertical", color: "gold", shape: "rect", label: "pay", height: 48 },
      createOrder: async (data, actions) => {
        return actions.order.create({
          purchase_units: [{
            amount: { value: String(plan.price), currency_code: "USD" },
            description: `IsabelaOS — ${plan.jades} Jades (${plan.label.en})`,
          }],
          application_context: { shipping_preference: "NO_SHIPPING" },
        });
      },
      onApprove: async (data, actions) => {
        setStep("loading"); setPpError("");
        try {
          const order = await actions.order.capture();
          const auth  = await getAuthHeadersGlobal();
          const r = await fetch("/api/paypal-verify-and-grant", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...auth },
            body: JSON.stringify({ orderID: order.id, pack: packKey, jades: plan.jades, price: plan.price }),
          });
          const j = await r.json().catch(() => null);
          if (!r.ok || !j?.ok) throw new Error(j?.error || "Error verificando pago.");
          setCardSuccess(isEs ? `¡Listo! Se acreditaron ${j.granted || plan.jades} Jades.` : `Done! ${j.granted || plan.jades} Jades credited.`);
          setStep("done");
          if (typeof onSuccess === "function") await onSuccess();
          setTimeout(() => { setCardSuccess(""); setStep("form"); onClose(); }, 2500);
        } catch (err) {
          setPpError(err?.message || "Error con PayPal.");
          setStep("form");
        }
      },
      onError: () => { setPpError(isEs ? "Error de PayPal. Intenta de nuevo." : "PayPal error. Try again."); setStep("form"); },
      onCancel: () => { setPpError(isEs ? "Pago cancelado." : "Payment cancelled."); setStep("form"); },
    }).render(paypalBtnRef.current);
    ppRendered.current = true;
  }, [payMethod, ppLoaded, selectedPlan, open]);

  // Re-render PayPal si cambia plan
  useEffect(() => {
    if (ppRendered.current && paypalBtnRef.current) {
      paypalBtnRef.current.innerHTML = "";
      ppRendered.current = false;
    }
  }, [selectedPlan]);

  // Pagadito listeners
  useEffect(() => {
    const handler = (e) => {
      if (!e.data || e.data.source !== "isabelaos-pagadito-return") return;
      const transactionId = e.data.transactionId;
      if (transactionId) callValidate(transactionId);
      else { setCardError(isEs ? "El banco no devolvió ID." : "Bank did not return ID."); setStep("form"); }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [challengeData, savedPlan, savedCard]);

  useEffect(() => {
    if (step !== "iframe" || !setupData) return;
    const t = setTimeout(() => {
      try { formRef.current?.submit(); } catch {}
      setTimeout(() => callJadesPay(), 3000);
    }, 500);
    return () => clearTimeout(t);
  }, [step, setupData]);

  if (!open) return null;

  async function handleCardPay(e) {
    e.preventDefault();
    setCardError("");
    if (!card.number || !card.expirationDate || !card.cvv || !card.cardHolderName) { setCardError(isEs ? "Completa los datos de tarjeta." : "Fill in card details."); return; }
    if (!card.firstName || !card.lastName || !card.email) { setCardError(isEs ? "Completa nombre y correo." : "Fill in name and email."); return; }
    setStep("loading");
    try {
      const auth = await getAuthHeadersGlobal();
      const r    = await fetch("/api/jades-setup", { method: "POST", headers: { "Content-Type": "application/json", ...auth }, body: JSON.stringify({ pack: packKey, price: plan.price, jades: plan.jades, card }) });
      const j    = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.response_message || j?.error || "Error iniciando pago.");
      setSavedPlan(packKey); setSavedCard(card); setSetupData(j); setStep("iframe");
    } catch (err) { setCardError(err?.message || "Error."); setStep("form"); }
  }

  async function callJadesPay() {
    try {
      const auth = await getAuthHeadersGlobal();
      const r    = await fetch("/api/jades-pay", { method: "POST", headers: { "Content-Type": "application/json", ...auth }, body: JSON.stringify({ pack: packKey, price: plan.price, jades: plan.jades, card, setupRequestId: setupData?.request_id, referenceId: setupData?.referenceId, deviceFingerprintID: setupData?.fingerprint || "" }) });
      const j    = await r.json().catch(() => null);
      if (j?.challenge_required) {
        if (!j.stepUpUrl || !j.accessToken) { setCardError(isEs ? "Verificación bancaria no disponible." : "Bank verification unavailable."); setStep("form"); return; }
        setChallengeData(j); setStep("challenge");
        setTimeout(() => { try { document.getElementById("step_up_form_tmpl")?.submit(); } catch {} }, 400);
        return;
      }
      if (!r.ok || !j?.ok) throw new Error(j?.response_message || j?.error || "Error en el pago.");
      setCardSuccess(isEs ? `¡Listo! Se acreditaron ${j.jades_added || plan.jades} Jades.` : `Done! ${j.jades_added || plan.jades} Jades credited.`);
      setStep("done");
      if (typeof onSuccess === "function") await onSuccess();
      setTimeout(() => { setCardSuccess(""); setStep("form"); onClose(); }, 2500);
    } catch (err) { setCardError(err?.message || "Error."); setStep("form"); }
  }

  async function callValidate(transactionId) {
    setStep("validating");
    try {
      const auth = await getAuthHeadersGlobal();
      const r    = await fetch("/api/validate-process-card", { method: "POST", headers: { "Content-Type": "application/json", ...auth }, body: JSON.stringify({ pack: savedPlan || packKey, price: plan.price, jades: plan.jades, card: savedCard || card, transactionId, id_transaction: challengeData?.id_transaction, setupRequestId: setupData?.request_id, referenceId: setupData?.referenceId }) });
      const j    = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.response_message || j?.error || "Error validando.");
      setCardSuccess(isEs ? `¡Listo! Se acreditaron ${j.jades_added || plan.jades} Jades.` : `Done! ${j.jades_added || plan.jades} Jades credited.`);
      setStep("done");
      if (typeof onSuccess === "function") await onSuccess();
      setTimeout(() => { setCardSuccess(""); setStep("form"); setChallengeData(null); onClose(); }, 2500);
    } catch (err) { setCardError(err?.message || "Error confirmando."); setStep("form"); }
  }

  function handleClose() {
    if (step === "loading" || step === "iframe" || step === "validating") return;
    setStep("form"); setCardError(""); setPpError(""); setChallengeData(null); setSetupData(null); onClose();
  }

  const inp = { width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, color: "#fff", padding: "10px 14px", fontSize: 13, outline: "none", fontFamily: "'DM Sans',sans-serif", marginTop: 4, boxSizing: "border-box" };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 800, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.85)", backdropFilter: "blur(12px)", padding: 16 }}
      onClick={handleClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", background: "#0a0c12", border: "1px solid rgba(255,90,0,0.3)", borderRadius: 24, padding: 24, boxShadow: "0 0 80px rgba(255,90,0,0.15)" }}>

        {/* Iframe oculto Pagadito */}
        {step === "iframe" && setupData && (
          <div style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
            <iframe ref={iframeRef} name="collectionIframe" height="1" width="1" style={{ display: "none" }} />
            <form ref={formRef} method="POST" target="collectionIframe" action={setupData.deviceDataCollectionUrl}>
              <input type="hidden" name="JWT" value={setupData.accessToken} />
            </form>
          </div>
        )}

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 18, fontWeight: 900, color: "#fff", marginBottom: 3 }}>
              ⚡ {isEs ? "Desbloquear plantilla" : "Unlock template"}
            </div>
            {tmplLabel && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{tmplLabel}</div>}
          </div>
          <button onClick={handleClose} style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#fff", padding: "4px 12px", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>

        {/* Loading / Processing */}
        {(step === "loading" || step === "iframe" || step === "validating") && (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <div style={{ fontSize: 40, marginBottom: 12, animation: "pulse 1.5s infinite" }}>💳</div>
            <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 6 }}>
              {isEs ? "Procesando pago seguro..." : "Processing secure payment..."}
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{isEs ? "No cierres esta ventana" : "Do not close this window"}</div>
          </div>
        )}

        {/* 3DS Challenge */}
        {step === "challenge" && challengeData && (
          <div style={{ marginTop: 16 }}>
            <div style={{ background: "rgba(255,179,0,0.08)", border: "1px solid rgba(255,179,0,0.25)", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#ffb300" }}>
              🔐 {isEs ? "Tu banco requiere verificación adicional." : "Your bank requires additional verification."}
            </div>
            <iframe name="stepUpIframe" id="step_up_iframe_tmpl" height="500" width="100%" style={{ border: "none", borderRadius: 12, background: "#fff" }} />
            <form id="step_up_form_tmpl" method="POST" target="stepUpIframe" action={challengeData.stepUpUrl} style={{ display: "none" }}>
              <input type="hidden" name="JWT" value={challengeData.accessToken} />
              <input type="hidden" name="MD"  value={challengeData.id_transaction || ""} />
            </form>
          </div>
        )}

        {/* Done */}
        {step === "done" && cardSuccess && (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 15, fontWeight: 700, color: "#4ade80" }}>{cardSuccess}</div>
          </div>
        )}

        {/* FORM */}
        {step === "form" && (
          <>
            {/* Plan selector */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: ACCENT, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>
                {isEs ? "Elige tu opción" : "Choose your option"}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {PLANS.map(p => (
                  <div key={p.id} onClick={() => setSelectedPlan(p.id)}
                    style={{ border: `1.5px solid ${selectedPlan === p.id ? ACCENT : "rgba(255,255,255,0.1)"}`, borderRadius: 14, padding: "14px 16px", cursor: "pointer", background: selectedPlan === p.id ? "rgba(255,90,0,0.08)" : "rgba(255,255,255,0.03)", transition: "all 0.2s", position: "relative" }}>
                    {p.badge && (
                      <div style={{ position: "absolute", top: -1, right: 12, background: `linear-gradient(135deg,${ACCENT},${GOLD})`, color: "#000", fontSize: 9, fontWeight: 900, letterSpacing: 1, padding: "2px 8px", borderRadius: "0 0 6px 6px" }}>
                        {p.badge[lang] || p.badge.en}
                      </div>
                    )}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 14, fontWeight: 800, color: "#fff", marginBottom: 2 }}>
                          {p.label[lang] || p.label.en}
                        </div>
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                          {p.sub[lang] || p.sub.en}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 20, fontWeight: 900, color: selectedPlan === p.id ? ACCENT : "#fff" }}>
                          ${p.price}
                        </div>
                        <div style={{ fontSize: 10, color: GOLD, fontWeight: 700 }}>
                          {p.jades} 💎 Jades
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Suscripción info */}
            <div style={{ background: "rgba(255,179,0,0.06)", border: "1px solid rgba(255,179,0,0.2)", borderRadius: 12, padding: "12px 14px", marginBottom: 20, fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>
              💎 {isEs
                ? "El Pack Popular ($13) incluye soporte personalizado para que crees todo lo que necesites con IsabelaOS."
                : "The Popular Pack ($13) includes personalized support to create everything you need with IsabelaOS."}
            </div>

            {/* Método de pago */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: ACCENT, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>
                {isEs ? "Método de pago" : "Payment method"}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div onClick={() => setPayMethod("paypal")} style={{ border: `1.5px solid ${payMethod === "paypal" ? GOLD : "rgba(255,255,255,0.1)"}`, borderRadius: 12, padding: "12px", cursor: "pointer", background: payMethod === "paypal" ? "rgba(255,179,0,0.08)" : "rgba(255,255,255,0.03)", transition: "all 0.2s", textAlign: "center" }}>
                  <div style={{ fontSize: 20, marginBottom: 4 }}>🌐</div>
                  <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 12, color: "#fff" }}>PayPal</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{isEs ? "Internacional" : "International"}</div>
                </div>
                <div onClick={() => setPayMethod("card")} style={{ border: `1.5px solid ${payMethod === "card" ? ACCENT : "rgba(255,255,255,0.1)"}`, borderRadius: 12, padding: "12px", cursor: "pointer", background: payMethod === "card" ? "rgba(255,90,0,0.08)" : "rgba(255,255,255,0.03)", transition: "all 0.2s", textAlign: "center" }}>
                  <div style={{ fontSize: 20, marginBottom: 4 }}>💳</div>
                  <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 12, color: "#fff" }}>{isEs ? "Tarjeta" : "Card"}</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>LatAm · Visa · MC</div>
                </div>
              </div>
            </div>

            {/* PayPal */}
            {payMethod === "paypal" && (
              <div style={{ marginBottom: 16 }}>
                {ppError && <div style={{ background: "rgba(255,60,60,0.08)", border: "1px solid rgba(255,60,60,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#ff8080", marginBottom: 10 }}>{ppError}</div>}
                {!ppLoaded && !ppError && <div style={{ textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.3)", padding: "16px 0" }}>Cargando PayPal...</div>}
                <div ref={paypalBtnRef} />
                <div style={{ textAlign: "center", fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 8 }}>
                  {isEs ? "Procesado por PayPal" : "Processed by PayPal"} · ${plan.price} USD · {plan.jades} Jades
                </div>
              </div>
            )}

            {/* Tarjeta Pagadito */}
            {payMethod === "card" && (
              <form onSubmit={handleCardPay} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#fff", marginBottom: 4 }}>
                  {isEs ? "Pagar" : "Pay"} ${plan.price} USD · {plan.jades} Jades
                </div>
                {[
                  { label: isEs ? "Nombre en tarjeta" : "Name on card", key: "cardHolderName", ph: "Como en la tarjeta" },
                  { label: isEs ? "Número de tarjeta" : "Card number",  key: "number",         ph: "1234 5678 9012 3456" },
                  { label: isEs ? "Vencimiento" : "Expiry (MM/YYYY)",  key: "expirationDate", ph: "01/2030" },
                  { label: "CVV", key: "cvv", ph: "123" },
                ].map(({ label, key, ph }) => (
                  <div key={key}>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{label}</div>
                    <input type="text" value={card[key]} onChange={e => upd(key, e.target.value)} placeholder={ph} style={inp} />
                  </div>
                ))}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{isEs ? "Nombre" : "First name"}</div>
                    <input type="text" value={card.firstName} onChange={e => upd("firstName", e.target.value)} placeholder="John" style={inp} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{isEs ? "Apellido" : "Last name"}</div>
                    <input type="text" value={card.lastName} onChange={e => upd("lastName", e.target.value)} placeholder="Doe" style={inp} />
                  </div>
                </div>
                {[
                  { label: isEs ? "Correo" : "Email",    key: "email", ph: "tu@email.com",        type: "email" },
                  { label: isEs ? "Teléfono" : "Phone",  key: "phone", ph: "+502 1234-5678" },
                  { label: isEs ? "Ciudad" : "City",     key: "city",  ph: "Ciudad de Guatemala" },
                  { label: isEs ? "Dirección" : "Address", key: "line1", ph: "Zona 10, Calle Principal" },
                ].map(({ label, key, ph, type }) => (
                  <div key={key}>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{label}</div>
                    <input type={type || "text"} value={card[key]} onChange={e => upd(key, e.target.value)} placeholder={ph} style={inp} />
                  </div>
                ))}
                <div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>{isEs ? "País" : "Country"}</div>
                  <select value={card.countryId} onChange={e => upd("countryId", e.target.value)} style={{ ...inp, marginTop: 0 }}>
                    {COUNTRIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                {cardError && <div style={{ background: "rgba(255,60,60,0.08)", border: "1px solid rgba(255,60,60,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#ff8080" }}>{cardError}</div>}
                <button type="submit" style={{ width: "100%", background: `linear-gradient(135deg,${ACCENT},${GOLD})`, border: "none", borderRadius: 12, color: "#000", fontFamily: "'Syne',sans-serif", fontSize: 14, fontWeight: 800, padding: "14px", cursor: "pointer", marginTop: 4 }}>
                  {isEs ? "Pagar" : "Pay"} ${plan.price} USD · {plan.jades} Jades
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
