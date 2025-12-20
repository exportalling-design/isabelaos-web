import { useState, useEffect, useMemo } from "react";
import { useAuth } from "./context/AuthContext";

import {
  saveGenerationInSupabase,
  loadGenerationsForUser,
  getTodayGenerationCount,
  deleteGenerationFromSupabase,
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
  xmas_photo: 12,
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
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------------------------------------------------
// Botón PayPal reutilizable
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

      // evita duplicar botones
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
              if (typeof onPaid === "function") onPaid(details);
              else {
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
      if (window.paypal) renderButtons();
      else existingScript.addEventListener("load", renderButtons, { once: true });
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
  }, [amount, description, divId, onPaid]);

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
// Panel del creador (generador de imágenes)
// MODELO: JADES + DEMO + OPTIMIZACIÓN PROMPT
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

  // Prompt optimizer
  const [autoPrompt, setAutoPrompt] = useState(false);
  const [optimizedPrompt, setOptimizedPrompt] = useState("");
  const [optimizedNegative, setOptimizedNegative] = useState("");

  // Estado render
  const [status, setStatus] = useState("IDLE"); // IDLE | OPTIMIZING | IN_QUEUE | IN_PROGRESS | COMPLETED | ERROR
  const [statusText, setStatusText] = useState("");
  const [imageB64, setImageB64] = useState(null);
  const [error, setError] = useState("");

  // Jades (temporal en localStorage)
  const jadeKey = userLoggedIn ? `isabelaos_jades_${user.id}` : null;
  const [jades, setJades] = useState(0);

  // DEMO
  const [demoCount, setDemoCount] = useState(0);

  useEffect(() => {
    if (!isDemo) return;
    const stored = localStorage.getItem("isabelaos_demo_count") || "0";
    setDemoCount(Number(stored));
  }, [isDemo]);

  useEffect(() => {
    if (!userLoggedIn || !jadeKey) return;
    const stored = localStorage.getItem(jadeKey);
    if (stored === null) {
      localStorage.setItem(jadeKey, "20");
      setJades(20);
    } else {
      setJades(Number(stored));
    }
  }, [userLoggedIn, jadeKey]);

  const costPerImage = GENERATION_COSTS.img_prompt;

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
        return text;
      }
      const optimized = String(data.optimizedPrompt).trim();
      if (!optimized) {
        setter("");
        return text;
      }
      setter(optimized);
      return optimized;
    } catch (err) {
      console.error("Error optimizando:", err);
      setter("");
      return text;
    }
  };

  const handleGenerate = async () => {
    setError("");
    setImageB64(null);

    // DEMO
    if (isDemo) {
      if (demoCount >= DEMO_LIMIT) {
        alert(
          `Has agotado tus ${DEMO_LIMIT} imágenes de prueba. Regístrate para continuar.`
        );
        onAuthRequired && onAuthRequired();
        return;
      }
    }

    // JADES
    if (userLoggedIn && jades < costPerImage) {
      setStatus("ERROR");
      setStatusText("Jades insuficientes.");
      setError(
        `No tienes jades suficientes. Cada imagen cuesta ${costPerImage} jade(s).`
      );
      return;
    }

    // Optimizar
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

    setStatus("IN_QUEUE");
    setStatusText("Enviando render al motor...");

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

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.output?.image_b64) {
        throw new Error(data?.error || "Error al generar la imagen.");
      }

      setImageB64(data.output.image_b64);
      setStatus("COMPLETED");
      setStatusText("Imagen generada correctamente.");

      // DEMO COUNT
      if (isDemo) {
        const next = demoCount + 1;
        setDemoCount(next);
        localStorage.setItem("isabelaos_demo_count", String(next));
      }

      // DESCONTAR JADES
      if (userLoggedIn && jadeKey) {
        const remaining = Math.max(0, Number(jades || 0) - costPerImage);
        setJades(remaining);
        localStorage.setItem(jadeKey, String(remaining));
      }

      // Guardar en Supabase
      if (userLoggedIn) {
        saveGenerationInSupabase({
          userId: user.id,
          imageUrl: `data:image/png;base64,${data.output.image_b64}`,
          prompt: promptToUse,
          negativePrompt: negativeToUse,
          width: Number(width),
          height: Number(height),
          steps: Number(steps),
        }).catch(console.error);
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

  const remaining = isDemo ? Math.max(0, DEMO_LIMIT - demoCount) : 0;

  const busy =
    status === "OPTIMIZING" ||
    status === "IN_QUEUE" ||
    status === "IN_PROGRESS";

  if (!userLoggedIn && !isDemo) {
    return (
      <div className="rounded-3xl border border-yellow-400/30 bg-yellow-500/5 p-6 text-center text-sm text-yellow-100">
        <p className="font-medium">Debes iniciar sesión para usar el generador.</p>
        <p className="mt-1 text-xs text-yellow-200/80">
          Desde tu cuenta podrás generar imágenes con nuestro motor conectado a RunPod,
          guardar tu historial y descargar. El sistema funciona con{" "}
          <span className="font-semibold text-white">Jades</span> (créditos).
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">Generador desde prompt</h2>

        {isDemo && (
          <div className="mt-4 rounded-2xl border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-[11px] text-cyan-100">
            Modo demo: te quedan {remaining} imágenes de prueba. La descarga requiere
            crear cuenta.
          </div>
        )}

        {userLoggedIn && (
          <div className="mt-4 rounded-2xl border border-white/10 bg-black/50 px-4 py-2 text-[11px] text-neutral-200">
            <span className="font-semibold text-white">Saldo:</span>{" "}
            {Number(jades || 0)} jade(s) ·{" "}
            <span className="text-neutral-400">
              Esta generación cuesta {GENERATION_COSTS.img_prompt} jade(s).
            </span>
          </div>
        )}

        <div className="mt-4 space-y-4 text-sm">
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
              <span>Optimizar mi prompt con IA (OpenAI)</span>
            </label>
            <span className="text-[10px] text-neutral-500 text-right">
              Si está activado, el sistema ajusta tu texto antes de enviar el render.
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
                disabled={busy}
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
                disabled={busy}
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
                disabled={busy}
              />
            </div>
          </div>

          <div className="mt-2 rounded-2xl bg-black/50 px-4 py-2 text-xs text-neutral-300">
            Estado actual: {statusText || "Listo para generar."}
            <br />
            <span className="text-[11px] text-neutral-400">
              {isDemo && `Uso de prueba: ${demoCount} / ${DEMO_LIMIT}. `}
              {userLoggedIn && (
                <>
                  Saldo: {Number(jades || 0)} jade(s) · Costo:{" "}
                  {GENERATION_COSTS.img_prompt} jade(s).
                </>
              )}
            </span>
          </div>

          {error && <p className="text-xs text-red-400 whitespace-pre-line">{error}</p>}

          <button
            onClick={handleGenerate}
            disabled={
              busy ||
              (isDemo ? demoCount >= DEMO_LIMIT : Number(jades || 0) < GENERATION_COSTS.img_prompt)
            }
            className="mt-4 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {isDemo && demoCount >= DEMO_LIMIT
              ? "Límite demo alcanzado (Crea cuenta)"
              : !isDemo && userLoggedIn && Number(jades || 0) < GENERATION_COSTS.img_prompt
              ? "Jades insuficientes (Compra plan o pack)"
              : status === "OPTIMIZING"
              ? "Optimizando..."
              : status === "IN_QUEUE" || status === "IN_PROGRESS"
              ? "Generando..."
              : "Generar imagen desde prompt"}
          </button>
        </div>
      </div>

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

  const [mode, setMode] = useState("prompt");

  const [prompt, setPrompt] = useState(
    "beautiful person in an elegant outfit, confident runway walk towards the camera, studio background, ultra detailed, 8k"
  );
  const [negative, setNegative] = useState(
    "low quality, blurry, deformed, glitch, watermark, noisy, pixelated"
  );

  const [autoPrompt, setAutoPrompt] = useState(false);
  const [optimizedPrompt, setOptimizedPrompt] = useState("");
  const [optimizedNegative, setOptimizedNegative] = useState("");

  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [quality, setQuality] = useState("HD");
  const [duration, setDuration] = useState(5);

  const [initImageFile, setInitImageFile] = useState(null);
  const [initImagePreviewUrl, setInitImagePreviewUrl] = useState(null);
  const [initImageB64, setInitImageB64] = useState("");

  const [status, setStatus] = useState("IDLE");
  const [statusText, setStatusText] = useState("");
  const [videoUrl, setVideoUrl] = useState(null);
  const [error, setError] = useState("");

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

    if (mode === "img2vid" && !initImageB64) {
      setError("Selecciona una imagen para generar video desde imagen.");
      return;
    }

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
        ? "Generando video en RunPod..."
        : "Generando video desde imagen en RunPod..."
    );

    try {
      const res = await fetch("/api/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          init_image_b64: mode === "img2vid" ? initImageB64 : undefined,
          prompt: promptToUse,
          negative_prompt: negativeToUse,
          aspect_ratio: aspectRatio,
          duration_seconds: duration,
          quality,
          optimize_prompt: autoPrompt,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data || !data.ok || !data.videoUrl) {
        console.error("Respuesta /api/generate-video:", data);
        throw new Error(data?.error || "Error en /api/generate-video.");
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

  const busy = status === "GENERATING" || status === "OPTIMIZING";

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">
              {mode === "prompt" ? "Generar video desde prompt" : "Imagen → Video"}
            </h2>
            <p className="mt-1 text-xs text-neutral-400">
              Genera clips cortos optimizados para reels.
            </p>
          </div>

          <div className="flex rounded-2xl border border-white/10 bg-black/40 p-1 text-xs">
            <button
              type="button"
              onClick={() => setMode("prompt")}
              disabled={busy}
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
              disabled={busy}
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
          {mode === "img2vid" && (
            <div className="rounded-2xl border border-white/10 bg-black/50 p-4">
              <p className="text-xs text-neutral-300 mb-2">Imagen base</p>

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
              <span>Optimizar mis prompts con IA</span>
            </label>
            <span className="text-[10px] text-neutral-500 text-right">
              Ajusta tu texto antes de enviarlo al motor.
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

          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="col-span-3">
              <p className="text-neutral-300 text-xs mb-1">Relación de aspecto</p>
              <div className="flex gap-2">
                {["1:1", "9:16", "16:9"].map((ar) => (
                  <button
                    key={ar}
                    type="button"
                    disabled={busy}
                    onClick={() => setAspectRatio(ar)}
                    className={`flex-1 rounded-2xl px-3 py-2 ${
                      aspectRatio === ar
                        ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                        : "bg-black/60 text-neutral-200 border border-white/10 hover:bg-white/5"
                    } ${busy ? "opacity-60" : ""}`}
                  >
                    {ar}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 text-xs">
            <div>
              <p className="text-neutral-300 mb-1">Calidad</p>
              <div className="flex gap-2">
                {["HD", "MAX"].map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={busy}
                    onClick={() => setQuality(q)}
                    className={`flex-1 rounded-2xl px-3 py-2 ${
                      quality === q
                        ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                        : "bg-black/60 text-neutral-200 border border-white/10 hover:bg-white/5"
                    } ${busy ? "opacity-60" : ""}`}
                  >
                    {q === "HD" ? "HD 720p" : "Máxima"}
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
                    disabled={busy}
                    onClick={() => setDuration(d)}
                    className={`flex-1 rounded-2xl px-3 py-2 ${
                      duration === d
                        ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                        : "bg-black/60 text-neutral-200 border border-white/10 hover:bg-white/5"
                    } ${busy ? "opacity-60" : ""}`}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-2 rounded-2xl bg-black/50 px-4 py-2 text-xs text-neutral-300">
            Estado actual:{" "}
            {statusText || "Listo para generar un clip."}
          </div>

          {error && <p className="text-xs text-red-400 whitespace-pre-line">{error}</p>}

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
        </div>
      </div>

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
            <p>Aquí verás tu clip cuando termine.</p>
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
  const [de]()
