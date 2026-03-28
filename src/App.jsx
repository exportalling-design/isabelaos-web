// src/App.jsx
// ─────────────────────────────────────────────────────────────
// App principal de IsabelaOS Studio
// CAMBIOS v2:
//   - CreatorPanel extraído a components/CreatorPanel.jsx
//   - Banner "Crear modelo" flotante sticky en landing
//   - Dashboard sin cambio de página — módulos como modales laterales
//   - Header logueado: jades + piedrita clickeable → panel de compra
//   - Sistema de compra de Jades con Pagadito (sin suscripción)
//   - Precios actualizados según pricing.js
// ─────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState, useRef } from "react";
import { useAuth } from "./context/AuthContext";
import { supabase } from "./lib/supabaseClient";
import { JADE_PACKS, COSTS } from "./lib/pricing";

// Componentes externos
import ContactView       from "./components/ContactView";
import { VideoFromPromptPanel } from "./components/VideoFromPromptPanel";
import { Img2VideoPanel }       from "./components/Img2VideoPanel";
import LibraryView              from "./components/LibraryView";
import AvatarStudioPanel        from "./components/AvatarStudioPanel";
import MontajeIAPanel           from "./components/MontajeIAPanel";
import CreatorPanel             from "./components/CreatorPanel";

import { startPaypalSubscription } from "./lib/PaypalCheckout";

// ── Constantes ────────────────────────────────────────────────
const DEMO_LIMIT  = 5;
const DAILY_LIMIT = 5;
const PAYPAL_CLIENT_ID   = import.meta.env.VITE_PAYPAL_CLIENT_ID || "";
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
// Panel lateral que aparece al hacer click en la piedrita
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
    // Overlay oscuro — click fuera cierra
    <div className="fixed inset-0 z-50 flex items-end justify-end" onClick={onClose}>
      {/* Panel lateral derecho */}
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
          </div>
        </div>

        {/* Formulario de tarjeta */}
        <form onSubmit={handlePay} className="mt-5 space-y-3">
          <div className="text-xs font-semibold text-white">
            Pagar ${pack.price_usd} USD · Pack {pack.label}
          </div>

          {[
            { label: "Nombre en tarjeta", key: "cardHolderName", placeholder: "JOHN DOE" },
            { label: "Número de tarjeta", key: "number",         placeholder: "4000000000002503" },
            { label: "Vencimiento (MM/YYYY)", key: "expirationDate", placeholder: "01/2027" },
            { label: "CVV",       key: "cvv",       placeholder: "123" },
            { label: "Nombre",    key: "firstName",  placeholder: "John" },
            { label: "Apellido",  key: "lastName",   placeholder: "Doe" },
            { label: "Correo",    key: "email",      placeholder: "tu@email.com" },
            { label: "Teléfono",  key: "phone",      placeholder: "5555-5555" },
            { label: "Ciudad",    key: "city",       placeholder: "Guatemala" },
            { label: "Dirección", key: "line1",      placeholder: "Zona 10" },
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
// GOOGLE ONLY MODAL (landing demo)
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
// DASHBOARD (usuario logueado)
// Módulos como ventanas flotantes laterales — sin cambio de página
// ══════════════════════════════════════════════════════════════
function DashboardView() {
  const { user, isAdmin, signOut } = useAuth();

  // Módulo activo — null = ninguno abierto (muestra home del dashboard)
  const [activeModule, setActiveModule] = useState(null);

  // Panel de compra de Jades
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

  const handleContact = () => {
    const subject = encodeURIComponent("Soporte IsabelaOS Studio");
    const body    = encodeURIComponent("Hola, necesito ayuda con IsabelaOS Studio.\n\n");
    window.location.href = `mailto:contacto@isabelaos.com?subject=${subject}&body=${body}`;
  };

  // Tabs del dashboard
  const tabs = [
    { key: "generator", label: "Imagen"        },
    { key: "img2video", label: "Imagen → Video" },
    { key: "avatars",   label: "Avatares"       },
    { key: "library",   label: "Biblioteca"     },
    { key: "montaje",   label: "Montaje IA"     },
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

            {/* Contador de Jades + piedrita clickeable */}
            <button
              onClick={() => setBuyJadesOpen(true)}
              className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/60 px-3 py-1.5 hover:border-cyan-400/40 hover:bg-cyan-500/5 transition-all"
              title="Comprar Jades">
              {/* Piedrita jade */}
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

        {/* Módulo activo — ventana flotante sobre el dashboard */}
        {activeModule && (
          <section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-black/35 p-4 md:p-6">
            <div className="pointer-events-none absolute -inset-16 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.10),transparent_25%),radial-gradient(circle_at_top_right,rgba(236,72,153,0.10),transparent_28%),radial-gradient(circle_at_bottom,rgba(168,85,247,0.10),transparent_35%)]" />

            {activeModule === "generator" && <CreatorPanel isDemo={false} />}
            {activeModule === "img2video" && <Img2VideoPanel userStatus={userStatus} spendJades={spendJades} />}
            {activeModule === "avatars"   && <AvatarStudioPanel userStatus={userStatus} />}
            {activeModule === "library"   && <LibraryView />}
            {activeModule === "montaje"   && <MontajeIAPanel userStatus={userStatus} />}
          </section>
        )}

        {/* Home del dashboard cuando no hay módulo activo */}
        {!activeModule && (
          <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {tabs.map((item) => (
              <button key={item.key} type="button" onClick={() => setActiveModule(item.key)}
                className="group rounded-[28px] border border-white/10 bg-black/35 p-6 text-left hover:border-cyan-400/30 hover:bg-black/50 transition-all">
                <div className="text-base font-semibold text-white group-hover:text-cyan-300 transition-colors">{item.label}</div>
                <div className="mt-2 text-xs text-neutral-400">
                  {item.key === "generator" && "Genera imágenes con FLUX y avatares faciales"}
                  {item.key === "img2video" && "Convierte imágenes en videos con Express o Standard"}
                  {item.key === "avatars"   && "Crea y administra tus modelos virtuales"}
                  {item.key === "library"   && "Revisa y descarga todas tus generaciones"}
                  {item.key === "montaje"   && "Monta personas o productos en fondos personalizados"}
                </div>
                <div className="mt-4 text-[11px] text-cyan-400/60 group-hover:text-cyan-400 transition-colors">
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
// LANDING — sección de precios actualizada
// ══════════════════════════════════════════════════════════════
function PricingSection({ onOpenAuth }) {
  return (
    <section id="planes" className="mt-20">
      <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-black/40 p-6 md:p-8">
        <div className="pointer-events-none absolute -inset-24 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.14),transparent_25%),radial-gradient(circle_at_top_right,rgba(236,72,153,0.16),transparent_28%),radial-gradient(circle_at_bottom,rgba(168,85,247,0.18),transparent_35%)]" />

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-neutral-400">Créditos de generación</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">Compra Jades y genera cuando quieras</h3>
            <p className="mt-2 max-w-2xl text-sm text-neutral-400">
              Sin suscripción mensual. Compra el pack que necesitas, los Jades no expiran.
              1 Jade = $0.10 USD.
            </p>
          </div>
          <button onClick={onOpenAuth}
            className="rounded-2xl border border-white/15 bg-white/5 px-4 py-2 text-xs text-white hover:bg-white/10">
            Ya tengo cuenta → Iniciar sesión
          </button>
        </div>

        {/* Grid de packs */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(JADE_PACKS).map(([key, p]) => (
            <div key={key} className="relative overflow-hidden rounded-[24px] border border-white/10 bg-black/50 p-5">
              <div className="text-lg font-semibold text-white">{p.label}</div>
              <div className="mt-2 text-4xl font-bold text-cyan-300">{p.jades}J</div>
              <div className="mt-1 text-sm text-neutral-400">${p.price_usd} USD</div>

              {/* Equivalencias */}
              <div className="mt-4 space-y-1 text-[11px] text-neutral-400">
                <div>· {p.jades} imágenes sin avatar</div>
                <div>· {Math.floor(p.jades / 2)} imágenes con avatar</div>
                <div>· {Math.floor(p.jades / COSTS.vid_express_8s)} videos Express 8s</div>
                <div>· {Math.floor(p.jades / COSTS.vid_standard_10s)} videos Standard 10s</div>
              </div>

              <button onClick={onOpenAuth}
                className="mt-5 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-2.5 text-xs font-semibold text-white">
                Comprar
              </button>
            </div>
          ))}
        </div>

        {/* Tabla de costos por generación */}
        <div className="mt-8 rounded-[24px] border border-white/10 bg-black/40 p-5">
          <div className="text-sm font-semibold text-white">Costo por generación</div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-[11px] text-neutral-300">
            {[
              { label: "Imagen sin avatar",     cost: COSTS.img_prompt,        color: "text-cyan-300"    },
              { label: "Imagen con avatar",      cost: COSTS.img_anchor,        color: "text-cyan-300"    },
              { label: "Video Express 8s",       cost: COSTS.vid_express_8s,    color: "text-fuchsia-300" },
              { label: "+ Audio Layer",          cost: COSTS.vid_express_audio, color: "text-fuchsia-300" },
              { label: "Video Standard 10s",     cost: COSTS.vid_standard_10s,  color: "text-yellow-300"  },
              { label: "Video Standard 15s",     cost: COSTS.vid_standard_15s,  color: "text-yellow-300"  },
              { label: "+ Audio Layer Standard", cost: COSTS.vid_standard_audio,color: "text-yellow-300"  },
            ].map(({ label, cost, color }) => (
              <div key={label} className="flex items-center justify-between rounded-xl border border-white/5 bg-black/40 px-3 py-2">
                <span>{label}</span>
                <span className={`font-semibold ${color}`}>{cost}J</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════════════════════
// LANDING VIEW
// Banner flotante sticky con "Crear modelo"
// ══════════════════════════════════════════════════════════════
function LandingView({ onOpenAuth, onStartDemo, onOpenContact, onOpenAbout }) {
  const [demoPrompt, setDemoPrompt] = useState(
    "Modelo virtual elegante para redes sociales, rostro consistente, luz cinematográfica, formato vertical"
  );
  // Control del banner sticky — visible siempre
  const [bannerVisible, setBannerVisible] = useState(true);

  const topVisuals = [
    { type: "video",  src: "/gallery/video1.mp4", label: "Demo principal", big: true  },
    { type: "image",  src: "/gallery/img2.png?v=2", label: "Campaña visual", big: false },
    { type: "image",  src: "/gallery/img3.png?v=2", label: "Escena IA",      big: false },
    { type: "image",  src: "/gallery/img4.png?v=2", label: "Avatar",         big: false },
    { type: "image",  src: "/gallery/img1.png?v=2", label: "Contenido",      big: false },
    { type: "image",  src: "/gallery/img5.png?v=2", label: "Preview",        big: false },
  ];

  return (
    <div className="min-h-screen w-full text-white"
      style={{ background: "radial-gradient(1200px_800px_at_100%_-10%,rgba(250,204,21,0.16),transparent_55%),radial-gradient(900px_700px_at_-10%_0%,rgba(34,211,238,0.18),transparent_50%),radial-gradient(900px_700px_at_50%_120%,rgba(168,85,247,0.08),transparent_55%),#05060A" }}>

      {/* Navbar */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/45 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400 via-sky-500 to-yellow-400 text-xs font-bold text-black shadow-[0_0_30px_rgba(250,204,21,0.22)]">io</div>
            <div>
              <div className="text-sm font-semibold leading-tight">isabelaOs <span className="text-xs text-neutral-400">Studio</span></div>
              <div className="text-[10px] text-neutral-500">Plataforma de modelos virtuales</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => scrollToId("planes")}
              className="hidden sm:inline rounded-xl border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10">Planes</button>
            <button onClick={onOpenAbout}
              className="hidden sm:inline rounded-xl border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10">Sobre nosotros</button>
            <button onClick={onOpenContact}
              className="hidden sm:inline rounded-xl border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10">Contacto</button>
            <button onClick={onOpenAuth}
              className="rounded-xl border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10">
              Iniciar sesión / Registrarse
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-16 pt-10">
        {/* Hero grid */}
        <section className="grid gap-8 xl:grid-cols-[0.84fr_1.1fr_0.82fr]">
          {/* Columna izquierda */}
          <div className="xl:pt-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-yellow-400/20 bg-yellow-400/10 px-4 py-1.5 text-[11px] text-yellow-200">
              Estudio visual con IA
            </div>
            <h1 className="mt-5 text-4xl font-semibold leading-[0.98] md:text-6xl">
              Tu estudio de
              <span className="mt-2 block bg-gradient-to-r from-cyan-300 via-sky-300 to-yellow-300 bg-clip-text text-transparent">
                modelos virtuales
              </span>
            </h1>
            <p className="mt-5 max-w-xl text-base text-neutral-300">
              Crea, organiza y escala contenido visual para personajes y modelos virtuales desde un solo sistema.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {["Producción en GPU","Consistencia de rostro","Imagen → Video","Biblioteca integrada"].map((t) => (
                <span key={t} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/80">{t}</span>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <button onClick={() => scrollToId("demo-box")}
                className="rounded-2xl bg-gradient-to-r from-cyan-400 via-sky-500 to-yellow-400 px-6 py-3 text-sm font-semibold text-black shadow-[0_0_35px_rgba(250,204,21,0.20)] hover:shadow-[0_0_40px_rgba(34,211,238,0.22)] transition-shadow">
                Crear mi modelo virtual
              </button>
              <button onClick={onOpenAbout}
                className="rounded-2xl border border-white/20 bg-white/5 px-6 py-3 text-sm font-semibold text-white hover:bg-white/10">
                Ver presentación
              </button>
            </div>
          </div>

          {/* Columna central — galería */}
          <div className="order-3 xl:order-2">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">Visuales del sistema</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">Contenido generado con IsabelaOS</h2>
              </div>
              <button onClick={() => scrollToId("demo-box")}
                className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs text-white hover:bg-white/10">
                Empezar ahora
              </button>
            </div>
            <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-white/5 p-4">
              <div className="pointer-events-none absolute -inset-20 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.14),transparent_25%),radial-gradient(circle_at_top_right,rgba(250,204,21,0.14),transparent_28%),radial-gradient(circle_at_bottom,rgba(168,85,247,0.08),transparent_35%)]" />
              <div className="grid auto-rows-[180px] grid-cols-2 gap-4 lg:grid-cols-3 lg:auto-rows-[170px]">
                {topVisuals.map((item, idx) => (
                  <div key={idx} className={`group relative overflow-hidden rounded-[26px] border border-white/10 bg-black/40 ${item.big ? "lg:col-span-2 lg:row-span-2" : ""}`}>
                    {item.type === "video"
                      ? <video className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                          src={item.src} autoPlay muted loop playsInline preload="metadata" />
                      : <div className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
                          style={{ backgroundImage: `url(${item.src})` }} />}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                    <div className="absolute left-3 top-3 rounded-full border border-white/10 bg-black/45 px-2.5 py-1 text-[10px] text-white/80 backdrop-blur-sm">{item.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Columna derecha — banner flotante sticky */}
          <div className="order-2 xl:order-3 xl:pt-14">
            {/* Banner sticky que acompaña el scroll */}
            <div className="sticky top-24">
              <div id="demo-box"
                className="relative overflow-hidden rounded-[30px] border-2 border-yellow-400/35 bg-black/55 p-6 backdrop-blur-md shadow-[0_0_40px_rgba(250,204,21,0.12)]">
                <div className="pointer-events-none absolute inset-0 rounded-[30px] ring-1 ring-cyan-400/20" />
                <div className="pointer-events-none absolute -inset-12 -z-10 bg-gradient-to-br from-cyan-500/18 via-transparent to-yellow-400/18 blur-3xl" />

                <div className="mb-3">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-yellow-200/80">Inicio rápido</p>
                  <h2 className="mt-2 text-xl font-semibold text-white">Empieza con tu primer modelo virtual</h2>
                </div>

                <div className="mb-4 grid gap-2 grid-cols-3">
                  <div className="rounded-2xl border border-cyan-400/25 bg-cyan-400/12 px-3 py-2 text-[11px] text-cyan-100">Imagen</div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-white/70">Imagen → Video</div>
                  <div className="rounded-2xl border border-yellow-400/25 bg-yellow-400/12 px-3 py-2 text-[11px] text-yellow-100">Avatar</div>
                </div>

                <textarea
                  className="mt-1 h-32 w-full resize-none rounded-2xl border border-yellow-400/20 bg-black/65 px-4 py-3 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-yellow-300"
                  value={demoPrompt} onChange={(e) => setDemoPrompt(e.target.value)}
                  placeholder="Ej: modelo virtual elegante para redes sociales..." />

                <div className="mt-3 grid gap-2 grid-cols-3 text-[10px]">
                  <div className="rounded-xl border border-white/10 bg-black/50 px-2 py-2 text-center text-neutral-400">Modelo virtual</div>
                  <div className="rounded-xl border border-white/10 bg-black/50 px-2 py-2 text-center text-neutral-400">Imagen vertical</div>
                  <div className="rounded-xl border border-white/10 bg-black/50 px-2 py-2 text-center text-neutral-400">Cuenta → panel</div>
                </div>

                <button
                  onClick={() => { saveDemoPrompt(demoPrompt); onStartDemo(); }}
                  disabled={!demoPrompt.trim()}
                  className="mt-4 w-full rounded-2xl bg-gradient-to-r from-cyan-400 via-sky-500 to-yellow-400 py-3 text-sm font-semibold text-black disabled:opacity-60">
                  Crear modelo
                </button>

                <div className="mt-2 text-[10px] text-neutral-400">
                  Al continuar, crearás tu cuenta y entrarás al panel con acceso inicial.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Testimonios */}
        <section className="mt-16">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-neutral-400">Señales tempranas</p>
            <h3 className="mt-1 text-2xl font-semibold text-white">Primeros resultados del sistema</h3>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {[
              { name: "Early Tester",    text: "El flujo se siente como una herramienta real, no como un juguete. Me gustó la consistencia del estilo." },
              { name: "Creador (beta)",  text: "Lo mejor es tener todo en un solo lugar: prompt → render → biblioteca. Eso ahorra tiempo." },
              { name: "Equipo creativo", text: "La plataforma ya se siente como producto, no como una simple demo de generación." },
            ].map((t, idx) => (
              <div key={idx} className="rounded-[28px] border border-white/10 bg-black/35 p-5 backdrop-blur-md">
                <div className="text-sm font-semibold text-white/90">{t.name}</div>
                <div className="mt-2 text-sm leading-relaxed text-white/70">{t.text}</div>
              </div>
            ))}
          </div>
        </section>

        <PricingSection onOpenAuth={onOpenAuth} />
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
  const [authOpen,       setAuthOpen]       = useState(false);
  const [landingPage,    setLandingPage]    = useState("home");
  const [googleModalOpen,setGoogleModalOpen]= useState(false);

  // Si está logueado → dashboard
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
