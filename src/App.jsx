import { useState, useEffect } from "react";

import { useAuth } from "./context/AuthContext";

import {
  saveGenerationInSupabase,
  loadGenerationsForUser,
  getTodayGenerationCount,
  deleteGenerationFromSupabase, // NUEVO: para borrar desde Supabase
} from "./lib/generations";

import { optimizePrompt } from "./lib/optimize_prompt"; // ✅ NUEVO IMPORT

// ---------------------------------------------------------
// LÍMITES GLOBALES
// ---------------------------------------------------------
const DEMO_LIMIT = 3; // Imágenes para usuarios sin registrar (Modo Invitado)
const DAILY_LIMIT = 5; // Imágenes para usuarios registrados (Modo Beta Gratuito)

// ---------------------------------------------------------
// PayPal – Client ID
// ---------------------------------------------------------
const PAYPAL_CLIENT_ID =
  import.meta.env.VITE_PAYPAL_CLIENT_ID ||
  "AZgwhtDkXVf9N6VrwtWk6dzwzM65DWBrM3dn3Og4DXgZhbxSxqRu1UWdEtbj12W_7ItmcrNhZDI3mtPG";

// ---------------------------------------------------------
// Helper scroll suave
// ---------------------------------------------------------
function scrollToId(id) {
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// ---------------------------------------------------------
// Botón PayPal reutilizable
// ---------------------------------------------------------
function PayPalButton({ amount = "5.00", containerId, onPaid }) {
  const divId = containerId || "paypal-button-container";

  useEffect(() => {
    if (!PAYPAL_CLIENT_ID) {
      console.warn("No hay PAYPAL_CLIENT_ID configurado");
      return;
    }

    const renderButtons = () => {
      if (!window.paypal) return;

      window.paypal
        .Buttons({
          style: {
            layout: "horizontal",
            color: "black",
            shape: "pill",
            label: "paypal",
          },
          createOrder: (data, actions) => {
            return actions.order.create({
              purchase_units: [
                {
                  amount: {
                    value: amount,
                    currency_code: "USD",
                  },
                  description: "IsabelaOS Studio – Plan Basic",
                },
              ],
            });
          },
          onApprove: async (data, actions) => {
            try {
              const details = await actions.order.capture();
              console.log("Pago PayPal completado:", details);

              if (typeof onPaid === "function") {
                try {
                  onPaid(details);
                } catch (cbErr) {
                  console.error("Error en onPaid PayPal:", cbErr);
                }
              } else {
                alert(
                  "Pago completado con PayPal. En la siguiente versión marcaremos automáticamente tu plan como activo en IsabelaOS Studio."
                );
              }
            } catch (err) {
              console.error("Error al capturar pago PayPal:", err);
              alert("Ocurrió un error al confirmar el pago con PayPal.");
            }
          },
          onError: (err) => {
            console.error("Error PayPal:", err);
            alert("Error al conectar con PayPal.");
          },
        })
        .render(`#${divId}`);
    };

    const existingScript = document.querySelector(
      'script[src*="https://www.paypal.com/sdk/js"]'
    );

    if (existingScript) {
      if (window.paypal) {
        renderButtons();
      } else {
        existingScript.addEventListener("load", renderButtons);
      }
      return;
    }

    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&currency=USD`;
    script.async = true;
    script.onload = renderButtons;
    document.body.appendChild(script);

    return () => {};
  }, [amount, divId, onPaid]);

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
        alert(
          "Cuenta creada. Si Supabase lo requiere, revisa tu correo para confirmar la cuenta."
        );
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
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1 text-neutral-400 hover:bg-white/10"
          >
            ✕
          </button>
        </div>

        <p className="mt-2 text-xs text-neutral-400">
          Usa tu correo o entra con Google para usar isabelaOs Studio.
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

          {error && (
            <p className="text-xs text-red-400 whitespace-pre-line">{error}</p>
          )}

          <button
            type="submit"
            disabled={localLoading}
            className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {localLoading
              ? "Procesando..."
              : mode === "login"
              ? "Entrar"
              : "Registrarme"}
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
              <button
                type="button"
                onClick={() => setMode("register")}
                className="text-cyan-300 underline"
              >
                Regístrate aquí
              </button>
            </>
          ) : (
            <>
              ¿Ya tienes cuenta?{" "}
              <button
                type="button"
                onClick={() => setMode("login")}
                className="text-cyan-300 underline"
              >
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
// Panel del creador (generador de imágenes) - sin biblioteca
// ---------------------------------------------------------
function CreatorPanel({ isDemo = false, onAuthRequired }) {
  const { user } = useAuth();

  const userLoggedIn = !isDemo && user;

  const [prompt, setPrompt] = useState(
    "Cinematic portrait, ultra detailed, soft light, 8k"
  );
  const [negative, setNegative] = useState(
    "blurry, low quality, deformed, watermark, text"
  );
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);
  const [steps, setSteps] = useState(22);

  // NUEVO: toggle para automatizar el prompt con OpenAI
  const [autoPrompt, setAutoPrompt] = useState(false);

  const [status, setStatus] = useState("IDLE");
  const [statusText, setStatusText] = useState("");
  const [imageB64, setImageB64] = useState(null);
  const [error, setError] = useState("");

  const [dailyCount, setDailyCount] = useState(0);
  const [isPremium, setIsPremium] = useState(false);

  const premiumKey = userLoggedIn ? `isabelaos_premium_${user.id}` : null;

  useEffect(() => {
    if (!userLoggedIn) {
      setIsPremium(false);
      setDailyCount(0);
      return;
    }

    if (user.email === "exportalling@gmail.com") {
      setIsPremium(true);
      if (premiumKey) {
        try {
          localStorage.setItem(premiumKey, "1");
        } catch (e) {
          console.warn("No se pudo guardar premium para exportalling:", e);
        }
      }
      return;
    }

    try {
      const stored = premiumKey ? localStorage.getItem(premiumKey) : null;
      setIsPremium(stored === "1");
    } catch (e) {
      console.warn("No se pudo leer premium desde localStorage:", e);
      setIsPremium(false);
    }
  }, [userLoggedIn, user, premiumKey]);

  const handlePaddleCheckout = async () => {
    if (!userLoggedIn) {
      alert("Por favor, inicia sesión para activar el plan.");
      onAuthRequired && onAuthRequired();
      return;
    }
    try {
      const res = await fetch("/api/paddle-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        console.error("Respuesta Paddle:", data);
        alert("No se pudo abrir el pago con Paddle. Intenta de nuevo más tarde.");
      }
    } catch (err) {
      console.error("Error Paddle:", err);
      alert("Error al conectar con Paddle.");
    }
  };

  useEffect(() => {
    if (!userLoggedIn) {
      setDailyCount(0);
      return;
    }

    (async () => {
      const countToday = await getTodayGenerationCount(user.id);
      setDailyCount(countToday);
    })();
  }, [userLoggedIn, user]);

  const [demoCount, setDemoCount] = useState(0);

  useEffect(() => {
    if (isDemo) {
      try {
        const storedDemoCount =
          localStorage.getItem("isabelaos_demo_count") || "0";
        setDemoCount(Number(storedDemoCount));
      } catch (e) {
        console.warn("Error leyendo demo count:", e);
      }
    }
  }, [isDemo]);

  const handleGenerate = async () => {
    setError("");

    const currentLimit = isDemo ? DEMO_LIMIT : DAILY_LIMIT;
    const currentCount = isDemo ? demoCount : dailyCount;

    if (!isPremium && currentCount >= currentLimit) {
      setStatus("ERROR");
      setStatusText("Límite de generación alcanzado.");

      if (isDemo && onAuthRequired) {
        alert(
          `Has agotado tus ${DEMO_LIMIT} imágenes de prueba. Crea tu cuenta GRATIS para obtener ${DAILY_LIMIT} imágenes al día, guardar tu historial y descargar.`
        );
        onAuthRequired();
      } else if (userLoggedIn) {
        setError(
          `Has llegado al límite de ${DAILY_LIMIT} imágenes gratuitas por hoy. Activa la suscripción mensual de US$5 para generar sin límite y desbloquear todos los módulos premium (como la Foto Navideña IA).`
        );
      }
      return;
    }

    setImageB64(null);

    // ✅ NUEVO: decidir qué prompt usar (original u optimizado)
    let effectivePrompt = prompt;

    if (autoPrompt) {
      setStatus("IN_QUEUE");
      setStatusText("Optimizando prompt con IA (OpenAI)...");
      const optimized = await optimizePrompt(prompt);
      if (optimized && typeof optimized === "string") {
        effectivePrompt = optimized;
        // 👉 aquí actualizamos el textarea para que VEAS el prompt optimizado
        setPrompt(optimized);
        setStatusText("Prompt optimizado. Enviando job a RunPod...");
      } else {
        setStatusText(
          "No se pudo optimizar el prompt. Enviando el texto original a RunPod..."
        );
      }
    } else {
      setStatus("IN_QUEUE");
      setStatusText("Enviando job a RunPod...");
    }

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // 🔥 ahora el backend recibe SIEMPRE el prompt final
          prompt: effectivePrompt,
          negative_prompt: negative,
          width: Number(width),
          height: Number(height),
          steps: Number(steps),
          // bandera solo informativa
          optimize_prompt: autoPrompt,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || "Error en /api/generate, revisa los logs.");
      }

      const jobId = data.jobId;
      setStatusText(`Job enviado. ID: ${jobId}. Consultando estado...`);

      let finished = false;
      while (!finished) {
        await new Promise((r) => setTimeout(r, 2000));

        const statusRes = await fetch(`/api/status?id=${jobId}`);
        const statusData = await statusRes.json();

        if (!statusRes.ok || statusData.error) {
          throw new Error(statusData.error || "Error al consultar /api/status.");
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
            const newDemoCount = demoCount + 1;
            setDemoCount(newDemoCount);
            localStorage.setItem("isabelaos_demo_count", String(newDemoCount));
          } else if (userLoggedIn) {
            setDailyCount((prev) => prev + 1);

            const dataUrl = `data:image/png;base64,${b64}`;
            saveGenerationInSupabase({
              userId: user.id,
              imageUrl: dataUrl,
              prompt: "",
              negativePrompt: "",
              width: Number(width),
              height: Number(height),
              steps: Number(steps),
            }).catch((e) => {
              console.error("Error guardando en Supabase:", e);
            });
          }
        } else {
          throw new Error("Job terminado pero sin imagen en la salida.");
        }
      }
    } catch (err) {
      console.error(err);
      setStatus("ERROR");
      setStatusText("Error al generar la imagen.");
      setError(err.message || String(err));
    }
  };

  const handleDownload = () => {
    if (isDemo) {
      alert(
        "Para descargar tu imagen, por favor, crea tu cuenta o inicia sesión."
      );
      onAuthRequired && onAuthRequired();
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

  const handlePayPalUnlock = () => {
    if (!userLoggedIn || !premiumKey) return;
    try {
      localStorage.setItem(premiumKey, "1");
      setIsPremium(true);
      setError("");
      setStatus("IDLE");
      setStatusText(
        "Plan Basic activado: ya no tienes límite diario en este navegador y se desbloquean los módulos premium mientras dure la beta."
      );
      alert(
        "Tu Plan Basic está activo. Desde ahora puedes generar imágenes sin límite y acceder a los módulos premium (como la Foto Navideña IA) mientras dure la beta."
      );
    } catch (e) {
      console.error("No se pudo guardar premium en localStorage:", e);
    }
  };

  if (!userLoggedIn && !isDemo) {
    return (
      <div className="rounded-3xl border border-yellow-400/30 bg-yellow-500/5 p-6 text-center text-sm text-yellow-100">
        <p className="font-medium">
          Debes iniciar sesión para usar el generador de imágenes.
        </p>
        <p className="mt-1 text-xs text-yellow-200/80">
          Desde tu cuenta podrás crear imágenes con nuestro motor real conectado
          a RunPod. {DAILY_LIMIT} imágenes diarias gratis; si quieres ir más
          allá, podrás activar el plan de US$5/mes para generar sin límite y
          desbloquear todos los módulos premium.
        </p>
      </div>
    );
  }

  const currentLimit = isDemo ? DEMO_LIMIT : DAILY_LIMIT;
  const currentCount = isDemo ? demoCount : dailyCount;
  const remaining = currentLimit - currentCount;

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* Formulario */}
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">
          Generador desde prompt
        </h2>

        {isDemo && (
          <div className="mt-4 rounded-2xl border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-[11px] text-cyan-100">
            Modo de prueba gratuito: te quedan {remaining} imágenes de prueba
            sin registrarte. La descarga y la biblioteca requieren crear una
            cuenta.
          </div>
        )}

        {userLoggedIn && !isPremium && remaining <= 2 && remaining > 0 && (
          <div className="mt-4 rounded-2xl border border-yellow-400/40 bg-yellow-500/10 px-4 py-2 text-[11px] text-yellow-100">
            Atención: solo te quedan {remaining} imágenes gratis hoy. Activa el
            plan ilimitado de US$5/mes para seguir generando y desbloquear los
            módulos premium.
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

          {/* NUEVO: toggle de optimización de prompt con IA (OpenAI) */}
          <div className="flex items-start justify-between gap-3 text-xs">
            <label className="flex items-center gap-2 text-neutral-300">
              <input
                type="checkbox"
                checked={autoPrompt}
                onChange={(e) => setAutoPrompt(e.target.checked)}
                className="h-4 w-4 rounded border-white/30 bg-black/70"
              />
              <span>Optimizar mi prompt con IA (OpenAI)</span>
            </label>
            <span className="text-[10px] text-neutral-500 text-right">
              Si está activado, el sistema ajusta tu texto automáticamente antes
              de enviar el render al motor en RunPod.
            </span>
          </div>

          <div>
            <label className="text-neutral-300">Negative prompt</label>
            <textarea
              className="mt-1 h-20 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              value={negative}
              onChange={(e) => setNegative(e.target.value)}
            />
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
                onChange={(e) => setSteps(e.target.value)}
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
                onChange={(e) => setWidth(e.target.value)}
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
                onChange={(e) => setHeight(e.target.value)}
              />
            </div>
          </div>

          <div className="mt-2 rounded-2xl bg-black/50 px-4 py-2 text-xs text-neutral-300">
            Estado actual: {statusText || "Listo para generar."}
            <br />
            <span className="text-[11px] text-neutral-400">
              {isDemo && `Uso de prueba: ${currentCount} / ${currentLimit}.`}
              {userLoggedIn && isPremium && (
                <>
                  Uso de hoy: {currentCount}. Plan Basic activo (sin límite y con
                  acceso a módulos premium).
                </>
              )}
              {userLoggedIn && !isPremium && (
                <>
                  Uso de hoy: {currentCount} / {currentLimit} imágenes.
                </>
              )}
            </span>
          </div>

          {error && (
            <p className="text-xs text-red-400 whitespace-pre-line">{error}</p>
          )}

          <button
            onClick={handleGenerate}
            disabled={
              status === "IN_QUEUE" ||
              status === "IN_PROGRESS" ||
              (!isPremium && currentCount >= currentLimit)
            }
            className="mt-4 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {!isPremium && currentCount >= currentLimit
              ? "Límite alcanzado (Crea cuenta / Desbloquea plan)"
              : status === "IN_QUEUE" || status === "IN_PROGRESS"
              ? "Generando..."
              : "Generar imagen desde prompt"}
          </button>

          {userLoggedIn && !isPremium && currentCount >= DAILY_LIMIT && (
            <>
              <button
                type="button"
                onClick={handlePaddleCheckout}
                className="mt-3 w-full rounded-2xl border border-yellow-400/60 py-2 text-xs font-semibold text-yellow-100 hover:bg-yellow-500/10"
              >
                Desbloquear con IsabelaOS Basic – US$5/mes (tarjeta / Paddle)
              </button>

              <div className="mt-3 text-[11px] text-neutral-400">
                o pagar con <span className="font-semibold">PayPal</span>:
                <PayPalButton
                  amount="5.00"
                  containerId="paypal-button-panel"
                  onPaid={handlePayPalUnlock}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Resultado */}
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6 flex flex-col">
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
            className="mt-4 w-full rounded-2xl border border-white/30 py-2 text-xs text.white hover:bg-white/10"
          >
            {isDemo ? "Descargar (Requiere crear cuenta)" : "Descargar imagen"}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// Biblioteca (LibraryView) – usa Supabase
// ---------------------------------------------------------
/* ... TODO lo demás de tu archivo se queda EXACTAMENTE igual ...
   (LibraryView, VideoPlaceholderPanel, XmasPhotoPanel, DashboardView,
    LandingView y el export default App que ya tienes).
   No toqué nada de eso para no mover ni cambiar tu interfaz.
*/
