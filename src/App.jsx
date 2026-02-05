
// App.jsx
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "./context/AuthContext";
import ContactView from "./components/ContactView";
// ✅ nuevos imports de panels (si antes estaban embebidos, ahora vienen desde components)
import { VideoFromPromptPanel } from "./components/VideoFromPromptPanel";
import { Img2VideoPanel } from "./components/Img2VideoPanel";
import VoiceToVideoPanel from "./components/VoiceToVideoPanel";
import { supabase } from "./lib/supabaseClient";

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
const DEMO_LIMIT = 3; // Invitado
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
// CreatorPanel (RunPod) ✅ UNA SOLA VERSIÓN (CORREGIDO: plan/jades)
// - No depende de useAuth().profile
// - Lee profiles(plan, jade_balance) directo de Supabase
// - Límite 5 SOLO si (plan free/none) Y jade_balance <= 0
//
// ✅ Optimización de prompt (OpenAI) estilo VIDEO:
// - Botón "Optimizar con IA" + toggle "Usar prompt optimizado para generar"
// - Muestra prompt/negative optimizados pequeños abajo
// - Si está activo y está stale, se re-optimiza al generar
// ---------------------------------------------------------
function CreatorPanel({ isDemo = false, onAuthRequired }) {
  const { user } = useAuth();

  const userLoggedIn = !isDemo && !!user;

  const [prompt, setPrompt] = useState("Cinematic portrait, ultra detailed, soft light, 8k");
  const [negative, setNegative] = useState("blurry, low quality, deformed, watermark, text");
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);
  const [steps, setSteps] = useState(22);

  const [status, setStatus] = useState("IDLE");
  const [statusText, setStatusText] = useState("Listo para ejecutar el motor.");
  const [imageB64, setImageB64] = useState(null);
  const [error, setError] = useState("");

  const [dailyCount, setDailyCount] = useState(0);
  const [demoCount, setDemoCount] = useState(0);

  // ✅ Perfil (profiles)
  const [profilePlan, setProfilePlan] = useState("free");
  const [profileJades, setProfileJades] = useState(0);

  // ---------------------------------------------------------
  // ✅ Optimizador de prompt (UI estilo VIDEO)
  // ---------------------------------------------------------
  const [useOptimizer, setUseOptimizer] = useState(false); // toggle "usar optimizado"
  const [optStatus, setOptStatus] = useState("IDLE"); // IDLE | OPTIMIZING | READY | ERROR
  const [optError, setOptError] = useState("");
  const [optimizedPrompt, setOptimizedPrompt] = useState("");
  const [optimizedNegative, setOptimizedNegative] = useState("");
  const [optSource, setOptSource] = useState({ prompt: "", negative: "" }); // para detectar stale

  // Si el usuario cambia prompt/negative, marcamos stale
  useEffect(() => {
    setOptError("");
    // NO borramos optimizedPrompt/Negative para que el usuario lo vea,
    // pero sí queda stale y se re-optimiza si genera.
  }, [prompt, negative]);

  const isOptStale =
    optStatus === "READY" && (optSource.prompt !== prompt || optSource.negative !== negative);

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

      // ✅ igual que video: si optimizas, activa el toggle automáticamente
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

  // ---------------------------------------------------------
  // Cargar profile desde Supabase (plan + jade_balance)
  // Usa tu helper getAuthHeadersGlobal() y REST /profiles
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

        const authHeaders = await getAuthHeadersGlobal(); // Authorization Bearer user JWT
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

  // ✅ Regla correcta:
  // - Si plan !== free/none  OR  jade_balance > 0  => NO límite 5
  // - Si plan === free/none y jade_balance <= 0   => sí límite 5
  const isFreeUser = !profilePlan || profilePlan === "free" || profilePlan === "none";
  const hasPaidAccess = !isFreeUser || profileJades > 0;

  // ---------------------------------------------------------
  // Contador diario (solo si aplica límite)
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
      // ✅ Si el optimizador está activo: aseguramos tener prompts optimizados (y no stale)
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
            // Si falla optimización, seguimos con el prompt original
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

          // opcional: para debug (no rompe backend)
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
            // ✅ Solo cuenta daily si aplica límite (free sin jades)
            if (!hasPaidAccess) setDailyCount((prev) => prev + 1);

            const dataUrl = `data:image/png;base64,${b64}`;
            saveGenerationInSupabase({
              userId: user.id,
              imageUrl: dataUrl,
              prompt, // guardamos el prompt del usuario (original)
              negativePrompt: negative, // guardamos el negativo original
              width: Number(width),
              height: Number(height),
              steps: Number(steps),

              // opcional para trazabilidad
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

  // UI: remaining
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
            Acceso premium activo: renders ilimitados (por plan o jades).
            <span className="ml-2 text-emerald-200/80">Jades: {profileJades}</span>
          </div>
        )}

        <div className="mt-4 space-y-4 text-sm">
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

          {/* ✅ Optimizer UI (IGUAL AL DE VIDEO) */}
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
                Presiona “Optimizar con IA” para generar una versión más descriptiva (en inglés) manteniendo tu idea.
              </div>
            )}

            {optError && (
              <div className="mt-2 text-[11px] text-red-400 whitespace-pre-line">{optError}</div>
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
                max={1024}
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
                max={1024}
                step={64}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="mt-2 rounded-2xl bg-black/50 px-4 py-2 text-xs text-neutral-300">
            Estado actual: {statusText || "Listo para ejecutar el motor."}
            <br />
            <span className="text-[11px] text-neutral-400">
              {isDemo ? (
                <>
                  Uso: {demoCount} / {DEMO_LIMIT}
                </>
              ) : hasPaidAccess ? (
                <>Uso: ilimitado (por plan o jades)</>
              ) : (
                <>
                  Uso: {dailyCount} / {DAILY_LIMIT}
                </>
              )}
              <span className="ml-2 opacity-70">(plan: {profilePlan})</span>
              {useOptimizer && <span className="ml-2 opacity-70">(IA: ON)</span>}
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
// Biblioteca (LibraryView) – usa Supabase
// ---------------------------------------------------------
function LibraryView() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!user) {
      setItems([]);
      setSelected(null);
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      try {
        const rows = await loadGenerationsForUser(user.id);
        const mapped = rows.map((row) => ({
          id: row.id,
          createdAt: row.created_at,
          src: row.image_url,
        }));
        setItems(mapped);
        if (mapped.length > 0) setSelected(mapped[0]);
      } catch (e) {
        console.error("Error cargando biblioteca:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const handleDeleteSelected = async () => {
    if (!selected || !user) return;
    const ok = window.confirm("¿Seguro que quieres eliminar este resultado? Esto también lo borrará de Supabase.");
    if (!ok) return;

    try {
      setDeleting(true);
      await deleteGenerationFromSupabase(selected.id);
      setItems((prev) => {
        const next = prev.filter((it) => it.id !== selected.id);
        setSelected(next.length > 0 ? next[0] : null);
        return next;
      });
    } catch (e) {
      console.error("Error eliminando:", e);
      alert("No se pudo eliminar. Intenta de nuevo.");
    } finally {
      setDeleting(false);
    }
  };

  if (!user) {
    return (
      <div className="rounded-3xl border border-yellow-400/30 bg-yellow-500/5 p-6 text-center text-sm text-yellow-100">
        Inicia sesión para acceder a tu biblioteca de producción.
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1.1fr_1.4fr]">
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">Biblioteca de producción</h2>
        <p className="mt-1 text-xs text-neutral-400">Resultados guardados por tu cuenta.</p>

        {loading ? (
          <p className="mt-4 text-xs text-neutral-400">Cargando historial...</p>
        ) : items.length === 0 ? (
          <p className="mt-4 text-xs text-neutral-400">Aún no tienes resultados guardados.</p>
        ) : (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelected(item)}
                className={`group relative overflow-hidden rounded-xl border ${
                  selected?.id === item.id ? "border-cyan-400" : "border-white/10"
                } bg-black/60`}
              >
                <img src={item.src} alt="Generación" className="h-24 w-full object-cover group-hover:opacity-80" />
                <div className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1 text-[10px] text-neutral-300">
                  {new Date(item.createdAt).toLocaleString()}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-3xl border border-white/10 bg-black/40 p-6 flex flex-col">
        <h2 className="text-lg font-semibold text-white">Vista previa</h2>
        <div className="mt-4 flex h-[420px] flex-1 items-center justify-center rounded-2xl bg-black/70 text-sm text-neutral-400">
          {selected ? (
            <img src={selected.src} alt="Seleccionada" className="h-full w-full rounded-2xl object-contain" />
          ) : (
            <p>Selecciona un resultado para verlo.</p>
          )}
        </div>
        {selected && (
          <button
            onClick={handleDeleteSelected}
            disabled={deleting}
            className="mt-4 w-full rounded-2xl border border-red-500/60 py-2 text-xs text-red-200 hover:bg-red-500/10 disabled:opacity-60"
          >
            {deleting ? "Eliminando..." : "Eliminar de mi biblioteca"}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// Foto Profesional IA (Headshot Pro)
// SOLO COMPONENTE – sin export default, sin costos
// ✅ CAMBIO: ya NO exige "plan activo".
// ✅ Ahora: exige login + (opcional) jades suficientes.
// ✅ Todo lo demás queda IGUAL (copy/paste estricto).
// ---------------------------------------------------------

function HeadshotPhotoPanel({ userStatus }) {
  const { user } = useAuth();

  const [dataUrl, setDataUrl] = useState(null);
  const [pureB64, setPureB64] = useState(null);
  const [extraPrompt, setExtraPrompt] = useState("");
  const [status, setStatus] = useState("IDLE");
  const [statusText, setStatusText] = useState("");
  const [resultB64, setResultB64] = useState(null);
  const [error, setError] = useState("");

  // -------------------------------------------------------------------
  // ✅ CAMBIO IMPORTANTE (mínimo)
  // Antes:
  // const isPremium = !!user && userStatus?.subscription_status === "active";
  //
  // Ahora:
  // - El backend ya cobra con spend_jades, así que NO bloqueamos por plan.
  // - Bloqueamos por login y (si querés) por jades suficientes.
  // -------------------------------------------------------------------
  const canUse = !!user;

  // ✅ Debe coincidir con COST_HEADSHOT_JADES del backend (ahora está en 1)
  const COST_HEADSHOT_JADES = 1;

  // ✅ Si tu userStatus trae jades, validamos. Si no trae, asumimos 0.
  const currentJades = userStatus?.jades ?? 0;
  const hasEnough = currentJades >= COST_HEADSHOT_JADES;

  // ✅ Si todavía NO querés validar jades en UI, poné: const enforceJades = false;
  // (El backend igual lo valida y devolverá INSUFFICIENT_JADES si no alcanza.)
  const enforceJades = true;

  // file input
  const fileInputId = "headshot-file-input";

  const handlePickFile = () => {
    const input = document.getElementById(fileInputId);
    if (input) input.click();
  };

  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });

  const handleFileChange = async (e) => {
    setError("");
    setResultB64(null);
    setStatus("IDLE");
    setStatusText("");

    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const durl = await fileToBase64(file);
      setDataUrl(durl);
      const parts = String(durl).split(",");
      setPureB64(parts[1] || null);
    } catch (err) {
      console.error(err);
      setError("No se pudo leer la imagen.");
    }
  };

  const handleGenerateHeadshot = async () => {
    setError("");

    // ✅ Login requerido
    if (!canUse) {
      setError("Debes iniciar sesión para usar este módulo.");
      return;
    }

    // ✅ (Opcional) Bloqueo por jades en UI
    if (enforceJades && !hasEnough) {
      setError("No tienes jades suficientes para generar un headshot.");
      return;
    }

    // ✅ Ya NO pedimos "plan activo"
    // if (!isPremium) {
    //   setError("Este módulo requiere un plan activo.");
    //   return;
    // }

    if (!pureB64) {
      setError("Sube una foto primero.");
      return;
    }

    setResultB64(null);
    setStatus("IN_QUEUE");
    setStatusText("Enviando foto a RunPod...");

    try {
      const auth = await getAuthHeadersGlobal();

      // ✅ Compat: enviamos lo que tu backend espera (style) y también description por si tu worker lo usa
      const res = await fetch("/api/generate-headshot", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({
          image_b64: pureB64,
          style: "corporate", // si querés luego lo cambiamos por selector
          description: extraPrompt || "", // se mantiene por compatibilidad con tu worker si lo usa
          // si tu backend NO acepta description, no pasa nada; si lo acepta, lo recibe.
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data?.jobId) {
        // ✅ Si el backend devuelve 402 (INSUFFICIENT_JADES), mostramos mensaje claro
        if (data?.error === "INSUFFICIENT_JADES" || res.status === 402) {
          throw new Error("No tienes jades suficientes para generar un headshot.");
        }
        throw new Error(data?.error || "Error lanzando job.");
      }

      const jobId = data.jobId;
      setStatusText(`Job ${jobId} enviado. Procesando...`);

      // ✅ Polling con timeout para no quedar infinito
      const startedAt = Date.now();
      const TIMEOUT_MS = 3 * 60 * 1000; // 3 min (ajusta si tu job tarda más)

      let finished = false;
      while (!finished) {
        // timeout
        if (Date.now() - startedAt > TIMEOUT_MS) {
          throw new Error("Timeout esperando el resultado. Revisa el job en RunPod.");
        }

        await new Promise((r) => setTimeout(r, 2000));

        const auth2 = await getAuthHeadersGlobal();
        const statusRes = await fetch(`/api/status?id=${encodeURIComponent(jobId)}`, {
          headers: { ...auth2 },
        });
        const statusData = await statusRes.json().catch(() => null);

        if (!statusRes.ok || !statusData) {
          throw new Error(statusData?.error || "Error consultando estado.");
        }

        const st = statusData.status || statusData?.state || "UNKNOWN";
        setStatus(st);
        setStatusText(`Estado: ${st}`);

        if (st === "IN_QUEUE" || st === "IN_PROGRESS" || st === "RUNNING") continue;

        finished = true;

        // ✅ Resultado
        if ((st === "COMPLETED" || st === "COMPLETED_SUCCESS") && statusData.output?.image_b64) {
          setResultB64(statusData.output.image_b64);
          setStatusText("Headshot generado con éxito.");
        } else if (st === "FAILED" || st === "ERROR") {
          throw new Error(statusData?.error || "El job falló en RunPod.");
        } else {
          throw new Error("Job finalizó sin imagen.");
        }
      }
    } catch (err) {
      console.error(err);
      setStatus("ERROR");
      setStatusText("Error generando headshot.");
      setError(err?.message || String(err));
    }
  };

  const handleDownload = () => {
    if (!resultB64) return;
    const link = document.createElement("a");
    link.href = `data:image/png;base64,${resultB64}`;
    link.download = "isabelaos-headshot.png";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const isBusy = status === "IN_QUEUE" || status === "IN_PROGRESS" || status === "RUNNING";

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">Headshot Profesional IA</h2>

        <div className="mt-2 text-xs text-neutral-400">
          {statusText || "Sube una foto y genera un headshot profesional."}
        </div>

        <div className="mt-5 space-y-4 text-sm">
          <button
            type="button"
            onClick={handlePickFile}
            className="mt-2 flex h-40 w-full items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/60 text-neutral-400"
          >
            {dataUrl ? "Cambiar foto" : "Sube tu foto"}
          </button>

          <input
            id={fileInputId}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />

          {dataUrl && <img src={dataUrl} className="rounded-xl" alt="preview" />}

          <input
            type="text"
            value={extraPrompt}
            onChange={(e) => setExtraPrompt(e.target.value)}
            placeholder="Ej: fondo neutro, luz de estudio"
            className="w-full rounded-xl bg-black/60 px-3 py-2 text-white"
          />

          <button
            onClick={handleGenerateHeadshot}
            disabled={isBusy}
            className="w-full rounded-xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 font-semibold text-white disabled:opacity-50"
          >
            {isBusy ? "Generando..." : "Generar Headshot"}
          </button>

          {error && <p className="text-red-400 text-xs">{error}</p>}
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        {resultB64 ? (
          <>
            <img src={`data:image/png;base64,${resultB64}`} className="rounded-xl" alt="resultado" />
            <button onClick={handleDownload} className="mt-4 w-full rounded-xl border py-2 text-white">
              Descargar
            </button>
          </>
        ) : (
          <p className="text-neutral-400">
            Aquí aparecerá el resultado
            {isBusy ? " (procesando...)" : ""}
          </p>
        )}
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
              ["video_prompt", "Motor de video"],
              ["img2video", "Imagen → Video"],
              ["voice2video", "Voz → Video (Beta)"],
              ["library", "Biblioteca"],
              ["headshot", "📸 Headshot Pro"],
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
              ["generator", "Motor de imagen (render)"],
              ["video_prompt", "Motor de video (clips)"],
              ["img2video", "Transformación Imagen → Video"],
              ["voice2video", "Voz → Video (Beta)"],
              ["library", "Biblioteca de producción"],
              ["headshot", "📸 Headshot Pro (Premium)"],
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

            {appViewMode === "generator" && <CreatorPanel isDemo={false} />}
            {appViewMode === "video_prompt" && <VideoFromPromptPanel userStatus={userStatus} spendJades={spendJades} />}
            {appViewMode === "img2video" && <Img2VideoPanel userStatus={userStatus} spendJades={spendJades} />} 
            {appViewMode === "voice2video" && <VoiceToVideoPanel userStatus={userStatus} />}
            {appViewMode === "library" && <LibraryView />}
            {appViewMode === "headshot" && <HeadshotPhotoPanel userStatus={userStatus} />}
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
function LandingView({ onOpenAuth, onStartDemo, onOpenContact }) {
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
        <section className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-cyan-400/40 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300/90 shadow-[0_0_25px_rgba(34,211,238,0.35)]">
              <span className="h-1 w-1 rounded-full bg-cyan-300" />
              <span>BETA PRIVADA · MOTOR DE PRODUCCIÓN VISUAL CON IA</span>
            </p>

            <h1 className="mt-3 text-4xl font-semibold leading-tight md:text-5xl">
              Produce contenido visual con IA{" "}
              <span className="block bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-violet-400 bg-clip-text text-transparent">
                como un sistema, no como un experimento.
              </span>
            </h1>

            <div className="mt-3 h-[2px] w-40 rounded-full bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-transparent shadow-[0_0_20px_rgba(168,85,247,0.7)]" />

            <p className="mt-4 max-w-xl text-sm text-neutral-300">
              IsabelaOS Studio es un <strong>motor de producción visual con IA</strong> desarrollado en Guatemala,
              diseñado para creadores, estudios y equipos que necesitan velocidad, consistencia y control creativo.
            </p>

            <p className="mt-3 max-w-xl text-xs text-neutral-400">
              No se trata solo de generar imágenes o videos, sino de construir resultados repetibles dentro de un flujo
              de producción visual.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-4">
              <button
                onClick={onStartDemo}
                className="rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-3 text-sm font-semibold text-white shadow-[0_0_35px_rgba(34,211,238,0.45)] hover:shadow-[0_0_40px_rgba(236,72,153,0.6)] transition-shadow"
              >
                Probar el motor ({DEMO_LIMIT} outputs)
              </button>
              <p className="max-w-xs text-[11px] text-neutral-400">
                Luego crea tu cuenta para desbloquear {DAILY_LIMIT} renders diarios y biblioteca.
              </p>
            </div>
          </div>

          <div className="relative order-first lg:order-last">
            <div className="pointer-events-none absolute -inset-8 -z-10 rounded-[32px] bg-gradient-to-br from-cyan-500/18 via-transparent to-fuchsia-500/25 blur-3xl" />

            <h2 className="text-sm font-semibold text-white mb-3">Calidad de estudio · Render del motor actual</h2>

            <div className="mt-2 grid grid-cols-2 gap-2">
              {["img1.png", "img2.png", "img3.png", "img4.png"].map((p, i) => (
                <div
                  key={p}
                  className={`rounded-2xl border border-white/10 overflow-hidden shadow-xl ${
                    i % 2 === 0 ? "shadow-fuchsia-500/10" : "shadow-cyan-500/10"
                  }`}
                >
                  <img src={`/gallery/${p}?v=2`} alt={p} className="w-full h-auto object-cover" />
                </div>
              ))}
            </div>

            <p className="mt-3 text-[10px] text-neutral-500">
              IsabelaOS Studio · motor de producción visual con IA desarrollado en Guatemala.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------
            NUEVO: Videos en Home (entre texto y planes)
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
                Estos clips están generados por el sistema en beta. La prioridad ahora es estabilizar el flujo, mejorar
                velocidad y pulir la calidad final del render.
              </p>
            </div>

            <div className="mt-3 sm:mt-0">
              <button
                onClick={onStartDemo}
                className="rounded-xl border border-white/20 bg-white/5 px-4 py-2 text-xs text-white hover:bg-white/10"
              >
                Probar el motor ahora
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {[
              {
                src: "/gallery/video1.mp4?v=2",
                title: "Video Demo 1",
                desc: "Generación de video desde prompt (beta).",
              },
              {
                src: "/gallery/video2.mp4?v=2",
                title: "Video Demo 2",
                desc: "Prueba de consistencia visual (beta).",
              },
            ].map((v) => (
              <div
                key={v.src}
                className="relative overflow-hidden rounded-3xl border border-white/10 bg-black/35 shadow-[0_0_60px_rgba(34,211,238,0.08)]"
              >
                <div className="pointer-events-none absolute -inset-12 -z-10 bg-gradient-to-br from-cyan-500/14 via-transparent to-fuchsia-500/16 blur-3xl" />

                <div className="relative">
                  <video
                    className="w-full aspect-video object-cover"
                    src={v.src}
                    controls
                    playsInline
                    preload="metadata"
                  />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />

                  <div className="absolute left-4 top-4">
                    <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/45 px-3 py-1 text-[10px] font-semibold text-white">
                      <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
                      Demo real
                    </span>
                  </div>

                  <div className="absolute bottom-3 left-4 right-4">
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-white">{v.title}</div>
                        <div className="text-[11px] text-neutral-200/80">{v.desc}</div>
                      </div>
                      <div className="hidden sm:block text-[10px] text-neutral-300/80">
                        /gallery/{v.title === "Video Demo 1" ? "video1.mp4" : "video2.mp4"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ✅ Planes (se queda en Home) */}
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
// Root App
// ---------------------------------------------------------
export default function App() {
  const { user } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [demoMode, setDemoMode] = useState(false);

  // ✅ NUEVO: navegación simple en landing
  const [landingPage, setLandingPage] = useState("home"); // "home" | "contact"

  if (user) return <DashboardView />;

  return (
    <>
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />

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
              onStartDemo={() => setDemoMode(true)}
              onOpenContact={() => setLandingPage("contact")}
            />
          )}

          {landingPage === "contact" && (
            <ContactView onBack={() => setLandingPage("home")} />
          )}
        </>
      )}
    </>
  );
}


