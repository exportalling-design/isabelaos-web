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
const DEMO_LIMIT = 3; // invitados
const DAILY_LIMIT = 5; // (solo mientras tengas beta gratis; opcional)

// ---------------------------------------------------------
// Jades / Planes (nuevo modelo)
// ---------------------------------------------------------
const JADE_VALUE_USD = 0.10;

const PLANS = {
  basic: { name: "Plan Basic", price: 19, includedJades: 100 },
  pro: { name: "Plan Pro", price: 39, includedJades: 300 },
};

const JADE_PACKS = [
  { jades: 100, price: 10 },
  { jades: 300, price: 27 },
];

const GENERATION_COSTS = {
  img_prompt: 1,
  img_transform: 2,
  vid_prompt: 10,
  vid_img2vid: 12,
  xmas_photo: 12, // ajustable
};

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
//  ✅ fixes: deps incluyen description, cleanup para evitar duplicado, props formateadas
// ---------------------------------------------------------
function PayPalButton({
  amount = "10.00",
  description = "IsabelaOS Studio",
  containerId,
  onPaid,
}) {
  const divId = containerId || "paypal-button-container";

  useEffect(() => {
    if (!PAYPAL_CLIENT_ID) {
      console.warn("No hay PAYPAL_CLIENT_ID configurado");
      return;
    }

    let cancelled = false;

    const renderButtons = () => {
      if (cancelled) return;
      if (!window.paypal) return;

      // ✅ evita duplicar botones si el effect corre más de una vez
      const mount = document.getElementById(divId);
      if (mount) mount.innerHTML = "";

      window.paypal
        .Buttons({
          style: {
            layout: "horizontal",
            color: "black",
            shape: "pill",
            label: "paypal",
          },
          createOrder: (data, actions) =>
            actions.order.create({
              purchase_units: [
                {
                  amount: {
                    value: String(amount),
                    currency_code: "USD",
                  },
                  description,
                },
              ],
            }),
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
        existingScript.addEventListener("load", renderButtons, { once: true });
      }
      return () => {
        cancelled = true;
      };
    }

    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&currency=USD`;
    script.async = true;
    script.onload = renderButtons;
    document.body.appendChild(script);

    return () => {
      cancelled = true;
    };
  }, [amount, description, divId, onPaid]); // ✅ incluye description

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
//  ✅ fixes: text.white -> text-white
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

    const optimized = String(data.optimizedPrompt || "").trim();
    if (!optimized) {
      setOptimizedPrompt("");
      return originalPrompt;
    }

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

    const optimized = String(data.optimizedPrompt || "").trim();
    if (!optimized) {
      setOptimizedNegative("");
      return originalNegative;
    }

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
        `Has llegado al límite de ${DAILY_LIMIT} imágenes gratuitas por hoy. Activa la suscripción mensual de US$${PLANS.basic.price}/mes para generar sin límite y desbloquear todos los módulos premium (como la Foto Navideña IA).`
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

    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || "Error en /api/generate, revisa los logs.");
    }

    const jobId = data.jobId;
    if (!jobId) throw new Error("No llegó jobId desde /api/generate.");

    setStatusText(`Job enviado. ID: ${jobId}. Consultando estado...`);

    // Guard para que no se quede infinito si algo se rompe
    const startedAt = Date.now();
    const MAX_WAIT_MS = 10 * 60 * 1000; // 10 min

    let finished = false;
    while (!finished) {
      if (Date.now() - startedAt > MAX_WAIT_MS) {
        throw new Error(
          "Tiempo de espera agotado consultando el estado del job. Revisa logs del worker/pod."
        );
      }

      await new Promise((r) => setTimeout(r, 2000));

      const statusRes = await fetch(`/api/status?id=${encodeURIComponent(jobId)}`);
      const statusData = await statusRes.json().catch(() => null);

      if (!statusRes.ok || !statusData || statusData.error) {
        throw new Error(
          statusData?.error || "Error al consultar /api/status."
        );
      }

      const st = statusData.status;
      setStatus(st);
      setStatusText(`Estado actual: ${st}...`);

      if (st === "IN_QUEUE" || st === "IN_PROGRESS" || st === "OPTIMIZING") {
        continue;
      }

      finished = true;

      if (st === "COMPLETED" && statusData.output?.image_b64) {
        const b64 = statusData.output.image_b64;
        setImageB64(b64);
        setStatusText("Render completado.");

        if (isDemo) {
          const newDemoCount = demoCount + 1;
          setDemoCount(newDemoCount);
          try {
            localStorage.setItem("isabelaos_demo_count", String(newDemoCount));
          } catch (e) {
            console.warn("No se pudo guardar demo count:", e);
          }
        } else if (userLoggedIn) {
          setDailyCount((prev) => prev + 1);

          const dataUrl = `data:image/png;base64,${b64}`;
          saveGenerationInSupabase({
            userId: user.id,
            imageUrl: dataUrl,
            prompt: promptToUse, // ✅ guardamos lo que realmente se usó
            negativePrompt: negativeToUse, // ✅ guardamos lo que realmente se usó
            width: Number(width),
            height: Number(height),
            steps: Number(steps),
          }).catch((e) => {
            console.error("Error guardando en Supabase:", e);
          });
        }
      } else if (st === "ERROR") {
        throw new Error(statusData?.error || "El job terminó en ERROR.");
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
    alert("Para descargar tu imagen, por favor, crea tu cuenta o inicia sesión.");
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
      "Plan Basic activo: ya no tienes límite diario en este navegador y se desbloquean los módulos premium."
    );
    alert(
      "Tu Plan Basic está activo. Desde ahora puedes generar imágenes sin límite y acceder a los módulos premium."
    );
  } catch (e) {
    console.error("No se pudo guardar premium en localStorage:", e);
  }
};

if (!userLoggedIn && !isDemo) {
  return (
    <div className="rounded-3xl border border-yellow-400/30 bg-yellow-500/5 p-6 text-center text-sm text-yellow-100">
      <p className="font-medium">Debes iniciar sesión para usar el generador de imágenes.</p>
      <p className="mt-1 text-xs text-yellow-200/80">
        Desde tu cuenta podrás crear imágenes con nuestro motor real conectado a RunPod.{" "}
        {DAILY_LIMIT} imágenes diarias gratis; si quieres ir más allá, podrás activar el plan de{" "}
        US${PLANS.basic.price}/mes para generar sin límite y desbloquear todos los módulos premium.
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
      <h2 className="text-lg font-semibold text-white">Generador desde prompt</h2>

      {isDemo && (
        <div className="mt-4 rounded-2xl border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-[11px] text-cyan-100">
          Modo de prueba gratuito: te quedan {remaining} imágenes de prueba sin registrarte. La
          descarga y la biblioteca requieren crear una cuenta.
        </div>
      )}

      {userLoggedIn && !isPremium && remaining <= 2 && remaining > 0 && (
        <div className="mt-4 rounded-2xl border border-yellow-400/40 bg-yellow-500/10 px-4 py-2 text-[11px] text-yellow-100">
          Atención: solo te quedan {remaining} imágenes gratis hoy. Activa el plan ilimitado de{" "}
          US${PLANS.basic.price}/mes para seguir generando y desbloquear los módulos premium.
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
              <span className="font-semibold">Prompt optimizado:</span> {optimizedPrompt}
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
            Si está activado, el sistema ajusta tu texto automáticamente antes de enviar el render
            al motor en RunPod.
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
              <span className="font-semibold">Negative optimizado:</span> {optimizedNegative}
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
              <> Uso de hoy: {currentCount}. Usuario beta – Plan Basic activo (sin límite).</>
            )}
            {userLoggedIn && !isPremium && (
              <>
                {" "}
                Uso de hoy: {currentCount} / {currentLimit} imágenes.
              </>
            )}
          </span>
        </div>

        {error && <p className="text-xs text-red-400 whitespace-pre-line">{error}</p>}

        <button
          onClick={handleGenerate}
          disabled={
            status === "OPTIMIZING" ||
            status === "IN_QUEUE" ||
            status === "IN_PROGRESS" ||
            (!isPremium && currentCount >= currentLimit)
          }
          className="mt-4 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {!isPremium && currentCount >= currentLimit
            ? "Límite alcanzado (Crea cuenta / Desbloquea plan)"
            : status === "OPTIMIZING"
            ? "Optimizando..."
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
              Desbloquear con IsabelaOS Basic – US${PLANS.basic.price}/mes (tarjeta / Paddle)
            </button>

            <div className="mt-3 text-[11px] text-neutral-400">
              o pagar con <span className="font-semibold">PayPal</span>:
              <PayPalButton
                amount={String(PLANS.basic.price)}
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
// NUEVO: Panel de generación de video (Prompt + Imagen→Video)
// ---------------------------------------------------------
function VideoPanel() {
  const { user } = useAuth();

  // ---- modo: "prompt" | "img2vid"
  const [mode, setMode] = useState("prompt");

  // ---- prompts
  const [prompt, setPrompt] = useState(
    "beautiful latina woman in an elegant tight blue dress, confident runway walk towards the camera, studio background, ultra detailed, 8k"
  );
  const [negative, setNegative] = useState(
    "low quality, blurry, bad anatomy, deformed, glitch, watermark, noisy, pixelated, static pose, nsfw, nude, explicit"
  );

  // ---- optimización IA
  const [autoPrompt, setAutoPrompt] = useState(false);
  const [optimizedPrompt, setOptimizedPrompt] = useState("");
  const [optimizedNegative, setOptimizedNegative] = useState("");

  // ---- settings video
  const [aspectRatio, setAspectRatio] = useState("9:16"); // "1:1" | "9:16" | "16:9"
  const [quality, setQuality] = useState("HD"); // "HD" | "MAX"
  const [duration, setDuration] = useState(5); // 5 | 10

  // ---- img2vid input
  const [initImageFile, setInitImageFile] = useState(null);
  const [initImagePreviewUrl, setInitImagePreviewUrl] = useState(null);
  const [initImageB64, setInitImageB64] = useState(""); // sin "data:image/..;base64,"

  // ---- estado
  const [status, setStatus] = useState("IDLE"); // IDLE | OPTIMIZING | GENERATING | DONE | ERROR
  const [statusText, setStatusText] = useState("");
  const [videoUrl, setVideoUrl] = useState(null);
  const [error, setError] = useState("");

  // Preview URL cleanup
  useEffect(() => {
    return () => {
      if (initImagePreviewUrl) URL.revokeObjectURL(initImagePreviewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
      reader.onload = () => {
        const result = String(reader.result || "");
        // result = "data:image/png;base64,AAAA..."
        const b64 = result.includes("base64,") ? result.split("base64,")[1] : "";
        if (!b64) return reject(new Error("La imagen no contiene base64 válido."));
        resolve(b64);
      };
      reader.readAsDataURL(file);
    });

  const handlePickInitImage = async (file) => {
    setError("");
    setVideoUrl(null);

    if (!file) {
      setInitImageFile(null);
      setInitImageB64("");
      if (initImagePreviewUrl) URL.revokeObjectURL(initImagePreviewUrl);
      setInitImagePreviewUrl(null);
      return;
    }

    // Validaciones ligeras
    if (!file.type?.startsWith("image/")) {
      setError("Selecciona un archivo de imagen válido (PNG/JPG/WebP).");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError("La imagen es muy grande. Máximo recomendado: 8MB.");
      return;
    }

    try {
      const preview = URL.createObjectURL(file);
      if (initImagePreviewUrl) URL.revokeObjectURL(initImagePreviewUrl);
      setInitImagePreviewUrl(preview);

      const b64 = await fileToBase64(file);
      setInitImageFile(file);
      setInitImageB64(b64);
    } catch (e) {
      console.error("Error leyendo imagen:", e);
      setError(e.message || String(e));
      setInitImageFile(null);
      setInitImageB64("");
      if (initImagePreviewUrl) URL.revokeObjectURL(initImagePreviewUrl);
      setInitImagePreviewUrl(null);
    }
  };

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

      const optimized = String(data.optimizedPrompt || "").trim();
      if (!optimized) {
        setter("");
        return text;
      }

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

    // Si es img2vid, necesitamos imagen
    if (mode === "img2vid" && !initImageB64) {
      setError("Selecciona una imagen para generar video desde imagen.");
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
      mode === "prompt"
        ? "Generando video en RunPod (CogVideoX + BodySync) y haciendo upscale..."
        : "Generando video desde imagen en RunPod (CogVideoX Img2Vid + BodySync) y haciendo upscale..."
    );

    try {
      // ✅ Usamos el MISMO endpoint, pero enviamos mode + init_image_b64 cuando sea img2vid.
      // Nota: tu backend debe aceptar:
      //   - mode: "prompt" | "img2vid"
      //   - init_image_b64 (solo en img2vid)
      const res = await fetch("/api/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode, // "prompt" | "img2vid"
          init_image_b64: mode === "img2vid" ? initImageB64 : undefined,
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

  const busy = status === "GENERATING" || status === "OPTIMIZING";

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* Configuración de video */}
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">
              {mode === "prompt"
                ? "Generar video desde prompt"
                : "Generar video desde imagen"}
            </h2>
            <p className="mt-1 text-xs text-neutral-400">
              {mode === "prompt" ? (
                <>
                  Usa nuestro pipeline de video con CogVideoX y BodySync Motion
                  Signature v1 para crear clips cortos listos para reels y
                  anuncios.
                </>
              ) : (
                <>
                  Sube una imagen base y genera un clip animado manteniendo el
                  estilo del prompt, con BodySync v1 para dar movimiento.
                </>
              )}
            </p>
          </div>

          {/* Tabs modo */}
          <div className="flex rounded-2xl border border-white/10 bg-black/40 p-1 text-xs">
            <button
              type="button"
              onClick={() => setMode("prompt")}
              className={`rounded-xl px-3 py-2 ${
                mode === "prompt"
                  ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                  : "text-neutral-200 hover:bg-white/5"
              }`}
            >
              Prompt
            </button>
            <button
              type="button"
              onClick={() => setMode("img2vid")}
              className={`rounded-xl px-3 py-2 ${
                mode === "img2vid"
                  ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                  : "text-neutral-200 hover:bg-white/5"
              }`}
            >
              Imagen → Video
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-4 text-sm">
          {/* Img2Vid uploader */}
          {mode === "img2vid" && (
            <div className="rounded-2xl border border-white/10 bg-black/50 p-4">
              <p className="text-xs text-neutral-300 mb-2">
                Imagen base (PNG/JPG/WebP)
              </p>

              <div className="flex items-start gap-4">
                <div className="flex-1">
                  <input
                    type="file"
                    accept="image/*"
                    disabled={busy}
                    onChange={(e) => handlePickInitImage(e.target.files?.[0])}
                    className="w-full rounded-2xl border border-white/10 bg-black/60 px-3 py-2 text-xs text-neutral-200"
                  />
                  <p className="mt-2 text-[11px] text-neutral-500">
                    Tip: usa una imagen bien iluminada y con el sujeto centrado.
                    Recomendado: 512–1024px.
                  </p>
                </div>

                <div className="w-28 h-28 rounded-2xl bg-black/60 border border-white/10 overflow-hidden flex items-center justify-center">
                  {initImagePreviewUrl ? (
                    <img
                      src={initImagePreviewUrl}
                      alt="Preview"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-[10px] text-neutral-500 px-2 text-center">
                      Sin imagen
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="text-neutral-300">Prompt</label>
            <textarea
              className="mt-1 h-24 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={busy}
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
                disabled={busy}
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
              disabled={busy}
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
                  disabled={busy}
                  onClick={() => setAspectRatio("1:1")}
                  className={`flex-1 rounded-2xl px-3 py-2 ${
                    aspectRatio === "1:1"
                      ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                      : "bg-black/60 text-neutral-200 border border-white/10 hover:bg-white/5"
                  } ${busy ? "opacity-60" : ""}`}
                >
                  1:1 (cuadrado)
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setAspectRatio("9:16")}
                  className={`flex-1 rounded-2xl px-3 py-2 ${
                    aspectRatio === "9:16"
                      ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                      : "bg-black/60 text-neutral-200 border border-white/10 hover:bg-white/5"
                  } ${busy ? "opacity-60" : ""}`}
                >
                  9:16 (vertical)
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setAspectRatio("16:9")}
                  className={`flex-1 rounded-2xl px-3 py-2 ${
                    aspectRatio === "16:9"
                      ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                      : "bg-black/60 text-neutral-200 border border-white/10 hover:bg-white/5"
                  } ${busy ? "opacity-60" : ""}`}
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
                  disabled={busy}
                  onClick={() => setQuality("HD")}
                  className={`flex-1 rounded-2xl px-3 py-2 ${
                    quality === "HD"
                      ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                      : "bg-black/60 text-neutral-200 border border-white/10 hover:bg-white/5"
                  } ${busy ? "opacity-60" : ""}`}
                >
                  HD 720p
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setQuality("MAX")}
                  className={`flex-1 rounded-2xl px-3 py-2 ${
                    quality === "MAX"
                      ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                      : "bg-black/60 text-neutral-200 border border-white/10 hover:bg-white/5"
                  } ${busy ? "opacity-60" : ""}`}
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
                  disabled={busy}
                  onClick={() => setDuration(5)}
                  className={`flex-1 rounded-2xl px-3 py-2 ${
                    duration === 5
                      ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                      : "bg-black/60 text-neutral-200 border border-white/10 hover:bg-white/5"
                  } ${busy ? "opacity-60" : ""}`}
                >
                  5 segundos
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setDuration(10)}
                  className={`flex-1 rounded-2xl px-3 py-2 ${
                    duration === 10
                      ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                      : "bg-black/60 text-neutral-200 border border-white/10 hover:bg-white/5"
                  } ${busy ? "opacity-60" : ""}`}
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
            disabled={busy}
            className="mt-4 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {status === "OPTIMIZING"
              ? "Optimizando..."
              : status === "GENERATING"
              ? "Generando video..."
              : mode === "prompt"
              ? "Generar video desde prompt"
              : "Generar video desde imagen"}
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
        setSelected(mapped.length > 0 ? mapped[0] : null);
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

      // ✅ update consistente (sin usar items stale)
      setItems((prev) => {
        const next = prev.filter((it) => it.id !== selected.id);
        setSelected(next.length > 0 ? next[0] : null);
        return next;
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
// Placeholder de video (ya NO se usa: lo dejamos, pero corregido)
// ---------------------------------------------------------
function VideoPlaceholderPanel() {
  return (
    <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
      <h2 className="text-lg font-semibold text-white">
        Generador de video (próximamente)
      </h2>
      <p className="mt-2 text-sm text-neutral-300">
        Estamos preparando el módulo de video para que puedas escribir un prompt
        o subir una imagen y obtener clips animados con calidad cinematográfica
        usando nuestro motor en RunPod.
      </p>
      <p className="mt-4 text-xs text-red-400 font-semibold">
        Estamos trabajando para tener este módulo lo antes posible con la máxima
        calidad de estudio.
      </p>
      <div className="mt-6 grid gap-4 md:grid-cols-2 text-xs text-neutral-300">
        <div className="rounded-2xl border border-white/10 bg-black/60 p-4">
          <h3 className="text-sm font-semibold text-white">¿Qué podrás hacer?</h3>
          <ul className="mt-2 space-y-1 list-disc list-inside">
            <li>Clips cortos desde texto o imagen (5–10 segundos).</li>
            <li>Escenas con cámara cinematográfica.</li>
            <li>Opciones de estilo (realista, anime, artístico).</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/60 p-4">
          <h3 className="text-sm font-semibold text-white">
            Integración con BodySync
          </h3>
          <p className="mt-2">
            Podrás combinar este módulo con BodySync para aplicar movimiento
            corporal a tus personajes IA.
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
  const [status, setStatus] = useState("IDLE"); // IDLE | IN_QUEUE | IN_PROGRESS | COMPLETED | ERROR
  const [statusText, setStatusText] = useState("");
  const [resultB64, setResultB64] = useState(null);
  const [error, setError] = useState("");

  // 🔐 Premium gate
  const [isPremium, setIsPremium] = useState(false);

  // 🔐 mismo criterio premium que en CreatorPanel
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

  // ✅ base64 helper (devuelve dataURL)
  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
      reader.readAsDataURL(file);
    });

  // ✅ validaciones suaves + limpieza de errores/resultado
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError("");
    setResultB64(null);

    if (!file.type?.startsWith("image/")) {
      setError("Selecciona un archivo de imagen válido (PNG/JPG/WebP).");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError("La imagen es muy grande. Máximo recomendado: 8MB.");
      return;
    }

    try {
      const dataUrlResult = await fileToBase64(file);
      setDataUrl(dataUrlResult);

      const parts = String(dataUrlResult).split(",");
      setPureB64(parts[1] || null);
    } catch (err) {
      console.error("Error leyendo archivo:", err);
      setError("No se pudo leer la imagen. Intenta con otra foto.");
      setDataUrl(null);
      setPureB64(null);
    }
  };

  const handleGenerateXmas = async () => {
    setError("");

    if (!user) {
      setError("Debes iniciar sesión para usar este módulo.");
      return;
    }

    // 🔐 bloqueo real
    if (!isPremium) {
      setError(
        "Este módulo forma parte del Plan Basic (US$5/mes). Activa tu plan para usar Foto Navideña IA."
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
        throw new Error(data?.error || "Error lanzando job navideño en RunPod.");
      }

      const jobId = data.jobId;
      setStatusText(`Foto enviada. ID: ${jobId}. Consultando estado...`);

      let finished = false;
      while (!finished) {
        await new Promise((r) => setTimeout(r, 2000));

        const statusRes = await fetch(`/api/status?id=${jobId}`);
        const statusData = await statusRes.json().catch(() => null);

        if (!statusRes.ok || !statusData) {
          throw new Error(statusData?.error || "Error al consultar /api/status.");
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

  const busy = status === "IN_QUEUE" || status === "IN_PROGRESS";

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">
          Foto Navideña IA (Premium)
        </h2>

        <p className="mt-2 text-sm text-neutral-300">
          Convierte tu foto (o la de tu familia) en un retrato navideño de
          estudio profesional, con iluminación cuidada y fondo temático generado
          por IA.
        </p>

        {/* 🔐 aviso premium (bonito) */}
        {!isPremium && user && (
          <div className="mt-4 rounded-2xl border border-yellow-400/40 bg-yellow-500/10 px-4 py-2 text-[11px] text-yellow-100">
            Este módulo requiere <span className="font-semibold">Plan Basic</span>.
            Activa tu plan para desbloquear Foto Navideña IA.
          </div>
        )}

        <p className="mt-3 text-xs text-neutral-300">
          Recomendaciones para tu foto:
        </p>
        <ul className="mt-1 list-disc list-inside text-[11px] text-neutral-400">
          <li>Foto bien iluminada (de día o con buena luz dentro de casa).</li>
          <li>
            Que se vea completa la persona o la familia (sin cabezas cortadas ni
            recortes extraños).
          </li>
          <li>Evita filtros muy fuertes o efectos que cambien mucho los colores.</li>
          <li>
            Ropa normal y adecuada para todo público. Si el sistema detecta
            desnudez o ropa excesivamente reveladora, puede cubrir o rechazar la
            imagen.
          </li>
        </ul>

        <p className="mt-2 text-[11px] text-neutral-400">
          El módulo intentará respetar la posición y la expresión de las
          personas, y cambiará el fondo y detalles para convertirla en una escena
          navideña lo más realista posible.
        </p>

        <div className="mt-5 space-y-4 text-sm">
          <div>
            <p className="text-xs text-neutral-300">
              1. Sube tu foto (JPG/PNG/WebP)
            </p>

            <button
              type="button"
              onClick={handlePickFile}
              disabled={!user || busy}
              className="mt-2 flex h-40 w-full items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/60 text-xs text-neutral-400 hover:border-cyan-400 hover:text-cyan-300 disabled:opacity-60"
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
                <img src={dataUrl} alt="Foto base" className="w-full object-cover" />
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
              disabled={!user || busy}
              placeholder="Ejemplo: familia de 4 personas, dos niños pequeños, estilo sala acogedora junto al árbol de Navidad."
              className="mt-2 w-full rounded-2xl bg-black/60 px-3 py-2 text-xs text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400 disabled:opacity-60"
            />
            <p className="mt-1 text-[11px] text-neutral-400">
              Este texto ayuda a la IA a adaptar mejor el fondo y los detalles
              (árbol, luces, regalos, etc.). Si lo dejas vacío, se usará un estilo
              navideño estándar.
            </p>
          </div>

          <div className="mt-2 rounded-2xl bg-black/50 px-4 py-2 text-xs text-neutral-300">
            Estado actual: {statusText || "Listo para enviar tu foto navideña a RunPod."}
          </div>

          {error && (
            <p className="text-xs text-red-400 whitespace-pre-line">{error}</p>
          )}

          <button
            type="button"
            onClick={handleGenerateXmas}
            disabled={busy || !pureB64 || !user || !isPremium}
            className="mt-3 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? "Generando foto navideña..." : "Generar foto navideña IA"}
          </button>

          <p className="mt-2 text-[11px] text-neutral-400">
            Este módulo forma parte de las funciones premium de IsabelaOS Studio.
            Al activar el Plan Basic, podrás usar este módulo junto con el resto
            de mejoras premium de la beta.
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
      className="relative min-h-screen w-full overflow-hidden text-white"
      style={{
        background:
          // gris oscuro + degradés (no negro puro)
          "radial-gradient(1200px_800px_at_110%_-10%,rgba(255,23,229,0.18),transparent_60%),radial-gradient(900px_650px_at_-10%_0%,rgba(0,229,255,0.14),transparent_55%),radial-gradient(900px_700px_at_50%_120%,rgba(140,90,255,0.18),transparent_60%),linear-gradient(180deg,#0b0f17 0%, #070a12 60%, #05060a 100%)",
      }}
    >
      {/* Neon side graphics */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[320px] opacity-70">
        <div className="absolute -left-24 top-10 h-[520px] w-[520px] rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute left-10 top-32 h-[260px] w-[2px] bg-gradient-to-b from-cyan-400/0 via-cyan-400/60 to-cyan-400/0 blur-[0.2px]" />
        <div className="absolute left-16 top-44 h-[220px] w-[2px] bg-gradient-to-b from-fuchsia-400/0 via-fuchsia-400/50 to-fuchsia-400/0 blur-[0.2px]" />
        <div className="absolute left-0 top-0 h-full w-full bg-[radial-gradient(circle_at_20%_30%,rgba(0,229,255,0.18),transparent_55%)]" />
      </div>

      <div className="pointer-events-none absolute inset-y-0 right-0 w-[360px] opacity-70">
        <div className="absolute -right-28 top-12 h-[520px] w-[520px] rounded-full bg-fuchsia-400/10 blur-3xl" />
        <div className="absolute right-12 top-28 h-[280px] w-[2px] bg-gradient-to-b from-fuchsia-400/0 via-fuchsia-400/60 to-fuchsia-400/0 blur-[0.2px]" />
        <div className="absolute right-20 top-44 h-[240px] w-[2px] bg-gradient-to-b from-cyan-400/0 via-cyan-400/50 to-cyan-400/0 blur-[0.2px]" />
        <div className="absolute right-0 top-0 h-full w-full bg-[radial-gradient(circle_at_80%_30%,rgba(255,23,229,0.18),transparent_55%)]" />
      </div>

      <header className="border-b border-white/10 bg-[#0b0f17]/60 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            {/* Logo (si pones /brand/logo.png) */}
            <div className="grid h-9 w-9 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-cyan-500 to-fuchsia-500 text-xs font-bold shadow-lg shadow-cyan-500/25">
              <img
                src="/brand/logo.png"
                alt="IsabelaOS Studio"
                className="h-full w-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
              {/* fallback visible si no existe el logo */}
              <span className="pointer-events-none">io</span>
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">
                IsabelaOS <span className="text-xs text-neutral-400">Studio</span>
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

            {/* NUEVO: Video desde imagen (si ya agregaste el componente) */}
            <button
              type="button"
              onClick={() => setAppViewMode("video_img")}
              className={`rounded-2xl px-3 py-1.5 ${
                appViewMode === "video_img"
                  ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                  : "bg-white/5 text-neutral-200 hover:bg-white/10"
              }`}
            >
              Video desde imagen
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
          <aside className="hidden md:flex w-56 flex-col rounded-3xl border border-white/10 bg-[#0b0f17]/60 p-4 text-xs backdrop-blur-md">
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

            {/* NUEVO: Video desde imagen */}
            <button
              type="button"
              onClick={() => setAppViewMode("video_img")}
              className={`mb-2 w-full rounded-2xl px-3 py-2 text-left ${
                appViewMode === "video_img"
                  ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                  : "bg-white/5 text-neutral-200 hover:bg-white/10"
              }`}
            >
              Generar video desde imagen
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
              <h1 className="text-xl font-semibold text-white">Panel del creador</h1>
              <p className="mt-1 text-xs text-neutral-400">
                Genera imágenes, guarda tu historial en la biblioteca y prueba
                módulos especiales. El video está disponible en beta y seguirá
                mejorando.
              </p>
            </div>

            {appViewMode === "generator" && <CreatorPanel />}
            {appViewMode === "video" && <VideoPanel />}

            {/* IMPORTANTE: define este componente en tu archivo.
               Si aún no lo pegaste, comenta esta línea por ahora. */}
            {appViewMode === "video_img" && <VideoFromImagePanel />}

            {appViewMode === "library" && <LibraryView />}
            {appViewMode === "xmas" && <XmasPhotoPanel />}
          </div>
        </section>
      </main>
    </div>
  );
}

// ---------------------------------------------------------
// Landing (no sesión) con neon + hero sobre foto + secciones visuales
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
        alert("No se pudo abrir el pago con Paddle. Intenta con PayPal.");
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

  // Assets (ponlos en /public/landing/)
  const HERO_MAIN = "/landing/hero_main.jpg";
  const HERO_SIDE = "/landing/hero_side.jpg";

  const IMG2VIDEO_IMG = "/landing/img2video.jpg";
  const IMG2VIDEO_DEMO = "/landing/img2video_demo.mp4";

  const MOSAIC_VIDEOS = [
    "/landing/mosaic/video1.mp4",
    "/landing/mosaic/video2.mp4",
    "/landing/mosaic/video3.mp4",
    "/landing/mosaic/video4.mp4",
    "/landing/mosaic/video5.mp4",
    "/landing/mosaic/video6.mp4",
    "/landing/mosaic/video7.mp4",
    "/landing/mosaic/video8.mp4",
  ];

  return (
    <div
      className="relative min-h-screen w-full overflow-hidden text-white"
      style={{
        background:
          "radial-gradient(1200px_800px_at_110%_-10%,rgba(255,23,229,0.18),transparent_60%),radial-gradient(900px_650px_at_-10%_0%,rgba(0,229,255,0.14),transparent_55%),radial-gradient(900px_700px_at_50%_120%,rgba(140,90,255,0.18),transparent_60%),linear-gradient(180deg,#0b0f17 0%, #070a12 60%, #05060a 100%)",
      }}
    >
      {/* Neon side graphics */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[320px] opacity-70">
        <div className="absolute -left-24 top-10 h-[520px] w-[520px] rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute left-10 top-32 h-[260px] w-[2px] bg-gradient-to-b from-cyan-400/0 via-cyan-400/60 to-cyan-400/0 blur-[0.2px]" />
        <div className="absolute left-16 top-44 h-[220px] w-[2px] bg-gradient-to-b from-fuchsia-400/0 via-fuchsia-400/50 to-fuchsia-400/0 blur-[0.2px]" />
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0 w-[360px] opacity-70">
        <div className="absolute -right-28 top-12 h-[520px] w-[520px] rounded-full bg-fuchsia-400/10 blur-3xl" />
        <div className="absolute right-12 top-28 h-[280px] w-[2px] bg-gradient-to-b from-fuchsia-400/0 via-fuchsia-400/60 to-fuchsia-400/0 blur-[0.2px]" />
        <div className="absolute right-20 top-44 h-[240px] w-[2px] bg-gradient-to-b from-cyan-400/0 via-cyan-400/50 to-cyan-400/0 blur-[0.2px]" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0b0f17]/55 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-cyan-500 to-fuchsia-500 text-xs font-bold shadow-lg shadow-cyan-500/25">
              <img
                src="/brand/logo.png"
                alt="IsabelaOS Studio"
                className="h-full w-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
              <span className="pointer-events-none">io</span>
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">
                IsabelaOS <span className="text-xs text-neutral-400">Studio</span>
              </div>
              <div className="text-[10px] text-neutral-500">
                Generación visual con IA
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => scrollToId("contacto")}
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
        {/* HERO: dos imágenes grandes, texto sobre foto */}
        <section className="grid gap-6 lg:grid-cols-2">
          {/* Hero principal con overlay texto */}
          <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[#0b0f17]/60 shadow-xl shadow-cyan-500/10">
            <img
              src={HERO_MAIN}
              alt="Hero principal"
              className="h-[360px] w-full object-cover md:h-[420px]"
            />

            {/* overlay para contraste */}
            <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/35 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-5 md:p-6">
              <div className="max-w-xl rounded-3xl border border-white/10 bg-black/35 p-5 backdrop-blur-md">
                <p className="inline-flex items-center gap-2 rounded-full border border-cyan-400/40 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200">
                  <span className="h-1 w-1 rounded-full bg-cyan-300" />
                  Beta privada · Render en la nube
                </p>

                <h1 className="mt-3 text-3xl font-semibold leading-tight md:text-4xl">
                  IsabelaOS Studio:
                  <span className="block bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-violet-400 bg-clip-text text-transparent">
                    genera imágenes y videos con estética de cine
                  </span>
                </h1>

                <p className="mt-3 text-sm text-neutral-200/90">
                  Escribe un prompt y obtén resultados listos para reels, ads y
                  contenido visual premium.
                </p>

                <div className="mt-5 flex flex-wrap items-center gap-4">
                  <button
                    onClick={onStartDemo}
                    className="rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-3 text-sm font-semibold text-white shadow-[0_0_35px_rgba(34,211,238,0.35)] hover:shadow-[0_0_40px_rgba(236,72,153,0.55)] transition-shadow"
                  >
                    Generar mis {DEMO_LIMIT} imágenes GRATIS
                  </button>

                  <p className="max-w-xs text-[11px] text-neutral-300">
                    Regístrate y desbloquea {DAILY_LIMIT} imágenes diarias.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Segunda imagen grande (sin texto) */}
          <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[#0b0f17]/60 shadow-xl shadow-fuchsia-500/10">
            <img
              src={HERO_SIDE}
              alt="Hero secundario"
              className="h-[360px] w-full object-cover md:h-[420px]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
            <div className="absolute left-5 top-5 rounded-2xl border border-white/10 bg-black/35 px-3 py-2 text-[11px] text-neutral-200 backdrop-blur-md">
              Cine look · Control creativo · Resultados rápidos
            </div>
          </div>
        </section>

        {/* IMAGE → VIDEO: 1 imagen + video a la par */}
        <section className="mt-10">
          <div className="mb-3 flex items-center gap-2">
            <div className="h-[2px] w-10 rounded-full bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-transparent" />
            <h2 className="text-sm font-semibold text-white">
              Image-to-Video: convierte tu imagen en movimiento
            </h2>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-3xl border border-white/10 bg-[#0b0f17]/55 p-5 backdrop-blur-md">
              <p className="text-xs text-neutral-300">
                Sube una imagen (o genera una aquí) y crea un clip corto con
                movimiento natural.
              </p>

              <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black/40">
                <img
                  src={IMG2VIDEO_IMG}
                  alt="Imagen base para Image-to-Video"
                  className="h-[320px] w-full object-cover"
                />
              </div>

              <div className="mt-4 flex items-center gap-3 text-xs text-neutral-300">
                <span className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-3 py-1">
                  1 imagen
                </span>
                <span className="text-neutral-500">→</span>
                <span className="rounded-full border border-fuchsia-400/40 bg-fuchsia-500/10 px-3 py-1">
                  clip 5–10s
                </span>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-[#0b0f17]/55 p-5 backdrop-blur-md">
              <p className="text-xs text-neutral-300">
                Resultado (demo). Aquí irá el preview real cuando conectes el
                módulo.
              </p>

              <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black/50">
                <video
                  src={IMG2VIDEO_DEMO}
                  controls
                  className="h-[360px] w-full object-cover"
                />
              </div>

              <p className="mt-3 text-[11px] text-neutral-400">
                * El motor final puede aplicar BodySync (más adelante) para
                movimiento más expresivo.
              </p>
            </div>
          </div>
        </section>

        {/* MOSAICO de VIDEOS */}
        <section className="mt-10">
          <div className="mb-3 flex items-center gap-2">
            <div className="h-[2px] w-10 rounded-full bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-transparent" />
            <h2 className="text-sm font-semibold text-white">
              Videos desde prompt · Mosaico
            </h2>
          </div>

          <div className="grid grid-cols-12 gap-3">
            {MOSAIC_VIDEOS.map((src, i) => {
              const big = i === 0 || i === 5;
              const tall = i === 2 || i === 6;

              return (
                <div
                  key={src}
                  className={[
                    "col-span-12 overflow-hidden rounded-3xl border border-white/10 bg-[#0b0f17]/55 backdrop-blur-md",
                    big ? "md:col-span-6" : "md:col-span-3",
                    tall ? "md:row-span-2" : "",
                  ].join(" ")}
                >
                  <div className="relative">
                    <video
                      src={src}
                      controls
                      className={["w-full object-cover", tall ? "h-[420px]" : "h-[210px]"].join(" ")}
                    />
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                  </div>
                </div>
              );
            })}
          </div>

          <p className="mt-3 text-[11px] text-neutral-400">
            * Solo reemplaza los archivos en <span className="text-neutral-300">public/landing/mosaic/</span> y listo.
          </p>
        </section>

        {/* BodySync (aclaración: solo imágenes por ahora) */}
        <section className="mt-12">
          <h2 className="text-sm font-semibold text-white mb-2">
            BodySync v1 · (Por ahora) guía de poses para generación de imágenes
          </h2>
          <p className="text-xs text-neutral-300 max-w-2xl">
            BodySync v1 en esta etapa se usa como <span className="font-semibold text-white">control de postura/pose</span>{" "}
            para mejorar la consistencia y dirección corporal en <span className="font-semibold text-white">imágenes</span>.
            La integración completa a video se libera más adelante.
          </p>

          <div className="mt-6 flex justify-center">
            <div className="max-w-md w-full rounded-3xl border border-white/10 bg-[#0b0f17]/60 px-4 py-4 shadow-lg shadow-cyan-500/20 backdrop-blur-md">
              <img
                src="/gallery/bodysync_showcase.png"
                alt="Ejemplo generado con BodySync"
                className="w-full rounded-2xl object-cover"
              />
            </div>
          </div>
        </section>

        {/* Plan de pago */}
        <section className="mt-14 max-w-xl border-t border-white/10 pt-8">
          <h2 className="text-sm font-semibold text-white">
            Plan beta para creadores
          </h2>
          <p className="mt-2 text-xs text-neutral-300">
            Si llegas al límite de {DAILY_LIMIT} imágenes gratuitas al día y quieres
            seguir generando sin restricciones, activa el plan ilimitado.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-4">
            <button
              onClick={handlePaddleCheckout}
              className="rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-2 text-sm font-semibold text-white"
            >
              IsabelaOS Basic – US$5/mes (tarjeta / Paddle)
            </button>
            <div className="flex flex-col gap-1 text-[11px] text-neutral-400">
              <span className="text-neutral-300">
                o pagar con <span className="font-semibold">PayPal</span>:
              </span>
              <PayPalButton amount="5.00" containerId="paypal-button-landing" />
            </div>
          </div>

          <p className="mt-3 text-[11px] text-neutral-400">
            Usuarios beta:{" "}
            <span className="font-semibold text-white">
              Plan Basic activo (sin límite)
            </span>{" "}
            mientras se mantenga la suscripción.
          </p>
        </section>

        {/* Contacto */}
        <section id="contacto" className="mt-16 max-w-xl">
          <h2 className="text-sm font-semibold text-white">Contacto y soporte</h2>
          <p className="mt-1 text-xs text-neutral-400">
            Si tienes dudas, escríbenos a{" "}
            <span className="font-semibold text-white">contacto@isabelaos.com</span>.
          </p>

          <form onSubmit={handleContactSubmit} className="mt-4 space-y-3 text-sm">
            <div>
              <label className="text-xs text-neutral-300">Nombre</label>
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className="mt-1 w-full rounded-2xl bg-black/50 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              />
            </div>
            <div>
              <label className="text-xs text-neutral-300">Correo</label>
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className="mt-1 w-full rounded-2xl bg-black/50 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              />
            </div>
            <div>
              <label className="text-xs text-neutral-300">Mensaje</label>
              <textarea
                rows={4}
                value={contactMessage}
                onChange={(e) => setContactMessage(e.target.value)}
                className="mt-1 w-full rounded-2xl bg-black/50 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              />
            </div>
            <button
              type="submit"
              className="mt-2 rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-2 text-sm font-semibold text-white"
            >
              Enviar mensaje
            </button>
          </form>
        </section>

        <footer className="mt-16 border-t border-white/10 pt-6 text-[11px] text-neutral-500">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              © {new Date().getFullYear()} IsabelaOS Studio · Desarrollado en Guatemala por Stalling Technologic.
            </span>
            <span className="flex flex-wrap gap-3">
              <a href="/terms.html" className="hover:text-neutral-300">
                Términos
              </a>
              <span>•</span>
              <a href="/privacy.html" className="hover:text-neutral-300">
                Privacidad
              </a>
              <span>•</span>
              <a href="/refunds.html" className="hover:text-neutral-300">
                Reembolsos
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

  // Fondo global coherente con el estilo (gris oscuro + neon)
  useEffect(() => {
    const bg =
      "radial-gradient(1200px_800px_at_110%_-10%,rgba(255,23,229,0.14),transparent_60%)," +
      "radial-gradient(900px_600px_at_-10%_0%,rgba(0,229,255,0.12),transparent_55%)," +
      "linear-gradient(180deg,#0A0C12 0%, #06070B 55%, #070816 100%)";

    document.documentElement.style.background = bg;
    document.body.style.background = bg;
    document.body.style.minHeight = "100vh";
  }, []);

  const openAuth = () => {
    // NO cambies la vista aquí: si estaba en demo, se queda en demo.
    setShowAuthModal(true);
  };

  const closeAuth = () => setShowAuthModal(false);

  const handleStartDemo = () => {
    setViewMode("demo");
    // opcional: llevar al top para que el demo se vea inmediato
    try {
      const el = document.getElementById("top");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      else window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      window.scrollTo(0, 0);
    }
  };

  // Si hay usuario, siempre dashboard
  useEffect(() => {
    if (user && viewMode !== "dashboard") {
      setViewMode("dashboard");
    }
  }, [user, viewMode]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-black/90 text-white">
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

        <div className="mt-10">
          <LandingView onOpenAuth={openAuth} onStartDemo={handleStartDemo} />
        </div>

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

