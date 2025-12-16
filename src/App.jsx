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
              className="mt-1 h-24 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
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
              className="mt-1 h-20 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
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
            className="mt-4 w-full rounded-2xl border border-white/30 py-2 text-xs text-white hover:bg-white/10"
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
        <h2 className="text-lg font-semibold text-white">
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
              className="mt-1 h-24 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
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
              className="mt-1 h-20 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
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
                      : "bg-black/60 text-neutral-200 border border-white/10 hover:bg-white/5"
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
                      : "bg-black/60 text-neutral-200 border border-white/10 hover:bg-white/5"
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
                      : "bg-black/60 text-neutral-200 border border-white/10 hover:bg-white/5"
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
                      : "bg-black/60 text-neutral-200 border border-white/10 hover:bg-white/5"
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
                      : "bg-black/60 text-neutral-200 border border-white/10 hover:bg-white/5"
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
                      : "bg-black/60 text-neutral-200 border border-white/10 hover:bg-white/5"
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
            className="mt-4 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60"
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
        <h2 className="text-lg font-semibold text-white">Resultado</h2>
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
            className="mt-4 w-full rounded-2xl border border-white/30 py-2 text-xs text-white hover:bg-white/10"
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
        <h2 className="text-lg font-semibold text-white">Biblioteca</h2>
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
        <h2 className="text-lg font-semibold text-white">Vista previa</h2>
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
      <h2 className="text-lg font-semibold text-white">
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
          <h3 className="text-sm font-semibold text-white">
            ¿Qué podrás hacer?
          </h3>
          <ul className="mt-2 space-y-1 list-disc list-inside">
            <li>Clips cortos desde texto (5–10 segundos).</li>
            <li>Escenas con cámara cinematográfica.</li>
            <li>Opciones de estilo (realista, anime, artístico).</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/60 p-4">
          <h3 className="text-sm font-semibold text-white">
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
        <h2 className="text-lg font-semibold text-white">
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
              className="mt-2 w-full rounded-2xl bg-black/60 px-3 py-2 text-xs text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
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
            className="mt-3 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60"
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
        <h2 className="text-lg font-semibold text-white">Resultado</h2>
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
            className="mt-4 w-full rounded-2xl border border-white/30 py-2 text-xs text-white hover:bg-white/10"
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
                  ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
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
                  ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
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
                  ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
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
                  ? "bg-gradient-to-r from-cyan-600 to-fuchsia-600 text-white"
                  : "bg-gradient-to-r from-cyan-600/70 to-fuchsia-600/70 text-white/90"
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
                  ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
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
                  ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
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
                  ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
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
                  ? "bg-gradient-to-r from-cyan-600 to-fuchsia-600 text-white"
                  : "bg-gradient-to-r from-cyan-600 to-fuchsia-600 text-white/90"
              }`}
            >
              🎄 Foto Navideña IA (Premium)
            </button>
          </aside>

          {/* Contenido principal */}
          <div className="flex-1 space-y-6">
            <div>
              <h1 className="text-xl font-semibold text-white">
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

// ---------------------------------------------------------// NUEVO: ContactView (página aparte, NO en Home)// ---------------------------------------------------------
function ContactView({ onBack }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    const subject = encodeURIComponent("Contacto desde IsabelaOS Studio");
    const body = encodeURIComponent(
      `Nombre: ${name}\nCorreo: ${email}\n\nMensaje:\n${message}`
    );
    window.location.href = `mailto:contacto@isabelaos.com?subject=${subject}&body=${body}`;
  };

  return (
    <div className="min-h-screen w-full text-white"
      style={{
        background:
          "radial-gradient(1100px_700px_at_110%_-10%,rgba(0,229,255,0.10),transparent_60%),radial-gradient(1000px_700px_at_-10%_0%,rgba(255,23,229,0.12),transparent_55%),linear-gradient(180deg,#0A0B10 0%,#06070B 55%,#05060A 100%)",
      }}
    >
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/35 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500 to-fuchsia-500 text-xs font-bold shadow-lg shadow-cyan-500/30">
              io
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">
                isabelaOs <span className="text-xs text-neutral-400">Studio</span>
              </div>
              <div className="text-[10px] text-neutral-500">Contacto</div>
            </div>
          </div>

          <button
            onClick={onBack}
            className="rounded-xl border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10"
          >
            ← Regresar
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-10">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-white">Contacto y soporte</h1>
          <p className="mt-1 text-sm text-neutral-300">
            Escríbenos y responderemos desde{" "}
            <span className="font-semibold text-white">contacto@isabelaos.com</span>.
          </p>
        </div>

        <div className="max-w-xl rounded-3xl border border-white/10 bg-black/45 p-6">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="text-xs text-neutral-300">Nombre</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              />
            </div>
            <div>
              <label className="text-xs text-neutral-300">Correo</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              />
            </div>
            <div>
              <label className="text-xs text-neutral-300">Mensaje</label>
              <textarea
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              />
            </div>

            <button
              type="submit"
              className="mt-2 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-2 text-sm font-semibold text-white"
            >
              Enviar
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
// ---------------------------------------------------------// NUEVO: Imagen → Video (subir una imagen y generar)// (Frontend listo; conecta a tu endpoint cuando lo tengas)// ---------------------------------------------------------
function ImageToVideoUploadPanel() {
  const { user } = useAuth();

  const [dataUrl, setDataUrl] = useState(null);
  const [pureB64, setPureB64] = useState(null);

  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState("");
  const [videoUrl, setVideoUrl] = useState(null);

  const fileInputId = "img2vid-file-input";

  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handlePick = () => {
    const el = document.getElementById(fileInputId);
    if (el) el.click();
  };

  const handleChange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError("");
    setVideoUrl(null);
    try {
      const d = await fileToBase64(f);
      setDataUrl(d);
      const parts = String(d).split(",");
      setPureB64(parts[1] || null);
    } catch (err) {
      console.error(err);
      setError("No se pudo leer la imagen.");
    }
  };

  const handleGenerate = async () => {
    setError("");
    setVideoUrl(null);

    if (!user) {
      setError("Debes iniciar sesión para generar video.");
      return;
    }
    if (!pureB64) {
      setError("Sube una imagen primero.");
      return;
    }

    setStatusText("Enviando imagen al generador de video...");

    try {
      // ⚠️ Ajusta el endpoint a TU API real:
      // /api/image-to-video (ejemplo)
      const res = await fetch("/api/image-to-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_b64: pureB64,
          // puedes agregar aquí params extra si tu API los usa
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data?.videoUrl) {
        throw new Error(data?.error || "Error generando video desde imagen.");
      }

      setVideoUrl(data.videoUrl);
      setStatusText("Video generado correctamente.");
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
      setStatusText("Error al generar el video.");
    }
  };

  return (
    <div className="rounded-3xl border border-white/10 bg-black/45 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-white">
            Image-to-Video (1 imagen → video)
          </h3>
          <p className="mt-1 text-xs text-neutral-400">
            Sube una imagen y genera un video (pipeline real en tu backend).
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div>
          <button
            type="button"
            onClick={handlePick}
            className="flex h-44 w-full items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/60 text-xs text-neutral-400 hover:border-cyan-400 hover:text-cyan-300"
          >
            {dataUrl ? "Cambiar imagen" : "Clic para subir una imagen"}
          </button>
          <input
            id={fileInputId}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleChange}
          />
          {dataUrl && (
            <div className="mt-3 overflow-hidden rounded-2xl border border-white/10">
              <img src={dataUrl} alt="Base" className="w-full object-cover" />
            </div>
          )}

          <div className="mt-4 rounded-2xl bg-black/55 px-4 py-2 text-xs text-neutral-300">
            {statusText || "Listo."}
          </div>

          {error && (
            <p className="mt-2 text-xs text-red-400 whitespace-pre-line">{error}</p>
          )}

          <button
            type="button"
            onClick={handleGenerate}
            disabled={!pureB64}
            className="mt-3 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            Generar video desde imagen
          </button>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/60 p-3">
          <p className="text-xs text-neutral-400 mb-2">Resultado</p>
          <div className="flex h-[260px] items-center justify-center rounded-2xl bg-black/70 text-xs text-neutral-400">
            {videoUrl ? (
              <video src={videoUrl} controls className="h-full w-full rounded-2xl object-contain" />
            ) : (
              <span>Aquí aparecerá el video.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
// ---------------------------------------------------------// NUEVO: Collage de videos (videos funcionales que pondrás en /public)// No toca tu backend. Solo UI.// ---------------------------------------------------------
function PromptVideosCollage() {
  const videos = [
    { src: "/videos/video1.mp4", w: "col-span-6", h: "h-52" },
    { src: "/videos/video2.mp4", w: "col-span-3", h: "h-40" },
    { src: "/videos/video3.mp4", w: "col-span-3", h: "h-40" },
    { src: "/videos/video4.mp4", w: "col-span-4", h: "h-44" },
    { src: "/videos/video5.mp4", w: "col-span-4", h: "h-44" },
    { src: "/videos/video6.mp4", w: "col-span-4", h: "h-44" },
  ];

  return (
    <div className="rounded-3xl border border-white/10 bg-black/45 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-white">Video desde prompt</h3>
          <p className="mt-1 text-xs text-neutral-400">
            Biblioteca/collage de videos (archivos reales en /public/videos).
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-12 gap-3">
        {videos.map((v, idx) => (
          <div
            key={idx}
            className={`relative overflow-hidden rounded-2xl border border-white/10 bg-black/70 ${v.w}`}
          >
            <video
              src={v.src}
              controls
              className={`${v.h} w-full object-cover`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// Landing (no sesión) — NUEVO layout estilo imagen referencia
// ---------------------------------------------------------
function LandingView({ onOpenAuth, onStartDemo, onGoContact }) {
  // ✅ NO contacto aquí (lo movimos a ContactView)
  // ✅ Mantén tus /gallery/imgX.png intactos

  const gallery9 = [
    "/gallery/img1.png?v=2",
    "/gallery/img2.png?v=2",
    "/gallery/img3.png?v=2",
    "/gallery/img4.png?v=2",
    "/gallery/img5.png?v=2",
    "/gallery/img6.png?v=2",
    "/gallery/img7.png?v=2",
    "/gallery/img8.png?v=2",
    "/gallery/img9.png?v=2",
  ];

  return (
    <div className="min-h-screen w-full text-white"
      style={{
        background:
          "radial-gradient(900px_700px_at_-10%_10%,rgba(0,229,255,0.10),transparent_55%),radial-gradient(900px_700px_at_110%_10%,rgba(255,23,229,0.12),transparent_55%),linear-gradient(180deg,#0E1017 0%,#07080D 55%,#05060A 100%)",
      }}
    >
      {/* “neon rails” laterales */}
      <div className="pointer-events-none fixed inset-y-0 left-0 w-[140px] opacity-70"
        style={{
          background:
            "radial-gradient(120px_420px_at_30%_30%,rgba(0,229,255,0.25),transparent_70%),radial-gradient(120px_420px_at_30%_70%,rgba(255,23,229,0.20),transparent_70%)",
          filter: "blur(0px)",
        }}
      />
      <div className="pointer-events-none fixed inset-y-0 right-0 w-[140px] opacity-70"
        style={{
          background:
            "radial-gradient(120px_420px_at_70%_30%,rgba(255,23,229,0.22),transparent_70%),radial-gradient(120px_420px_at_70%_70%,rgba(0,229,255,0.18),transparent_70%)",
        }}
      />

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/25 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500 to-fuchsia-500 text-xs font-bold shadow-lg shadow-cyan-500/30">
              io
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">
                isabelaOs <span className="text-xs text-neutral-400">Studio</span>
              </div>
              <div className="text-[10px] text-neutral-500">Generación visual con IA</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onGoContact}
              className="rounded-xl border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10"
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
        {/* HERO: 2 imágenes arriba, texto sobre una con blur */}
        <section className="grid gap-6 lg:grid-cols-2">
          {/* Imagen grande con texto encima */}
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-black/40">
            <img
              src="/gallery/img1.png?v=2"
              alt="Hero visual"
              className="h-[320px] w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
            <div className="absolute left-6 top-6 right-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-black/35 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200 backdrop-blur-md">
                <span className="h-1 w-1 rounded-full bg-cyan-300" />
                Beta · IsabelaOS Studio
              </div>

              <h1 className="mt-3 text-3xl font-semibold leading-tight md:text-4xl">
                IsabelaOS Studio:
                <span className="block bg-gradient-to-r from-cyan-300 via-fuchsia-300 to-violet-300 bg-clip-text text-transparent">
                  Unleash your imagination
                </span>
              </h1>

              {/* Fondo difuminado para contraste */}
              <div className="mt-3 inline-block rounded-2xl border border-white/10 bg-black/40 px-4 py-2 backdrop-blur-md">
                <p className="text-xs text-neutral-200">
                  Genera imágenes y videos con estilo cinematográfico.
                  <span className="text-neutral-400">
                    {" "}Sube tus assets a /public (gallery y videos).
                  </span>
                </p>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  onClick={onStartDemo}
                  className="rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-2.5 text-sm font-semibold text-white shadow-[0_0_35px_rgba(34,211,238,0.35)]"
                >
                  Generar mis 3 imágenes GRATIS
                </button>
                <button
                  onClick={onOpenAuth}
                  className="rounded-2xl border border-white/20 bg-black/25 px-6 py-2.5 text-sm text-white hover:bg-white/10"
                >
                  Entrar
                </button>
              </div>
            </div>
          </div>

          {/* Segunda imagen (sin texto grande) */}
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-black/40">
            <img
              src="/gallery/img2.png?v=2"
              alt="Hero second"
              className="h-[320px] w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent" />
            <div className="absolute bottom-4 left-4 right-4">
              <div className="rounded-2xl border border-white/10 bg-black/35 px-4 py-3 backdrop-blur-md">
                <p className="text-xs text-neutral-200">
                  Fondo gris oscuro + neón lateral, como tu referencia.
                </p>
                <p className="mt-1 text-[11px] text-neutral-400">
                  Mantengo rutas: <span className="text-white">/gallery/img1.png</span> y videos <span className="text-white">/videos/video1.mp4</span>.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Imagen → Video (1 imagen + flecha + preview) */}
        <section className="mt-10">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Image-to-Video</h2>
            <p className="text-[11px] text-neutral-400">
              1 imagen → flecha → video (como tu ejemplo)
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr]">
            <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/45">
              <img
                src="/gallery/img3.png?v=2"
                alt="Input"
                className="h-[220px] w-full object-cover"
              />
              <div className="p-3 text-[11px] text-neutral-400">Imagen de ejemplo (solo 1).</div>
            </div>

            <div className="hidden md:grid place-items-center">
              <div className="grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-black/40 text-2xl text-cyan-300 shadow-[0_0_25px_rgba(34,211,238,0.25)]">
                →
              </div>
            </div>

            <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/45">
              <div className="h-[220px] w-full grid place-items-center bg-black/65 text-xs text-neutral-400">
                Aquí irá tu video resultante
              </div>
              <div className="p-3 text-[11px] text-neutral-400">Preview del video.</div>
            </div>
          </div>

          {/* NUEVO: generador real con upload (como pediste) */}
          <div className="mt-5">
            <ImageToVideoUploadPanel />
          </div>
        </section>

        {/* Video desde prompt — collage */}
        <section className="mt-10">
          <PromptVideosCollage />
        </section>

        {/* Imágenes generadas desde prompt — librería 9 */}
        <section className="mt-10">
          <div className="rounded-3xl border border-white/10 bg-black/45 p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Imágenes desde prompt</h3>
              <p className="text-[11px] text-neutral-400">Biblioteca (9)</p>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {gallery9.map((src, idx) => (
                <div
                  key={idx}
                  className="overflow-hidden rounded-2xl border border-white/10 bg-black/60"
                >
                  <img src={src} alt={`img-${idx + 1}`} className="h-28 w-full object-cover" />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* NAVIDAD — la dejamos tal cual estaba (tu sección ya existe) */}
        <section className="mt-10">
          {/* IMPORTANTE: aquí NO reescribo tu bloque navidad.
              Solo lo “encapsulo” y lo dejaremos igual cuando lo pegues.
              Si quieres, lo movemos entero desde tu Landing actual sin tocarlo.
           */}
          <div className="rounded-3xl border border-white/10 bg-black/45 p-6">
            <h3 className="text-sm font-semibold text-white">Navidad</h3>
            <p className="mt-2 text-xs text-neutral-400">
              Aquí va tu sección navideña EXACTA del script original (sin cambios).
            </p>
          </div>
        </section>

        {/* BodySync — igual pero imagen pequeña a la par */}
        <section className="mt-10">
          <div className="rounded-3xl border border-white/10 bg-black/45 p-6">
            <h3 className="text-sm font-semibold text-white">BodySync</h3>

            <div className="mt-4 grid gap-4 md:grid-cols-[1.3fr_0.7fr] items-start">
              <div>
                <p className="text-xs text-neutral-300">
                  BodySync mantiene el mismo texto y propuesta, solo que ahora la imagen va
                  a la par, más pequeña.
                </p>
                <ul className="mt-3 list-disc list-inside text-[11px] text-neutral-400">
                  <li>Movimiento corporal realista.</li>
                  <li>Motion Signature para estilo consistente.</li>
                  <li>Listo para clips y anuncios.</li>
                </ul>
              </div>

              <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/60">
                <img
                  src="/gallery/bodysync_showcase.png"
                  alt="BodySync"
                  className="h-40 w-full object-cover"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Suscripciones + Jades (modelo híbrido) */}
        <section className="mt-10">
          <div className="rounded-3xl border border-white/10 bg-black/45 p-6">
            <h3 className="text-sm font-semibold text-white">Suscripciones y Jades</h3>
            <p className="mt-2 text-xs text-neutral-400">
              Aquí conectamos tus planes de Supabase (suscripción mensual) + compra de jades.
              Si por alguna razón la carga falla, usamos fallback.
            </p>

            {/* De momento no invento tu loader exacto porque no está en este archivo.
                En la Parte 3 te dejo el “hook” para traerlos de tu API/Supabase. */}
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/60 p-4 text-xs text-neutral-300">
              ✅ Mantendremos: plan mensual + compra opcional de jades (como ya definimos).
            </div>
          </div>
        </section>

        <footer className="mt-14 border-t border-white/10 pt-6 text-[11px] text-neutral-500">
          © {new Date().getFullYear()} isabelaOs Studio · Stalling Technologic.
        </footer>
      </main>
    </div>
  );
}

// ---------------------------------------------------------
// App principal (con vista contacto aparte)
// ---------------------------------------------------------
export default function App() {
  const { user, loading } = useAuth();

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [viewMode, setViewMode] = useState("landing"); // landing | demo | dashboard | contact

  useEffect(() => {
    document.documentElement.style.background = "#06070B";
  }, []);

  const openAuth = () => {
    setShowAuthModal(true);
    if (viewMode === "contact") setViewMode("landing");
  };
  const closeAuth = () => setShowAuthModal(false);

  const handleStartDemo = () => setViewMode("demo");

  const goContact = () => setViewMode("contact");
  const backHome = () => setViewMode("landing");

  useEffect(() => {
    if (user && viewMode !== "dashboard") setViewMode("dashboard");
  }, [user, viewMode]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-black text-white">
        <p className="text-sm text-neutral-400">Cargando sesión...</p>
      </div>
    );
  }

  if (user) return <DashboardView />;

  if (viewMode === "contact") {
    return <ContactView onBack={backHome} />;
  }

  if (viewMode === "demo") {
    return (
      <>
        <div id="top" className="pt-10">
          <CreatorPanel isDemo={true} onAuthRequired={openAuth} />
        </div>

        <LandingView
          onOpenAuth={openAuth}
          onStartDemo={handleStartDemo}
          onGoContact={goContact}
        />

        <AuthModal open={showAuthModal} onClose={closeAuth} />
      </>
    );
  }

  return (
    <>
      <LandingView
        onOpenAuth={openAuth}
        onStartDemo={handleStartDemo}
        onGoContact={goContact}
      />
      <AuthModal open={showAuthModal} onClose={closeAuth} />
    </>
  );
            }
