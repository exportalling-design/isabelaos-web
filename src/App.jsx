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
  // Imagen
  // ---------------------------------------------------------
function CreatorPanel({ isDemo = false, onAuthRequired }) {
  const { user } = useAuth();

  const userLoggedIn = !isDemo && !!user;

  const [prompt, setPrompt] = useState("Cinematic portrait, ultra detailed, soft light, 8k");
  const [negative, setNegative] = useState("blurry, low quality, deformed, watermark, text");
  const [width, setWidth] = useState(1080);
  const [height, setHeight] = useState(1920);
  const [steps, setSteps] = useState(22);
  const [skinMode, setSkinMode] = useState("standard");

  const [status, setStatus] = useState("IDLE");
  const [statusText, setStatusText] = useState("Listo para ejecutar el motor.");
  const [imageB64, setImageB64] = useState(null);
  const [error, setError] = useState("");

  const [dailyCount, setDailyCount] = useState(0);
  const [demoCount, setDemoCount] = useState(0);

  const [profilePlan, setProfilePlan] = useState("free");
  const [profileJades, setProfileJades] = useState(0);

  // ---------------------------------------------------------
  // Avatares LoRA
  // ---------------------------------------------------------
  const [avatars, setAvatars] = useState([]);
  const [avatarsLoading, setAvatarsLoading] = useState(false);
  const [selectedAvatarId, setSelectedAvatarId] = useState("");

  const selectedAvatar =
    avatars.find((a) => String(a.id) === String(selectedAvatarId)) || null;

  // ---------------------------------------------------------
  // Prefill prompt desde landing demo
  // ---------------------------------------------------------
  useEffect(() => {
    if (!userLoggedIn) return;
    try {
      const p = readDemoPrompt();
      if (p?.trim()) {
        setPrompt(p);
        clearDemoPrompt();
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLoggedIn]);

  // ---------------------------------------------------------
  // Optimizador de prompt
  // ---------------------------------------------------------
  const [useOptimizer, setUseOptimizer] = useState(false);
  const [optStatus, setOptStatus] = useState("IDLE");
  const [optError, setOptError] = useState("");
  const [optimizedPrompt, setOptimizedPrompt] = useState("");
  const [optimizedNegative, setOptimizedNegative] = useState("");
  const [optSource, setOptSource] = useState({ prompt: "", negative: "" });

  useEffect(() => {
    setOptError("");
  }, [prompt, negative]);

  const isOptStale =
    optStatus === "READY" &&
    (optSource.prompt !== prompt || optSource.negative !== negative);

  async function runOptimizeNow() {
    setOptError("");
    setOptStatus("OPTIMIZING");

    try {
      const r = await fetch("/api/optimize-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
         prompt,
         negative_prompt: negative,
         mode: "image",
         skin_mode: skinMode || "standard",
         has_anchor: !!selectedAvatarId,
         image_model:
           skinMode === "natural" && !!selectedAvatarId
           ? "realistic_vision"
           : "flux",
    }),
  });

      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        throw new Error(j?.error || "Error optimizando prompt.");
      }

      const op = String(j.optimizedPrompt || "").trim();
      const on = String(j.optimizedNegative || "").trim();

      setOptimizedPrompt(op);
      setOptimizedNegative(on);
      setOptSource({ prompt, negative });
      setOptStatus("READY");
      setUseOptimizer(true);

      return { ok: true, optimizedPrompt: op, optimizedNegative: on };
    } catch (e) {
      setOptStatus("ERROR");
      setOptError(e?.message || String(e));
      return { ok: false, error: e?.message || String(e) };
    }
  }

  function getEffectivePrompts() {
    const canUseOpt = useOptimizer && optimizedPrompt && !isOptStale;
    return {
      finalPrompt: canUseOpt ? optimizedPrompt : prompt,
      finalNegative: canUseOpt ? (optimizedNegative || "") : negative,
      usingOptimized: !!canUseOpt,
    };
  }

    async function getAvatarAnchors(avatarId) {
    if (!avatarId) return [];

    try {
      const authHeaders = await getAuthHeadersGlobal();

      const r = await fetch(
        `/api/avatars-get-anchor-urls?avatar_id=${encodeURIComponent(avatarId)}`,
        {
          method: "GET",
          headers: {
            ...authHeaders,
          },
        }
      );

      const j = await r.json().catch(() => null);

      if (!r.ok || !j?.ok) {
        throw new Error(j?.error || "No se pudieron cargar las anchors del avatar.");
      }

      return Array.isArray(j.anchors) ? j.anchors : [];
    } catch (e) {
      console.error("Error cargando avatar anchors:", e);
      return [];
    }
  }

  // ---------------------------------------------------------
  // Cargar profile desde Supabase
  // ---------------------------------------------------------
  useEffect(() => {
    if (!userLoggedIn) {
      setProfilePlan("free");
      setProfileJades(0);
      return;
    }

    (async () => {
      try {
        const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
        const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

        if (!SUPABASE_URL || !SUPABASE_ANON) {
          console.warn("Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");
          return;
        }

        const authHeaders = await getAuthHeadersGlobal();
        const url =
          `${SUPABASE_URL.replace(/\/$/, "")}` +
          `/rest/v1/profiles?id=eq.${user.id}&select=plan,jade_balance`;

        const r = await fetch(url, {
          headers: {
            apikey: SUPABASE_ANON,
            ...authHeaders,
          },
        });

        const rows = await r.json().catch(() => []);
        const row = Array.isArray(rows) ? rows[0] : null;

        const plan = String(row?.plan || "free").toLowerCase();
        const jades = Number(row?.jade_balance || 0);

        setProfilePlan(plan);
        setProfileJades(jades);
      } catch (e) {
        console.error("Error cargando profiles:", e);
      }
    })();
  }, [userLoggedIn, user?.id]);

  const isFreeUser = !profilePlan || profilePlan === "free" || profilePlan === "none";
  const hasPaidAccess = !isFreeUser || profileJades > 0;

  // ---------------------------------------------------------
  // Cargar avatares desde /api/avatars-list
  // ---------------------------------------------------------
  useEffect(() => {
    if (!userLoggedIn || !user?.id || isDemo) {
      setAvatars([]);
      setSelectedAvatarId("");
      return;
    }

    (async () => {
      try {
        setAvatarsLoading(true);

        const authHeaders = await getAuthHeadersGlobal();
        const r = await fetch(
          `/api/avatars-list?user_id=${encodeURIComponent(user.id)}`,
          {
            method: "GET",
            headers: {
              ...authHeaders,
            },
          }
        );

        const j = await r.json().catch(() => null);

        if (!r.ok || !j?.ok) {
          throw new Error(j?.error || "No se pudieron cargar los avatares.");
        }

        const readyAvatars = (Array.isArray(j.avatars) ? j.avatars : []).filter(
          (a) =>
            String(a?.status || "").toUpperCase() === "READY" &&
            Number(a?.anchor_count || 0) >= 1
        );
        setAvatars(readyAvatars);

        setSelectedAvatarId((prev) => {
          if (prev && readyAvatars.some((a) => String(a.id) === String(prev))) {
            return prev;
          }
          return readyAvatars[0]?.id || "";
        });
      } catch (e) {
        console.error("Error cargando avatares:", e);
        setAvatars([]);
        setSelectedAvatarId("");
      } finally {
        setAvatarsLoading(false);
      }
    })();
  }, [userLoggedIn, user?.id, isDemo]);

  // ---------------------------------------------------------
  // Contador diario
  // ---------------------------------------------------------
  useEffect(() => {
    if (!userLoggedIn) {
      setDailyCount(0);
      return;
    }

    if (hasPaidAccess) {
      setDailyCount(0);
      return;
    }

    (async () => {
      try {
        const countToday = await getTodayGenerationCount(user.id);
        setDailyCount(countToday || 0);
      } catch (e) {
        console.error("Error leyendo dailyCount:", e);
        setDailyCount(0);
      }
    })();
  }, [userLoggedIn, user?.id, hasPaidAccess]);

  // ---------------------------------------------------------
  // Demo count
  // ---------------------------------------------------------
  useEffect(() => {
    if (!isDemo) return;
    try {
      const stored = localStorage.getItem("isabelaos_demo_count") || "0";
      setDemoCount(Number(stored));
    } catch (e) {
      console.warn("Error leyendo demo count:", e);
    }
  }, [isDemo]);

  const limitReached = !isDemo && !hasPaidAccess && dailyCount >= DAILY_LIMIT;

  const disabled =
    status === "IN_QUEUE" ||
    status === "IN_PROGRESS" ||
    (!isDemo && !userLoggedIn) ||
    limitReached ||
    (isDemo && demoCount >= DEMO_LIMIT);

  const handleGenerate = async () => {
    setError("");
    setOptError("");

    if (!isDemo && !userLoggedIn) {
      onAuthRequired?.();
      return;
    }

    if (isDemo && demoCount >= DEMO_LIMIT) {
      setStatus("ERROR");
      setStatusText("Límite de demo alcanzado.");
      alert(
        `Has agotado tus ${DEMO_LIMIT} pruebas. Crea tu cuenta GRATIS para obtener ${DAILY_LIMIT} renders al día, guardar tu historial y descargar.`
      );
      onAuthRequired?.();
      return;
    }

    if (!isDemo && limitReached) {
      setStatus("ERROR");
      setStatusText("Límite de generación alcanzado.");
      setError(
        `Has llegado al límite de ${DAILY_LIMIT} renders gratuitos por hoy. Activa una suscripción o compra jades para generar sin límite.`
      );
      return;
    }

    setImageB64(null);
    setStatus("IN_QUEUE");
    setStatusText("Preparando job...");

    try {
      let finalPrompt = prompt;
      let finalNegative = negative;

      if (useOptimizer) {
        const needsOptimize =
          optStatus !== "READY" ||
          !optimizedPrompt ||
          optSource.prompt !== prompt ||
          optSource.negative !== negative;

        if (needsOptimize) {
          setStatusText("Optimizando prompt con IA...");
          const opt = await runOptimizeNow();

          if (!opt.ok || !opt.optimizedPrompt) {
            finalPrompt = prompt;
            finalNegative = negative;
          } else {
            finalPrompt = opt.optimizedPrompt;
            finalNegative = opt.optimizedNegative || "";
          }
        } else {
          const eff = getEffectivePrompts();
          finalPrompt = eff.finalPrompt;
          finalNegative = eff.finalNegative;
        }
      }

      let avatarAnchors = [];

      if (selectedAvatar?.id) {
        setStatusText("Cargando referencias faciales del avatar...");
        avatarAnchors = await getAvatarAnchors(selectedAvatar.id);
      }

      setStatusText("Enviando job a RunPod...");

      const authHeaders = isDemo ? {} : await getAuthHeadersGlobal();

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({
          prompt: finalPrompt,
          negative_prompt: finalNegative,
          width: Number(width),
          height: Number(height),
          steps: Number(steps),
          skin_mode: skinMode,

          // avatar / lora
          avatar_id: selectedAvatar?.id || null,
          avatar_name: selectedAvatar?.name || null,
          
          // avatar / anchors
          avatar_anchor_urls: avatarAnchors.map((a) => a.url).filter(Boolean),
          avatar_anchor_paths: avatarAnchors.map((a) => a.storage_path).filter(Boolean),

          // debug UI
          _ui_original_prompt: prompt,
          _ui_original_negative: negative,
          _ui_used_optimizer: !!useOptimizer,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Error en /api/generate, revisa logs.");
      }

      const jobId = data.jobId;
      setStatus("IN_PROGRESS");
      setStatusText(`Job enviado. ID: ${jobId}. Consultando estado...`);

      let finished = false;

      while (!finished) {
        await new Promise((r) => setTimeout(r, 2000));

        const authHeaders2 = isDemo ? {} : await getAuthHeadersGlobal();
        const statusRes = await fetch(`/api/status?id=${jobId}`, {
          headers: { ...authHeaders2 },
        });

        const statusData = await statusRes.json().catch(() => null);

        if (!statusRes.ok || statusData?.error) {
          throw new Error(statusData?.error || "Error consultando /api/status.");
        }

        const st = statusData.status;
        setStatus(st);
        setStatusText(`Estado actual: ${st}...`);

        if (st === "IN_QUEUE" || st === "IN_PROGRESS") continue;

        finished = true;

        if (st === "COMPLETED" && statusData.output?.image_b64) {
          const b64 = statusData.output.image_b64;
          setImageB64(b64);
          setStatusText("Render completado.");

          if (isDemo) {
            const next = demoCount + 1;
            setDemoCount(next);
            localStorage.setItem("isabelaos_demo_count", String(next));
          } else if (userLoggedIn) {
            if (!hasPaidAccess) setDailyCount((prev) => prev + 1);

            const dataUrl = `data:image/png;base64,${b64}`;
            saveGenerationInSupabase({
              userId: user.id,
              imageUrl: dataUrl,
              prompt,
              negativePrompt: negative,
              width: Number(width),
              height: Number(height),
              steps: Number(steps),
              optimizedPrompt: useOptimizer ? (optimizedPrompt || null) : null,
              optimizedNegativePrompt: useOptimizer ? (optimizedNegative || null) : null,
              usedOptimizer: !!useOptimizer,
            }).catch((e) => console.error("Error guardando en Supabase:", e));
          }
        } else {
          throw new Error("Job terminado pero sin imagen en la salida.");
        }
      }
    } catch (err) {
      console.error(err);
      setStatus("ERROR");
      setStatusText("Error al generar la imagen.");
      setError(err?.message || String(err));
    }
  };

  const handleDownload = () => {
    if (isDemo) {
      alert("Para descargar, por favor crea tu cuenta o inicia sesión.");
      onAuthRequired?.();
      return;
    }

    if (!imageB64) return;

    const link = document.createElement("a");
    link.href = `data:image/png;base64,${imageB64}`;
    link.download = "isabelaos-image.png";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!userLoggedIn && !isDemo) {
    return (
      <div className="rounded-3xl border border-yellow-400/30 bg-yellow-500/5 p-6 text-center text-sm text-yellow-100">
        <p className="font-medium">Debes iniciar sesión para usar el motor de producción visual.</p>
        <p className="mt-1 text-xs text-yellow-200/80">
          Desde tu cuenta podrás ejecutar renders con el motor conectado a GPU.
        </p>
      </div>
    );
  }

  const remaining = isDemo
    ? Math.max(0, DEMO_LIMIT - demoCount)
    : hasPaidAccess
    ? Infinity
    : Math.max(0, DAILY_LIMIT - dailyCount);

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">Motor de imagen · Producción visual</h2>

        {isDemo && (
          <div className="mt-4 rounded-2xl border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-[11px] text-cyan-100">
            Modo demo: te quedan {remaining} outputs sin registrarte. Descarga y biblioteca requieren cuenta.
          </div>
        )}

        {!isDemo && !hasPaidAccess && remaining <= 2 && remaining > 0 && (
          <div className="mt-4 rounded-2xl border border-yellow-400/40 bg-yellow-500/10 px-4 py-2 text-[11px] text-yellow-100">
            Atención: solo te quedan {remaining} renders hoy.
          </div>
        )}

        {!isDemo && hasPaidAccess && (
          <div className="mt-4 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-[11px] text-emerald-100">
            Acceso premium activo: renders limitados por plan o jades.
            <span className="ml-2 text-emerald-200/80">Jades: {profileJades}</span>
          </div>
        )}

        <div className="mt-4 space-y-4 text-sm">
          {!isDemo && (
            <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
            <div className="text-sm font-medium text-white">Anchors faciales</div>
            <div className="mt-1 text-[11px] text-neutral-400">
              Elige un anchor guardado para enviar 1 a 3 fotos de referencia al worker.
            </div>

              <select
                className="mt-3 w-full rounded-2xl bg-black/60 px-3 py-3 text-sm text-white outline-none ring-1 ring-cyan-400/60 focus:ring-2 focus:ring-cyan-400"
                value={selectedAvatarId}
                onChange={(e) => setSelectedAvatarId(e.target.value)}
                disabled={avatarsLoading}
              >
                <option value="">Sin avatar</option>
                {avatars.map((avatar) => (
                  <option key={avatar.id} value={avatar.id}>
                    {avatar.name}
                  </option>
                ))}
              </select>

              <div className="mt-2 text-[11px] text-neutral-500">
                {avatarsLoading
                  ? "Cargando avatares..."
                  : avatars.length > 0
                  ? `${avatars.length} avatar(es) READY encontrados`
                  : "No hay anchors READY todavía"}
              </div>
            </div>
          )}

          <div>
            <label className="text-neutral-300">Prompt</label>
            <textarea
              className="mt-1 h-24 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>

          <div>
            <label className="text-neutral-300">Negative prompt</label>
            <textarea
              className="mt-1 h-20 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              value={negative}
              onChange={(e) => setNegative(e.target.value)}
            />
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-neutral-300">
                Optimización de prompt (OpenAI)
                {optStatus === "READY" && optimizedPrompt ? (
                  <span className="ml-2 text-[10px] text-emerald-300/90">
                    {isOptStale ? "Desactualizado" : "Listo ✓"}
                  </span>
                ) : (
                  <span className="ml-2 text-[10px] text-neutral-400">Opcional</span>
                )}
              </div>

              <button
                type="button"
                onClick={runOptimizeNow}
                disabled={optStatus === "OPTIMIZING" || !prompt?.trim()}
                className="rounded-xl border border-white/20 px-3 py-1 text-[11px] text-white hover:bg-white/10 disabled:opacity-60"
              >
                {optStatus === "OPTIMIZING" ? "Optimizando..." : "Optimizar con IA"}
              </button>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <input
                id="useOptImage"
                type="checkbox"
                checked={useOptimizer}
                onChange={(e) => setUseOptimizer(e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="useOptImage" className="text-[11px] text-neutral-300">
                Usar prompt optimizado para generar
              </label>

              <span className="ml-auto text-[10px] text-neutral-500">
                {useOptimizer && optStatus === "READY" && optimizedPrompt && !isOptStale
                  ? "Activo (mandará optimizado)"
                  : "Mandará tu prompt"}
              </span>
            </div>

            {optimizedPrompt ? (
              <div className="mt-2">
                <div className="text-[10px] text-neutral-400">
                  Prompt optimizado (se envía al motor si está activo):
                </div>
                <div className="mt-1 max-h-24 overflow-auto rounded-xl bg-black/60 p-2 text-[10px] text-neutral-200">
                  {optimizedPrompt}
                </div>

                <div className="mt-2 text-[10px] text-neutral-400">Negative optimizado:</div>
                <div className="mt-1 max-h-20 overflow-auto rounded-xl bg-black/60 p-2 text-[10px] text-neutral-200">
                  {optimizedNegative || "(vacío)"}
                </div>

                {isOptStale && (
                  <div className="mt-2 text-[10px] text-yellow-200/90">
                    Cambiaste el prompt/negative: al generar se re-optimizará automáticamente.
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-2 text-[10px] text-neutral-500">
                Presiona “Optimizar con IA” para generar una versión más descriptiva (en inglés)
                manteniendo tu idea.
              </div>
            )}

            {optError && (
              <div className="mt-2 whitespace-pre-line text-[11px] text-red-400">{optError}</div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-neutral-300">Steps</label>
              <input
                type="number"
                min={5}
                max={50}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
                value={steps}
                onChange={(e) => setSteps(Number(e.target.value))}
              />
            </div>

            <div>
              <label className="text-neutral-300">Width</label>
              <input
                type="number"
                min={256}
                max={2048}
                step={64}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
              />
            </div>

            <div>
              <label className="text-neutral-300">Height</label>
              <input
                type="number"
                min={256}
                max={2048}
                step={64}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="mt-3">
            <label className="text-neutral-300">Piel</label>

            <select
              className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              value={skinMode}
              onChange={(e) => setSkinMode(e.target.value)}
            >
              <option value="standard">Standard</option>
              <option value="natural">Skin natural</option>
            </select>

            <div className="mt-1 text-[11px] text-neutral-500">
              Skin natural reduce el embellecimiento automático.
            </div>
          </div>
          
          <div className="mt-2 rounded-2xl bg-black/50 px-4 py-2 text-xs text-neutral-300">
            Estado actual: {statusText || "Listo para ejecutar el motor."}
            <br />
            <span className="text-[11px] text-neutral-400">
              {isDemo ? (
                <>Uso: {demoCount} / {DEMO_LIMIT}</>
              ) : hasPaidAccess ? (
                <>Uso: limitado (por plan o jades)</>
              ) : (
                <>Uso: {dailyCount} / {DAILY_LIMIT}</>
              )}
              <span className="ml-2 opacity-70">(plan: {profilePlan})</span>
              {useOptimizer && <span className="ml-2 opacity-70">(IA: ON)</span>}
              {selectedAvatar && (
                <span className="ml-2 opacity-70">(avatar: {selectedAvatar.name})</span>
              )}
                <span className="ml-2 opacity-70">(piel: {skinMode})</span>
            </span>
          </div>

          {error && <p className="whitespace-pre-line text-xs text-red-400">{error}</p>}

          <button
            onClick={handleGenerate}
            disabled={disabled}
            className="mt-4 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {isDemo && demoCount >= DEMO_LIMIT
              ? "Límite alcanzado"
              : !isDemo && limitReached
              ? "Límite alcanzado"
              : status === "IN_QUEUE" || status === "IN_PROGRESS"
              ? "Ejecutando..."
              : isDemo
              ? "Generar (Demo)"
              : "Ejecutar render en el motor"}
          </button>
        </div>
      </div>

      <div className="flex flex-col rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">Resultado</h2>

        <div className="mt-4 flex h-[420px] flex-1 items-center justify-center rounded-2xl bg-black/70 text-sm text-neutral-400">
          {imageB64 ? (
            <img
              src={`data:image/png;base64,${imageB64}`}
              alt="Imagen generada"
              className="h-full w-full rounded-2xl object-contain"
            />
          ) : (
            <p>Aquí verás el resultado en cuanto se complete el render.</p>
          )}
        </div>

        {imageB64 && (
          <button
            onClick={handleDownload}
            className="mt-4 w-full rounded-2xl border border-white/30 py-2 text-xs text-white hover:bg-white/10"
          >
            {isDemo ? "Descargar (Requiere crear cuenta)" : "Descargar resultado"}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// Dashboard: pestaña "Suscribirse" (antes estaba en el home)
// ---------------------------------------------------------
function SubscribePanel({ userStatus, onRefresh }) {
  const { user } = useAuth();

  const [selectedPlan, setSelectedPlan] = useState("basic");
  const [cardForm, setCardForm] = useState({
    cardHolderName: "",
    number: "",
    expirationDate: "",
    cvv: "",
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    city: "Guatemala",
    state: "Guatemala",
    zip: "",
    countryId: "320",
    line1: "",
  });

  const [paying, setPaying] = useState(false);
  const [cardError, setCardError] = useState("");
  const [cardSuccess, setCardSuccess] = useState("");
  const [challengeData, setChallengeData] = useState(null);

  const selectedPrice = PLANS?.[selectedPlan]?.price_usd ?? 0;
  const selectedJades = PLANS?.[selectedPlan]?.included_jades ?? 0;

  const paypalPlanId =
    selectedPlan === "basic" ? PAYPAL_PLAN_ID_BASIC : PAYPAL_PLAN_ID_PRO;

  const paypalCustomId = user?.id ? `uid=${user.id};plan=${selectedPlan}` : null;

  const updateField = (key, value) => {
    setCardForm((prev) => ({ ...prev, [key]: value }));
  };

  async function handleCardPay(e) {
    e.preventDefault();
    setCardError("");
    setCardSuccess("");
    setChallengeData(null);

    if (!user?.id) {
      setCardError("Debes iniciar sesión para suscribirte.");
      return;
    }

    if (!cardForm.number || !cardForm.expirationDate || !cardForm.cvv || !cardForm.cardHolderName) {
      setCardError("Completa los datos de tarjeta.");
      return;
    }

    if (!cardForm.firstName || !cardForm.lastName || !cardForm.email || !cardForm.phone) {
      setCardError("Completa tus datos personales.");
      return;
    }

    if (!cardForm.line1 || !cardForm.city || !cardForm.state || !cardForm.countryId) {
      setCardError("Completa la dirección de facturación.");
      return;
    }

    try {
      setPaying(true);

      const auth = await getAuthHeadersGlobal();

      const r = await fetch("/api/pagadito/subscribe-card", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...auth,
        },
        body: JSON.stringify({
          plan: selectedPlan,
          card: {
            number: cardForm.number.trim(),
            expirationDate: cardForm.expirationDate.trim(),
            cvv: cardForm.cvv.trim(),
            cardHolderName: cardForm.cardHolderName.trim(),
            firstName: cardForm.firstName.trim(),
            lastName: cardForm.lastName.trim(),
            billingAddress: {
              city: cardForm.city.trim(),
              state: cardForm.state.trim(),
              zip: cardForm.zip.trim(),
              countryId: cardForm.countryId.trim(),
              line1: cardForm.line1.trim(),
              phone: cardForm.phone.trim(),
            },
            email: cardForm.email.trim(),
          },
        }),
      });

      const j = await r.json().catch(() => null);

      if (!r.ok || !j?.ok) {
        if (j?.challenge_required) {
          setChallengeData(j.challenge || null);
          setCardError("El banco solicitó verificación 3D Secure. Completa el challenge.");
          return;
        }
        throw new Error(j?.response_message || j?.error || "No se pudo procesar el pago con tarjeta.");
      }

      setCardSuccess(
        `Suscripción ${selectedPlan.toUpperCase()} activada correctamente. Se acreditaron ${selectedJades} jades.`
      );

      if (typeof onRefresh === "function") {
        await onRefresh();
      }
    } catch (err) {
      setCardError(err?.message || "Error procesando pago.");
    } finally {
      setPaying(false);
    }
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-black/60 p-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-white">Suscribirse</h2>
        <p className="text-xs text-neutral-400">
          Puedes activar tu plan con tarjeta o usar PayPal como alternativa. El plan se ligará a tu cuenta actual.
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
        <button
          type="button"
          onClick={() => setSelectedPlan("basic")}
          className={`rounded-3xl border p-5 text-left transition ${
            selectedPlan === "basic"
              ? "border-cyan-400 bg-cyan-500/10"
              : "border-white/10 bg-black/40 hover:bg-black/50"
          }`}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-white">Basic</h3>
            <span className="text-sm text-neutral-300">${PLANS?.basic?.price_usd ?? 19}/mes</span>
          </div>
          <p className="mt-2 text-xs text-neutral-400">
            Incluye {PLANS?.basic?.included_jades ?? 100} jades mensuales.
          </p>
        </button>

        <button
          type="button"
          onClick={() => setSelectedPlan("pro")}
          className={`rounded-3xl border p-5 text-left transition ${
            selectedPlan === "pro"
              ? "border-fuchsia-400 bg-fuchsia-500/10"
              : "border-white/10 bg-black/40 hover:bg-black/50"
          }`}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-white">Pro</h3>
            <span className="text-sm text-neutral-300">${PLANS?.pro?.price_usd ?? 39}/mes</span>
          </div>
          <p className="mt-2 text-xs text-neutral-400">
            Incluye {PLANS?.pro?.included_jades ?? 300} jades mensuales.
          </p>
        </button>
      </div>

      <div className="mt-6 rounded-3xl border border-white/10 bg-black/40 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-white">
              Pagar con tarjeta · {selectedPlan === "basic" ? "Basic" : "Pro"}
            </h3>
            <p className="mt-1 text-xs text-neutral-400">
              Total: ${selectedPrice} / mes · Se acreditan {selectedJades} jades al activarse.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/50 px-3 py-2 text-xs text-neutral-300">
            Plan actual: <span className="font-semibold text-white">{selectedPlan}</span>
          </div>
        </div>

        <form onSubmit={handleCardPay} className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="text-xs text-neutral-300">Nombre en tarjeta</label>
            <input
              type="text"
              value={cardForm.cardHolderName}
              onChange={(e) => updateField("cardHolderName", e.target.value)}
              className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              placeholder="JOHN DOE"
            />
          </div>

          <div>
            <label className="text-xs text-neutral-300">Número de tarjeta</label>
            <input
              type="text"
              value={cardForm.number}
              onChange={(e) => updateField("number", e.target.value)}
              className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              placeholder="4000000000002503"
            />
          </div>

          <div>
            <label className="text-xs text-neutral-300">Vencimiento (MM/YYYY)</label>
            <input
              type="text"
              value={cardForm.expirationDate}
              onChange={(e) => updateField("expirationDate", e.target.value)}
              className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              placeholder="01/2027"
            />
          </div>

          <div>
            <label className="text-xs text-neutral-300">CVV</label>
            <input
              type="text"
              value={cardForm.cvv}
              onChange={(e) => updateField("cvv", e.target.value)}
              className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              placeholder="123"
            />
          </div>

          <div>
            <label className="text-xs text-neutral-300">Nombre</label>
            <input
              type="text"
              value={cardForm.firstName}
              onChange={(e) => updateField("firstName", e.target.value)}
              className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              placeholder="John"
            />
          </div>

          <div>
            <label className="text-xs text-neutral-300">Apellido</label>
            <input
              type="text"
              value={cardForm.lastName}
              onChange={(e) => updateField("lastName", e.target.value)}
              className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              placeholder="Doe"
            />
          </div>

          <div>
            <label className="text-xs text-neutral-300">Correo</label>
            <input
              type="email"
              value={cardForm.email}
              onChange={(e) => updateField("email", e.target.value)}
              className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              placeholder="tu@email.com"
            />
          </div>

          <div>
            <label className="text-xs text-neutral-300">Teléfono</label>
            <input
              type="text"
              value={cardForm.phone}
              onChange={(e) => updateField("phone", e.target.value)}
              className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              placeholder="5555-5555"
            />
          </div>

          <div>
            <label className="text-xs text-neutral-300">Ciudad</label>
            <input
              type="text"
              value={cardForm.city}
              onChange={(e) => updateField("city", e.target.value)}
              className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              placeholder="Guatemala"
            />
          </div>

          <div>
            <label className="text-xs text-neutral-300">Estado / Departamento</label>
            <input
              type="text"
              value={cardForm.state}
              onChange={(e) => updateField("state", e.target.value)}
              className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              placeholder="Guatemala"
            />
          </div>

          <div>
            <label className="text-xs text-neutral-300">Código postal</label>
            <input
              type="text"
              value={cardForm.zip}
              onChange={(e) => updateField("zip", e.target.value)}
              className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              placeholder="01001"
            />
          </div>

          <div>
            <label className="text-xs text-neutral-300">País (ISO)</label>
            <input
              type="text"
              value={cardForm.countryId}
              onChange={(e) => updateField("countryId", e.target.value)}
              className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              placeholder="320"
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-xs text-neutral-300">Dirección</label>
            <input
              type="text"
              value={cardForm.line1}
              onChange={(e) => updateField("line1", e.target.value)}
              className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              placeholder="Zona 10, Guatemala"
            />
          </div>

          {cardError && (
            <div className="md:col-span-2 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-xs text-red-200">
              {cardError}
            </div>
          )}

          {cardSuccess && (
            <div className="md:col-span-2 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">
              {cardSuccess}
            </div>
          )}

          {challengeData?.stepUpUrl && (
            <div className="md:col-span-2 rounded-2xl border border-yellow-400/30 bg-yellow-500/10 p-4 text-xs text-yellow-100">
              <div className="mb-2 font-semibold text-white">3D Secure requerido</div>
              <p className="mb-3">
                El banco pidió validación adicional. En la siguiente fase conectaremos el iframe challenge aquí mismo.
              </p>
              <div className="rounded-xl bg-black/50 p-3 text-[11px] break-all">
                stepUpUrl: {challengeData.stepUpUrl}
              </div>
            </div>
          )}

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={paying}
              className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {paying ? "Procesando pago..." : `Pagar ${selectedPlan === "basic" ? "Basic" : "Pro"} con tarjeta`}
            </button>
          </div>
        </form>

        <div className="mt-6 border-t border-white/10 pt-5">
          <div className="text-xs text-neutral-400">O si prefieres, paga con PayPal:</div>

          {!paypalPlanId ? (
            <div className="mt-3 rounded-2xl border border-yellow-400/30 bg-yellow-500/10 px-4 py-3 text-xs text-yellow-100">
              Falta configurar el Plan ID de PayPal para {selectedPlan}.
            </div>
          ) : (
            <PayPalButton
              mode="subscription"
              planId={paypalPlanId}
              customId={paypalCustomId}
              containerId={`paypal-subscribe-${selectedPlan}`}
              onPaid={async () => {
                setCardSuccess("Suscripción PayPal creada. Esperando confirmación del webhook...");
                setTimeout(() => {
                  if (typeof onRefresh === "function") onRefresh();
                }, 2500);
              }}
            />
          )}
        </div>
      </div>
    </section>
  );
}
// ---------------------------------------------------------
// Dashboard (logueado) · versión premium / workspace
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

  const tabs = [
    { key: "generator", label: "Imagen" },
    { key: "img2video", label: "Imagen → Video" },
    { key: "avatars", label: "Avatares" },
    { key: "library", label: "Biblioteca" },
    { key: "montaje", label: "Montaje IA" },
    { key: "subscribe", label: "Plan" },
  ];

  return (
    <div
      className="min-h-screen w-full text-white"
      style={{
        background:
          "radial-gradient(1200px_800px_at_110%-10%,rgba(255,23,229,0.12),transparent_60%),radial-gradient(900px_600px_at-10%_0%,rgba(0,229,255,0.10),transparent_50%),radial-gradient(900px_500px_at_50%_120%,rgba(168,85,247,0.12),transparent_55%),#06070B",
      }}
    >
      {/* ---------------------------------------------------------
          Header superior
         --------------------------------------------------------- */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/60 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500 to-fuchsia-500 text-xs font-bold shadow-[0_0_25px_rgba(34,211,238,0.35)]">
              io
            </div>

            <div>
              <div className="text-sm font-semibold leading-tight">
                isabelaOs <span className="text-xs text-neutral-400">Studio</span>
              </div>
              <div className="text-[10px] text-neutral-500">Workspace del creador</div>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-3 text-xs">
            <span className="hidden lg:inline text-neutral-300">
              {user?.email} {isAdmin ? "· admin" : ""}
            </span>

            <div className="hidden md:flex items-center gap-2 rounded-2xl border border-white/10 bg-black/60 px-3 py-1.5">
              <span className="text-[10px] text-neutral-400">{userPlanLabel}</span>
              <span className="mx-1 h-3 w-px bg-white/10" />
              <span className="text-[11px] text-neutral-300">
                Jades:{" "}
                <span className="font-semibold text-white">
                  {userStatus.loading ? "..." : userStatus.jades ?? 0}
                </span>
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

      {/* ---------------------------------------------------------
          Contenido principal
         --------------------------------------------------------- */}
      <main className="mx-auto max-w-7xl px-4 pb-16 pt-8">
        {/* Estado móvil */}
        <div className="mb-5 md:hidden">
          <div className="rounded-2xl border border-white/10 bg-black/60 px-4 py-3 text-[11px] text-neutral-300">
            <div className="flex flex-col gap-2">
              <span className="text-neutral-400">{userPlanLabel}</span>
              <span className="font-semibold text-white">
                Jades: {userStatus.loading ? "..." : userStatus.jades ?? 0}
              </span>
            </div>
          </div>
        </div>

        {/* Encabezado del panel */}
        <section className="mb-6">
          <p className="text-[11px] uppercase tracking-[0.22em] text-neutral-400">
            Workspace
          </p>

          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-white md:text-3xl">
                Panel del creador
              </h1>
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

        {/* Tabs superiores */}
        <section className="mb-6">
          <div className="no-scrollbar flex gap-2 overflow-x-auto rounded-[24px] border border-white/10 bg-black/35 p-2">
            {tabs.map((item) => {
              const active = appViewMode === item.key;

              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setAppViewMode(item.key)}
                  className={[
                    "whitespace-nowrap rounded-2xl px-4 py-3 text-sm font-medium transition-all",
                    active
                      ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white shadow-[0_0_30px_rgba(34,211,238,0.22)]"
                      : "bg-white/5 text-white/75 hover:bg-white/10 hover:text-white",
                  ].join(" ")}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Contenedor principal del módulo activo */}
        <section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-black/35 p-4 md:p-6">
          <div className="pointer-events-none absolute -inset-16 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.10),transparent_25%),radial-gradient(circle_at_top_right,rgba(236,72,153,0.10),transparent_28%),radial-gradient(circle_at_bottom,rgba(168,85,247,0.10),transparent_35%)]" />

          {appViewMode === "generator" && <CreatorPanel isDemo={false} />}

          {appViewMode === "img2video" && (
            <Img2VideoPanel userStatus={userStatus} spendJades={spendJades} />
          )}

          {appViewMode === "avatars" && (
            <AvatarStudioPanel userStatus={userStatus} />
          )}

          {appViewMode === "library" && <LibraryView />}

          {appViewMode === "montaje" && (
            <MontajeIAPanel userStatus={userStatus} />
          )}

          {appViewMode === "subscribe" && (
            <SubscribePanel userStatus={userStatus} onRefresh={fetchUserStatus} />
          )}
        </section>
      </main>
    </div>
  );
}

// ---------------------------------------------------------
// Landing: sección de planes (versión premium)
// ---------------------------------------------------------
function PricingSection({ onOpenAuth }) {
  const features = useMemo(
    () => ({
      basic: [
        "Acceso al sistema desde la web",
        `Incluye ${PLANS?.basic?.included_jades ?? 100} jades / mes`,
        "Biblioteca personal con historial y descargas",
        "Motor visual en actualización continua",
        "Soporte básico por contacto",
      ],
      pro: [
        "Todo lo incluido en Basic",
        `Incluye ${PLANS?.pro?.included_jades ?? 300} jades / mes`,
        "Mayor capacidad de generación y prioridad",
        "Acceso anticipado a funciones nuevas",
        "Soporte prioritario",
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
    <section id="planes" className="mt-20">
      <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-black/40 p-6 md:p-8">
        <div className="pointer-events-none absolute -inset-24 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.14),transparent_25%),radial-gradient(circle_at_top_right,rgba(236,72,153,0.16),transparent_28%),radial-gradient(circle_at_bottom,rgba(168,85,247,0.18),transparent_35%)]" />

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-neutral-400">
              Acceso al sistema
            </p>
            <h3 className="mt-2 text-2xl font-semibold text-white">
              Planes para producción continua
            </h3>
            <p className="mt-2 max-w-2xl text-sm text-neutral-400">
              Suscripción mensual. Cancela cuando quieras. Los jades se cargan cada mes y se usan
              dentro del motor para imágenes y video.
            </p>
          </div>

          <button
            onClick={onOpenAuth}
            className="rounded-2xl border border-white/15 bg-white/5 px-4 py-2 text-xs text-white hover:bg-white/10"
          >
            Ya tengo cuenta → Iniciar sesión
          </button>
        </div>

        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-black/50 p-6">
            <div className="pointer-events-none absolute -inset-10 -z-10 bg-gradient-to-br from-cyan-500/15 via-transparent to-fuchsia-500/10 blur-3xl" />

            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xl font-semibold text-white">Plan Basic</p>
                <p className="mt-2 text-sm text-neutral-400">
                  Para entrar al sistema, producir de forma constante y empezar a construir tu flujo.
                </p>
              </div>

              <div className="text-right shrink-0">
                <p className="text-4xl font-semibold text-white leading-none">
                  ${PLANS?.basic?.price_usd ?? 19}
                  <span className="ml-1 text-sm text-neutral-400">/mes</span>
                </p>
                <p className="mt-2 text-[11px] text-neutral-500">
                  {PLANS?.basic?.included_jades ?? 100} jades incluidos
                </p>
              </div>
            </div>

            <ul className="mt-6 space-y-3 text-sm text-neutral-200">
              {features.basic.map((t) => (
                <li key={t} className="flex gap-3">
                  <span className="mt-2 h-2 w-2 rounded-full bg-cyan-300" />
                  <span className="text-neutral-300">{t}</span>
                </li>
              ))}
            </ul>

            <div className="mt-6 rounded-[22px] border border-white/10 bg-black/60 px-4 py-4 text-sm text-neutral-300">
              <div className="text-neutral-400">Con los jades incluidos puedes generar aprox:</div>
              <div className="mt-2">• <span className="font-semibold text-white">{estBasic.images}</span> imágenes</div>
              <div>• <span className="font-semibold text-white">{estBasic.videosPrompt}</span> videos (desde prompt)</div>
              <div>• <span className="font-semibold text-white">{estBasic.videosImg2Vid}</span> videos (imagen → video)</div>
            </div>

            <div className="mt-6">
              <button
                onClick={onOpenAuth}
                className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3.5 text-sm font-semibold text-white shadow-[0_0_30px_rgba(34,211,238,0.25)]"
              >
                Inicia sesión para suscribirte
              </button>
              <p className="mt-2 text-center text-[10px] text-neutral-500">
                El pago se realiza dentro de tu cuenta para asignar plan y jades.
              </p>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-[28px] border border-fuchsia-400/25 bg-black/50 p-6">
            <div className="pointer-events-none absolute -inset-10 -z-10 bg-gradient-to-br from-fuchsia-500/16 via-transparent to-violet-500/18 blur-3xl" />

            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-fuchsia-400/30 bg-fuchsia-500/10 px-3 py-1 text-[10px] font-semibold text-fuchsia-200">
                  Recomendado
                </div>
                <p className="mt-3 text-xl font-semibold text-white">Plan Pro</p>
                <p className="mt-2 text-sm text-neutral-400">
                  Para usuarios que quieren más potencia, más capacidad y prioridad dentro del sistema.
                </p>
              </div>

              <div className="text-right shrink-0">
                <p className="text-4xl font-semibold text-white leading-none">
                  ${PLANS?.pro?.price_usd ?? 39}
                  <span className="ml-1 text-sm text-neutral-400">/mes</span>
                </p>
                <p className="mt-2 text-[11px] text-neutral-500">
                  {PLANS?.pro?.included_jades ?? 300} jades incluidos
                </p>
              </div>
            </div>

            <ul className="mt-6 space-y-3 text-sm text-neutral-200">
              {features.pro.map((t) => (
                <li key={t} className="flex gap-3">
                  <span className="mt-2 h-2 w-2 rounded-full bg-fuchsia-300" />
                  <span className="text-neutral-300">{t}</span>
                </li>
              ))}
            </ul>

            <div className="mt-6 rounded-[22px] border border-white/10 bg-black/60 px-4 py-4 text-sm text-neutral-300">
              <div className="text-neutral-400">Con los jades incluidos puedes generar aprox:</div>
              <div className="mt-2">• <span className="font-semibold text-white">{estPro.images}</span> imágenes</div>
              <div>• <span className="font-semibold text-white">{estPro.videosPrompt}</span> videos (desde prompt)</div>
              <div>• <span className="font-semibold text-white">{estPro.videosImg2Vid}</span> videos (imagen → video)</div>
            </div>

            <div className="mt-6">
              <button
                onClick={onOpenAuth}
                className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3.5 text-sm font-semibold text-white shadow-[0_0_30px_rgba(236,72,153,0.25)]"
              >
                Inicia sesión para suscribirte
              </button>
              <p className="mt-2 text-center text-[10px] text-neutral-500">
                El pago se realiza dentro de tu cuenta para asignar plan y jades.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------
// Landing (no sesión) + home premium
// ---------------------------------------------------------
function LandingView({ onOpenAuth, onStartDemo, onOpenContact, onOpenAbout }) {
  const [demoPrompt, setDemoPrompt] = useState(
    "Modelo virtual elegante para redes sociales, rostro consistente, luz cinematográfica, formato vertical"
  );

  const topVisuals = [
    { src: "/gallery/img1.png?v=2", label: "Retrato premium", big: true },
    { src: "/gallery/img2.png?v=2", label: "Campaña visual", big: false },
    { src: "/gallery/img3.png?v=2", label: "Escena IA", big: false },
    { src: "/gallery/img4.png?v=2", label: "Avatar", big: false },
    { src: "/gallery/img1.png?v=2", label: "Contenido", big: false },
  ];

  return (
    <div
      className="min-h-screen w-full text-white"
      style={{
        background:
          "radial-gradient(1200px_800px_at_100%_-10%,rgba(250,204,21,0.14),transparent_55%),radial-gradient(900px_700px_at_-10%_0%,rgba(34,211,238,0.16),transparent_50%),radial-gradient(900px_700px_at_50%_120%,rgba(168,85,247,0.10),transparent_55%),#05060A",
      }}
    >
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/45 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400 via-sky-500 to-yellow-400 text-xs font-bold text-black shadow-[0_0_30px_rgba(250,204,21,0.22)]">
              io
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">
                isabelaOs <span className="text-xs text-neutral-400">Studio</span>
              </div>
              <div className="text-[10px] text-neutral-500">
                Plataforma de modelos virtuales
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => scrollToId("planes")}
              className="hidden sm:inline rounded-xl border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10"
            >
              Planes
            </button>

            <button
              onClick={onOpenAbout}
              className="hidden sm:inline rounded-xl border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10"
            >
              Sobre nosotros
            </button>

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

      <main className="mx-auto max-w-7xl px-4 pb-16 pt-10">
        <section className="grid gap-8 xl:grid-cols-[0.84fr_1.1fr_0.8fr]">
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
              <span className="inline-flex items-center gap-2 rounded-full border border-yellow-400/20 bg-yellow-400/10 px-3 py-1 text-[11px] text-yellow-100">
                Producción en GPU
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] text-cyan-100">
                Consistencia de rostro
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/80">
                Imagen → Video
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/80">
                Biblioteca integrada
              </span>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <button
                onClick={() => scrollToId("demo-box")}
                className="rounded-2xl bg-gradient-to-r from-cyan-400 via-sky-500 to-yellow-400 px-6 py-3 text-sm font-semibold text-black shadow-[0_0_35px_rgba(250,204,21,0.20)]"
              >
                Crear mi modelo virtual
              </button>

              <button
                onClick={onOpenAbout}
                className="rounded-2xl border border-white/20 bg-white/5 px-6 py-3 text-sm font-semibold text-white hover:bg-white/10"
              >
                Ver presentación
              </button>
            </div>

            <p className="mt-4 max-w-md text-[12px] text-neutral-400">
              Empieza con una idea, entra al panel y organiza tu flujo creativo en una sola plataforma.
            </p>
          </div>

          <div className="order-3 xl:order-2">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">
                  Visuales del sistema
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-white">
                  Contenido generado con IsabelaOS
                </h2>
              </div>

              <button
                onClick={() => scrollToId("demo-box")}
                className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs text-white hover:bg-white/10"
              >
                Empezar ahora
              </button>
            </div>

            <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-white/5 p-4">
              <div className="pointer-events-none absolute -inset-20 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.14),transparent_25%),radial-gradient(circle_at_top_right,rgba(250,204,21,0.14),transparent_28%),radial-gradient(circle_at_bottom,rgba(168,85,247,0.10),transparent_35%)]" />

              <div className="grid auto-rows-[180px] grid-cols-2 gap-4 lg:grid-cols-3 lg:auto-rows-[170px]">
                {topVisuals.map((item, idx) => (
                  <div
                    key={`${item.src}-${idx}`}
                    className={`group relative overflow-hidden rounded-[26px] border border-white/10 bg-black/40 ${item.big ? "lg:col-span-2 lg:row-span-2" : ""}`}
                  >
                    <div
                      className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
                      style={{ backgroundImage: `url(${item.src})` }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                    <div className="absolute left-3 top-3 rounded-full border border-white/10 bg-black/45 px-2.5 py-1 text-[10px] text-white/80 backdrop-blur-sm">
                      {item.label}
                    </div>
                  </div>
                ))}
              </div>

              <p className="mt-4 text-[11px] text-neutral-500">
                Vista visual de referencia. Luego se puede conectar con tus archivos reales para mostrar previews uniformes.
              </p>
            </div>
          </div>

          <div id="demo-box" className="order-2 xl:order-3 xl:pt-14">
            <div className="relative overflow-hidden rounded-[30px] border border-white/10 bg-black/45 p-6 backdrop-blur-md shadow-xl">
              <div className="pointer-events-none absolute -inset-12 -z-10 bg-gradient-to-br from-cyan-500/14 via-transparent to-yellow-400/14 blur-3xl" />

              <div className="mb-3">
                <p className="text-[11px] uppercase tracking-[0.22em] text-neutral-400">
                  Inicio rápido
                </p>
                <h2 className="mt-2 text-xl font-semibold text-white">
                  Empieza con tu primer modelo virtual
                </h2>
              </div>

              <div className="mb-4 grid gap-2 sm:grid-cols-3">
                <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-xs text-cyan-100">
                  Imagen
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/70">
                  Imagen → Video
                </div>
                <div className="rounded-2xl border border-yellow-400/15 bg-yellow-400/10 px-4 py-3 text-xs text-yellow-100">
                  Avatar / Biblioteca
                </div>
              </div>

              <textarea
                className="mt-1 h-44 w-full resize-none rounded-2xl bg-black/60 px-4 py-4 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-yellow-300"
                value={demoPrompt}
                onChange={(e) => setDemoPrompt(e.target.value)}
                placeholder="Ej: modelo virtual elegante para redes sociales, rostro consistente, iluminación cinematográfica, formato vertical"
              />

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Enfoque</div>
                  <div className="mt-1 text-sm text-white">Modelo virtual</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Salida</div>
                  <div className="mt-1 text-sm text-white">Imagen vertical</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Flujo</div>
                  <div className="mt-1 text-sm text-white">Cuenta → panel</div>
                </div>
              </div>

              <button
                onClick={() => {
                  saveDemoPrompt(demoPrompt);
                  onStartDemo();
                }}
                disabled={!demoPrompt.trim()}
                className="mt-5 w-full rounded-2xl bg-gradient-to-r from-cyan-400 via-sky-500 to-yellow-400 py-3.5 text-sm font-semibold text-black disabled:opacity-60"
              >
                Crear modelo
              </button>

              <div className="mt-3 text-[11px] text-neutral-400">
                Al continuar, crearás tu cuenta y entrarás al panel de creación con acceso inicial.
              </div>
            </div>
          </div>
        </section>

        <section className="mt-16">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-neutral-400">
                Señales tempranas
              </p>
              <h3 className="mt-1 text-2xl font-semibold text-white">
                Primeros resultados del sistema
              </h3>
              <p className="mt-2 max-w-2xl text-sm text-neutral-400">
                A medida que escalamos, iremos agregando más feedback real de testers, equipos y creadores.
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
                text: "La plataforma ya se siente como producto, no como una simple demo de generación.",
              },
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
