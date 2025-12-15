import { useState, useEffect } from "react";
import { useAuth } from "./context/AuthContext";

import {
  saveGenerationInSupabase,
  loadGenerationsForUser,
  getTodayGenerationCount,
  deleteGenerationFromSupabase,
} from "./lib/generations";

/* ================= LIMITES ================= */
const DEMO_LIMIT = 3;
const DAILY_LIMIT = 5;

/* ================= PAYPAL ================= */
const PAYPAL_CLIENT_ID =
  import.meta.env.VITE_PAYPAL_CLIENT_ID || "TU_CLIENT_ID_AQUI";

/* ================= PAYPAL BUTTON ================= */
function PayPalButton({ amount = "5.00", containerId }) {
  useEffect(() => {
    if (!PAYPAL_CLIENT_ID) return;

    const render = () => {
      if (!window.paypal) return;
      window.paypal.Buttons({
        style: { layout: "horizontal", shape: "pill", color: "black" },
        createOrder: (_, actions) =>
          actions.order.create({
            purchase_units: [{ amount: { value: amount } }],
          }),
        onApprove: (_, actions) => actions.order.capture(),
      }).render(`#${containerId}`);
    };

    if (window.paypal) render();
    else {
      const s = document.createElement("script");
      s.src = `https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&currency=USD`;
      s.onload = render;
      document.body.appendChild(s);
    }
  }, [amount, containerId]);

  return <div id={containerId} />;
}

/* ================= AUTH MODAL ================= */
function AuthModal({ open, onClose }) {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    mode === "login"
      ? await signInWithEmail(email, password)
      : await signUpWithEmail(email, password);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70">
      <div className="w-full max-w-md rounded-3xl bg-black/90 p-6 border border-white/10">
        <h3 className="text-lg font-semibold text-white">
          {mode === "login" ? "Iniciar sesión" : "Crear cuenta"}
        </h3>

        <form onSubmit={submit} className="mt-4 space-y-3">
          <input
            type="email"
            placeholder="Correo"
            className="w-full rounded-xl bg-black/60 px-3 py-2 text-white"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="password"
            placeholder="Contraseña"
            className="w-full rounded-xl bg-black/60 px-3 py-2 text-white"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="w-full rounded-xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-2 text-white">
            {mode === "login" ? "Entrar" : "Registrarme"}
          </button>
        </form>

        <button
          onClick={signInWithGoogle}
          className="mt-3 w-full rounded-xl border border-white/20 py-2 text-white"
        >
          Google
        </button>

        <p className="mt-3 text-xs text-neutral-400 text-center">
          {mode === "login" ? (
            <>
              ¿No tienes cuenta?{" "}
              <button onClick={() => setMode("register")} className="underline">
                Regístrate
              </button>
            </>
          ) : (
            <>
              ¿Ya tienes cuenta?{" "}
              <button onClick={() => setMode("login")} className="underline">
                Inicia sesión
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

/* ================= LANDING VIEW ================= */
function LandingView({ onOpenAuth, onStartDemo }) {
  const [tab, setTab] = useState("home");

  return (
    <div className="min-h-screen text-white bg-[#05060A]">
      {/* HEADER */}
      <header className="border-b border-white/10 bg-black/40 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-3 flex justify-between">
          <span className="font-semibold">isabelaOs Studio</span>
          <div className="flex gap-2">
            <button
              onClick={() => setTab(tab === "home" ? "contact" : "home")}
              className="border border-white/20 px-3 py-1 rounded-xl text-xs"
            >
              {tab === "home" ? "Contacto" : "Volver"}
            </button>
            <button
              onClick={onOpenAuth}
              className="border border-white/20 px-3 py-1 rounded-xl text-xs"
            >
              Login
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-12">
        {tab === "home" && (
          <>
            {/* HERO */}
            <section className="grid lg:grid-cols-2 gap-8">
              <div>
                <h1 className="text-4xl font-bold">
                  Generación visual con IA
                </h1>
                <p className="mt-3 text-neutral-400">
                  Imágenes y video con calidad studio en segundos.
                </p>
                <div className="mt-6 flex gap-3">
                  <button
                    onClick={onStartDemo}
                    className="bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-3 rounded-xl"
                  >
                    {DEMO_LIMIT} imágenes gratis
                  </button>
                  <button
                    onClick={onOpenAuth}
                    className="border border-white/20 px-6 py-3 rounded-xl"
                  >
                    Crear cuenta
                  </button>
                </div>
              </div>

              <div className="rounded-3xl overflow-hidden border border-white/10">
                <img
                  src="/gallery/img1.png"
                  alt="Hero"
                  className="w-full h-64 object-cover"
                />
              </div>
            </section>

            {/* IMAGE TO VIDEO */}
            <section className="mt-14">
              <h2 className="font-semibold mb-4">Image → Video</h2>
              <div className="grid md:grid-cols-3 gap-4">
                <img src="/gallery/img2.png" className="rounded-xl" />
                <div className="flex items-center justify-center text-4xl">→</div>
                <div className="h-40 rounded-xl border border-white/10 grid place-items-center text-neutral-500">
                  Video
                </div>
              </div>
            </section>

            {/* VIDEO TO VIDEO */}
            <section className="mt-14">
              <h2 className="font-semibold mb-4">Video → Video</h2>
              <div className="grid grid-cols-4 gap-3">
                {[...Array(6)].map((_, i) => (
                  <div
                    key={i}
                    className="h-24 border border-white/10 rounded-xl grid place-items-center text-xs text-neutral-500"
                  >
                    Slot
                  </div>
                ))}
              </div>
            </section>

            {/* BODY SYNC */}
            <section className="mt-14 grid lg:grid-cols-2 gap-6">
              <div>
                <h2 className="font-semibold">BodySync</h2>
                <p className="text-xs text-neutral-400 mt-2">
                  Movimiento corporal realista por IA.
                </p>
              </div>
              <img
                src="/gallery/bodysync_showcase.png"
                className="rounded-xl"
              />
            </section>

            {/* PLAN */}
            <section className="mt-14">
              <h2 className="font-semibold mb-2">Plan Basic</h2>
              <p className="text-xs text-neutral-400">
                Generación ilimitada · US$5/mes
              </p>
              <div className="mt-4 flex gap-4">
                <button className="bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-2 rounded-xl">
                  Pagar con tarjeta
                </button>
                <PayPalButton amount="5.00" containerId="paypal-landing" />
              </div>
            </section>
          </>
        )}

        {tab === "contact" && (
          <section className="max-w-md">
            <h2 className="text-xl font-semibold">Contacto</h2>
            <p className="text-xs text-neutral-400 mt-2">
              contacto@isabelaos.com
            </p>
          </section>
        )}
      </main>
    </div>
  );
}

/* ================= APP ================= */
export default function App() {
  const { user, loading } = useAuth();
  const [showAuth, setShowAuth] = useState(false);
  const [view, setView] = useState("landing");

  if (loading)
    return (
      <div className="min-h-screen grid place-items-center text-neutral-400">
        Cargando...
      </div>
    );

  if (user) return <div>Dashboard (tu código sigue igual)</div>;

  return (
    <>
      <LandingView
        onOpenAuth={() => setShowAuth(true)}
        onStartDemo={() => setView("demo")}
      />
      <AuthModal open={showAuth} onClose={() => setShowAuth(false)} />
    </>
  );
}
