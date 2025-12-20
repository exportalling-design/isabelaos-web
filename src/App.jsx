import { useState, useEffect } from "react";

import { useAuth } from "./context/AuthContext";

import {
  saveGenerationInSupabase,
  loadGenerationsForUser,
  getTodayGenerationCount,
  deleteGenerationFromSupabase, // NUEVO: para borrar desde Supabase
} from "./lib/generations";

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
          <h3 className="text-lg font-semibold text.white">
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
              className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text.white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
            />
          </div>
          <div>
            <label className="text-xs text-neutral-300">Contraseña</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text.white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 whitespace-pre-line">{error}</p>
          )}

          <button
            type="submit"
            disabled={localLoading}
            className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-2 text-sm font-semibold text.white disabled:opacity-60"
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
          className="mt-3 w-full rounded-2xl border border-white/20 py-2 text-sm text.white hover:bg-white/10 disabled:opacity-60"
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

  // NUEVO: almacenamos el prompt optimizado por separado
  const [optimizedPrompt, setOptimizedPrompt] = useState("");
  const [optimizedNegative, setOptimizedNegative] = useState("");

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
        alert(
          "No se pudo abrir el pago con Paddle. Intenta de nuevo más tarde."
        );
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

  // NUEVO: función que llama al endpoint /api/optimize-prompt para el prompt positivo
  const optimizePromptIfNeeded = async (originalPrompt) => {
    if (!autoPrompt || !originalPrompt?.trim()) {
      setOptimizedPrompt("");
      return originalPrompt;
    }

    try {
      setStatus("OPTIMIZING");
      setStatusText("Optimizando prompt con IA...");

      const res = await fetch("/api/optimize-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: originalPrompt }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.ok || !data.optimizedPrompt) {
        console.warn("No se pudo optimizar el prompt, usando el original.", data);
        setStatusText(
          "No se pudo optimizar el prompt; usando el texto original para el render."
        );
        setOptimizedPrompt("");
        return originalPrompt;
      }

      const optimized = data.optimizedPrompt;
      setOptimizedPrompt(optimized); // mostramos el prompt mejorado debajo del textarea
      return optimized;
    } catch (err) {
      console.error("Error al optimizar prompt:", err);
      setStatusText(
        "Error al optimizar el prompt; usando el texto original para el render."
      );
      setOptimizedPrompt("");
      return originalPrompt;
    }
  };

  // NUEVO: optimizar también el negative prompt con el mismo endpoint
  const optimizeNegativeIfNeeded = async (originalNegative) => {
    if (!autoPrompt || !originalNegative?.trim()) {
      setOptimizedNegative("");
      return originalNegative;
    }

    try {
      setStatus("OPTIMIZING");
      setStatusText("Optimizando negative prompt con IA...");

      const res = await fetch("/api/optimize-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: originalNegative }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.ok || !data.optimizedPrompt) {
        console.warn(
          "No se pudo optimizar el negative prompt, usando el original.",
          data
        );
        setStatusText(
          "No se pudo optimizar el negative prompt; usando el texto original para el render."
        );
        setOptimizedNegative("");
        return originalNegative;
      }

      const optimized = data.optimizedPrompt;
      setOptimizedNegative(optimized); // mostramos el negative mejorado debajo del textarea
      return optimized;
    } catch (err) {
      console.error("Error al optimizar negative prompt:", err);
      setStatusText(
        "Error al optimizar el negative prompt; usando el texto original para el render."
      );
      setOptimizedNegative("");
      return originalNegative;
    }
  };

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

    // 1) si está activado, primero optimizamos el prompt (positivo) y el negative
    let promptToUse = prompt;
    let negativeToUse = negative;

    if (autoPrompt) {
      promptToUse = await optimizePromptIfNeeded(prompt);
      negativeToUse = await optimizeNegativeIfNeeded(negative);
    } else {
      setOptimizedPrompt("");
      setOptimizedNegative("");
    }

    // 2) luego lanzamos el render normal a RunPod, usando los textos optimizados
    setStatus("IN_QUEUE");
    setStatusText("Enviando job a RunPod...");

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptToUse,
          negative_prompt: negativeToUse,
          width: Number(width),
          height: Number(height),
          steps: Number(steps),
          // se mantiene por compatibilidad, aunque ya optimizamos antes
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
              prompt: "", // si quieres, aquí luego podemos guardar promptToUse
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
              className="mt-1 h-24 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text.white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            {autoPrompt && optimizedPrompt && (
              <div className="mt-2 rounded-2xl border border-cyan-400/40 bg-black/60 px-3 py-2 text-[11px] text-cyan-200">
                <span className="font-semibold">Prompt optimizado:</span>{" "}
                {optimizedPrompt}
              </div>
            )}
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
              className="mt-1 h-20 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text.white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              value={negative}
              onChange={(e) => setNegative(e.target.value)}
            />
            {autoPrompt && optimizedNegative && (
              <div className="mt-2 rounded-2xl border border-fuchsia-400/40 bg-black/60 px-3 py-2 text-[11px] text-fuchsia-100">
                <span className="font-semibold">Negative optimizado:</span>{" "}
                {optimizedNegative}
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-neutral-300">Steps</label>
              <input
                type="number"
                min={5}
                max={50}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text.white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
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
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text.white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
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
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text.white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
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
                  Uso de hoy: {currentCount}. Plan Basic activo (sin límite y
                  con acceso a módulos premium).
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
            className="mt-4 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text.white disabled:opacity-60"
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
        <h2 className="text-lg font-semibold text.white">Resultado</h2>
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
// NUEVO: Panel de generación de video
// ---------------------------------------------------------
function VideoPanel() {
  const { user } = useAuth();

  const [prompt, setPrompt] = useState(
    "beautiful latina woman in an elegant tight blue dress, confident runway walk towards the camera, studio background, ultra detailed, 8k"
  );
  const [negative, setNegative] = useState(
    "low quality, blurry, bad anatomy, deformed, glitch, watermark, noisy, pixelated, static pose, nsfw, nude, explicit"
  );

  const [autoPrompt, setAutoPrompt] = useState(false);
  const [optimizedPrompt, setOptimizedPrompt] = useState("");
  const [optimizedNegative, setOptimizedNegative] = useState("");

  const [aspectRatio, setAspectRatio] = useState("9:16"); // 1:1, 9:16, 16:9
  const [quality, setQuality] = useState("HD"); // HD, MAX
  const [duration, setDuration] = useState(5); // segundos: 5 o 10

  const [status, setStatus] = useState("IDLE");
  const [statusText, setStatusText] = useState("");
  const [videoUrl, setVideoUrl] = useState(null);
  const [error, setError] = useState("");

  const optimizeOne = async (label, text, setter) => {
    if (!autoPrompt || !text?.trim()) {
      setter("");
      return text;
    }

    try {
      setStatus("OPTIMIZING");
      setStatusText(`Optimizando ${label} con IA...`);

      const res = await fetch("/api/optimize-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.ok || !data.optimizedPrompt) {
        console.warn(`No se pudo optimizar ${label}, usando original.`, data);
        setter("");
        setStatusText(
          `No se pudo optimizar el ${label}; usando el texto original para el video.`
        );
        return text;
      }

      const optimized = data.optimizedPrompt;
      setter(optimized);
      return optimized;
    } catch (err) {
      console.error(`Error optimizando ${label}:`, err);
      setter("");
      setStatusText(
        `Error al optimizar el ${label}; usando el texto original para el video.`
      );
      return text;
    }
  };

  const handleGenerateVideo = async () => {
    setError("");
    setVideoUrl(null);

    if (!user) {
      setError("Debes iniciar sesión para generar video.");
      return;
    }

    // 1) Optimizar prompts si está activado
    let promptToUse = prompt;
    let negativeToUse = negative;

    if (autoPrompt) {
      promptToUse = await optimizeOne("prompt", prompt, setOptimizedPrompt);
      negativeToUse = await optimizeOne(
        "negative prompt",
        negative,
        setOptimizedNegative
      );
    } else {
      setOptimizedPrompt("");
      setOptimizedNegative("");
    }

    setStatus("GENERATING");
    setStatusText(
      "Generando video en RunPod (CogVideoX + BodySync) y haciendo upscale..."
    );

    try {
      const res = await fetch("/api/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptToUse,
          negative_prompt: negativeToUse,
          aspect_ratio: aspectRatio, // "1:1" | "9:16" | "16:9"
          duration_seconds: duration, // 5 | 10
          quality, // "HD" | "MAX"
          optimize_prompt: autoPrompt,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data || !data.ok || !data.videoUrl) {
        console.error("Respuesta /api/generate-video:", data);
        throw new Error(
          data?.error || "Error en /api/generate-video. Revisa los logs."
        );
      }

      setVideoUrl(data.videoUrl);
      setStatus("DONE");
      setStatusText("Video generado y upscalizado correctamente.");
    } catch (err) {
      console.error("Error handleGenerateVideo:", err);
      setStatus("ERROR");
      setStatusText("Error al generar el video.");
      setError(err.message || String(err));
    }
  };

  const handleDownloadVideo = () => {
    if (!videoUrl) return;
    window.open(videoUrl, "_blank");
  };

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* Configuración de video */}
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text.white">
          Generar video desde prompt
        </h2>
        <p className="mt-1 text-xs text-neutral-400">
          Usa nuestro pipeline de video con CogVideoX y BodySync Motion
          Signature v1 para crear clips cortos caminando hacia la cámara, listos
          para reels y anuncios.
        </p>

        <div className="mt-4 space-y-4 text-sm">
          <div>
            <label className="text-neutral-300">Prompt</label>
            <textarea
              className="mt-1 h-24 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text.white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            {autoPrompt && optimizedPrompt && (
              <div className="mt-2 rounded-2xl border border-cyan-400/40 bg-black/60 px-3 py-2 text-[11px] text-cyan-200">
                <span className="font-semibold">Prompt optimizado:</span>{" "}
                {optimizedPrompt}
              </div>
            )}
          </div>

          <div className="flex items-start justify-between gap-3 text-xs">
            <label className="flex items-center gap-2 text-neutral-300">
              <input
                type="checkbox"
                checked={autoPrompt}
                onChange={(e) => setAutoPrompt(e.target.checked)}
                className="h-4 w-4 rounded border-white/30 bg-black/70"
              />
              <span>Optimizar mis prompts con IA (OpenAI)</span>
            </label>
            <span className="text-[10px] text-neutral-500 text-right">
              El sistema ajusta automáticamente tus textos antes de enviarlos al
              motor de video.
            </span>
          </div>

          <div>
            <label className="text-neutral-300">Negative prompt</label>
            <textarea
              className="mt-1 h-20 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text.white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              value={negative}
              onChange={(e) => setNegative(e.target.value)}
            />
            {autoPrompt && optimizedNegative && (
              <div className="mt-2 rounded-2xl border border-fuchsia-400/40 bg-black/60 px-3 py-2 text-[11px] text-fuchsia-100">
                <span className="font-semibold">Negative optimizado:</span>{" "}
                {optimizedNegative}
              </div>
            )}
          </div>

          {/* Aspect ratio */}
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="col-span-3">
              <p className="text-neutral-300 text-xs mb-1">
                Relación de aspecto
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAspectRatio("1:1")}
                  className={`flex-1 rounded-2xl px-3 py-2 ${
                    aspectRatio === "1:1"
                      ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                      : "bg-black/60 text-neutral-200 border border-white/10 hover:bg-white/5"
                  }`}
                >
                  1:1 (cuadrado)
                </button>
                <button
                  type="button"
                  onClick={() => setAspectRatio("9:16")}
                  className={`flex-1 rounded-2xl px-3 py-2 ${
                    aspectRatio === "9:16"
                      ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                      : "bg-black/60 text-neutral-200 border border.white/10 hover:bg.white/5"
                  }`}
                >
                  9:16 (vertical)
                </button>
                <button
                  type="button"
                  onClick={() => setAspectRatio("16:9")}
                  className={`flex-1 rounded-2xl px-3 py-2 ${
                    aspectRatio === "16:9"
                      ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                      : "bg-black/60 text-neutral-200 border border.white/10 hover:bg.white/5"
                  }`}
                >
                  16:9 (horizontal)
                </button>
              </div>
            </div>
          </div>

          {/* Calidad y duración */}
          <div className="grid gap-3 md:grid-cols-2 text-xs">
            <div>
              <p className="text-neutral-300 mb-1">Calidad</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setQuality("HD")}
                  className={`flex-1 rounded-2xl px-3 py-2 ${
                    quality === "HD"
                      ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                      : "bg-black/60 text-neutral-200 border border.white/10 hover:bg.white/5"
                  }`}
                >
                  HD 720p
                </button>
                <button
                  type="button"
                  onClick={() => setQuality("MAX")}
                  className={`flex-1 rounded-2xl px-3 py-2 ${
                    quality === "MAX"
                      ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                      : "bg-black/60 text-neutral-200 border border.white/10 hover:bg.white/5"
                  }`}
                >
                  Máxima
                </button>
              </div>
            </div>

            <div>
              <p className="text-neutral-300 mb-1">Duración</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDuration(5)}
                  className={`flex-1 rounded-2xl px-3 py-2 ${
                    duration === 5
                      ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                      : "bg-black/60 text-neutral-200 border border.white/10 hover:bg.white/5"
                  }`}
                >
                  5 segundos
                </button>
                <button
                  type="button"
                  onClick={() => setDuration(10)}
                  className={`flex-1 rounded-2xl px-3 py-2 ${
                    duration === 10
                      ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                      : "bg-black/60 text-neutral-200 border border.white/10 hover:bg.white/5"
                  }`}
                >
                  10 segundos
                </button>
              </div>
            </div>
          </div>

          <div className="mt-2 rounded-2xl bg-black/50 px-4 py-2 text-xs text-neutral-300">
            Estado actual:{" "}
            {statusText ||
              "Listo para generar un clip de video con BodySync v1."}
          </div>

          {error && (
            <p className="text-xs text-red-400 whitespace-pre-line">{error}</p>
          )}

          <button
            type="button"
            onClick={handleGenerateVideo}
            disabled={status === "GENERATING"}
            className="mt-4 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text.white disabled:opacity-60"
          >
            {status === "GENERATING"
              ? "Generando video..."
              : "Generar video desde prompt"}
          </button>

          <p className="mt-2 text-[11px] text-neutral-400">
            Este módulo usa una resolución base optimizada en el pod de video y
            luego aplica un upscale a 720p o calidad máxima recomendada para
            IsabelaOS Studio.
          </p>
        </div>
      </div>

      {/* Vista previa del video */}
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6 flex flex-col">
        <h2 className="text-lg font-semibold text.white">Resultado</h2>
        <div className="mt-4 flex h-[420px] flex-1 items-center justify-center rounded-2xl bg-black/70 text-sm text-neutral-400">
          {videoUrl ? (
            <video
              src={videoUrl}
              controls
              className="h-full w-full rounded-2xl object-contain"
            />
          ) : (
            <p>
              Aquí verás tu clip en cuanto termine el proceso de generación y
              upscale.
            </p>
          )}
        </div>
        {videoUrl && (
          <button
            type="button"
            onClick={handleDownloadVideo}
            className="mt-4 w-full rounded-2xl border border-white/30 py-2 text-xs text.white hover:bg-white/10"
          >
            Abrir / descargar video
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
        if (mapped.length > 0) {
          setSelected(mapped[0]);
        }
      } catch (e) {
        console.error("Error cargando biblioteca:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const handleDeleteSelected = async () => {
    if (!selected || !user) return;
    const confirmDelete = window.confirm(
      "¿Seguro que quieres eliminar esta imagen de tu biblioteca? Esta acción también la borrará de Supabase."
    );
    if (!confirmDelete) return;

    try {
      setDeleting(true);
      await deleteGenerationFromSupabase(selected.id);
      setItems((prev) => prev.filter((it) => it.id !== selected.id));
      setSelected((prevSelected) => {
        const remaining = items.filter((it) => it.id !== prevSelected.id);
        return remaining.length > 0 ? remaining[0] : null;
      });
    } catch (e) {
      console.error("Error eliminando imagen de Supabase:", e);
      alert("No se pudo eliminar la imagen. Intenta de nuevo.");
    } finally {
      setDeleting(false);
    }
  };

  if (!user) {
    return (
      <div className="rounded-3xl border border-yellow-400/30 bg-yellow-500/5 p-6 text-center text-sm text-yellow-100">
        Inicia sesión para acceder a tu biblioteca de imágenes generadas.
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1.1fr_1.4fr]">
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text.white">Biblioteca</h2>
        <p className="mt-1 text-xs text-neutral-400">
          Aquí aparecerán las imágenes generadas desde tu cuenta conectada a
          RunPod. Puedes seleccionar una para verla en grande y eliminarla si ya
          no la necesitas.
        </p>

        {loading ? (
          <p className="mt-4 text-xs text-neutral-400">Cargando historial...</p>
        ) : items.length === 0 ? (
          <p className="mt-4 text-xs text-neutral-400">
            Aún no tienes imágenes guardadas en tu cuenta.
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelected(item)}
                className={`group relative overflow-hidden rounded-xl border ${
                  selected && selected.id === item.id
                    ? "border-cyan-400"
                    : "border-white/10"
                } bg-black/60`}
              >
                <img
                  src={item.src}
                  alt="Generación"
                  className="h-24 w-full object-cover group-hover:opacity-80"
                />
                <div className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1 text-[10px] text-neutral-300">
                  {new Date(item.createdAt).toLocaleString()}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-3xl border border-white/10 bg-black/40 p-6 flex flex-col">
        <h2 className="text-lg font-semibold text.white">Vista previa</h2>
        <div className="mt-4 flex h-[420px] flex-1 items-center justify-center rounded-2xl bg-black/70 text-sm text-neutral-400">
          {selected ? (
            <img
              src={selected.src}
              alt="Imagen seleccionada"
              className="h-full w-full rounded-2xl object-contain"
            />
          ) : (
            <p>Selecciona una imagen de tu biblioteca para verla en grande.</p>
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
// Placeholder de video (ya no se usa, pero lo dejamos por si acaso)
// ---------------------------------------------------------
function VideoPlaceholderPanel() {
  return (
    <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
      <h2 className="text-lg font-semibold text.white">
        Generador de video desde prompt (próximamente)
      </h2>
      <p className="mt-2 text-sm text-neutral-300">
        Estamos preparando el módulo de video para que puedas escribir un prompt
        y obtener secuencias animadas con calidad cinematográfica usando nuestro
        motor en RunPod.
      </p>
      <p className="mt-4 text-xs text-red-400 font-semibold">
        Estamos trabajando para tener este módulo lo antes posible con la máxima
        calidad de estudio.
      </p>
      <div className="mt-6 grid gap-4 md:grid-cols-2 text-xs text-neutral-300">
        <div className="rounded-2xl border border-white/10 bg-black/60 p-4">
          <h3 className="text-sm font-semibold text.white">
            ¿Qué podrás hacer?
          </h3>
          <ul className="mt-2 space-y-1 list-disc list-inside">
            <li>Clips cortos desde texto (5–10 segundos).</li>
            <li>Escenas con cámara cinematográfica.</li>
            <li>Opciones de estilo (realista, anime, artístico).</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/60 p-4">
          <h3 className="text-sm font-semibold text.white">
            Integración con BodySync
          </h3>
          <p className="mt-2">
            Más adelante podrás combinar este módulo con BodySync para aplicar
            movimiento corporal a tus personajes IA.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// Módulo Foto Navideña IA (Premium)
// ---------------------------------------------------------
function XmasPhotoPanel() {
  const { user } = useAuth();

  const [dataUrl, setDataUrl] = useState(null); // data:image/...;base64,xxx
  const [pureB64, setPureB64] = useState(null); // solo base64
  const [extraPrompt, setExtraPrompt] = useState("");
  const [status, setStatus] = useState("IDLE");
  const [statusText, setStatusText] = useState("");
  const [resultB64, setResultB64] = useState(null);
  const [error, setError] = useState("");

  // 🔐 NUEVO: estado premium para bloquear este módulo a usuarios sin plan
  const [isPremium, setIsPremium] = useState(false);

  useEffect(() => {
    if (!user) {
      setIsPremium(false);
      return;
    }

    const premiumKey = `isabelaos_premium_${user.id}`;

    if (user.email === "exportalling@gmail.com") {
      setIsPremium(true);
      try {
        localStorage.setItem(premiumKey, "1");
      } catch (e) {
        console.warn("No se pudo guardar premium para exportalling en Xmas:", e);
      }
      return;
    }

    try {
      const stored = localStorage.getItem(premiumKey);
      setIsPremium(stored === "1");
    } catch (e) {
      console.warn("No se pudo leer premium desde localStorage en Xmas:", e);
      setIsPremium(false);
    }
  }, [user]);

  const fileInputId = "xmas-file-input";

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
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrlResult = await fileToBase64(file);
      setDataUrl(dataUrlResult);
      const parts = String(dataUrlResult).split(",");
      setPureB64(parts[1] || null);
    } catch (err) {
      console.error("Error leyendo archivo:", err);
      setError("No se pudo leer la imagen. Intenta con otra foto.");
    }
  };

  const handleGenerateXmas = async () => {
    setError("");

    if (!user) {
      setError("Debes iniciar sesión para usar este módulo.");
      return;
    }

    // 🔐 NUEVO: bloqueo real para usuarios sin plan Basic
    if (!isPremium) {
      setError(
        "Este módulo forma parte del Plan Basic (US$5/mes). Activa tu plan para usar Foto Navideña IA junto con el generador ilimitado desde prompt."
      );
      return;
    }

    if (!pureB64) {
      setError("Por favor sube una foto primero.");
      return;
    }

    setResultB64(null);
    setStatus("IN_QUEUE");
    setStatusText("Enviando foto navideña a RunPod...");

    try {
      const res = await fetch("/api/generate-xmas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_b64: pureB64,
          description: extraPrompt || "",
        }),
      });

      const data = await res.json().catch(() => null);
      console.log("Respuesta /api/generate-xmas:", data);

      if (!res.ok || !data || !data.ok || !data.jobId) {
        throw new Error(
          data?.error || "Error lanzando job navideño en RunPod."
        );
      }

      const jobId = data.jobId;
      setStatusText(`Foto enviada. ID: ${jobId}. Consultando estado...`);

      let finished = false;
      while (!finished) {
        await new Promise((r) => setTimeout(r, 2000));

        const statusRes = await fetch(`/api/status?id=${jobId}`);
        const statusData = await statusRes.json().catch(() => null);

        if (!statusRes.ok || !statusData) {
          throw new Error(
            statusData?.error || "Error al consultar /api/status."
          );
        }

        const st = statusData.status;
        setStatus(st);
        setStatusText(`Estado actual: ${st}...`);

        if (st === "IN_QUEUE" || st === "IN_PROGRESS") continue;

        finished = true;

        if (st === "COMPLETED" && statusData.output?.image_b64) {
          const b64 = statusData.output.image_b64;
          setResultB64(b64);
          setStatusText("Foto navideña generada con éxito.");
        } else {
          throw new Error("Job terminado pero sin imagen en la salida.");
        }
      }
    } catch (err) {
      console.error("Error en handleGenerateXmas:", err);
      setStatus("ERROR");
      setStatusText("Error al generar la foto navideña.");
      setError(err.message || String(err));
    }
  };

  const handleDownload = () => {
    if (!resultB64) return;
    const link = document.createElement("a");
    link.href = `data:image/png;base64,${resultB64}`;
    link.download = "isabelaos-xmas-photo.png";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text.white">
          Foto Navideña IA (Premium)
        </h2>
        <p className="mt-2 text-sm text-neutral-300">
          Convierte tu foto (o la de tu familia) en un retrato navideño de
          estudio profesional, con iluminación cuidada y fondo temático
          totalmente generado por IA.
        </p>
        <p className="mt-3 text-xs text-neutral-300">
          Recomendaciones para tu foto:
        </p>
        <ul className="mt-1 list-disc list-inside text-[11px] text-neutral-400">
          <li>Foto bien iluminada (de día o con buena luz dentro de casa).</li>
          <li>
            Que se vea completa la persona o la familia (sin cabezas cortadas
            ni recortes extraños).
          </li>
          <li>
            Evita filtros muy fuertes o efectos que cambien mucho los colores.
          </li>
          <li>
            Ropa normal y adecuada para todo público. Si el sistema detecta
            desnudez o ropa excesivamente reveladora, la zona será cubierta con
            color oscuro o la foto puede ser rechazada.
          </li>
        </ul>
        <p className="mt-2 text-[11px] text-neutral-400">
          El módulo intentará respetar la posición y la expresión de las
          personas, y cambiará el fondo y detalles para convertirla en una
          escena navideña lo más realista posible.
        </p>

        <div className="mt-5 space-y-4 text-sm">
          <div>
            <p className="text-xs text-neutral-300">
              1. Sube tu foto (JPG/PNG)
            </p>
            <button
              type="button"
              onClick={handlePickFile}
              className="mt-2 flex h-40 w-full items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/60 text-xs text-neutral-400 hover:border-cyan-400 hover:text-cyan-300"
            >
              {dataUrl ? "Cambiar foto" : "Haz clic para subir una foto"}
            </button>
            <input
              id={fileInputId}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
            {dataUrl && (
              <div className="mt-3 overflow-hidden rounded-2xl border border-white/10">
                <img
                  src={dataUrl}
                  alt="Foto base"
                  className="w-full object-cover"
                />
              </div>
            )}
          </div>

          <div>
            <p className="text-xs text-neutral-300">
              2. Opcional: cuéntanos quién aparece y qué tipo de escena quieres
            </p>
            <input
              type="text"
              value={extraPrompt}
              onChange={(e) => setExtraPrompt(e.target.value)}
              placeholder="Ejemplo: familia de 4 personas, dos niños pequeños, estilo sala acogedora junto al árbol de Navidad."
              className="mt-2 w-full rounded-2xl bg-black/60 px-3 py-2 text-xs text.white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
            />
            <p className="mt-1 text-[11px] text-neutral-400">
              Este texto ayuda a la IA a adaptar mejor el fondo y los detalles
              (árbol, luces, regalos, etc.). Si lo dejas vacío, se usará un
              estilo navideño estándar.
            </p>
          </div>

          <div className="mt-2 rounded-2xl bg-black/50 px-4 py-2 text-xs text-neutral-300">
            Estado actual:{" "}
            {statusText || "Listo para enviar tu foto navideña a RunPod."}
          </div>

          {error && (
            <p className="text-xs text-red-400 whitespace-pre-line">{error}</p>
          )}

          <button
            type="button"
            onClick={handleGenerateXmas}
            disabled={
              status === "IN_QUEUE" ||
              status === "IN_PROGRESS" ||
              !pureB64 ||
              !user
            }
            className="mt-3 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text.white disabled:opacity-60"
          >
            {status === "IN_QUEUE" || status === "IN_PROGRESS"
              ? "Generando foto navideña..."
              : "Generar foto navideña IA"}
          </button>

          <p className="mt-2 text-[11px] text-neutral-400">
            Este módulo forma parte de las funciones premium de IsabelaOS
            Studio. Si activas el Plan Basic (US$5/mes), podrás usarlo junto con
            el generador ilimitado desde prompt y el resto de mejoras que
            vayamos liberando en la beta.
          </p>
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-black/40 p-6 flex flex-col">
        <h2 className="text-lg font-semibold text.white">Resultado</h2>
        <div className="mt-4 flex h-[420px] flex-1 items-center justify-center rounded-2xl bg-black/70 text-sm text-neutral-400">
          {resultB64 ? (
            <img
              src={`data:image/png;base64,${resultB64}`}
              alt="Foto navideña generada"
              className="h-full w-full rounded-2xl object-contain"
            />
          ) : (
            <p>Aquí verás tu foto navideña en cuanto se complete el render.</p>
          )}
        </div>
        {resultB64 && (
          <button
            onClick={handleDownload}
            className="mt-4 w-full rounded-2xl border border-white/30 py-2 text-xs text.white hover:bg-white/10"
          >
            Descargar foto navideña
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// Dashboard (logueado) con sidebar de vistas
// ---------------------------------------------------------
function DashboardView() {
  const { user, isAdmin, signOut } = useAuth();
  const [appViewMode, setAppViewMode] = useState("generator");

  const handleContact = () => {
    const subject = encodeURIComponent("Soporte IsabelaOS Studio");
    const body = encodeURIComponent(
      "Hola, necesito ayuda con IsabelaOS Studio.\n\n(Escribe aquí tu mensaje)"
    );
    window.location.href = `mailto:contacto@isabelaos.com?subject=${subject}&body=${body}`;
  };

  return (
    <div
      className="min-h-screen w-full text-white"
      style={{
        background:
          "radial-gradient(1200px_800px_at_110%_-10%,rgba(255,23,229,0.12),transparent_60%),radial-gradient(900px_600px_at_-10%_0%,rgba(0,229,255,0.10),transparent_50%),#06070B",
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
                isabelaOs{" "}
                <span className="text-xs text-neutral-400">Studio</span>
              </div>
              <div className="text-[10px] text-neutral-500">
                Panel del creador · Beta
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <span className="hidden sm:inline text-neutral-300">
              {user?.email} {isAdmin && "· admin"}
            </span>
            <button
              onClick={handleContact}
              className="rounded-xl border border-white/20 px-3 py-1.5 text-xs text.white hover:bg-white/10"
            >
              Contacto
            </button>
            <button
              onClick={signOut}
              className="rounded-xl border border-white/20 px-4 py-1.5 text-xs text.white hover:bg-white/10"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-10">
        {/* Navegación móvil */}
        <div className="mb-4 md:hidden">
          <p className="text-[11px] font-semibold text-neutral-300 mb-2">
            Navegación
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              onClick={() => setAppViewMode("generator")}
              className={`rounded-2xl px-3 py-1.5 ${
                appViewMode === "generator"
                  ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text.white"
                  : "bg-white/5 text-neutral-200 hover:bg-white/10"
              }`}
            >
              Imagen desde prompt
            </button>
            <button
              type="button"
              onClick={() => setAppViewMode("video")}
              className={`rounded-2xl px-3 py-1.5 ${
                appViewMode === "video"
                  ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text.white"
                  : "bg-white/5 text-neutral-200 hover:bg-white/10"
              }`}
            >
              Video desde prompt
            </button>
            <button
              type="button"
              onClick={() => setAppViewMode("library")}
              className={`rounded-2xl px-3 py-1.5 ${
                appViewMode === "library"
                  ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text.white"
                  : "bg-white/5 text-neutral-200 hover:bg-white/10"
              }`}
            >
              Biblioteca
            </button>
            {/* ARREGLADO: botón morado también para Foto Navideña IA en móvil */}
            <button
              type="button"
              onClick={() => setAppViewMode("xmas")}
              className={`rounded-2xl px-3 py-1.5 ${
                appViewMode === "xmas"
                  ? "bg-gradient-to-r from-cyan-600 to-fuchsia-600 text.white"
                  : "bg-gradient-to-r from-cyan-600/70 to-fuchsia-600/70 text.white/90"
              }`}
            >
              🎄 Foto Navideña IA
            </button>
          </div>
        </div>

        <section className="flex gap-6">
          {/* Sidebar */}
          <aside className="hidden md:flex w-56 flex-col rounded-3xl border border-white/10 bg-black/60 p-4 text-xs">
            <p className="text-[11px] font-semibold text-neutral-300 mb-3">
              Navegación
            </p>
            <button
              type="button"
              onClick={() => setAppViewMode("generator")}
              className={`mb-2 w-full rounded-2xl px-3 py-2 text-left ${
                appViewMode === "generator"
                  ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text.white"
                  : "bg-white/5 text-neutral-200 hover:bg-white/10"
              }`}
            >
              Generar imagen desde prompt
            </button>
            <button
              type="button"
              onClick={() => setAppViewMode("video")}
              className={`mb-2 w-full rounded-2xl px-3 py-2 text-left ${
                appViewMode === "video"
                  ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text.white"
                  : "bg-white/5 text-neutral-200 hover:bg-white/10"
              }`}
            >
              Generar video desde prompt
            </button>
            <button
              type="button"
              onClick={() => setAppViewMode("library")}
              className={`mb-2 w-full rounded-2xl px-3 py-2 text-left ${
                appViewMode === "library"
                  ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text.white"
                  : "bg-white/5 text-neutral-200 hover:bg-white/10"
              }`}
            >
              Biblioteca
            </button>
            {/* ARREGLADO: botón morado también para Foto Navideña IA en sidebar */}
            <button
              type="button"
              onClick={() => setAppViewMode("xmas")}
              className={`mt-4 w-full rounded-2xl px-3 py-2 text-left ${
                appViewMode === "xmas"
                  ? "bg-gradient-to-r from-cyan-600 to-fuchsia-600 text.white"
                  : "bg-gradient-to-r from-cyan-600 to-fuchsia-600 text.white/90"
              }`}
            >
              🎄 Foto Navideña IA (Premium)
            </button>
          </aside>

          {/* Contenido principal */}
          <div className="flex-1 space-y-6">
            <div>
              <h1 className="text-xl font-semibold text.white">
                Panel del creador
              </h1>
              <p className="mt-1 text-xs text-neutral-400">
                Genera imágenes, guarda tu historial en la biblioteca y prueba
                los módulos especiales como Foto Navideña IA y el nuevo
                generador de video desde prompt, todo desde tu cuenta conectada
                al pipeline real en RunPod.
              </p>
            </div>

            {appViewMode === "generator" && <CreatorPanel />}
            {appViewMode === "video" && <VideoPanel />}
            {appViewMode === "library" && <LibraryView />}
            {appViewMode === "xmas" && <XmasPhotoPanel />}
          </div>
        </section>
      </main>
    </div>
  );
}

// ---------------------------------------------------------
// Landing (no sesión) con neon + BodySync
// ---------------------------------------------------------
function LandingView({ onOpenAuth, onStartDemo }) {
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactMessage, setContactMessage] = useState("");

  const handlePaddleCheckout = async () => {
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
        alert("No se pudo abrir el pago con Paddle. Intenta con Paypal.");
      }
    } catch (err) {
      console.error("Error Paddle:", err);
      alert("Error al conectar con Paddle.");
    }
  };

  const handleContactSubmit = (e) => {
    e.preventDefault();
    const subject = encodeURIComponent("Contacto desde IsabelaOS Studio");
    const body = encodeURIComponent(
      `Nombre: ${contactName}\nCorreo: ${contactEmail}\n\nMensaje:\n${contactMessage}`
    );
    window.location.href = `mailto:contacto@isabelaos.com?subject=${subject}&body=${body}`;
  };

  return (
    <div
      className="min-h-screen w-full text.white"
      style={{
        background:
          "radial-gradient(1200px_800px_at_110%_-10%,rgba(255,23,229,0.22),transparent_60%),radial-gradient(900px_600px_at_-10%_0%,rgba(0,229,255,0.22),transparent_55%),radial-gradient(700px_700px_at_50%_120%,rgba(140,90,255,0.5),transparent_60%),#05060A",
      }}
    >
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500 to-fuchsia-500 text-xs font-bold shadow-lg shadow-cyan-500/40">
              io
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">
                isabelaOs{" "}
                <span className="text-xs text-neutral-400">Studio</span>
              </div>
              <div className="text-[10px] text-neutral-500">
                Generación visual con IA
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => scrollToId("contacto")}
              className="hidden sm:inline rounded-xl border border.white/20 px-4 py-1.5 text-xs text.white hover:bg.white/10"
            >
              Contacto
            </button>
            <button
              onClick={onOpenAuth}
              className="rounded-xl border border.white/20 px-4 py-1.5 text-xs text.white hover:bg.white/10"
            >
              Iniciar sesión / Registrarse
            </button>
          </div>
        </div>
      </header>

      {/* Hero + Gallery */}
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-10">
        <section className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
          {/* Columna texto */}
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-cyan-400/40 bg.white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300/90 shadow-[0_0_25px_rgba(34,211,238,0.35)]">
              <span className="h-1 w-1 rounded-full bg-cyan-300" />
              <span>Beta privada · Motor de imagen de estudio</span>
            </p>
            <h1 className="mt-3 text-4xl font-semibold leading-tight md:text-5xl">
              Genera imágenes fotorrealistas{" "}
              <span className="block bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-violet-400 bg-clip-text text-transparent">
                con IA en la nube.
              </span>
            </h1>

            {/* Barra neón bajo el título */}
            <div className="mt-3 h-[2px] w-40 rounded-full bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-transparent shadow-[0_0_20px_rgba(168,85,247,0.7)]" />

            <p className="mt-4 max-w-xl text-sm text-neutral-300">
              IsabelaOS Studio es el primer sistema de generación visual con IA
              desarrollado desde Guatemala para creadores, estudios y agencias
              de modelos virtuales. Escribe un prompt y obtén imágenes con
              calidad de estudio en segundos.
            </p>

            <p className="mt-3 max-w-xl text-xs text-neutral-400">
              Durante la beta puedes usar nuestro motor de imágenes y, más
              adelante, acceder a módulos exclusivos como BodySync (movimiento
              corporal IA), Script2Film, CineCam y generador de video desde
              texto. Además, hemos añadido un módulo especial de{" "}
              <span className="font-semibold text.white">
                Foto Navideña IA
              </span>{" "}
              para transformar una foto real de tu familia en un retrato
              navideño de estudio con fondo totalmente generado por IA.
            </p>

            {/* NUEVO: descripción del sistema de prompts optimizados */}
            <p className="mt-2 max-w-xl text-xs text-neutral-400">
              También puedes activar la opción{" "}
              <span className="font-semibold text.white">
                “Optimizar mi prompt con IA (OpenAI)”
              </span>{" "}
              para que el sistema mejore automáticamente el texto que escribes
              antes de enviarlo al motor en la nube, tal como funciona en tu
              versión local.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-4">
              <button
                onClick={onStartDemo}
                className="rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-3 text-sm font-semibold text.white shadow-[0_0_35px_rgba(34,211,238,0.45)] hover:shadow-[0_0_40px_rgba(236,72,153,0.6)] transition-shadow"
              >
                Generar mis {DEMO_LIMIT} imágenes GRATIS ahora
              </button>
              <p className="max-w-xs text-[11px] text-neutral-400">
                Prueba la calidad del motor antes de crear tu cuenta y
                desbloquea {DAILY_LIMIT} imágenes diarias registrándote.
              </p>
            </div>

            <p className="mt-4 text-xs text-neutral-500">
              Próximamente: módulos de video y nuestro motor propio de realismo
              corporal{" "}
              <span className="font-semibold text.white">BodySync v1</span>.
            </p>
          </div>

          {/* Galería 2x2 */}
          <div className="relative order-first lg:order-last">
            {/* Halo neón detrás de la galería */}
            <div className="pointer-events-none absolute -inset-8 -z-10 rounded-[32px] bg-gradient-to-br from-cyan-500/18 via-transparent to-fuchsia-500/25 blur-3xl" />

            <h2 className="text-sm font-semibold text.white mb-3">
              Calidad de estudio · Renderizado con el motor actual
            </h2>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border.white/10 overflow-hidden shadow-xl shadow-fuchsia-500/10">
                <img
                  src="/gallery/img1.png?v=2"
                  alt="Imagen generada 1"
                  className="w-full h-auto object-cover"
                />
              </div>
              <div className="rounded-2xl border border.white/10 overflow-hidden shadow-xl shadow-cyan-500/10">
                <img
                  src="/gallery/img2.png?v=2"
                  alt="Imagen generada 2"
                  className="w-full h-auto object-cover"
                />
              </div>
              <div className="rounded-2xl border border.white/10 overflow-hidden shadow-xl shadow-fuchsia-500/10">
                <img
                  src="/gallery/img3.png?v=2"
                  alt="Imagen generada 3"
                  className="w-full h-auto object-cover"
                />
              </div>
              <div className="rounded-2xl border border.white/10 overflow-hidden shadow-xl shadow-cyan-500/10">
                <img
                  src="/gallery/img4.png?v=2"
                  alt="Imagen generada 4"
                  className="w-full h-auto object-cover"
                />
              </div>
            </div>

            <p className="mt-3 text-[10px] text-neutral-500">
              isabelaOs Studio es el primer sistema de generación visual con IA
              desarrollado en Guatemala pensando en creadores, estudios y
              agencias de modelos virtuales.
            </p>
          </div>
        </section>

        {/* Sección especial Foto Navideña IA */}
        <section className="mt-12 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="rounded-3xl border border.white/10 bg-black/50 p-5 text-xs text-neutral-300">
            <h3 className="text-sm font-semibold text.white">
              Especial Navidad · Foto Navideña IA
            </h3>
            <p className="mt-2 text-[11px] text-neutral-300">
              Sube una foto real tuya o de tu familia y deja que IsabelaOS
              Studio la convierta en un retrato navideño de estudio con fondo,
              luces y decoración generados por IA.
            </p>
            <ul className="mt-2 list-disc list-inside text-[11px] text-neutral-400">
              <li>Ideal para compartir en redes sociales o imprimir.</li>
              <li>
                Respeta la pose original y cambia el entorno a una escena
                navideña realista.
              </li>
              <li>
                Forma parte de los módulos premium incluidos al activar el Plan
                Basic de US$5/mes.
              </li>
            </ul>
            <p className="mt-3 text-[11px] text-neutral-400">
              Dentro del panel del creador encontrarás la sección{" "}
              <span className="font-semibold text.white">
                “Foto Navideña IA (Premium)”
              </span>{" "}
              donde se explica con detalle qué tipo de foto subir y cómo
              funciona el proceso.
            </p>
          </div>

          <div className="rounded-3xl border border.white/10 bg-black/60 p-4 flex items-center justify-center">
            <img
              src="/gallery/xmas_family_before_after.png"
              alt="Ejemplo de familia antes y después con fondo navideño"
              className="w-full rounded-2xl object-cover"
            />
          </div>
        </section>

        {/* Vista previa del panel */}
        <section className="mt-12">
          {/* Línea separadora con gradiente */}
          <div className="mb-3 h-px w-24 bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-transparent" />
          <h2 className="text-sm font-semibold text.white mb-4">
            Flujo de trabajo simple y potente
          </h2>
          <div className="rounded-3xl border border.white/10 bg-black/50 p-5 text-xs text-neutral-300">
            <h3 className="text-sm font-semibold text.white">
              Vista previa del panel del creador
            </h3>
            <p className="mt-2 text-[11px] text-neutral-400">
              Interfaz simple para escribir un prompt, ajustar resolución y ver
              el resultado generado por el motor conectado a RunPod.
            </p>
            <div className="mt-4 rounded-2xl border border.white/10 overflow-hidden bg-black/60">
              <img
                src="/preview/panel.png"
                alt="Vista previa del panel de isabelaOs Studio"
                className="w-full object-cover"
              />
            </div>
          </div>
        </section>

        {/* Showcase BodySync */}
        <section className="mt-12">
          <h2 className="text-sm font-semibold text.white mb-2">
            Preparándonos para BodySync · Movimiento corporal IA
          </h2>
          <p className="text-xs text-neutral-300 max-w-2xl">
            Estas imágenes fueron generadas con nuestro prototipo BodySync,
            pensado para describir poses y movimiento corporal realista mediante
            una “firma de movimiento” (Motion Signature). Muy pronto podrás
            combinar IsabelaOS Studio con BodySync para crear escenas completas
            en video con movimiento natural.
          </p>

          <ul className="mt-3 max-w-2xl list-disc list-inside text-[11px] text-neutral-400">
            <li>
              Diseñado para creadores que necesitan coreografías y poses
              naturales sin horas de animación manual.
            </li>
            <li>
              Ideal para videos cortos, reels y escenas cinemáticas con
              personajes IA consistentes.
            </li>
            <li>
              Integración directa con nuestro futuro módulo de video y con el
              motor de imágenes de IsabelaOS Studio.
            </li>
          </ul>

          {/* Imagen BodySync centrada */}
          <div className="mt-6 flex justify-center">
            <div className="max-w-md w-full rounded-3xl border border.white/10 bg-black/70 px-4 py-4 shadow-lg shadow-cyan-500/25">
              <img
                src="/gallery/bodysync_showcase.png"
                alt="Ejemplo generado con BodySync"
                className="w-full rounded-2xl object-cover"
              />
            </div>
          </div>
        </section>

        {/* Plan de pago */}
        <section className="mt-14 max-w-xl border-t border.white/10 pt-8">
          <h2 className="text-sm font-semibold text.white">
            Plan beta para creadores
          </h2>
          <p className="mt-2 text-xs text-neutral-300">
            Si llegas al límite de {DAILY_LIMIT} imágenes gratuitas al día (por
            usuario registrado) y quieres seguir generando sin restricciones,
            puedes activar el plan ilimitado mientras dure la beta. El Plan
            Basic de US$5/mes desbloquea:
          </p>
          <ul className="mt-2 list-disc list-inside text-[11px] text-neutral-400">
            <li>Generador de imágenes desde prompt sin límite diario.</li>
            <li>
              Acceso a los módulos premium actuales (como Foto Navideña IA).
            </li>
            <li>
              Acceso anticipado a nuevos módulos avanzados que se vayan
              liberando durante la beta.
            </li>
          </ul>

          <div className="mt-4 flex flex-wrap items-center gap-4">
            <button
              onClick={handlePaddleCheckout}
              className="rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-2 text-sm font-semibold text.white"
            >
              isabelaOs Basic – US$5/mes (tarjeta / Paddle)
            </button>
            <div className="flex flex-col gap-1 text-[11px] text-neutral-400">
              <span className="text-neutral-300">
                o pagar con <span className="font-semibold">PayPal</span>:
              </span>
              <PayPalButton amount="5.00" containerId="paypal-button-landing" />
            </div>
          </div>

          <p className="mt-3 text-[11px] text-neutral-400">
            Los usuarios que se registren y activen el plan durante la beta
            serán considerados{" "}
            <span className="font-semibold text.white">usuarios beta</span> con
            un Plan Basic activo (sin límite de imágenes) mientras se mantenga
            la suscripción.
          </p>
        </section>

        {/* Contacto */}
        <section id="contacto" className="mt-16 max-w-xl">
          <h2 className="text-sm font-semibold text.white">
            Contacto y soporte
          </h2>
          <p className="mt-1 text-xs text-neutral-400">
            Si tienes dudas sobre IsabelaOS Studio, escríbenos y el equipo de
            soporte responderá desde{" "}
            <span className="font-semibold text.white">
              contacto@isabelaos.com
            </span>
            .
          </p>

          <form
            onSubmit={handleContactSubmit}
            className="mt-4 space-y-3 text-sm"
          >
            <div>
              <label className="text-xs text-neutral-300">Nombre</label>
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text.white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              />
            </div>
            <div>
              <label className="text-xs text-neutral-300">Correo</label>
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text.white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              />
            </div>
            <div>
              <label className="text-xs text-neutral-300">Mensaje</label>
              <textarea
                rows={4}
                value={contactMessage}
                onChange={(e) => setContactMessage(e.target.value)}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text.white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              />
            </div>
            <button
              type="submit"
              className="mt-2 rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-2 text-sm font-semibold text.white"
            >
              Enviar mensaje
            </button>
          </form>
        </section>

        <footer className="mt-16 border-t border.white/10 pt-6 text-[11px] text-neutral-500">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              © {new Date().getFullYear()} isabelaOs Studio · Desarrollado en
              Guatemala, Cobán Alta Verapaz por Stalling Technologic.
            </span>
            <span className="flex flex-wrap gap-3">
              <a href="/terms.html" className="hover:text-neutral-300">
                Términos de servicio
              </a>
              <span>•</span>
              <a href="/privacy.html" className="hover:text-neutral-300">
                Política de privacidad
              </a>
              <span>•</span>
              <a href="/refunds.html" className="hover:text-neutral-300">
                Política de reembolsos
              </a>
            </span>
          </div>
        </footer>
      </main>
    </div>
  );
}

// ---------------------------------------------------------
// App principal
// ---------------------------------------------------------
export default function App() {
  const { user, loading } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [viewMode, setViewMode] = useState("landing");

  useEffect(() => {
    document.documentElement.style.background = "#06070B";
  }, []);

  const openAuth = () => {
    setShowAuthModal(true);
    setViewMode("landing");
  };
  const closeAuth = () => setShowAuthModal(false);

  const handleStartDemo = () => {
    setViewMode("demo");
  };

  useEffect(() => {
    if (user && viewMode !== "dashboard") {
      setViewMode("dashboard");
    }
  }, [user, viewMode]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-black text.white">
        <p className="text-sm text-neutral-400">Cargando sesión...</p>
      </div>
    );
  }

  if (user) {
    return <DashboardView />;
  }

  if (viewMode === "demo") {
    return (
      <>
        <div id="top" className="pt-10">
          <CreatorPanel isDemo={true} onAuthRequired={openAuth} />
        </div>
        <LandingView onOpenAuth={openAuth} onStartDemo={handleStartDemo} />
        <AuthModal open={showAuthModal} onClose={closeAuth} />
      </>
    );
  }

  return (
    <>
      <LandingView onOpenAuth={openAuth} onStartDemo={handleStartDemo} />
      <AuthModal open={showAuthModal} onClose={closeAuth} />
    </>
  );
}
