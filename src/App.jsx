import { useState, useEffect } from "react";

// Supongo que este archivo de contexto se proporciona por separado,
// no está incluido en el bloque de código original, pero es necesario.
import { useAuth } from "./context/AuthContext";

// Supongo que estas funciones se proporcionan por separado en el archivo lib/generations.js,
// no están incluidas en el bloque de código original, pero son necesarias.
import {
  saveGenerationInSupabase,
  loadGenerationsForUser,
  getTodayGenerationCount,
  deleteGenerationFromSupabase,
} from "./lib/generations";

// =========================================================
// 🌎 CONSTANTES Y HELPERS GLOBALES
// =========================================================
const DEMO_LIMIT = 3; // Invitado (sin registro)
const DAILY_LIMIT = 5; // Usuario registrado (beta gratis)

const PAYPAL_CLIENT_ID =
  import.meta.env.VITE_PAYPAL_CLIENT_ID ||
  "AZgwhtDkXVf9N6VrwtWk6dzwzM65DWBrM3dn3Og4DXgZhbxSxqRu1UWdEtbj12W_7ItmcrNhZDI3mtPG";

/**
 * Helper para hacer scroll suave a un ID.
 * @param {string} id
 */
function scrollToId(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * Helper para activar el plan premium (Supabase first, fallback localStorage).
 * @param {{userId: string, email: string}} params
 * @returns {Promise<{ok: boolean, source: string, error?: string}>}
 */
async function activatePremiumForUser({ userId, email }) {
  // 1) Intento “real”: marcar premium en Supabase (server-side)
  try {
    const res = await fetch("/api/activate-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, email, plan: "basic", provider: "paypal" }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok) return { ok: true, source: "supabase" };
  } catch (_) {}

  // 2) Fallback: localStorage
  try {
    const premiumKey = `isabelaos_premium_${userId}`;
    localStorage.setItem(premiumKey, "1");
    return { ok: true, source: "localStorage" };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// =========================================================
// 💳 COMPONENTE: PayPalButton
// =========================================================

/**
 * Botón PayPal reutilizable para pagos.
 * @param {{amount: string, containerId: string, onPaid: (details: object) => void}} props
 */
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
                  amount: { value: amount, currency_code: "USD" },
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
                  await onPaid(details);
                } catch (cbErr) {
                  console.error("Error en onPaid PayPal:", cbErr);
                }
              } else {
                alert("Pago completado con PayPal.");
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
      if (window.paypal) renderButtons();
      else existingScript.addEventListener("load", renderButtons);
      return;
    }

    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&currency=USD`;
    script.async = true;
    script.onload = renderButtons;
    document.body.appendChild(script);
  }, [amount, divId, onPaid]);

  return (
    <div className="mt-2 w-full flex justify-center">
      <div className="rounded-2xl bg-gradient-to-r from-indigo-700/80 via-fuchsia-600/80 to-indigo-800/80 px-4 py-2 shadow-lg">
        <div id={divId} className="min-w-[160px]" />
      </div>
    </div>
  );
}

// =========================================================
// 🔑 COMPONENTE: AuthModal
// =========================================================

/**
 * Modal para iniciar sesión o crear cuenta.
 * @param {{open: boolean, onClose: () => void}} props
 */
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
        alert("Cuenta creada. Revisa tu correo si Supabase requiere confirmación.");
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
          Usa tu correo o entra con Google para usar IsabelaOS Studio.
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

// =========================================================
// 🖼️ COMPONENTE: CreatorPanel (Generador de imágenes)
// =========================================================

/**
 * Panel para la generación de imágenes.
 * @param {{isDemo: boolean, onAuthRequired: () => void}} props
 */
function CreatorPanel({ isDemo = false, onAuthRequired }) {
  const { user } = useAuth();
  const userLoggedIn = !isDemo && user;

  // Estados del formulario
  const [prompt, setPrompt] = useState("Cinematic portrait, ultra detailed, soft light, 8k");
  const [negative, setNegative] = useState("blurry, low quality, deformed, watermark, text");
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);
  const [steps, setSteps] = useState(22);

  // Estados de optimización IA
  const [autoPrompt, setAutoPrompt] = useState(false);
  const [optimizedPrompt, setOptimizedPrompt] = useState("");
  const [optimizedNegative, setOptimizedNegative] = useState("");

  // Estados de proceso y resultado
  const [status, setStatus] = useState("IDLE");
  const [statusText, setStatusText] = useState("");
  const [imageB64, setImageB64] = useState(null);
  const [error, setError] = useState("");

  // Estados de límites y premium
  const [dailyCount, setDailyCount] = useState(0);
  const [isPremium, setIsPremium] = useState(false);
  const [demoCount, setDemoCount] = useState(0);

  const premiumKey = userLoggedIn ? `isabelaos_premium_${user.id}` : null;

  // Carga estado premium (admin + localStorage)
  useEffect(() => {
    if (!userLoggedIn) {
      setIsPremium(false);
      setDailyCount(0);
      return;
    }

    // Admin hardcode (se debe eliminar en prod)
    if (user.email === "exportalling@gmail.com") {
      setIsPremium(true);
      if (premiumKey) {
        try { localStorage.setItem(premiumKey, "1"); } catch (_) {}
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

  // Carga conteo diario (Supabase)
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

  // Carga conteo demo (localStorage)
  useEffect(() => {
    if (!isDemo) return;
    try {
      const storedDemoCount = localStorage.getItem("isabelaos_demo_count") || "0";
      setDemoCount(Number(storedDemoCount));
    } catch (e) {
      console.warn("Error leyendo demo count:", e);
    }
  }, [isDemo]);

  /**
   * Optimiza un prompt o negative prompt con un endpoint IA.
   * @param {string} originalText
   * @param {React.Dispatch<React.SetStateAction<string>>} setOptimized
   * @param {string} label
   * @returns {Promise<string>} Prompt o negative prompt a usar.
   */
  const optimizeOne = async (originalText, setOptimized, label) => {
    if (!autoPrompt || !originalText?.trim()) {
      setOptimized("");
      return originalText;
    }

    try {
      setStatus("OPTIMIZING");
      setStatusText(`Optimizando ${label} con IA...`);

      const res = await fetch("/api/optimize-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: originalText }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data.optimizedPrompt) {
        setStatusText(`No se pudo optimizar ${label}; usando original.`);
        setOptimized("");
        return originalText;
      }

      setOptimized(data.optimizedPrompt);
      return data.optimizedPrompt;
    } catch (err) {
      console.error(`Error al optimizar ${label}:`, err);
      setStatusText(`Error al optimizar ${label}; usando original.`);
      setOptimized("");
      return originalText;
    }
  };

  // Lógica de generación de imagen
  const handleGenerate = async () => {
    setError("");

    const currentLimit = isDemo ? DEMO_LIMIT : DAILY_LIMIT;
    const currentCount = isDemo ? demoCount : dailyCount;

    // Premium = ilimitado
    if (!isPremium && currentCount >= currentLimit) {
      setStatus("ERROR");
      setStatusText("Límite de generación alcanzado.");

      if (isDemo && onAuthRequired) {
        alert(
          `Agotaste tus ${DEMO_LIMIT} imágenes de prueba. Crea tu cuenta GRATIS para obtener ${DAILY_LIMIT} imágenes al día, guardar historial y descargar.`
        );
        onAuthRequired();
      } else if (userLoggedIn) {
        setError(
          `Límite de ${DAILY_LIMIT} imágenes hoy. Activa Plan Basic (US$5/mes) para generar sin límite y desbloquear módulos premium.`
        );
      }
      return;
    }

    setImageB64(null);

    // 1) Optimizar si aplica
    let promptToUse = prompt;
    let negativeToUse = negative;

    if (autoPrompt) {
      promptToUse = await optimizeOne(prompt, setOptimizedPrompt, "prompt");
      negativeToUse = await optimizeOne(negative, setOptimizedNegative, "negative prompt");
    } else {
      setOptimizedPrompt("");
      setOptimizedNegative("");
    }

    // 2) Render normal
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
          optimize_prompt: autoPrompt,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || "Error en /api/generate.");

      const jobId = data.jobId;
      setStatusText(`Job enviado. ID: ${jobId}. Consultando estado...`);

      let finished = false;
      while (!finished) {
        await new Promise((r) => setTimeout(r, 2000));

        const statusRes = await fetch(`/api/status?id=${jobId}`);
        const statusData = await statusRes.json();

        if (!statusRes.ok || statusData.error) throw new Error(statusData.error || "Error /api/status.");

        const st = statusData.status;
        setStatus(st);
        setStatusText(`Estado actual: ${st}...`);

        if (st === "IN_QUEUE" || st === "IN_PROGRESS") continue;

        finished = true;

        if (st === "COMPLETED" && statusData.output?.image_b64) {
          const b64 = statusData.output.image_b64;
          setImageB64(b64);
          setStatusText("Render completado.");

          // Manejo de contadores
          if (isDemo) {
            const newDemoCount = demoCount + 1;
            setDemoCount(newDemoCount);
            localStorage.setItem("isabelaos_demo_count", String(newDemoCount));
          }

          // Guardar en Supabase (si está logueado)
          if (userLoggedIn) {
            setDailyCount((prev) => prev + 1);

            const dataUrl = `data:image/png;base64,${b64}`;
            saveGenerationInSupabase({
              userId: user.id,
              imageUrl: dataUrl,
              prompt: promptToUse,
              negativePrompt: negativeToUse,
              width: Number(width),
              height: Number(height),
              steps: Number(steps),
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
      setError(err.message || String(err));
    }
  };

  // Lógica de descarga
  const handleDownload = () => {
    if (isDemo) {
      alert("Para descargar tu imagen, crea tu cuenta o inicia sesión.");
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

  // Lógica de activación PayPal
  const handlePayPalUnlock = async () => {
    if (!userLoggedIn) return;

    const result = await activatePremiumForUser({ userId: user.id, email: user.email });
    if (result.ok) {
      setIsPremium(true);
      setError("");
      setStatus("IDLE");
      setStatusText(
        "Usuario beta – Plan Basic activo (sin límite)."
      );
      alert("Plan Basic activo: ahora generas sin límite y desbloqueas módulos premium.");
    } else {
      alert("No se pudo activar el plan. Intenta de nuevo.");
    }
  };

  // UI helper: límites
  const currentLimit = isDemo ? DEMO_LIMIT : DAILY_LIMIT;
  const currentCount = isDemo ? demoCount : dailyCount;
  const remaining = currentLimit - currentCount;

  if (!userLoggedIn && !isDemo) {
    return (
      <div className="rounded-3xl border border-yellow-400/30 bg-yellow-500/5 p-6 text-center text-sm text-yellow-100">
        <p className="font-medium">Debes iniciar sesión para usar el generador de imágenes.</p>
        <p className="mt-1 text-xs text-yellow-200/80">
          {DAILY_LIMIT} imágenes diarias gratis. Plan Basic (US$5/mes) para ilimitado y módulos premium.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* Formulario */}
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">Generador desde prompt</h2>

        {isDemo && (
          <div className="mt-4 rounded-2xl border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-[11px] text-cyan-100">
            Modo prueba: te quedan {Math.max(0, remaining)} imágenes. Descarga y biblioteca requieren cuenta.
          </div>
        )}

        {userLoggedIn && isPremium && (
          <div className="mt-4 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-[11px] text-emerald-100">
            ✅ Usuario beta – Plan Basic activo (sin límite)
          </div>
        )}

        {userLoggedIn && !isPremium && remaining <= 2 && remaining > 0 && (
          <div className="mt-4 rounded-2xl border border-yellow-400/40 bg-yellow-500/10 px-4 py-2 text-[11px] text-yellow-100">
            Solo te quedan {remaining} imágenes hoy. Activa Plan Basic (US$5/mes) para ilimitado.
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
              Ajusta tu texto automáticamente antes del render.
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
            Estado: {statusText || "Listo para generar."}
            <br />
            <span className="text-[11px] text-neutral-400">
              {isDemo && `Uso de prueba: ${currentCount} / ${currentLimit}. `}
              {userLoggedIn && isPremium && `Uso de hoy: ${currentCount}. (sin límite) `}
              {userLoggedIn && !isPremium && `Uso de hoy: ${currentCount} / ${currentLimit}. `}
            </span>
          </div>

          {error && <p className="text-xs text-red-400 whitespace-pre-line">{error}</p>}

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

          {/* Pagos: solo cuando toca */}
          {userLoggedIn && !isPremium && currentCount >= DAILY_LIMIT && (
            <div className="mt-3">
              <p className="text-[11px] text-neutral-400">
                Desbloquea Plan Basic (US$5/mes) para ilimitado:
              </p>
              <PayPalButton
                amount="5.00"
                containerId="paypal-button-panel"
                onPaid={handlePayPalUnlock}
              />
            </div>
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
            {isDemo ? "Descargar (Requiere cuenta)" : "Descargar imagen"}
          </button>
        )}
      </div>
    </div>
  );
}

// =========================================================
// 🎥 COMPONENTE: VideoPanel (Generador de video)
// =========================================================

/**
 * Panel para la generación de videos. Requiere usuario logueado.
 */
function VideoPanel() {
  const { user } = useAuth();

  // Estados del formulario
  const [prompt, setPrompt] = useState(
    "beautiful latina woman in an elegant tight blue dress, confident runway walk towards the camera, studio background, ultra detailed, 8k"
  );
  const [negative, setNegative] = useState(
    "low quality, blurry, bad anatomy, deformed, glitch, watermark, noisy, pixelated, static pose"
  );

  // Estados de optimización IA
  const [autoPrompt, setAutoPrompt] = useState(false);
  const [optimizedPrompt, setOptimizedPrompt] = useState("");
  const [optimizedNegative, setOptimizedNegative] = useState("");

  // Estados de parámetros de video
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [quality, setQuality] = useState("HD");
  const [duration, setDuration] = useState(5);

  // Estados de proceso y resultado
  const [status, setStatus] = useState("IDLE");
  const [statusText, setStatusText] = useState("");
  const [videoUrl, setVideoUrl] = useState(null);
  const [error, setError] = useState("");

  /**
   * Optimiza un prompt o negative prompt con un endpoint IA.
   * @param {string} label
   * @param {string} text
   * @param {React.Dispatch<React.SetStateAction<string>>} setter
   * @returns {Promise<string>} Prompt o negative prompt a usar.
   */
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
      if (!res.ok || !data?.ok || !data.optimizedPrompt) {
        setter("");
        setStatusText(`No se pudo optimizar ${label}; usando original.`);
        return text;
      }

      setter(data.optimizedPrompt);
      return data.optimizedPrompt;
    } catch (err) {
      console.error(`Error optimizando ${label}:`, err);
      setter("");
      setStatusText(`Error al optimizar ${label}; usando original.`);
      return text;
    }
  };

  // Lógica de generación de video
  const handleGenerateVideo = async () => {
    setError("");
    setVideoUrl(null);

    if (!user) {
      setError("Debes iniciar sesión para generar video.");
      return;
    }

    let promptToUse = prompt;
    let negativeToUse = negative;

    if (autoPrompt) {
      promptToUse = await optimizeOne("prompt", prompt, setOptimizedPrompt);
      negativeToUse = await optimizeOne("negative", negative, setOptimizedNegative);
    } else {
      setOptimizedPrompt("");
      setOptimizedNegative("");
    }

    setStatus("GENERATING");
    setStatusText("Generando video en RunPod y haciendo upscale...");

    try {
      const res = await fetch("/api/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptToUse,
          negative_prompt: negativeToUse,
          aspect_ratio: aspectRatio,
          duration_seconds: duration,
          quality,
          optimize_prompt: autoPrompt,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok || !data.videoUrl) {
        throw new Error(data?.error || "Error en /api/generate-video. Revisa logs.");
      }

      setVideoUrl(data.videoUrl);
      setStatus("DONE");
      setStatusText("Video generado correctamente.");
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
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">Generar video desde prompt</h2>

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

          <div className="flex items-start justify-between gap-3 text-xs">
            <label className="flex items-center gap-2 text-neutral-300">
              <input
                type="checkbox"
                checked={autoPrompt}
                onChange={(e) => setAutoPrompt(e.target.checked)}
                className="h-4 w-4 rounded border-white/30 bg-black/70"
              />
              <span>Optimizar prompts con IA (OpenAI)</span>
            </label>
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

          <div className="grid gap-3 md:grid-cols-2 text-xs">
            <div>
              <p className="text-neutral-300 mb-1">Relación de aspecto</p>
              <div className="flex gap-2">
                {["1:1", "9:16", "16:9"].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setAspectRatio(r)}
                    className={`flex-1 rounded-2xl px-3 py-2 ${
                      aspectRatio === r
                        ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                        : "bg-black/60 text-neutral-200 border border-white/10 hover:bg-white/5"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-neutral-300 mb-1">Duración</p>
              <div className="flex gap-2">
                {[5, 10].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDuration(d)}
                    className={`flex-1 rounded-2xl px-3 py-2 ${
                      duration === d
                        ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                        : "bg-black/60 text-neutral-200 border border-white/10 hover:bg-white/5"
                    }`}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </div>

            <div className="md:col-span-2">
              <p className="text-neutral-300 mb-1">Calidad</p>
              <div className="flex gap-2">
                {["HD", "MAX"].map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setQuality(q)}
                    className={`flex-1 rounded-2xl px-3 py-2 ${
                      quality === q
                        ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                        : "bg-black/60 text-neutral-200 border border-white/10 hover:bg-white/5"
                    }`}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-2 rounded-2xl bg-black/50 px-4 py-2 text-xs text-neutral-300">
            Estado: {statusText || "Listo para generar video."}
          </div>

          {error && <p className="text-xs text-red-400 whitespace-pre-line">{error}</p>}

          <button
            type="button"
            onClick={handleGenerateVideo}
            disabled={status === "GENERATING" || !user}
            className="mt-4 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {status === "GENERATING" ? "Generando..." : "Generar video"}
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-black/40 p-6 flex flex-col">
        <h2 className="text-lg font-semibold text-white">Resultado</h2>
        <div className="mt-4 flex h-[420px] flex-1 items-center justify-center rounded-2xl bg-black/70 text-sm text-neutral-400">
          {videoUrl ? (
            <video src={videoUrl} controls className="h-full w-full rounded-2xl object-contain" />
          ) : (
            <p>Aquí verás tu clip cuando termine la generación.</p>
          )}
        </div>

        {videoUrl && (
          <button
            type="button"
            onClick={handleDownloadVideo}
            className="mt-4 w-full rounded-2xl border border-white/30 py-2 text-xs text-white hover:bg-white/10"
          >
            Abrir / descargar
          </button>
        )}
      </div>
    </div>
  );
}

// =========================================================
// 📚 COMPONENTE: LibraryView (Biblioteca de imágenes)
// =========================================================

/**
 * Vista de la biblioteca para imágenes guardadas en Supabase.
 */
function LibraryView() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  // Carga las imágenes del usuario desde Supabase al iniciar o cambiar de usuario
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
          prompt: row.prompt || "",
        }));
        setItems(mapped);
        setSelected(mapped[0] || null);
      } catch (e) {
        console.error("Error cargando biblioteca:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  // Lógica para eliminar la imagen seleccionada
  const handleDeleteSelected = async () => {
    if (!selected || !user) return;
    const ok = window.confirm("¿Eliminar esta imagen? Se borrará también de Supabase.");
    if (!ok) return;

    try {
      setDeleting(true);
      await deleteGenerationFromSupabase(selected.id);

      // Actualizar el estado de forma funcional
      setItems((prev) => {
        const newItems = prev.filter((it) => it.id !== selected.id);
        // Si la imagen actual se elimina, seleccionar la primera del nuevo array
        if (selected.id === selected.id) {
          setSelected(newItems[0] || null);
        }
        return newItems;
      });
    } catch (e) {
      console.error("Error eliminando imagen:", e);
      alert("No se pudo eliminar. Intenta de nuevo.");
    } finally {
      setDeleting(false);
    }
  };

  // Re-seleccionar la primera si la selección actual es nula (después de eliminar)
  useEffect(() => {
    if (!selected && items.length > 0) setSelected(items[0]);
  }, [items, selected]);

  if (!user) {
    return (
      <div className="rounded-3xl border border-yellow-400/30 bg-yellow-500/5 p-6 text-center text-sm text-yellow-100">
        Inicia sesión para acceder a tu biblioteca.
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1.1fr_1.4fr]">
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">Biblioteca</h2>

        {loading ? (
          <p className="mt-4 text-xs text-neutral-400">Cargando historial...</p>
        ) : items.length === 0 ? (
          <p className="mt-4 text-xs text-neutral-400">Aún no tienes imágenes guardadas.</p>
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
                title={item.prompt || "Generación"}
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
            <img src={selected.src} alt="Seleccionada" className="h-full w-full rounded-2xl object-contain" />
          ) : (
            <p>Selecciona una imagen para verla aquí.</p>
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

// =========================================================
// 🎄 COMPONENTE: XmasPhotoPanel (Módulo Premium)
// =========================================================

/**
 * Módulo premium para generar fotos navideñas a partir de una foto base.
 */
function XmasPhotoPanel() {
  const { user } = useAuth();

  // Estados de la foto de entrada
  const [dataUrl, setDataUrl] = useState(null); // Data URL para previsualización
  const [pureB64, setPureB64] = useState(null); // Base64 puro para el envío
  const [extraPrompt, setExtraPrompt] = useState("");

  // Estados de proceso y resultado
  const [status, setStatus] = useState("IDLE");
  const [statusText, setStatusText] = useState("");
  const [resultB64, setResultB64] = useState(null);
  const [error, setError] = useState("");

  // Estado de gating (Premium)
  const [isPremium, setIsPremium] = useState(false);

  // Cargar estado premium
  useEffect(() => {
    if (!user) {
      setIsPremium(false);
      return;
    }
    const premiumKey = `isabelaos_premium_${user.id}`;

    if (user.email === "exportalling@gmail.com") {
      setIsPremium(true);
      try { localStorage.setItem(premiumKey, "1"); } catch (_) {}
      return;
    }

    try {
      setIsPremium(localStorage.getItem(premiumKey) === "1");
    } catch (_) {
      setIsPremium(false);
    }
  }, [user]);

  const fileInputId = "xmas-file-input";

  /**
   * Convierte un objeto File a Base64 Data URL.
   * @param {File} file
   * @returns {Promise<string>}
   */
  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });

  // Manejador de cambio de archivo
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

  // Lógica de generación de foto navideña
  const handleGenerateXmas = async () => {
    setError("");

    if (!user) return setError("Debes iniciar sesión para usar este módulo.");
    if (!isPremium)
      return setError("Este módulo es Plan Basic (US$5/mes). Activa tu plan para usar Foto Navideña IA.");

    if (!pureB64) return setError("Sube una foto primero.");

    setResultB64(null);
    setStatus("IN_QUEUE");
    setStatusText("Enviando foto navideña a RunPod...");

    try {
      const res = await fetch("/api/generate-xmas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_b64: pureB64, description: extraPrompt || "" }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data.jobId) throw new Error(data?.error || "Error lanzando job navideño.");

      const jobId = data.jobId;
      setStatusText(`Foto enviada. ID: ${jobId}. Consultando estado...`);

      let finished = false;
      while (!finished) {
        await new Promise((r) => setTimeout(r, 2000));

        const statusRes = await fetch(`/api/status?id=${jobId}`);
        const statusData = await statusRes.json().catch(() => null);

        if (!statusRes.ok || !statusData) throw new Error(statusData?.error || "Error /api/status.");

        const st = statusData.status;
        setStatus(st);
        setStatusText(`Estado actual: ${st}...`);

        if (st === "IN_QUEUE" || st === "IN_PROGRESS") continue;
        finished = true;

        if (st === "COMPLETED" && statusData.output?.image_b64) {
          setResultB64(statusData.output.image_b64);
          setStatusText("Foto navideña generada con éxito.");
        } else {
          throw new Error("Job terminado pero sin imagen.");
        }
      }
    } catch (err) {
      console.error("Error Xmas:", err);
      setStatus("ERROR");
      setStatusText("Error al generar la foto navideña.");
      setError(err.message || String(err));
    }
  };

  // Lógica de descarga
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
        <h2 className="text-lg font-semibold text-white">Foto Navideña IA (Premium)</h2>

        {!isPremium && (
          <div className="mt-4 rounded-2xl border border-yellow-400/40 bg-yellow-500/10 px-4 py-2 text-[11px] text-yellow-100">
            Este módulo requiere Plan Basic (US$5/mes).
          </div>
        )}

        <div className="mt-5 space-y-4 text-sm">
          <div>
            <p className="text-xs text-neutral-300">Sube tu foto (JPG/PNG)</p>
            <input
              id={fileInputId}
              type="file"
              accept="image/*"
              className="mt-2 w-full text-xs text-neutral-300"
              onChange={handleFileChange}
            />
            {dataUrl && (
              <div className="mt-3 overflow-hidden rounded-2xl border border-white/10">
                <img src={dataUrl} alt="Foto base" className="w-full object-cover" />
              </div>
            )}
          </div>

          <div>
            <p className="text-xs text-neutral-300">Opcional: describe la escena</p>
            <input
              type="text"
              value={extraPrompt}
              onChange={(e) => setExtraPrompt(e.target.value)}
              className="mt-2 w-full rounded-2xl bg-black/60 px-3 py-2 text-xs text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              placeholder="Ej: familia, sala acogedora, árbol, regalos..."
            />
          </div>

          <div className="mt-2 rounded-2xl bg-black/50 px-4 py-2 text-xs text-neutral-300">
            Estado: {statusText || "Listo."}
          </div>

          {error && <p className="text-xs text-red-400 whitespace-pre-line">{error}</p>}

          <button
            type="button"
            onClick={handleGenerateXmas}
            disabled={status === "IN_QUEUE" || status === "IN_PROGRESS" || !pureB64 || !user}
            className="mt-3 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {status === "IN_QUEUE" || status === "IN_PROGRESS" ? "Generando..." : "Generar foto navideña"}
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-black/40 p-6 flex flex-col">
        <h2 className="text-lg font-semibold text-white">Resultado</h2>
        <div className="mt-4 flex h-[420px] flex-1 items-center justify-center rounded-2xl bg-black/70 text-sm text-neutral-400">
          {resultB64 ? (
            <img src={`data:image/png;base64,${resultB64}`} alt="Navideña" className="h-full w-full rounded-2xl object-contain" />
          ) : (
            <p>Aquí verás tu resultado cuando termine.</p>
          )}
        </div>
        {resultB64 && (
          <button
            onClick={handleDownload}
            className="mt-4 w-full rounded-2xl border border-white/30 py-2 text-xs text-white hover:bg-white/10"
          >
            Descargar
          </button>
        )}
      </div>
    </div>
  );
}

// =========================================================
// 🚀 COMPONENTE: DashboardView (Vista principal logueada)
// =========================================================

/**
 * Vista principal para el usuario autenticado (panel de control).
 */
function DashboardView() {
  const { user, isAdmin, signOut } = useAuth();
  const [appViewMode, setAppViewMode] = useState("generator");

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
                isabelaOs <span className="text-xs text-neutral-400">Studio</span>
              </div>
              <div className="text-[10px] text-neutral-500">Panel del creador · Beta</div>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <span className="hidden sm:inline text-neutral-300">
              {user?.email} {isAdmin ? "· admin" : ""}
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
        {/* Sidebar + contenido */}
        <section className="flex gap-6">
          <aside className="hidden md:flex w-56 flex-col rounded-3xl border border-white/10 bg-black/60 p-4 text-xs">
            <p className="text-[11px] font-semibold text-neutral-300 mb-3">Navegación</p>

            <button
              type="button"
              onClick={() => setAppViewMode("generator")}
              className={`mb-2 w-full rounded-2xl px-3 py-2 text-left ${
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
              className={`mb-2 w-full rounded-2xl px-3 py-2 text-left ${
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
                  : "bg-gradient-to-r from-cyan-600/70 to-fuchsia-600/70 text-white/90"
              }`}
            >
              🎄 Foto Navideña IA (Premium)
            </button>
          </aside>

          <div className="flex-1 space-y-6">
            <div>
              <h1 className="text-xl font-semibold text-white">Panel del creador</h1>
              <p className="mt-1 text-xs text-neutral-400">
                Genera imágenes, videos, guarda historial y usa módulos premium.
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

// =========================================================
// 🌐 COMPONENTE: LandingView (Página de aterrizaje)
// =========================================================

/**
 * Vista de aterrizaje para usuarios no autenticados.
 * @param {{onOpenAuth: () => void, onStartDemo: () => void}} props
 */
function LandingView({ onOpenAuth, onStartDemo }) {
  const handleContactSubmit = (e) => {
    e.preventDefault();
    const subject = encodeURIComponent("Contacto desde IsabelaOS Studio");
    const body = encodeURIComponent("Hola, necesito info de IsabelaOS Studio.");
    window.location.href = `mailto:contacto@isabelaos.com?subject=${subject}&body=${body}`;
  };

  return (
    <div
      className="min-h-screen w-full text-white"
      style={{
        background:
          "radial-gradient(1200px_800px_at_110%_-10%,rgba(255,23,229,0.22),transparent_60%),radial-gradient(900px_600px_at_-10%_0%,rgba(0,229,255,0.22),transparent_55%),radial-gradient(700px_700px_at_50%_120%,rgba(140,90,255,0.5),transparent_60%),#05060A",
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
              <div className="text-[10px] text-neutral-500">Generación visual con IA</div>
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
              Login / Registro
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-10">
        {/* HERO */}
        <section className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
          {/* Texto */}
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-cyan-400/40 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300/90">
              <span className="h-1 w-1 rounded-full bg-cyan-300" />
              <span>Beta privada · Motor visual</span>
            </p>

            <h1 className="mt-3 text-4xl font-semibold leading-tight md:text-5xl">
              Genera contenido visual{" "}
              <span className="block bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-violet-400 bg-clip-text text-transparent">
                en segundos.
              </span>
            </h1>

            <div className="mt-3 h-[2px] w-40 rounded-full bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-transparent" />

            <p className="mt-4 max-w-xl text-sm text-neutral-300">
              IsabelaOS Studio: motor en la nube para creadores. Prompt → render real.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-4">
              <button
                onClick={onStartDemo}
                className="rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-3 text-sm font-semibold text-white"
              >
                Generar mis {DEMO_LIMIT} imágenes GRATIS
              </button>

              <button
                onClick={onOpenAuth}
                className="rounded-2xl border border-white/20 px-6 py-3 text-sm text-white hover:bg-white/10"
              >
                Crear cuenta
              </button>
            </div>

            <p className="mt-3 text-xs text-neutral-400">
              Cuenta gratuita: {DAILY_LIMIT} imágenes al día + biblioteca. Plan Basic: ilimitado + premium.
            </p>
          </div>

          {/* 2 imágenes grandes (una con texto encima + overlay) */}
          <div className="relative">
            <div className="pointer-events-none absolute -inset-8 -z-10 rounded-[32px] bg-gradient-to-br from-cyan-500/18 via-transparent to-fuchsia-500/25 blur-3xl" />

            <div className="grid gap-3">
              {/* Imagen 1 con texto encima */}
              <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-black/50">
                <img
                  src="/gallery/img1.png?v=3"
                  alt="Preview 1"
                  className="h-[220px] w-full object-cover"
                />

                {/* Overlay para contraste */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-black/10" />

                {/* Texto encima */}
                <div className="absolute bottom-0 left-0 right-0 p-4">
                  <p className="text-xs text-cyan-200/90 font-semibold">
                    Calidad de estudio
                  </p>
                  <p className="mt-1 text-sm text-white font-semibold">
                    Render real + prompt optimizado
                  </p>
                  <p className="mt-1 text-[11px] text-neutral-300">
                    Resultados consistentes para posts, ads y reels.
                  </p>
                </div>
              </div>

              {/* Imagen 2 grande */}
              <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/50">
                <img
                  src="/gallery/img2.png?v=3"
                  alt="Preview 2"
                  className="h-[220px] w-full object-cover"
                />
              </div>
            </div>

            <p className="mt-3 text-[10px] text-neutral-500">
              *Imágenes de muestra (galería). El resultado depende de tu prompt.
            </p>
          </div>
        </section>

        {/* Contacto */}
        <section id="contacto" className="mt-16 max-w-xl">
          <h2 className="text-sm font-semibold text-white">Contacto y soporte</h2>
          <p className="mt-1 text-xs text-neutral-400">
            Escríbenos a <span className="font-semibold text-white">contacto@isabelaos.com</span>
          </p>

          <form onSubmit={handleContactSubmit} className="mt-4 space-y-3 text-sm">
            <button
              type="submit"
              className="mt-2 rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-2 text-sm font-semibold text-white"
            >
              Enviar correo
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}

// =========================================================
// 📱 COMPONENTE: App Principal
// =========================================================

export default function App() {
  const { user, loading } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [viewMode, setViewMode] = useState("landing"); // landing | demo | dashboard

  useEffect(() => {
    // Establece el fondo global
    document.documentElement.style.background = "#06070B";
  }, []);

  const openAuth = () => {
    setShowAuthModal(true);
    setViewMode("landing"); // Asegurarse que el modo demo se cancele
  };
  const closeAuth = () => setShowAuthModal(false);

  const handleStartDemo = () => setViewMode("demo");

  // Cambiar a 'dashboard' automáticamente al autenticarse
  useEffect(() => {
    if (user && viewMode !== "dashboard") setViewMode("dashboard");
    if (!user && viewMode === "dashboard") setViewMode("landing");
  }, [user, viewMode]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-black text-white">
        <p className="text-sm text-neutral-400">Cargando sesión...</p>
      </div>
    );
  }

  if (user) return <DashboardView />;

  if (viewMode === "demo") {
    return (
      <>
        <div id="top" className="pt-10">
          <CreatorPanel isDemo={true} onAuthRequired={openAuth} />
        </div>
        {/* Añadir landing abajo por si el usuario scrollea para registrarse */}
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
