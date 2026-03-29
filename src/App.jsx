// src/App.jsx
// ─────────────────────────────────────────────────────────────
// App principal de IsabelaOS Studio
// CAMBIOS v3:
//   - Módulo Product Photoshoot integrado (tipo Pomelli)
//   - Tab "📸 Photoshoot" en el dashboard
//   - Conectado al sistema de Jades existente
// ─────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState, useRef } from "react";
import { useAuth } from "./context/AuthContext";
import { supabase } from "./lib/supabaseClient";
import { JADE_PACKS, COSTS } from "./lib/pricing";

// Componentes externos
import ContactView              from "./components/ContactView";
import { VideoFromPromptPanel } from "./components/VideoFromPromptPanel";
import { Img2VideoPanel }       from "./components/Img2VideoPanel";
import LibraryView              from "./components/LibraryView";
import AvatarStudioPanel        from "./components/AvatarStudioPanel";
import MontajeIAPanel           from "./components/MontajeIAPanel";
import CreatorPanel             from "./components/CreatorPanel";
import ComercialPanel           from "./components/ComercialPanel";
import ProductPhotoshoot        from "./components/ProductPhotoshoot"; // ← NUEVO

import { startPaypalSubscription } from "./lib/PaypalCheckout";

// ── Constantes ────────────────────────────────────────────────
const DEMO_LIMIT  = 5;
const DAILY_LIMIT = 5;
const PAYPAL_CLIENT_ID     = import.meta.env.VITE_PAYPAL_CLIENT_ID || "";
const PAYPAL_PLAN_ID_BASIC = import.meta.env.VITE_PAYPAL_PLAN_ID_BASIC || "";
const PAYPAL_PLAN_ID_PRO   = import.meta.env.VITE_PAYPAL_PLAN_ID_PRO   || "";

// ── Demo prompt handoff ───────────────────────────────────────
const DEMO_PROMPT_KEY = "isabela_demo_prompt_text2img";
function saveDemoPrompt(p)  { try { localStorage.setItem(DEMO_PROMPT_KEY, String(p || "")); } catch {} }
function scrollToId(id) { document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }

// ── Auth headers ──────────────────────────────────────────────
async function getAuthHeadersGlobal() {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  } catch { return {}; }
}

// ══════════════════════════════════════════════════════════════
// MODAL DE COMPRA DE JADES
// ══════════════════════════════════════════════════════════════
function BuyJadesModal({ open, onClose, userId, onSuccess }) {
  const [selectedPack, setSelectedPack] = useState("popular");
  const [paying,       setPaying]       = useState(false);
  const [cardError,    setCardError]    = useState("");
  const [cardSuccess,  setCardSuccess]  = useState("");

  const [card, setCard] = useState({
    cardHolderName: "", number: "", expirationDate: "", cvv: "",
    firstName: "", lastName: "", email: "", phone: "",
    city: "Guatemala", state: "Guatemala", zip: "", countryId: "320", line1: "",
  });

  const upd = (k, v) => setCard((p) => ({ ...p, [k]: v }));

  if (!open) return null;

  const pack = JADE_PACKS[selectedPack];

  async function handlePay(e) {
    e.preventDefault();
    setCardError(""); setCardSuccess("");
    if (!card.number || !card.expirationDate || !card.cvv || !card.cardHolderName) {
      setCardError("Completa los datos de tarjeta."); return;
    }
    if (!card.firstName || !card.lastName || !card.email) {
      setCardError("Completa tu nombre y correo."); return;
    }
    try {
      setPaying(true);
      const auth = await getAuthHeadersGlobal();
      const r = await fetch("/api/jades-buy", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({
          pack: selectedPack,
          card: {
            number: card.number.trim(), expirationDate: card.expirationDate.trim(),
            cvv: card.cvv.trim(), cardHolderName: card.cardHolderName.trim(),
            firstName: card.firstName.trim(), lastName: card.lastName.trim(),
            email: card.email.trim(),
            billingAddress: {
              city: card.city.trim(), state: card.state.trim(), zip: card.zip.trim(),
              countryId: card.countryId.trim(), line1: card.line1.trim(), phone: card.phone.trim(),
            },
          },
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        if (j?.challenge_required) {
          setCardError("Tu banco solicitó verificación 3D Secure. Intenta de nuevo o usa otra tarjeta.");
          return;
        }
        throw new Error(j?.response_message || j?.error || "No se pudo procesar el pago.");
      }
      setCardSuccess(`¡Listo! Se acreditaron ${j.jades_added} Jades a tu cuenta.`);
      if (typeof onSuccess === "function") await onSuccess();
      setTimeout(() => { setCardSuccess(""); onClose(); }, 2500);
    } catch (err) {
      setCardError(err?.message || "Error procesando pago.");
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end" onClick={onClose}>
      <div
        className="relative h-full w-full max-w-md overflow-y-auto border-l border-white/10 bg-[#06070B] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}>

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Comprar Jades</h2>
            <p className="mt-1 text-xs text-neutral-400">1 Jade = $0.10 USD · Sin suscripción</p>
          </div>
          <button onClick={onClose}
            className="rounded-xl border border-white/15 px-3 py-1.5 text-xs text-neutral-400 hover:bg-white/10">
            ✕
          </button>
        </div>

        {/* Packs */}
        <div className="mt-5 grid grid-cols-2 gap-3">
          {Object.entries(JADE_PACKS).map(([key, p]) => (
            <button key={key} type="button" onClick={() => setSelectedPack(key)}
              className={`rounded-2xl border p-4 text-left transition ${
                selectedPack === key
                  ? "border-cyan-400 bg-cyan-500/10"
                  : "border-white/10 bg-black/40 hover:bg-black/50"
              }`}>
              <div className="text-sm font-semibold text-white">{p.label}</div>
              <div className="mt-1 text-xl font-bold text-cyan-300">{p.jades}J</div>
              <div className="mt-1 text-xs text-neutral-400">${p.price_usd} USD</div>
              <div className="mt-1 text-[10px] text-neutral-500">
                ${(p.price_usd / p.jades * 10).toFixed(1)}¢ por jade
              </div>
            </button>
          ))}
        </div>

        {/* Equivalencias del pack seleccionado */}
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-[11px] text-neutral-300">
          <div className="font-semibold text-white">Con {pack.jades} Jades puedes generar:</div>
          <div className="mt-2 space-y-1">
            <div>· <span className="font-semibold text-white">{pack.jades}</span> imágenes sin avatar</div>
            <div>· <span className="font-semibold text-white">{Math.floor(pack.jades / 2)}</span> imágenes con avatar</div>
            <div>· <span className="font-semibold text-white">{Math.floor(pack.jades / COSTS.vid_express_8s)}</span> videos Express 8s</div>
            <div>· <span className="font-semibold text-white">{Math.floor(pack.jades / COSTS.vid_standard_10s)}</span> videos Standard 10s</div>
            <div>· <span className="font-semibold text-white">{Math.floor(pack.jades / 20)}</span> sesiones Photoshoot (4 fotos)</div>
          </div>
        </div>

        {/* Formulario de tarjeta */}
        <form onSubmit={handlePay} className="mt-5 space-y-3">
          <div className="text-xs font-semibold text-white">
            Pagar ${pack.price_usd} USD · Pack {pack.label}
          </div>

          {[
            { label: "Nombre en tarjeta",     key: "cardHolderName", placeholder: "JOHN DOE" },
            { label: "Número de tarjeta",      key: "number",         placeholder: "4000000000002503" },
            { label: "Vencimiento (MM/YYYY)",  key: "expirationDate", placeholder: "01/2027" },
            { label: "CVV",                    key: "cvv",            placeholder: "123" },
            { label: "Nombre",                 key: "firstName",      placeholder: "John" },
            { label: "Apellido",               key: "lastName",       placeholder: "Doe" },
            { label: "Correo",                 key: "email",          placeholder: "tu@email.com" },
            { label: "Teléfono",               key: "phone",          placeholder: "5555-5555" },
            { label: "Ciudad",                 key: "city",           placeholder: "Guatemala" },
            { label: "Dirección",              key: "line1",          placeholder: "Zona 10" },
          ].map(({ label, key, placeholder }) => (
            <div key={key}>
              <label className="text-[11px] text-neutral-400">{label}</label>
              <input type={key === "email" ? "email" : "text"}
                value={card[key]} onChange={(e) => upd(key, e.target.value)}
                placeholder={placeholder}
                className="mt-1 w-full rounded-xl bg-black/60 px-3 py-2 text-xs text-white outline-none ring-1 ring-white/10 focus:ring-cyan-400" />
            </div>
          ))}

          {cardError && (
            <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {cardError}
            </div>
          )}
          {cardSuccess && (
            <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
              {cardSuccess}
            </div>
          )}

          <button type="submit" disabled={paying}
            className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60">
            {paying ? "Procesando..." : `Pagar $${pack.price_usd} · ${pack.jades} Jades`}
          </button>
        </form>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MODAL DE AUTENTICACIÓN
// ══════════════════════════════════════════════════════════════
function AuthModal({ open, onClose }) {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();
  const [mode,     setMode]     = useState("login");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault(); setError(""); setLoading(true);
    try {
      if (mode === "login") await signInWithEmail(email, password);
      else { await signUpWithEmail(email, password); alert("Cuenta creada. Revisa tu correo si se requiere confirmación."); }
      onClose();
    } catch (err) { setError(err.message || String(err)); }
    finally { setLoading(false); }
  };

  const handleGoogle = async () => {
    setError(""); setLoading(true);
    try { await signInWithGoogle(); onClose(); }
    catch (err) { setError(err.message || String(err)); setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-black/90 p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">
            {mode === "login" ? "Inicia sesión" : "Crea tu cuenta"}
          </h3>
          <button onClick={onClose} className="rounded-lg px-3 py-1 text-neutral-400 hover:bg-white/10">✕</button>
        </div>
        <p className="mt-2 text-xs text-neutral-400">Usa tu correo o entra con Google para acceder al motor de producción visual.</p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label className="text-xs text-neutral-300">Correo</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400" />
          </div>
          <div>
            <label className="text-xs text-neutral-300">Contraseña</label>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400" />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {loading ? "Procesando..." : mode === "login" ? "Entrar" : "Registrarme"}
          </button>
        </form>
        <button onClick={handleGoogle} disabled={loading}
          className="mt-3 w-full rounded-2xl border border-white/20 py-2 text-sm text-white hover:bg-white/10 disabled:opacity-60">
          Continuar con Google
        </button>
        <p className="mt-3 text-center text-xs text-neutral-400">
          {mode === "login"
            ? <> ¿No tienes cuenta?{" "}<button type="button" onClick={() => setMode("register")} className="text-cyan-300 underline">Regístrate aquí</button></>
            : <> ¿Ya tienes cuenta?{" "}<button type="button" onClick={() => setMode("login")} className="text-cyan-300 underline">Inicia sesión</button></>}
        </p>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// GOOGLE ONLY MODAL
// ══════════════════════════════════════════════════════════════
function GoogleOnlyModal({ open, onClose, onGoogle }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-black/90 p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Regístrate con Google</h3>
          <button onClick={onClose} className="rounded-lg px-3 py-1 text-neutral-400 hover:bg-white/10">✕</button>
        </div>
        <p className="mt-2 text-xs text-neutral-400">
          Crea tu cuenta con Google. Al entrar recibirás tus{" "}
          <span className="font-semibold text-white">10 jades gratis</span>.
        </p>
        <button onClick={onGoogle}
          className="mt-5 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white shadow-[0_0_35px_rgba(34,211,238,0.35)]">
          Registrarme con Google
        </button>
        <button onClick={onClose}
          className="mt-3 w-full rounded-2xl border border-white/20 py-3 text-sm text-white hover:bg-white/10">
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════
function DashboardView() {
  const { user, isAdmin, signOut } = useAuth();
  const [activeModule, setActiveModule] = useState(null);
  const [buyJadesOpen, setBuyJadesOpen] = useState(false);

  const [userStatus, setUserStatus] = useState({
    loading: true, plan: null, subscription_status: "none", jades: 0,
  });

  const fetchUserStatus = async () => {
    if (!user?.id) return;
    try {
      const auth = await getAuthHeadersGlobal();
      const r    = await fetch(`/api/user-status?user_id=${encodeURIComponent(user.id)}`, { headers: auth });
      const data = await r.json().catch(() => null);
      if (!r.ok || !data?.ok) throw new Error(data?.error || "user-status error");
      setUserStatus({ loading: false, plan: data.plan, subscription_status: data.subscription_status, jades: data.jades ?? 0 });
    } catch { setUserStatus((p) => ({ ...p, loading: false })); }
  };

  useEffect(() => {
    if (!user?.id) return;
    fetchUserStatus();
    const t = setInterval(fetchUserStatus, 15000);
    return () => clearInterval(t);
  }, [user?.id]);

  const spendJades = async ({ amount, reason }) => {
    if (!user?.id) throw new Error("No user");
    const auth = await getAuthHeadersGlobal();
    const r    = await fetch("/api/jades-spend", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ user_id: user.id, amount: Number(amount), reason: reason || "spend" }),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data?.ok) throw new Error(data?.error || "No se pudo descontar jades.");
    await fetchUserStatus();
    return data;
  };

  // Función de deducción para ProductPhotoshoot
  // Descuenta 5 Jades por imagen (20 total por sesión de 4 imágenes)
  const handlePhotoshootJades = async (amount) => {
    try {
      await spendJades({ amount, reason: "product_photoshoot" });
    } catch (err) {
      console.error("Error descontando jades photoshoot:", err);
    }
  };

  const handleContact = () => {
    const subject = encodeURIComponent("Soporte IsabelaOS Studio");
    const body    = encodeURIComponent("Hola, necesito ayuda con IsabelaOS Studio.\n\n");
    window.location.href = `mailto:contacto@isabelaos.com?subject=${subject}&body=${body}`;
  };

  // ── Tabs del dashboard ─────────────────────────────────────
  // Se agrega "photoshoot" como nueva tab
  const tabs = [
    { key: "generator",  label: "Imagen"          },
    { key: "img2video",  label: "Imagen → Video"  },
    { key: "avatars",    label: "Avatares"         },
    { key: "library",    label: "Biblioteca"       },
    { key: "montaje",    label: "Montaje IA"       },
    { key: "comercial",  label: "🎬 Comercial IA"  },
    { key: "photoshoot", label: "📸 Photoshoot"    }, // ← NUEVO
  ];

  return (
    <div className="min-h-screen w-full text-white"
      style={{ background: "radial-gradient(1200px_800px_at_110%-10%,rgba(255,23,229,0.12),transparent_60%),radial-gradient(900px_600px_at-10%_0%,rgba(0,229,255,0.10),transparent_50%),radial-gradient(900px_500px_at_50%_120%,rgba(168,85,247,0.12),transparent_55%),#06070B" }}>

      {/* ── Header ── */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/60 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500 to-fuchsia-500 text-xs font-bold shadow-[0_0_25px_rgba(34,211,238,0.35)]">
              io
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">isabelaOs <span className="text-xs text-neutral-400">Studio</span></div>
              <div className="text-[10px] text-neutral-500">Workspace del creador</div>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-3 text-xs">
            <span className="hidden lg:inline text-neutral-300">{user?.email}{isAdmin ? " · admin" : ""}</span>

            <button
              onClick={() => setBuyJadesOpen(true)}
              className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/60 px-3 py-1.5 hover:border-cyan-400/40 hover:bg-cyan-500/5 transition-all"
              title="Comprar Jades">
              <span className="text-base" role="img" aria-label="jade">💎</span>
              <span className="text-[11px] text-neutral-300">
                Jades: <span className="font-semibold text-white">{userStatus.loading ? "..." : userStatus.jades ?? 0}</span>
              </span>
              <span className="text-[10px] text-cyan-400/70">+ Comprar</span>
            </button>

            <button onClick={handleContact}
              className="rounded-xl border border-white/20 px-3 py-1.5 text-xs text-white hover:bg-white/10">
              Contacto
            </button>
            <button onClick={signOut}
              className="rounded-xl border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10">
              Cerrar sesión
            </button>
          </div>
        </div>
      </header>

      {/* ── Contenido principal ── */}
      <main className="mx-auto max-w-7xl px-4 pb-16 pt-8">
        <section className="mb-6">
          <p className="text-[11px] uppercase tracking-[0.22em] text-neutral-400">Workspace</p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-white md:text-3xl">Panel del creador</h1>
              <p className="mt-2 max-w-2xl text-sm text-neutral-400">
                Genera, revisa, descarga y administra resultados desde un solo sistema conectado a GPU.
              </p>
            </div>
            <div className="hidden lg:flex items-center gap-2 rounded-2xl border border-white/10 bg-black/35 px-4 py-3 text-xs text-neutral-300">
              <span className="text-neutral-400">Estado:</span>
              <span className="font-medium text-white">Sistema activo</span>
            </div>
          </div>
        </section>

        {/* Tabs */}
        <section className="mb-6">
          <div className="no-scrollbar flex gap-2 overflow-x-auto rounded-[24px] border border-white/10 bg-black/35 p-2">
            {tabs.map((item) => {
              const active = activeModule === item.key;
              return (
                <button key={item.key} type="button"
                  onClick={() => setActiveModule(active ? null : item.key)}
                  className={["whitespace-nowrap rounded-2xl px-4 py-3 text-sm font-medium transition-all",
                    active
                      ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white shadow-[0_0_30px_rgba(34,211,238,0.22)]"
                      : "bg-white/5 text-white/75 hover:bg-white/10 hover:text-white"].join(" ")}>
                  {item.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Módulo activo */}
        {activeModule && (
          <section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-black/35 p-4 md:p-6">
            <div className="pointer-events-none absolute -inset-16 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.10),transparent_25%),radial-gradient(circle_at_top_right,rgba(236,72,153,0.10),transparent_28%),radial-gradient(circle_at_bottom,rgba(168,85,247,0.10),transparent_35%)]" />

            {activeModule === "generator"  && <CreatorPanel isDemo={false} />}
            {activeModule === "img2video"  && <Img2VideoPanel userStatus={userStatus} spendJades={spendJades} />}
            {activeModule === "avatars"    && <AvatarStudioPanel userStatus={userStatus} />}
            {activeModule === "library"    && <LibraryView />}
            {activeModule === "montaje"    && <MontajeIAPanel userStatus={userStatus} />}
            {activeModule === "comercial"  && <ComercialPanel userStatus={userStatus} />}

            {/* ── PHOTOSHOOT MODULE ── */}
            {activeModule === "photoshoot" && (
              <ProductPhotoshoot
                userJades={userStatus.jades ?? 0}
                onJadesDeducted={handlePhotoshootJades}
              />
            )}
          </section>
        )}

        {/* Home del dashboard — cards cuando no hay módulo activo */}
        {!activeModule && (
          <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {tabs.map((item) => (
              <button key={item.key} type="button" onClick={() => setActiveModule(item.key)}
                className={[
                  "group rounded-[28px] border p-6 text-left transition-all",
                  // Card especial para Photoshoot
                  item.key === "photoshoot"
                    ? "border-cyan-400/25 bg-cyan-500/5 hover:border-cyan-400/40 hover:bg-cyan-500/8"
                    : "border-white/10 bg-black/35 hover:border-cyan-400/30 hover:bg-black/50"
                ].join(" ")}>
                <div className={["text-base font-semibold transition-colors",
                  item.key === "photoshoot" ? "text-cyan-200 group-hover:text-cyan-100" : "text-white group-hover:text-cyan-300"
                ].join(" ")}>{item.label}</div>
                <div className="mt-2 text-xs text-neutral-400">
                  {item.key === "generator"  && "Genera imágenes con FLUX y avatares faciales"}
                  {item.key === "img2video"  && "Convierte imágenes en videos con Express o Standard"}
                  {item.key === "avatars"    && "Crea y administra tus modelos virtuales"}
                  {item.key === "library"    && "Revisa y descarga todas tus generaciones"}
                  {item.key === "montaje"    && "Monta personas o productos en fondos personalizados"}
                  {item.key === "comercial"  && "Genera comerciales profesionales con video, voz y narración IA"}
                  {item.key === "photoshoot" && "Convierte fotos de productos en shoots profesionales — Studio, Lifestyle, In Use, Campaign"}
                </div>
                {item.key === "photoshoot" && (
                  <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-cyan-400/20 bg-cyan-400/8 px-3 py-1 text-[10px] text-cyan-300">
                    ✦ Nuevo · 20 Jades por sesión · 4 variaciones
                  </div>
                )}
                <div className={["mt-4 text-[11px] transition-colors",
                  item.key === "photoshoot" ? "text-cyan-400/60 group-hover:text-cyan-400" : "text-cyan-400/60 group-hover:text-cyan-400"
                ].join(" ")}>
                  Abrir módulo →
                </div>
              </button>
            ))}

            {/* Card de Jades */}
            <button type="button" onClick={() => setBuyJadesOpen(true)}
              className="group rounded-[28px] border border-cyan-400/20 bg-cyan-500/5 p-6 text-left hover:border-cyan-400/40 hover:bg-cyan-500/10 transition-all">
              <div className="flex items-center gap-2">
                <span className="text-2xl">💎</span>
                <div className="text-base font-semibold text-white">Mis Jades</div>
              </div>
              <div className="mt-2 text-3xl font-bold text-cyan-300">
                {userStatus.loading ? "..." : userStatus.jades ?? 0}
              </div>
              <div className="mt-2 text-xs text-neutral-400">Créditos para generar imágenes y videos</div>
              <div className="mt-4 text-[11px] text-cyan-400/60 group-hover:text-cyan-400 transition-colors">
                Comprar más Jades →
              </div>
            </button>
          </section>
        )}
      </main>

      {/* Modal de compra de Jades */}
      <BuyJadesModal
        open={buyJadesOpen}
        onClose={() => setBuyJadesOpen(false)}
        userId={user?.id}
        onSuccess={fetchUserStatus} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// PRICING SECTION
// ══════════════════════════════════════════════════════════════
function PricingSection({ onOpenAuth }) {
  return (
    <section id="planes" className="mt-24">
      <div className="text-center mb-10">
        <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-400/70">Sin suscripción</p>
        <h3 className="mt-3 text-3xl md:text-4xl font-semibold text-white">Paga solo lo que usas</h3>
        <p className="mt-3 text-sm text-neutral-400 max-w-xl mx-auto">
          Compra Jades y genera cuando quieras. Sin mensualidad, sin contratos. 1 Jade = $0.10 USD.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(JADE_PACKS).map(([key, p], i) => {
          const isPopular = key === "popular";
          return (
            <div key={key} className={`relative overflow-hidden rounded-[28px] border p-6 transition-all hover:-translate-y-1 ${
              isPopular
                ? "border-cyan-400/60 bg-gradient-to-b from-cyan-500/15 to-black/60 shadow-[0_0_40px_rgba(34,211,238,0.15)]"
                : "border-white/10 bg-black/40 hover:border-white/20"
            }`}>
              {isPopular && (
                <div className="absolute top-4 right-4 rounded-full bg-cyan-400 px-2.5 py-0.5 text-[10px] font-bold text-black">Popular</div>
              )}
              <div className="text-xs text-neutral-400 uppercase tracking-widest">{p.label}</div>
              <div className="mt-3 flex items-end gap-1">
                <span className="text-4xl font-bold text-white">${p.price_usd}</span>
                <span className="mb-1 text-xs text-neutral-400">USD</span>
              </div>
              <div className="mt-1 text-lg font-semibold text-cyan-300">{p.jades} Jades</div>

              <div className="mt-5 space-y-2 text-[11px] text-neutral-300">
                <div className="flex items-center gap-2"><span className="text-cyan-400">✓</span> {p.jades} imágenes sin avatar</div>
                <div className="flex items-center gap-2"><span className="text-cyan-400">✓</span> {Math.floor(p.jades / 2)} imágenes con avatar</div>
                <div className="flex items-center gap-2"><span className="text-fuchsia-400">✓</span> {Math.floor(p.jades / COSTS.vid_express_8s)} videos Express 8s</div>
                <div className="flex items-center gap-2"><span className="text-emerald-400">✓</span> {Math.floor(p.jades / 20)} sesiones Photoshoot</div>
                <div className="flex items-center gap-2"><span className="text-yellow-400">✓</span> Jades sin vencimiento</div>
              </div>

              <button onClick={onOpenAuth}
                className={`mt-6 w-full rounded-2xl py-2.5 text-xs font-semibold transition-all ${
                  isPopular
                    ? "bg-gradient-to-r from-cyan-400 to-fuchsia-500 text-white shadow-[0_0_20px_rgba(34,211,238,0.25)]"
                    : "border border-white/20 text-white hover:bg-white/10"
                }`}>
                Comprar {p.label}
              </button>
            </div>
          );
        })}
      </div>

      {/* Tabla de costos */}
      <div className="mt-8 rounded-[28px] border border-white/10 bg-black/40 p-6">
        <div className="text-sm font-semibold text-white mb-4">Costo por generación</div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-[11px]">
          {[
            { label: "Imagen sin avatar",       cost: COSTS.img_prompt,         icon: "🖼️", color: "text-cyan-300"    },
            { label: "Imagen con avatar",        cost: COSTS.img_anchor,         icon: "👤", color: "text-cyan-300"    },
            { label: "Video Express 8s",         cost: COSTS.vid_express_8s,     icon: "🎬", color: "text-fuchsia-300" },
            { label: "Video Standard 10s",       cost: COSTS.vid_standard_10s,   icon: "🎥", color: "text-yellow-300"  },
            { label: "Video Standard 15s",       cost: COSTS.vid_standard_15s,   icon: "🎥", color: "text-yellow-300"  },
            { label: "Audio Express",            cost: COSTS.vid_express_audio,  icon: "🔊", color: "text-fuchsia-300" },
            { label: "Audio Standard",           cost: COSTS.vid_standard_audio, icon: "🔊", color: "text-yellow-300"  },
            { label: "Montaje IA",               cost: 5,                        icon: "✨", color: "text-emerald-300" },
            { label: "Photoshoot (sesión 4 fotos)", cost: 20,                   icon: "📸", color: "text-cyan-300"    }, // ← NUEVO
          ].map(({ label, cost, icon, color }) => (
            <div key={label} className="flex items-center justify-between rounded-2xl border border-white/5 bg-black/40 px-4 py-3">
              <span className="flex items-center gap-2 text-neutral-300">{icon} {label}</span>
              <span className={`font-bold ${color}`}>{cost}J</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════════════════════
// LANDING VIEW
// ══════════════════════════════════════════════════════════════
function StatCounter({ value, label, suffix = "" }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let start = 0;
    const end = parseInt(value);
    if (start === end) return;
    const dur = 1800;
    const step = Math.ceil(end / (dur / 16));
    const timer = setInterval(() => {
      start = Math.min(start + step, end);
      setCount(start);
      if (start >= end) clearInterval(timer);
    }, 16);
    return () => clearInterval(timer);
  }, [value]);
  return (
    <div className="text-center">
      <div className="text-3xl md:text-4xl font-bold text-white">{count.toLocaleString()}{suffix}</div>
      <div className="mt-1 text-[11px] text-neutral-400 uppercase tracking-wider">{label}</div>
    </div>
  );
}

function LandingView({ onOpenAuth, onStartDemo, onOpenContact, onOpenAbout }) {
  const [demoPrompt, setDemoPrompt] = useState(
    "Modelo virtual elegante para redes sociales, rostro consistente, luz cinematográfica, formato vertical"
  );

  const topVisuals = [
    { type: "video",  src: "/gallery/video1.mp4",   label: "Demo principal", big: true  },
    { type: "image",  src: "/gallery/img2.png?v=2",  label: "Campaña visual", big: false },
    { type: "image",  src: "/gallery/img3.png?v=2",  label: "Escena IA",      big: false },
    { type: "image",  src: "/gallery/img4.png?v=2",  label: "Avatar",         big: false },
    { type: "image",  src: "/gallery/img1.png?v=2",  label: "Contenido",      big: false },
    { type: "image",  src: "/gallery/img5.png?v=2",  label: "Preview",        big: false },
  ];

  const steps = [
    { num: "01", title: "Describe tu visión", desc: "Escribe el prompt de tu modelo virtual o campaña. Puedes usar el optimizador IA para mejorarlo.", icon: "✍️" },
    { num: "02", title: "Motor GPU genera",   desc: "Nuestro worker conectado a GPU procesa tu solicitud con FLUX o Realistic Vision en segundos.",    icon: "⚡" },
    { num: "03", title: "Edita y exporta",    desc: "Convierte a video, monta en escenas con Montaje IA, descarga y organiza en tu biblioteca.",        icon: "🎬" },
  ];

  return (
    <div className="min-h-screen w-full text-white overflow-x-hidden"
      style={{ background: "radial-gradient(1200px_800px_at_100%_-10%,rgba(250,204,21,0.14),transparent_55%),radial-gradient(900px_700px_at_-10%_0%,rgba(34,211,238,0.16),transparent_50%),radial-gradient(900px_700px_at_50%_120%,rgba(168,85,247,0.08),transparent_55%),#05060A" }}>

      {/* ── Navbar ── */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/50 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400 via-sky-500 to-yellow-400 text-xs font-bold text-black shadow-[0_0_30px_rgba(250,204,21,0.22)]">io</div>
            <div>
              <div className="text-sm font-semibold leading-tight">isabelaOs <span className="text-xs text-neutral-400">Studio</span></div>
              <div className="text-[10px] text-neutral-500">Plataforma de modelos virtuales</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => scrollToId("planes")} className="hidden sm:inline rounded-xl border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10 transition-all">Planes</button>
            <button onClick={onOpenAbout}               className="hidden sm:inline rounded-xl border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10 transition-all">Sobre nosotros</button>
            <button onClick={onOpenContact}             className="hidden sm:inline rounded-xl border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10 transition-all">Contacto</button>
            <button onClick={onOpenAuth}
              className="rounded-xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90 transition-all">
              Iniciar sesión / Registrarse
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-20 pt-10">

        {/* ── HERO ── */}
        <section className="grid gap-10 xl:grid-cols-[1fr_1.2fr_0.85fr]">

          {/* Izquierda */}
          <div className="xl:pt-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-yellow-400/30 bg-yellow-400/10 px-4 py-1.5 text-[11px] text-yellow-200">
              <span className="h-1.5 w-1.5 rounded-full bg-yellow-400 animate-pulse" />
              Estudio visual con IA · GPU en vivo
            </div>
            <h1 className="mt-6 text-5xl font-bold leading-[0.95] md:text-6xl lg:text-7xl tracking-tight">
              Tu estudio de
              <span className="block bg-gradient-to-r from-cyan-300 via-sky-300 to-yellow-300 bg-clip-text text-transparent mt-1">
                modelos<br />virtuales
              </span>
            </h1>
            <p className="mt-6 max-w-md text-base text-neutral-300 leading-relaxed">
              Crea, organiza y escala contenido visual para personajes y modelos virtuales desde un solo sistema conectado a GPU.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {["Producción en GPU","Consistencia de rostro","Imagen → Video","Montaje IA","📸 Photoshoot"].map((t) => (
                <span key={t} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/70">
                  <span className="h-1 w-1 rounded-full bg-cyan-400" />{t}
                </span>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button onClick={() => scrollToId("demo-box")}
                className="rounded-2xl bg-gradient-to-r from-cyan-400 via-sky-500 to-yellow-400 px-7 py-3.5 text-sm font-bold text-black shadow-[0_0_40px_rgba(250,204,21,0.22)] hover:shadow-[0_0_50px_rgba(34,211,238,0.30)] transition-all">
                Crear mi modelo virtual
              </button>
              <button onClick={onOpenAbout}
                className="rounded-2xl border border-white/20 bg-white/5 px-7 py-3.5 text-sm font-semibold text-white hover:bg-white/10 transition-all">
                Ver presentación
              </button>
            </div>

            {/* Mini stats */}
            <div className="mt-10 grid grid-cols-3 gap-4 border-t border-white/10 pt-8">
              <StatCounter value={1240} suffix="+" label="Modelos creados" />
              <StatCounter value={3}    suffix="s"  label="Tiempo promedio" />
              <StatCounter value={98}   suffix="%"  label="Satisfacción" />
            </div>
          </div>

          {/* Centro — galería */}
          <div className="order-3 xl:order-2">
            <div className="mb-5 flex items-end justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">Visuales del sistema</p>
                <h2 className="mt-1 text-xl font-semibold text-white">Generado con IsabelaOS</h2>
              </div>
              <button onClick={() => scrollToId("demo-box")}
                className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs text-white hover:bg-white/10 transition-all">
                Empezar →
              </button>
            </div>
            <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-white/3 p-3">
              <div className="pointer-events-none absolute -inset-20 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(250,204,21,0.12),transparent_30%)]" />
              <div className="grid auto-rows-[200px] grid-cols-2 gap-3 lg:grid-cols-3 lg:auto-rows-[185px]">
                {topVisuals.map((item, idx) => (
                  <div key={idx}
                    className={`group relative overflow-hidden rounded-[22px] border border-white/10 bg-black/40 ${item.big ? "lg:col-span-2 lg:row-span-2" : ""}`}>
                    {item.type === "video"
                      ? <video className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-108"
                          src={item.src} autoPlay muted loop playsInline preload="metadata" style={{transform:"scale(1.01)"}} />
                      : <div className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-[1.08]"
                          style={{ backgroundImage: `url(${item.src})`, transform:"scale(1.01)" }} />}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                    <div className="absolute left-3 top-3 rounded-full border border-white/15 bg-black/50 px-3 py-1 text-[10px] text-white/80 backdrop-blur-sm">{item.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Derecha — demo box sticky */}
          <div className="order-2 xl:order-3 xl:pt-10">
            <div className="sticky top-24">
              <div id="demo-box"
                className="relative overflow-hidden rounded-[30px] border-2 border-yellow-400/35 bg-black/60 p-6 backdrop-blur-md shadow-[0_0_60px_rgba(250,204,21,0.10)]">
                <div className="pointer-events-none absolute inset-0 rounded-[30px] ring-1 ring-cyan-400/15" />
                <div className="pointer-events-none absolute -inset-12 -z-10 bg-gradient-to-br from-cyan-500/15 via-transparent to-yellow-400/15 blur-3xl" />

                <p className="text-[11px] uppercase tracking-[0.22em] text-yellow-200/80">Inicio rápido</p>
                <h2 className="mt-2 text-xl font-bold text-white">Empieza con tu primer modelo virtual</h2>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  {["Imagen","Imagen → Video","Avatar"].map((t, i) => (
                    <div key={t} className={`rounded-2xl px-3 py-2 text-[11px] text-center border ${
                      i === 0 ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-100"
                      : i === 2 ? "border-yellow-400/30 bg-yellow-400/10 text-yellow-100"
                      : "border-white/10 bg-white/5 text-white/70"}`}>{t}</div>
                  ))}
                </div>

                <textarea
                  className="mt-4 h-28 w-full resize-none rounded-2xl border border-yellow-400/20 bg-black/60 px-4 py-3 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-yellow-300 transition-all"
                  value={demoPrompt} onChange={(e) => setDemoPrompt(e.target.value)}
                  placeholder="Ej: modelo virtual elegante para redes sociales..." />

                <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]">
                  {["Modelo virtual","Imagen vertical","Cuenta → panel"].map(t => (
                    <div key={t} className="rounded-xl border border-white/10 bg-black/50 px-2 py-2 text-center text-neutral-400">{t}</div>
                  ))}
                </div>

                <button
                  onClick={() => { saveDemoPrompt(demoPrompt); onStartDemo(); }}
                  disabled={!demoPrompt.trim()}
                  className="mt-5 w-full rounded-2xl bg-gradient-to-r from-cyan-400 via-sky-500 to-yellow-400 py-3.5 text-sm font-bold text-black shadow-[0_0_30px_rgba(250,204,21,0.20)] disabled:opacity-60 hover:shadow-[0_0_40px_rgba(34,211,238,0.25)] transition-all">
                  Crear modelo →
                </button>
                <p className="mt-2 text-[10px] text-neutral-400 text-center">Sin tarjeta · Gratis para empezar</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── CÓMO FUNCIONA ── */}
        <section className="mt-24">
          <div className="text-center mb-10">
            <p className="text-[11px] uppercase tracking-[0.28em] text-neutral-400">Flujo de trabajo</p>
            <h3 className="mt-3 text-3xl font-bold text-white">Cómo funciona</h3>
            <p className="mt-3 text-sm text-neutral-400 max-w-lg mx-auto">De la idea al resultado visual en tres pasos simples.</p>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {steps.map((s, i) => (
              <div key={i} className="group relative overflow-hidden rounded-[28px] border border-white/10 bg-black/40 p-7 hover:border-cyan-400/30 hover:bg-black/50 transition-all">
                <div className="pointer-events-none absolute -right-6 -top-6 text-[80px] opacity-5 group-hover:opacity-10 transition-opacity">{s.icon}</div>
                <div className="text-[11px] font-bold text-neutral-500 tracking-widest">{s.num}</div>
                <div className="mt-3 text-4xl">{s.icon}</div>
                <h4 className="mt-4 text-lg font-semibold text-white">{s.title}</h4>
                <p className="mt-2 text-sm text-neutral-400 leading-relaxed">{s.desc}</p>
                {i < steps.length - 1 && (
                  <div className="hidden md:block absolute -right-3 top-1/2 -translate-y-1/2 z-10 text-neutral-600 text-xl">→</div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── GALERÍA GRANDE ── */}
        <section className="mt-24">
          <div className="flex items-end justify-between mb-8">
            <div>
              <p className="text-[11px] uppercase tracking-[0.28em] text-neutral-400">Capacidades</p>
              <h3 className="mt-2 text-3xl font-bold text-white">Lo que puedes crear</h3>
            </div>
            <button onClick={onOpenAuth}
              className="rounded-2xl border border-white/20 px-5 py-2.5 text-xs text-white hover:bg-white/10 transition-all">
              Empezar ahora →
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 auto-rows-[220px]">
            {[
              { src:"/gallery/img1.png?v=2", label:"Modelo virtual",   span:"md:col-span-2 md:row-span-2" },
              { src:"/gallery/img2.png?v=2", label:"Campaña visual",   span:"" },
              { src:"/gallery/img3.png?v=2", label:"Escena con IA",    span:"" },
              { src:"/gallery/img4.png?v=2", label:"Avatar facial",    span:"" },
              { src:"/gallery/img5.png?v=2", label:"Contenido social", span:"" },
            ].map((item, i) => (
              <div key={i} className={`group relative overflow-hidden rounded-[24px] border border-white/10 bg-black/60 ${item.span}`}>
                <div className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-[1.06]"
                  style={{ backgroundImage: `url(${item.src})` }} />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                <div className="absolute bottom-4 left-4 text-sm font-semibold text-white">{item.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── TESTIMONIOS ── */}
        <section className="mt-24">
          <div className="text-center mb-10">
            <p className="text-[11px] uppercase tracking-[0.28em] text-neutral-400">Primeros resultados</p>
            <h3 className="mt-3 text-3xl font-bold text-white">Lo que dicen los usuarios</h3>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {[
              { name: "Early Tester",    role: "Creador de contenido", text: "El flujo se siente como una herramienta real, no como un juguete. Me gustó la consistencia del estilo.", rating: 5 },
              { name: "Creador (beta)",  role: "Influencer virtual",   text: "Lo mejor es tener todo en un solo lugar: prompt → render → biblioteca. Eso ahorra tiempo.", rating: 5 },
              { name: "Equipo creativo", role: "Agencia digital",      text: "La plataforma ya se siente como producto terminado. La usamos para campañas de clientes.", rating: 5 },
            ].map((t, i) => (
              <div key={i} className="rounded-[28px] border border-white/10 bg-black/40 p-6 hover:border-white/20 transition-all">
                <div className="flex items-center gap-1 mb-4">
                  {Array(t.rating).fill(0).map((_, j) => <span key={j} className="text-yellow-400 text-sm">★</span>)}
                </div>
                <p className="text-sm text-neutral-200 leading-relaxed italic">"{t.text}"</p>
                <div className="mt-5 border-t border-white/10 pt-4">
                  <div className="text-sm font-semibold text-white">{t.name}</div>
                  <div className="text-xs text-neutral-400">{t.role}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── CTA CENTRAL ── */}
        <section className="mt-24">
          <div className="relative overflow-hidden rounded-[36px] border border-cyan-400/20 bg-black/50 p-12 text-center">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(34,211,238,0.08),transparent_70%)]" />
            <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-400/70">Empieza hoy</p>
            <h3 className="mt-4 text-4xl md:text-5xl font-bold text-white">Crea tu primer modelo virtual</h3>
            <p className="mt-4 text-neutral-400 max-w-lg mx-auto">Sin tarjeta de crédito. Sin suscripción. Empieza gratis y compra Jades cuando los necesites.</p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <button onClick={onStartDemo}
                className="rounded-2xl bg-gradient-to-r from-cyan-400 via-sky-500 to-yellow-400 px-8 py-4 text-base font-bold text-black shadow-[0_0_50px_rgba(34,211,238,0.25)] hover:shadow-[0_0_60px_rgba(250,204,21,0.30)] transition-all">
                Crear mi modelo gratis →
              </button>
              <button onClick={() => scrollToId("planes")}
                className="rounded-2xl border border-white/20 px-8 py-4 text-base text-white hover:bg-white/10 transition-all">
                Ver precios
              </button>
            </div>
          </div>
        </section>

        <PricingSection onOpenAuth={onOpenAuth} />
      </main>

      {/* ── FOOTER ── */}
      <footer className="border-t border-white/10 bg-black/40 mt-8">
        <div className="mx-auto max-w-7xl px-4 py-10">
          <div className="grid gap-8 md:grid-cols-3">
            <div>
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400 to-yellow-400 text-xs font-bold text-black">io</div>
                <div>
                  <div className="text-sm font-semibold text-white">isabelaOs Studio</div>
                  <div className="text-[10px] text-neutral-400">Plataforma de modelos virtuales</div>
                </div>
              </div>
              <p className="mt-4 text-xs text-neutral-400 max-w-xs leading-relaxed">
                Creado por Stalling Technologic, Cobán, Alta Verapaz, Guatemala.
              </p>
            </div>
            <div>
              <div className="text-xs font-semibold text-white uppercase tracking-wider mb-4">Plataforma</div>
              <div className="space-y-2 text-xs text-neutral-400">
                <div className="hover:text-white cursor-pointer transition-colors" onClick={onOpenAuth}>Crear cuenta</div>
                <div className="hover:text-white cursor-pointer transition-colors" onClick={() => scrollToId("planes")}>Precios</div>
                <div className="hover:text-white cursor-pointer transition-colors" onClick={onOpenAbout}>Sobre nosotros</div>
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-white uppercase tracking-wider mb-4">Soporte</div>
              <div className="space-y-2 text-xs text-neutral-400">
                <div className="hover:text-white cursor-pointer transition-colors" onClick={onOpenContact}>Contacto</div>
                <div className="text-neutral-500">contacto@isabelaos.com</div>
              </div>
            </div>
          </div>
          <div className="mt-8 border-t border-white/10 pt-6 flex flex-wrap items-center justify-between gap-4">
            <div className="text-[11px] text-neutral-500">© 2025 IsabelaOS · Todos los derechos reservados</div>
            <div className="text-[11px] text-neutral-500">Hecho con IA · GPU Power · Cobán GT</div>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ABOUT VIEW
// ══════════════════════════════════════════════════════════════
function AboutView({ onBackHome }) {
  const videoRef = useRef(null);
  const [soundOn, setSoundOn] = useState(false);

  const enableSound = async () => {
    const v = videoRef.current;
    if (!v) return;
    try { v.muted = false; v.volume = 1; await v.play(); setSoundOn(true); } catch {}
  };

  return (
    <div className="min-h-screen w-full text-white"
      style={{ background: "radial-gradient(1200px_800px_at_110%-10%,rgba(255,23,229,0.22),transparent_60%),radial-gradient(900px_600px_at-10%_0%,rgba(0,229,255,0.22),transparent_55%),#05060A" }}>
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500 to-fuchsia-500 text-xs font-bold">io</div>
            <div>
              <div className="text-sm font-semibold leading-tight">isabelaOs <span className="text-xs text-neutral-400">Studio</span></div>
              <div className="text-[10px] text-neutral-500">Presentación del sistema</div>
            </div>
          </div>
          <button onClick={onBackHome}
            className="rounded-xl border border-white/20 bg-white/5 px-4 py-1.5 text-xs text-white hover:bg-white/10">
            Volver a la página principal
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-10">
        <section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-white/5 p-4">
          <div className="mb-4">
            <p className="text-[11px] uppercase tracking-[0.22em] text-neutral-400">Presentación</p>
            <h1 className="mt-2 text-3xl font-semibold text-white md:text-4xl">Qué es IsabelaOS</h1>
            <p className="mt-3 max-w-3xl text-sm text-neutral-300">Una plataforma para crear y operar modelos virtuales con inteligencia artificial.</p>
          </div>
          <div className="relative">
            <video ref={videoRef}
              className="h-[360px] w-full rounded-[24px] border border-white/10 bg-black/40 object-cover md:h-[500px]"
              src="/gallery/video10.mp4" autoPlay muted loop playsInline preload="metadata" controls={soundOn} />
            {!soundOn && (
              <button onClick={enableSound}
                className="absolute bottom-4 left-4 rounded-2xl border border-white/15 bg-black/60 px-4 py-2 text-xs text-white hover:bg-black/70">
                🔊 Activar audio
              </button>
            )}
          </div>
        </section>

        <div className="mt-8">
          <button onClick={onBackHome}
            className="rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-3 text-sm font-semibold text-white">
            Regresar a la página principal
          </button>
        </div>
      </main>

      <footer className="border-t border-white/10 bg-black/30">
        <div className="mx-auto max-w-6xl px-4 py-6 text-center text-[11px] text-neutral-400">
          IsabelaOS 2025 creado por Stalling Technologic Cobán, Alta Verapaz.
        </div>
      </footer>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// APP ROOT
// ══════════════════════════════════════════════════════════════
export default function App() {
  const { user, signInWithGoogle } = useAuth();
  const [authOpen,        setAuthOpen]        = useState(false);
  const [landingPage,     setLandingPage]     = useState("home");
  const [googleModalOpen, setGoogleModalOpen] = useState(false);

  if (user) return <DashboardView />;

  return (
    <>
      <AuthModal        open={authOpen}        onClose={() => setAuthOpen(false)} />
      <GoogleOnlyModal  open={googleModalOpen} onClose={() => setGoogleModalOpen(false)}
        onGoogle={async () => {
          try { await signInWithGoogle(); setGoogleModalOpen(false); }
          catch (e) { alert(e?.message || "No se pudo iniciar con Google."); }
        }} />

      {landingPage === "home" && (
        <LandingView
          onOpenAuth={()    => setAuthOpen(true)}
          onStartDemo={()   => setGoogleModalOpen(true)}
          onOpenContact={() => setLandingPage("contact")}
          onOpenAbout={()   => setLandingPage("about")} />
      )}
      {landingPage === "contact" && <ContactView onBack={() => setLandingPage("home")} />}
      {landingPage === "about"   && <AboutView onBackHome={() => setLandingPage("home")} />}
    </>
  );
}

