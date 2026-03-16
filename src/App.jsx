// App.jsx
import { useEffect, useMemo, useState, useRef } from "react";
import { useAuth } from "./context/AuthContext";
import ContactView from "./components/ContactView";
// ✅ nuevos imports de panels (si antes estaban embebidos, ahora vienen desde components)
import { VideoFromPromptPanel } from "./components/VideoFromPromptPanel";
import { Img2VideoPanel } from "./components/Img2VideoPanel";
import VoiceToVideoPanel from "./components/VoiceToVideoPanel";
import { supabase } from "./lib/supabaseClient";
import LibraryView from "./components/LibraryView";
import AvatarStudioPanel from "./components/AvatarStudioPanel";
import MontajeIAPanel from "./components/MontajeIAPanel";
import generatepanel from "./components/generatepanel";

import {
  saveGenerationInSupabase,
  loadGenerationsForUser,
  getTodayGenerationCount,
  deleteGenerationFromSupabase,
} from "./lib/generations";

import { PLANS, COSTS } from "./lib/pricing";

// ✅ PayPal checkout (redirect, NO popup)
import { startPaypalSubscription } from "./lib/PaypalCheckout";


// ---------------------------------------------------------
// LÍMITES GLOBALES
// ---------------------------------------------------------
const DEMO_LIMIT = 5; // ✅ Invitado (se mantiene para UI/labels, pero ahora el demo de landing fuerza Google)
const DAILY_LIMIT = 5; // Beta gratis (logueado)

// ---------------------------------------------------------
// COSTOS DE TOKENS (JADES)
// ---------------------------------------------------------
const COST_VIDEO_FROM_PROMPT = 20;
const COST_IMG2VIDEO = 25;
const COST_XMAS_PHOTO = 10;

// ---------------------------------------------------------
// PayPal – Client ID
// ---------------------------------------------------------
const PAYPAL_CLIENT_ID =
  import.meta.env.VITE_PAYPAL_CLIENT_ID ||
  "AZgwhtDkXVf9N6VrwtWk6dzwzM65DWBrM3dn3Og4DXgZhbxSxqRu1UWdEtbj12W_7ItmcrNhZDI3mtPG";

// ---------------------------------------------------------
// PayPal – Plan IDs (Subscriptions)
// ---------------------------------------------------------
const PAYPAL_PLAN_ID_BASIC = import.meta.env.VITE_PAYPAL_PLAN_ID_BASIC || "";
const PAYPAL_PLAN_ID_PRO = import.meta.env.VITE_PAYPAL_PLAN_ID_PRO || "";

// ---------------------------------------------------------
// ✅ Demo prompt handoff (Landing -> Creator)
// ---------------------------------------------------------
const DEMO_PROMPT_KEY = "isabela_demo_prompt_text2img";

function saveDemoPrompt(prompt) {
  try { localStorage.setItem(DEMO_PROMPT_KEY, String(prompt || "")); } catch {}
}
function readDemoPrompt() {
  try { return localStorage.getItem(DEMO_PROMPT_KEY) || ""; } catch { return ""; }
}
function clearDemoPrompt() {
  try { localStorage.removeItem(DEMO_PROMPT_KEY); } catch {}
}

// ---------------------------------------------------------
// Helper scroll suave
// ---------------------------------------------------------
function scrollToId(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------------------------------------------------
// Helpers base64
// ---------------------------------------------------------
function b64ToBlob(b64, contentType = "application/octet-stream") {
  const byteCharacters = atob(String(b64));
  const byteArrays = [];
  const sliceSize = 1024;

  for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
    const slice = byteCharacters.slice(offset, offset + sliceSize);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) byteNumbers[i] = slice.charCodeAt(i);
    byteArrays.push(new Uint8Array(byteNumbers));
  }
  return new Blob(byteArrays, { type: contentType });
}

// ---------------------------------------------------------
// ✅ TOKEN SUPABASE → HEADER AUTH (GLOBAL HELPER)
// ---------------------------------------------------------
async function getAuthHeadersGlobal() {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return {};
    const token = data?.session?.access_token;
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

// ---------------------------------------------------------
// Botón PayPal reutilizable (ORDER / SUBSCRIPTION)
// ---------------------------------------------------------
function PayPalButton({
  mode = "order", // "order" | "subscription"
  amount = "19.00",
  description = "IsabelaOS Studio",
  planId = null,
  customId = null,
  containerId,
  onPaid,
}) {
  const divId = containerId || "paypal-button-container";

  useEffect(() => {
    if (!PAYPAL_CLIENT_ID) {
      console.warn("No hay PAYPAL_CLIENT_ID configurado");
      return;
    }

    const renderButtons = () => {
      if (!window.paypal) return;

      const host = document.getElementById(divId);
      if (host) host.innerHTML = "";

      const common = {
        style: {
          layout: "horizontal",
          color: "black",
          shape: "pill",
          label: "paypal",
        },
        onError: (err) => {
          console.error("Error PayPal:", err);
          alert("Error al conectar con PayPal.");
        },
      };

      if (mode === "subscription") {
        if (!planId) {
          console.warn("PayPalButton: mode=subscription pero falta planId (P-xxxx)");
          const host2 = document.getElementById(divId);
          if (host2)
            host2.innerHTML = `<div style="color:#fff;font-size:12px;padding:6px 10px;">Falta planId de PayPal</div>`;
          return;
        }

        window.paypal
          .Buttons({
            ...common,
            createSubscription: (data, actions) => {
              return actions.subscription.create({
                plan_id: planId,
                ...(customId ? { custom_id: customId } : {}),
              });
            },
            onApprove: async (data, actions) => {
              try {
                const subscriptionID = data?.subscriptionID || null;

                let details = null;
                try {
                  if (actions?.subscription?.get && subscriptionID) {
                    details = await actions.subscription.get();
                  }
                } catch (e) {
                  console.warn("No se pudo obtener detalles de la suscripción:", e);
                }

                console.log("Suscripción PayPal aprobada:", {
                  subscriptionID,
                  details,
                });

                if (typeof onPaid === "function") {
                  await onPaid({
                    type: "subscription",
                    subscriptionID,
                    details,
                    planId,
                    customId: customId || null,
                  });
                } else {
                  alert(
                    "Suscripción creada. En breve se acreditarán tus jades automáticamente cuando el webhook confirme."
                  );
                }
              } catch (err) {
                console.error("Error en aprobación de suscripción PayPal:", err);
                alert("Ocurrió un error al confirmar la suscripción con PayPal.");
              }
            },
          })
          .render(`#${divId}`);

        return;
      }

      window.paypal
        .Buttons({
          ...common,
          createOrder: (data, actions) =>
            actions.order.create({
              purchase_units: [
                {
                  amount: { value: amount, currency_code: "USD" },
                  description,
                },
              ],
            }),
          onApprove: async (data, actions) => {
            try {
              const details = await actions.order.capture();
              console.log("Pago PayPal completado:", details);
              if (typeof onPaid === "function") {
                await onPaid({ type: "order", details });
              } else {
                alert(
                  "Pago completado con PayPal. En la siguiente versión marcaremos automáticamente tu plan como activo."
                );
              }
            } catch (err) {
              console.error("Error al capturar pago PayPal:", err);
              alert("Ocurrió un error al confirmar el pago con PayPal.");
            }
          },
        })
        .render(`#${divId}`);
    };

    const sdkParams =
      mode === "subscription"
        ? `client-id=${PAYPAL_CLIENT_ID}&currency=USD&vault=true&intent=subscription`
        : `client-id=${PAYPAL_CLIENT_ID}&currency=USD`;

    const sdkSrc = `https://www.paypal.com/sdk/js?${sdkParams}`;
    const existingScript = document.querySelector(`script[src="${sdkSrc}"]`);

    if (existingScript) {
      if (window.paypal) renderButtons();
      else existingScript.addEventListener("load", renderButtons);
      return;
    }

    const script = document.createElement("script");
    script.src = sdkSrc;
    script.async = true;
    script.onload = renderButtons;
    document.body.appendChild(script);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, divId, onPaid, description, mode, planId, customId]);

  return (
    <div className="mt-2 w-full flex justify-center">
      <div className="rounded-2xl bg-gradient-to-r from-indigo-700/80 via-fuchsia-600/80 to-indigo-800/80 px-4 py-2 shadow-lg">
        <div id={divId} className="min-w-[160px]" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// Modal de autenticación
// ---------------------------------------------------------
function AuthModal({ open, onClose }) {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localLoading, setLocalLoading] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLocalLoading(true);
    try {
      if (mode === "login") {
        await signInWithEmail(email, password);
      } else {
        await signUpWithEmail(email, password);
        alert("Cuenta creada. Si Supabase lo requiere, revisa tu correo para confirmar la cuenta.");
      }
      onClose();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLocalLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError("");
    setLocalLoading(true);
    try {
      await signInWithGoogle();
      onClose();
    } catch (err) {
      setError(err.message || String(err));
      setLocalLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-black/90 p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">
            {mode === "login" ? "Inicia sesión" : "Crea tu cuenta"}
          </h3>
          <button onClick={onClose} className="rounded-lg px-3 py-1 text-neutral-400 hover:bg-white/10">
            ✕
          </button>
        </div>

        <p className="mt-2 text-xs text-neutral-400">
          Usa tu correo o entra con Google para acceder al motor de producción visual.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label className="text-xs text-neutral-300">Correo</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
            />
          </div>
          <div>
            <label className="text-xs text-neutral-300">Contraseña</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
            />
          </div>

          {error && <p className="text-xs text-red-400 whitespace-pre-line">{error}</p>}

          <button
            type="submit"
            disabled={localLoading}
            className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {localLoading ? "Procesando..." : mode === "login" ? "Entrar" : "Registrarme"}
          </button>
        </form>

        <button
          onClick={handleGoogle}
          disabled={localLoading}
          className="mt-3 w-full rounded-2xl border border-white/20 py-2 text-sm text-white hover:bg-white/10 disabled:opacity-60"
        >
          Continuar con Google
        </button>

        <p className="mt-3 text-center text-xs text-neutral-400">
          {mode === "login" ? (
            <>
              ¿No tienes cuenta?{" "}
              <button type="button" onClick={() => setMode("register")} className="text-cyan-300 underline">
                Regístrate aquí
              </button>
            </>
          ) : (
            <>
              ¿Ya tienes cuenta?{" "}
              <button type="button" onClick={() => setMode("login")} className="text-cyan-300 underline">
                Inicia sesión
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// ✅ Modal simple: “Regístrate con Google” (solo para landing demo)
// ---------------------------------------------------------
function GoogleOnlyModal({ open, onClose, onGoogle }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-black/90 p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Regístrate con Google</h3>
          <button onClick={onClose} className="rounded-lg px-3 py-1 text-neutral-400 hover:bg-white/10">
            ✕
          </button>
        </div>

        <p className="mt-2 text-xs text-neutral-400">
          Para ejecutar el demo, crea tu cuenta con Google. Al entrar recibirás tus{" "}
          <span className="text-white font-semibold">10 jades gratis</span>.
        </p>

        <button
          onClick={onGoogle}
          className="mt-5 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white shadow-[0_0_35px_rgba(34,211,238,0.35)]"
        >
          Registrarme con Google
        </button>

        <button
          onClick={onClose}
          className="mt-3 w-full rounded-2xl border border-white/20 py-3 text-sm text-white hover:bg-white/10"
        >
          Cancelar
        </button>

        <p className="mt-3 text-[10px] text-neutral-500">
          IsabelaOS Studio usa pipeline propio y ejecución directa en GPU (no “apikeys” de otros generadores).
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// ✅ Collage de 5 videos (landing)
// ---------------------------------------------------------
function VideoCollage() {
  const vids = [
    "/gallery/video1.mp4?v=2",
    "/gallery/video2.mp4?v=2",
    "/gallery/video3.mp4?v=2",
    "/gallery/video4.mp4?v=2",
    "/gallery/video5.mp4?v=2",
  ];

  return (
    <div className="mt-5 grid gap-3 rounded-3xl border border-white/10 bg-black/35 p-4 shadow-[0_0_60px_rgba(34,211,238,0.08)]">
      <div className="grid gap-3 lg:grid-cols-12">
        {/* Square */}
        <div className="lg:col-span-4 overflow-hidden rounded-2xl border border-white/10 bg-black/60 aspect-square">
          <video src={vids[0]} autoPlay muted loop playsInline className="h-full w-full object-cover" />
        </div>

        {/* 9:16 vertical */}
        <div className="lg:col-span-3 overflow-hidden rounded-2xl border border-white/10 bg-black/60 aspect-[9/16]">
          <video src={vids[1]} autoPlay muted loop playsInline className="h-full w-full object-cover" />
        </div>

        {/* Wide */}
        <div className="lg:col-span-5 overflow-hidden rounded-2xl border border-white/10 bg-black/60 aspect-video">
          <video src={vids[2]} autoPlay muted loop playsInline className="h-full w-full object-cover" />
        </div>

        {/* 9:16 vertical */}
        <div className="lg:col-span-3 overflow-hidden rounded-2xl border border-white/10 bg-black/60 aspect-[9/16]">
          <video src={vids[3]} autoPlay muted loop playsInline className="h-full w-full object-cover" />
        </div>

        {/* Square */}
        <div className="lg:col-span-9 overflow-hidden rounded-2xl border border-white/10 bg-black/60 aspect-[16/9]">
          <video src={vids[4]} autoPlay muted loop playsInline className="h-full w-full object-cover" />
        </div>
      </div>

      <div className="mt-2 text-[10px] text-neutral-500">
        Clips en autoplay (demo). Los archivos se cargan desde /gallery/*.mp4.
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// Dashboard: pestaña "Suscribirse" (antes estaba en el home)
// ---------------------------------------------------------
function SubscribePanel({ userStatus }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-black/60 p-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-white">Suscribirse</h2>
        <p className="text-xs text-neutral-400">
          Suscripción mensual. Al activarse, el sistema acreditará tus jades automáticamente por webhook.
        </p>
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-xs text-neutral-300">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            Estado:{" "}
            <span className="font-semibold text-white">
              {userStatus.loading ? "..." : userStatus.subscription_status}
            </span>
          </span>

          <span className="text-neutral-400">
            Plan:{" "}
            <span className="font-semibold text-white">
              {userStatus.loading ? "..." : userStatus.plan || "none"}
            </span>
          </span>

          <span className="text-neutral-400">
            Jades:{" "}
            <span className="font-semibold text-white">
              {userStatus.loading ? "..." : userStatus.jades ?? 0}
            </span>
          </span>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-3xl border border-white/10 bg-black/40 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-white">Basic</h3>
            <span className="text-sm text-neutral-300">$19/mes</span>
          </div>
          <p className="mt-2 text-xs text-neutral-400">Ideal para creators en beta. Incluye jades mensuales.</p>

          <div className="mt-4">
            {!PAYPAL_PLAN_ID_BASIC ? (
              <div className="rounded-2xl border border-yellow-400/30 bg-yellow-500/10 p-3 text-xs text-yellow-200">
                Falta VITE_PAYPAL_PLAN_ID_BASIC en tu .env
              </div>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await startPaypalSubscription("basic");
                  } catch (e) {
                    alert(e?.message || "No se pudo iniciar la suscripción.");
                  }
                }}
                className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white"
              >
                Suscribirme con PayPal
              </button>
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-black/40 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-white">Pro</h3>
            <span className="text-sm text-neutral-300">$39/mes</span>
          </div>
          <p className="mt-2 text-xs text-neutral-400">Más jades y potencia para producción constante.</p>

          <div className="mt-4">
            {!PAYPAL_PLAN_ID_PRO ? (
              <div className="rounded-2xl border border-yellow-400/30 bg-yellow-500/10 p-3 text-xs text-yellow-200">
                Falta VITE_PAYPAL_PLAN_ID_PRO en tu .env
              </div>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await startPaypalSubscription("pro");
                  } catch (e) {
                    alert(e?.message || "No se pudo iniciar la suscripción.");
                  }
                }}
                className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white"
              >
                Suscribirme con PayPal
              </button>
            )}
          </div>
        </div>
      </div>

      <p className="mt-4 text-[10px] text-neutral-500">
        Nota: si el webhook tarda unos segundos, refresca la página. El crédito de jades se aplica cuando PayPal confirma
        el evento.
      </p>
    </section>
  );
}

// ---------------------------------------------------------
// Dashboard (logueado)
// ---------------------------------------------------------
function DashboardView() {
  const { user, isAdmin, signOut } = useAuth();
  const [appViewMode, setAppViewMode] = useState("generator");

  const [userStatus, setUserStatus] = useState({
    loading: true,
    plan: null,
    subscription_status: "none",
    jades: 0,
  });

  const fetchUserStatus = async () => {
    if (!user?.id) return;
    try {
      const auth = await getAuthHeadersGlobal();

      const r = await fetch(`/api/user-status?user_id=${encodeURIComponent(user.id)}`, {
        headers: { ...auth },
      });

      const data = await r.json().catch(() => null);
      if (!r.ok || !data?.ok) throw new Error(data?.error || "user-status error");

      setUserStatus({
        loading: false,
        plan: data.plan,
        subscription_status: data.subscription_status,
        jades: data.jades ?? 0,
      });
    } catch (e) {
      console.warn("Error user-status:", e);
      setUserStatus((prev) => ({ ...prev, loading: false }));
    }
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
    const r = await fetch("/api/jades-spend", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({
        user_id: user.id,
        amount: Number(amount),
        reason: reason || "spend",
      }),
    });

    const data = await r.json().catch(() => null);
    if (!r.ok || !data?.ok) throw new Error(data?.error || "No se pudo descontar jades.");

    await fetchUserStatus();
    return data;
  };

  const userPlanLabel = useMemo(() => {
    if (userStatus.loading) return "Cargando...";
    if (userStatus.subscription_status === "active" && userStatus.plan) {
      return `Usuario beta – Plan ${userStatus.plan} activo (sin límite)`;
    }
    return "Usuario beta – Plan Basic activo (sin límite)";
  }, [userStatus.loading, userStatus.subscription_status, userStatus.plan]);

  const handleContact = () => {
    const subject = encodeURIComponent("Soporte IsabelaOS Studio");
    const body = encodeURIComponent("Hola, necesito ayuda con IsabelaOS Studio.\n\n(Escribe aquí tu mensaje)");
    window.location.href = `mailto:contacto@isabelaos.com?subject=${subject}&body=${body}`;
  };

  return (
    <div
      className="min-h-screen w-full text-white"
      style={{
        background:
          "radial-gradient(1200px_800px_at_110%-10%,rgba(255,23,229,0.12),transparent_60%),radial-gradient(900px_600px_at-10%_0%,rgba(0,229,255,0.10),transparent_50%),#06070B",
      }}
    >
      <header className="border-b border-white/10 bg-black/60 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500 to-fuchsia-500 text-xs font-bold">
              io
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">
                isabelaOs <span className="text-xs text-neutral-400">Studio</span>
              </div>
              <div className="text-[10px] text-neutral-500">Panel del creador · Beta</div>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <span className="hidden sm:inline text-neutral-300">
              {user?.email} {isAdmin ? "· admin" : ""}
            </span>

            <div className="hidden md:flex items-center gap-2 rounded-2xl border border-white/10 bg-black/60 px-3 py-1.5">
              <span className="text-[10px] text-neutral-400">{userPlanLabel}</span>
              <span className="mx-1 h-3 w-px bg-white/10" />
              <span className="text-[11px] text-neutral-300">
                Jades:{" "}
                <span className="font-semibold text-white">{userStatus.loading ? "..." : userStatus.jades ?? 0}</span>
              </span>
            </div>

            <button
              onClick={handleContact}
              className="rounded-xl border border-white/20 px-3 py-1.5 text-xs text-white hover:bg-white/10"
            >
              Contacto
            </button>
            <button
              onClick={signOut}
              className="rounded-xl border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-10">
        <div className="mb-4 md:hidden">
          <div className="mb-3 rounded-2xl border border-white/10 bg-black/60 px-4 py-2 text-[11px] text-neutral-300">
            <div className="flex items-center justify-between gap-2">
              <span className="text-neutral-400">{userPlanLabel}</span>
              <span className="font-semibold text-white">Jades: {userStatus.loading ? "..." : userStatus.jades ?? 0}</span>
            </div>
          </div>

          <p className="text-[11px] font-semibold text-neutral-300 mb-2">Navegación</p>
          <div className="flex flex-wrap gap-2 text-xs">
            {[
              ["generator", "Motor de imagen"],
              ["img2video", "Imagen → Video"],
              ["avatars", "🧬 Avatares (LoRA)"], // ✅ NUEVO
              ["library", "Biblioteca"],
              ["montaje", "🧩 Montaje IA"],
              ["subscribe", "Suscribirse"],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setAppViewMode(key)}
                className={`rounded-2xl px-3 py-1.5 ${
                  appViewMode === key
                    ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                    : "bg-white/5 text-neutral-200 hover:bg-white/10"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <section className="flex gap-6">
          <aside className="hidden md:flex w-56 flex-col rounded-3xl border border-white/10 bg-black/60 p-4 text-xs">
            <p className="text-[11px] font-semibold text-neutral-300 mb-3">Navegación</p>

            {[
              ["generator", "Motor de imagen"],
              ["img2video", "Transformación Imagen → Video"],
              ["avatars", "🧬 Avatares (LoRA)"], // ✅ NUEVO
              ["library", "Biblioteca de producción"],
              ["montaje", "🧩 Montaje IA"],
              ["subscribe", "Suscribirse"],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setAppViewMode(key)}
                className={`mb-2 w-full rounded-2xl px-3 py-2 text-left ${
                  appViewMode === key
                    ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                    : "bg-white/5 text-neutral-200 hover:bg-white/10"
                }`}
              >
                {label}
              </button>
            ))}
          </aside>

          <div className="flex-1 space-y-6">
            <div>
              <h1 className="text-xl font-semibold text-white">Panel del creador</h1>
              <p className="mt-1 text-xs text-neutral-400">
                Genera, revisa, descarga y administra resultados desde un solo sistema conectado a GPU.
              </p>
            </div>

            {appViewMode === "generator" && <generatepanel userStatus={userStatus} />}
            {appViewMode === "img2video" && <Img2VideoPanel userStatus={userStatus} spendJades={spendJades} />}
            {appViewMode === "avatars" && <AvatarStudioPanel userStatus={userStatus} />} {/* ✅ NUEVO */}
            {appViewMode === "library" && <LibraryView />}
            {appViewMode === "montaje" && <MontajeIAPanel userStatus={userStatus} />}
            {appViewMode === "subscribe" && <SubscribePanel userStatus={userStatus} />}
          </div>
        </section>
      </main>
    </div>
  );
}

// ---------------------------------------------------------
// Landing: sección de planes
// ---------------------------------------------------------
function PricingSection({ onOpenAuth }) {
  const features = useMemo(
    () => ({
      basic: [
        "Acceso al motor en la web",
        `Incluye ${PLANS?.basic?.included_jades ?? 100} jades / mes`,
        "Biblioteca personal (historial y descargas)",
        "Actualizaciones del motor (beta)",
        "Soporte básico por contacto",
      ],
      pro: [
        "Todo lo de Basic",
        `Incluye ${PLANS?.pro?.included_jades ?? 300} jades / mes`,
        "Más capacidad de generación (prioridad)",
        "Acceso anticipado a nuevas funciones",
        "Soporte prioritario (beta)",
      ],
    }),
    []
  );

  const estimate = (includedJades = 0) => {
    const cImg = Number(COSTS?.img_prompt ?? 1);
    const cVidPrompt = Number(COSTS?.vid_prompt ?? 10);
    const cImg2Vid = Number(COSTS?.vid_img2vid ?? 12);

    const images = cImg > 0 ? Math.floor(includedJades / cImg) : 0;
    const videosPrompt = cVidPrompt > 0 ? Math.floor(includedJades / cVidPrompt) : 0;
    const videosImg2Vid = cImg2Vid > 0 ? Math.floor(includedJades / cImg2Vid) : 0;

    return { images, videosPrompt, videosImg2Vid };
  };

  const estBasic = estimate(PLANS?.basic?.included_jades ?? 100);
  const estPro = estimate(PLANS?.pro?.included_jades ?? 300);

  return (
    <section id="planes" className="mt-16">
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-white">Planes</h3>
            <p className="mt-1 text-xs text-neutral-400">
              Suscripción mensual. Cancela cuando quieras. (Los jades se cargan mensualmente.)
            </p>
          </div>

          <button
            onClick={onOpenAuth}
            className="rounded-2xl border border-white/15 bg-white/5 px-4 py-2 text-xs text-white hover:bg-white/10"
          >
            Ya tengo cuenta → Iniciar sesión
          </button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-black/40 p-6">
            <div className="pointer-events-none absolute -inset-10 -z-10 bg-gradient-to-br from-cyan-500/15 via-transparent to-fuchsia-500/10 blur-2xl" />

            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-white">Plan Basic</p>
                <p className="mt-1 text-[11px] text-neutral-400">
                  Para creadores que quieren entrar al motor y producir de forma constante.
                </p>
              </div>

              <div className="text-right">
                <p className="text-2xl font-semibold text-white">
                  ${PLANS?.basic?.price_usd ?? 19}
                  <span className="text-xs text-neutral-400">/mes</span>
                </p>
                <p className="text-[10px] text-neutral-500">{PLANS?.basic?.included_jades ?? 100} jades incluidos</p>
              </div>
            </div>

            <ul className="mt-4 space-y-2 text-[12px] text-neutral-200">
              {features.basic.map((t) => (
                <li key={t} className="flex gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-cyan-300" />
                  <span className="text-neutral-300">{t}</span>
                </li>
              ))}
            </ul>

            <div className="mt-4 rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-[11px] text-neutral-300">
              <div className="text-neutral-400">Con los jades incluidos puedes generar aprox:</div>
              <div className="mt-1">
                • <span className="text-white font-semibold">{estBasic.images}</span> imágenes
              </div>
              <div>
                • <span className="text-white font-semibold">{estBasic.videosPrompt}</span> videos (desde prompt)
              </div>
              <div>
                • <span className="text-white font-semibold">{estBasic.videosImg2Vid}</span> videos (imagen → video)
              </div>
            </div>

            <div className="mt-5">
              <button
                onClick={onOpenAuth}
                className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white"
              >
                Inicia sesión para suscribirte
              </button>
              <p className="mt-2 text-[10px] text-neutral-500 text-center">
                (El pago solo se realiza dentro de tu cuenta para poder asignar plan y jades al usuario.)
              </p>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-3xl border border-fuchsia-400/25 bg-black/40 p-6">
            <div className="pointer-events-none absolute -inset-10 -z-10 bg-gradient-to-br from-fuchsia-500/18 via-transparent to-violet-500/18 blur-2xl" />

            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-fuchsia-400/30 bg-fuchsia-500/10 px-3 py-1 text-[10px] font-semibold text-fuchsia-200">
                  Recomendado
                </div>
                <p className="mt-2 text-sm font-semibold text-white">Plan Pro</p>
                <p className="mt-1 text-[11px] text-neutral-400">
                  Para usuarios que quieren más jades, más potencia y prioridad en generación.
                </p>
              </div>

              <div className="text-right">
                <p className="text-2xl font-semibold text-white">
                  ${PLANS?.pro?.price_usd ?? 39}
                  <span className="text-xs text-neutral-400">/mes</span>
                </p>
                <p className="text-[10px] text-neutral-500">{PLANS?.pro?.included_jades ?? 300} jades incluidos</p>
              </div>
            </div>

            <ul className="mt-4 space-y-2 text-[12px] text-neutral-200">
              {features.pro.map((t) => (
                <li key={t} className="flex gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-fuchsia-300" />
                  <span className="text-neutral-300">{t}</span>
                </li>
              ))}
            </ul>

            <div className="mt-4 rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-[11px] text-neutral-300">
              <div className="text-neutral-400">Con los jades incluidos puedes generar aprox:</div>
              <div className="mt-1">
                • <span className="text-white font-semibold">{estPro.images}</span> imágenes
              </div>
              <div>
                • <span className="text-white font-semibold">{estPro.videosPrompt}</span> videos (desde prompt)
              </div>
              <div>
                • <span className="text-white font-semibold">{estPro.videosImg2Vid}</span> videos (imagen → video)
              </div>
            </div>

            <div className="mt-5">
              <button
                onClick={onOpenAuth}
                className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white"
              >
                Inicia sesión para suscribirte
              </button>
              <p className="mt-2 text-[10px] text-neutral-500 text-center">
                (El pago solo se realiza dentro de tu cuenta para poder asignar plan y jades al usuario.)
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------
// Landing (no sesión) + demo
// ---------------------------------------------------------
function LandingView({ onOpenAuth, onStartDemo, onOpenContact, onOpenAbout }) {
  // ✅ NUEVO: demo prompt en landing (y forzar Google modal)
  const [demoPrompt, setDemoPrompt] = useState("Cinematic portrait, ultra detailed, soft light, 8k");

  return (
    <div
      className="min-h-screen w-full text-white"
      style={{
        background:
          "radial-gradient(1200px_800px_at_110%-10%,rgba(255,23,229,0.22),transparent_60%),radial-gradient(900px_600px_at-10%_0%,rgba(0,229,255,0.22),transparent_55%),radial-gradient(700px_700px_at_50%_120%,rgba(140,90,255,0.5),transparent_60%),#05060A",
      }}
    >
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500 to-fuchsia-500 text-xs font-bold shadow-lg shadow-cyan-500/40">
              io
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">
                isabelaOs <span className="text-xs text-neutral-400">Studio</span>
              </div>
              <div className="text-[10px] text-neutral-500">Motor de producción visual</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => scrollToId("planes")}
              className="hidden sm:inline rounded-xl border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10"
            >
              Planes
            </button>

            {/* ✅ NUEVO */}
            <button
              onClick={onOpenAbout}
              className="hidden sm:inline rounded-xl border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10"
            >
              Sobre nosotros
            </button>

            {/* ✅ Antes hacía scroll a #contacto. Ahora abre "página" (vista) Contacto */}
            <button
              onClick={onOpenContact}
              className="hidden sm:inline rounded-xl border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10"
            >
              Contacto
            </button>

            <button
              onClick={onOpenAuth}
              className="rounded-xl border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10"
            >
              Iniciar sesión / Registrarse
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-10">
        <section className="grid gap-10 lg:grid-cols-[1.35fr_1fr]">
          <div>
            {/* ✅ ELIMINADO: BETA PRIVADA */}

            <h1 className="mt-3 text-4xl font-semibold leading-tight md:text-5xl">
              Produce contenido visual con IA{" "}
              <span className="block bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-violet-400 bg-clip-text text-transparent">
                como un sistema, no como un experimento.
              </span>
            </h1>

            <div className="mt-3 h-[2px] w-40 rounded-full bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-transparent shadow-[0_0_20px_rgba(168,85,247,0.7)]" />

            {/* ✅ Texto más corto en Home (lo largo se movió a Sobre nosotros) */}
            <p className="mt-4 max-w-xl text-sm text-neutral-300">
              Motor de producción visual con IA para creadores y equipos que necesitan, consistencia y control creativo.
            </p>

            {/* ✅ Próximamente */}
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/80">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
                Próximamente: Voz a video
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/80">
                <span className="h-1.5 w-1.5 rounded-full bg-fuchsia-300" />
                Próximamente: Creación de avatares
              </span>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-4">
              <button
                onClick={() => {
                  // ✅ ahora “probar el motor” abre el demo de prompt (y fuerza Google al generar)
                  scrollToId("demo-box");
                }}
                className="rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-3 text-sm font-semibold text-white shadow-[0_0_35px_rgba(34,211,238,0.45)] hover:shadow-[0_0_40px_rgba(236,72,153,0.6)] transition-shadow"
              >
                Probar el motor (demo)
              </button>

              <button
                onClick={onOpenAbout}
                className="rounded-2xl border border-white/20 bg-white/5 px-6 py-3 text-sm font-semibold text-white hover:bg-white/10"
              >
                Ver sobre nosotros
              </button>

              <p className="max-w-xs text-[11px] text-neutral-400">
                Escribe tu prompt y ejecuta el demo. Al generar, te pedirá registrarte con Google.
              </p>
            </div>
          </div>

          {/* ✅ Cuadro demo más grande + fondo menos difuminado */}
          <div id="demo-box" className="relative order-first lg:order-last">
            <div className="pointer-events-none absolute -inset-8 -z-10 rounded-[32px] bg-gradient-to-br from-cyan-500/18 via-transparent to-fuchsia-500/25 blur-3xl" />

            {/* Neon rays */}
            <div className="pointer-events-none absolute inset-0 -z-10 opacity-70">
              <div className="absolute -top-24 left-1/3 h-96 w-[2px] rotate-12 bg-gradient-to-b from-cyan-400/0 via-cyan-300/60 to-fuchsia-400/0 blur-[0.5px]" />
              <div className="absolute -top-10 left-[65%] h-80 w-[2px] -rotate-12 bg-gradient-to-b from-fuchsia-400/0 via-fuchsia-300/55 to-yellow-300/0 blur-[0.5px]" />
              <div className="absolute bottom-0 left-[15%] h-72 w-[2px] rotate-[18deg] bg-gradient-to-b from-yellow-300/0 via-yellow-200/45 to-cyan-300/0 blur-[0.5px]" />
            </div>

            {/* Blurred gallery images behind (menos blur, un poco más visibles) */}
            <div className="pointer-events-none absolute inset-0 -z-10 opacity-70">
              {["img1.png", "img2.png", "img3.png", "img4.png"].map((p, i) => (
                <div
                  key={p}
                  className="absolute rounded-3xl border border-white/10"
                  style={{
                    width: i % 2 === 0 ? 360 : 420,
                    height: i % 2 === 0 ? 240 : 260,
                    left: i === 0 ? "-35px" : i === 1 ? "50%" : i === 2 ? "6%" : "56%",
                    top: i === 0 ? "16%" : i === 1 ? "6%" : i === 2 ? "64%" : "54%",
                    transform: `rotate(${i === 0 ? -10 : i === 1 ? 8 : i === 2 ? 10 : -6}deg)`,
                    backgroundImage: `url(/gallery/${p}?v=2)`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    filter: "blur(7px)", // ✅ antes 10px
                    opacity: 0.55, // ✅ más visible
                  }}
                />
              ))}
            </div>

            <h2 className="text-sm font-semibold text-white mb-3">Demo · Genera una imagen (prompt positivo)</h2>

            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-black/45 p-6 backdrop-blur-md shadow-xl">
              <div className="pointer-events-none absolute -inset-12 -z-10 bg-gradient-to-br from-cyan-500/16 via-transparent to-fuchsia-500/16 blur-3xl" />

              <textarea
                className="mt-1 h-36 w-full resize-none rounded-2xl bg-black/60 px-4 py-3 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
                value={demoPrompt}
                onChange={(e) => setDemoPrompt(e.target.value)}
                placeholder="Escribe tu prompt positivo..."
              />

              <button
                onClick={() => {
                  saveDemoPrompt(demoPrompt);
                  onStartDemo(); // ✅ ahora onStartDemo abre modal Google (definido en Root App)
                }}
                disabled={!demoPrompt.trim()}
                className="mt-4 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                Generar imagen (demo)
              </button>

              <div className="mt-3 text-[11px] text-neutral-400">
                Al generar te pedirá registrarte con Google y entrarás directo al panel con{" "}
                <span className="text-white font-semibold">10 jades gratis</span>.
              </div>
            </div>

            <p className="mt-3 text-[10px] text-neutral-500">
              IsabelaOS Studio · pipeline propio · ejecución directa en GPU · desarrollado en Guatemala.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------
            Videos en Home (entre texto y planes) ✅ collage 5
           --------------------------------------------------------- */}
        <section className="mt-12">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-neutral-400">
                Demo real · Generado desde el motor
              </p>
              <h3 className="mt-1 text-xl font-semibold text-white">
                Videos de prueba (pipeline actual)
              </h3>
              <p className="mt-1 max-w-2xl text-xs text-neutral-400">
                Estos clips están generados por el sistema. La prioridad ahora es estabilizar el flujo, mejorar
                velocidad y pulir la calidad final del render.
              </p>
            </div>

            <div className="mt-3 sm:mt-0">
              <button
                onClick={() => scrollToId("demo-box")}
                className="rounded-xl border border-white/20 bg-white/5 px-4 py-2 text-xs text-white hover:bg-white/10"
              >
                Probar el motor ahora
              </button>
            </div>
          </div>

          {/* ✅ Wrapper para que se vea un poco más compacto visualmente */}
          <div className="mt-5 rounded-3xl border border-white/10 bg-white/5 p-4">
            {/* TODO (si no hace autoplay): en VideoCollage asegúrate que cada <video> tenga:
                autoPlay muted loop playsInline preload="metadata"
            */}
            <VideoCollage />
          </div>
        </section>

        {/* ---------------------------------------------------------
            NUEVO: Opiniones (testimonios)
           --------------------------------------------------------- */}
        <section className="mt-12">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-neutral-400">
                Opiniones
              </p>
              <h3 className="mt-1 text-xl font-semibold text-white">
                Lo que dicen los primeros usuarios
              </h3>
              <p className="mt-1 max-w-2xl text-xs text-neutral-400">
                A medida que escalamos, iremos agregando más feedback real de testers y creadores.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {[
              {
                name: "Early Tester",
                text: "El flujo se siente como una herramienta real, no como un juguete. Me gustó la consistencia del estilo.",
              },
              {
                name: "Creador (beta)",
                text: "Lo mejor es tener todo en un solo lugar: prompt → render → biblioteca. Eso ahorra tiempo.",
              },
              {
                name: "Equipo creativo",
                text: "La idea de voz a video y avatares es justo lo que necesitamos para escalar contenido.",
              },
            ].map((t, idx) => (
              <div key={idx} className="rounded-3xl border border-white/10 bg-black/35 p-5 backdrop-blur-md">
                <div className="text-sm font-semibold text-white/90">{t.name}</div>
                <div className="mt-2 text-sm text-white/70 leading-relaxed">{t.text}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ✅ Planes (se queda en Home y hasta abajo como querés) */}
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


// ---------------------------------------------------------
// Sobre Nosotros (vista)
// ---------------------------------------------------------
function AboutView({ onBackHome }) {
  const videoRef = useRef(null);
  const [soundOn, setSoundOn] = useState(false);

  const enableSound = async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      v.muted = false;
      v.volume = 1;
      await v.play();
      setSoundOn(true);
    } catch (e) {
      console.log(e);
      // Si el navegador bloquea, al menos el usuario puede darle play manual
    }
  };

  return (
    <div
      className="min-h-screen w-full text-white"
      style={{
        background:
          "radial-gradient(1200px_800px_at_110%-10%,rgba(255,23,229,0.22),transparent_60%),radial-gradient(900px_600px_at-10%_0%,rgba(0,229,255,0.22),transparent_55%),radial-gradient(700px_700px_at_50%_120%,rgba(140,90,255,0.5),transparent_60%),#05060A",
      }}
    >
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500 to-fuchsia-500 text-xs font-bold shadow-lg shadow-cyan-500/40">
              io
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">
                isabelaOs <span className="text-xs text-neutral-400">Studio</span>
              </div>
              <div className="text-[10px] text-neutral-500">Sobre nosotros</div>
            </div>
          </div>

          <button
            onClick={onBackHome}
            className="rounded-xl border border-white/20 bg-white/5 px-4 py-1.5 text-xs text-white hover:bg-white/10"
          >
            Volver a la página principal
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-10">
        {/* ✅ Video arriba de todo */}
        <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
          {/* ✅ Subirlo a: public/gallery/video10.mp4 */}
          <div className="relative">
            <video
              ref={videoRef}
              className="w-full h-[360px] md:h-[460px] object-cover rounded-2xl border border-white/10 bg-black/40"
              src="/gallery/video10.mp4"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              controls={soundOn} // opcional: muestra controles después de activar audio
            />

            {/* Botón overlay para activar audio (los navegadores requieren interacción) */}
            {!soundOn && (
              <button
                onClick={enableSound}
                className="absolute bottom-4 left-4 rounded-2xl bg-black/60 border border-white/15 px-4 py-2 text-xs text-white hover:bg-black/70"
              >
                🔊 Activar audio
              </button>
            )}

            {/* Mini nota opcional */}
            {!soundOn && (
              <div className="absolute bottom-4 right-4 hidden sm:block text-[10px] text-white/60 bg-black/50 border border-white/10 rounded-xl px-3 py-2">
                El audio se activa al tocar el botón
              </div>
            )}
          </div>
        </section>

        {/* ✅ Info completa aquí */}
        <section className="mt-8">
          <h1 className="text-3xl font-semibold text-white">Sobre nosotros</h1>

          <p className="mt-4 max-w-3xl text-sm text-neutral-300">
            IsabelaOS Studio es un <strong>motor de producción visual con IA</strong> desarrollado en Guatemala,
            diseñado para creadores, estudios y equipos que necesitan velocidad, consistencia y control creativo.
          </p>

          <p className="mt-3 max-w-3xl text-sm text-neutral-300">
            No se trata solo de generar imágenes o videos, sino de construir resultados repetibles dentro de un flujo
            de producción visual. <strong>Pipeline propio</strong> (infraestructura + workers + render) ejecutado
            directamente en GPU: <strong>no dependemos de “apikeys” de otros generadores</strong>.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-3xl border border-white/10 bg-black/35 p-5 backdrop-blur-md">
              <div className="text-sm font-semibold text-white/90">Estamos escalando</div>
              <p className="mt-2 text-sm text-white/70 leading-relaxed">
                Estamos en etapa de crecimiento: mejorando velocidad, estabilidad del render y preparando nuevos módulos
                para creadores que necesitan resultados consistentes y un flujo de trabajo real.
              </p>
            </div>

            <div className="rounded-3xl border border-white/10 bg-black/35 p-5 backdrop-blur-md">
              <div className="text-sm font-semibold text-white/90">Lo que viene</div>
              <ul className="mt-2 text-sm text-white/70 leading-relaxed list-disc pl-5">
                <li>Voz a Video (próximamente)</li>
                <li>Creación de Avatares (próximamente)</li>
              </ul>
            </div>
          </div>

          <div className="mt-8">
            <button
              onClick={onBackHome}
              className="rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-3 text-sm font-semibold text-white shadow-[0_0_35px_rgba(34,211,238,0.45)] hover:shadow-[0_0_40px_rgba(236,72,153,0.6)] transition-shadow"
            >
              Regresar a la página principal
            </button>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-black/30">
        <div className="mx-auto max-w-6xl px-4 py-6 text-center text-[11px] text-neutral-400">
          IsabelaOS 2025 creado por Stalling Technologic Cobán, Alta Verapaz.
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------
// Root App
// ---------------------------------------------------------
export default function App() {
  const { user, signInWithGoogle } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [demoMode, setDemoMode] = useState(false);

  // ✅ NUEVO: navegación simple en landing
  const [landingPage, setLandingPage] = useState("home"); // "home" | "contact" | "about"

  // ✅ NUEVO: modal Google-only para el demo
  const [googleModalOpen, setGoogleModalOpen] = useState(false);

  if (user) return <DashboardView />;

  return (
    <>
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />

      {/* ✅ NUEVO: modal dedicado */}
      <GoogleOnlyModal
        open={googleModalOpen}
        onClose={() => setGoogleModalOpen(false)}
        onGoogle={async () => {
          try {
            await signInWithGoogle();
            setGoogleModalOpen(false);
          } catch (e) {
            alert(e?.message || "No se pudo iniciar con Google.");
          }
        }}
      />

      {demoMode ? (
        <div className="min-h-screen bg-neutral-950 text-white">
          <div className="mx-auto max-w-6xl px-4 py-8">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">IsabelaOS Studio</p>
                <p className="text-[11px] text-neutral-400">Demo del motor</p>
              </div>
              <button
                onClick={() => setDemoMode(false)}
                className="rounded-2xl border border-white/20 px-4 py-2 text-xs hover:bg-white/10"
              >
                Volver
              </button>
            </div>

            <CreatorPanel isDemo={true} onAuthRequired={() => setAuthOpen(true)} />
          </div>
        </div>
      ) : (
        <>
          {landingPage === "home" && (
            <LandingView
              onOpenAuth={() => setAuthOpen(true)}
              onStartDemo={() => setGoogleModalOpen(true)} // ✅ CAMBIO: ahora el demo de landing abre Google-only
              onOpenContact={() => setLandingPage("contact")}
              onOpenAbout={() => setLandingPage("about")}
            />
          )}

          {landingPage === "contact" && (
            <ContactView onBack={() => setLandingPage("home")} />
          )}

          {landingPage === "about" && (
            <AboutView onBackHome={() => setLandingPage("home")} />
          )}
        </>
      )}
    </>
  );
}
