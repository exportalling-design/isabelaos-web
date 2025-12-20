// App.jsx
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "./context/AuthContext";

import {
  saveGenerationInSupabase,
  loadGenerationsForUser,
  deleteGenerationFromSupabase,
} from "./lib/generations";

// ---------------------------------------------------------
// LÍMITES GLOBALES
// ---------------------------------------------------------
const DEMO_LIMIT = 3; // invitados (demo)

// ---------------------------------------------------------
// Jades / Planes (modelo actual)
// ---------------------------------------------------------
const JADE_VALUE_USD = 0.1;

const PLANS = {
  basic: { key: "basic", name: "Plan Basic", price: 19, includedJades: 100 },
  pro: { key: "pro", name: "Plan Pro", price: 39, includedJades: 300 },
};

const JADE_PACKS = [
  { key: "pack100", jades: 100, price: 10 },
  { key: "pack300", jades: 300, price: 27 },
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
function PayPalButton({ amount = "10.00", description = "IsabelaOS Studio", containerId, onPaid }) {
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

      const mount = document.getElementById(divId);
      if (mount) mount.innerHTML = "";

      window.paypal
        .Buttons({
          style: { layout: "horizontal", color: "black", shape: "pill", label: "paypal" },
          createOrder: (data, actions) =>
            actions.order.create({
              purchase_units: [
                {
                  amount: { value: String(amount), currency_code: "USD" },
                  description,
                },
              ],
            }),
          onApprove: async (data, actions) => {
            try {
              const details = await actions.order.capture();
              console.log("Pago PayPal completado:", details);
              if (typeof onPaid === "function") onPaid(details);
              else alert("Pago completado con PayPal.");
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

    const existingScript = document.querySelector('script[src*="https://www.paypal.com/sdk/js"]');

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

  useEffect(() => {
    if (!open) return;
    setError("");
    setLocalLoading(false);
  }, [open]);

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
      setError(err?.message || String(err));
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
      setError(err?.message || String(err));
      setLocalLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-black/90 p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">{mode === "login" ? "Inicia sesión" : "Crea tu cuenta"}</h3>
          <button onClick={onClose} className="rounded-lg px-3 py-1 text-neutral-400 hover:bg-white/10">
            ✕
          </button>
        </div>

        <p className="mt-2 text-xs text-neutral-400">Usa tu correo o entra con Google para usar IsabelaOS Studio.</p>

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
// Panel: Generador de imágenes (Jades + Demo)
// ---------------------------------------------------------
function CreatorPanel({ isDemo = false, onAuthRequired }) {
  const { user } = useAuth();
  const userLoggedIn = !isDemo && !!user;

  const [prompt, setPrompt] = useState("Cinematic portrait, ultra detailed, soft light, 8k");
  const [negative, setNegative] = useState("blurry, low quality, deformed, watermark, text");

  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);
  const [steps, setSteps] = useState(22);

  // Prompt optimizer (OpenAI)
  const [autoPrompt, setAutoPrompt] = useState(false);
  const [optimizedPrompt, setOptimizedPrompt] = useState("");
  const [optimizedNegative, setOptimizedNegative] = useState("");

  // Estado
  const [status, setStatus] = useState("IDLE"); // IDLE | OPTIMIZING | IN_QUEUE | IN_PROGRESS | COMPLETED | ERROR
  const [statusText, setStatusText] = useState("");
  const [imageB64, setImageB64] = useState(null);
  const [error, setError] = useState("");

  // Demo count
  const [demoCount, setDemoCount] = useState(0);

  // Jades (temporal en localStorage por usuario)
  const jadeKey = userLoggedIn ? `isabelaos_jades_${user.id}` : null;
  const [jades, setJades] = useState(0);

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

  const cost = GENERATION_COSTS.img_prompt;
  const remaining = isDemo ? Math.max(0, DEMO_LIMIT - demoCount) : 0;

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

      const optimized = String(data.optimizedPrompt || "").trim();
      if (!optimized) {
        setter("");
        return text;
      }

      setter(optimized);
      return optimized;
    } catch (e) {
      console.error("Error optimizando:", e);
      setter("");
      return text;
    }
  };

  const handleGenerate = async () => {
    setError("");
    setImageB64(null);

    // DEMO
    if (isDemo && demoCount >= DEMO_LIMIT) {
      setStatus("ERROR");
      setStatusText("Límite demo alcanzado.");
      alert(`Has agotado tus ${DEMO_LIMIT} imágenes de prueba. Regístrate para continuar.`);
      onAuthRequired && onAuthRequired();
      return;
    }

    // LOGUEADO: validar jades
    if (userLoggedIn && Number(jades || 0) < cost) {
      setStatus("ERROR");
      setStatusText("Jades insuficientes.");
      setError(`No tienes jades suficientes. Esta generación cuesta ${cost} jade(s).`);
      return;
    }

    // Optimizar (si aplica)
    let promptToUse = prompt;
    let negativeToUse = negative;

    if (autoPrompt) {
      promptToUse = await optimizeOne("prompt", prompt, setOptimizedPrompt);
      negativeToUse = await optimizeOne("negative", negative, setOptimizedNegative);
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
          optimize_prompt: !!autoPrompt,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.output?.image_b64) {
        throw new Error(data?.error || "Error al generar la imagen.");
      }

      const b64 = data.output.image_b64;
      setImageB64(b64);
      setStatus("COMPLETED");
      setStatusText("Imagen generada correctamente.");

      // DEMO count
      if (isDemo) {
        const next = demoCount + 1;
        setDemoCount(next);
        localStorage.setItem("isabelaos_demo_count", String(next));
      }

      // Descontar jades
      if (userLoggedIn && jadeKey) {
        const next = Math.max(0, Number(jades || 0) - cost);
        setJades(next);
        localStorage.setItem(jadeKey, String(next));
      }

      // Guardar en Supabase
      if (userLoggedIn && user?.id) {
        saveGenerationInSupabase({
          userId: user.id,
          imageUrl: `data:image/png;base64,${b64}`,
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
      setError(err?.message || String(err));
    }
  };

  const handleDownload = () => {
    if (isDemo) {
      alert("Para descargar tu imagen, por favor crea tu cuenta o inicia sesión.");
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

  // Gate: si NO es demo y NO hay user
  if (!userLoggedIn && !isDemo) {
    return (
      <div className="rounded-3xl border border-yellow-400/30 bg-yellow-500/5 p-6 text-center text-sm text-yellow-100">
        <p className="font-medium">Debes iniciar sesión para usar el generador de imágenes.</p>
        <p className="mt-1 text-xs text-yellow-200/80">
          Desde tu cuenta podrás generar imágenes, guardar historial y descargar. El sistema usa{" "}
          <span className="font-semibold text-white">Jades</span> (créditos) y planes que incluyen jades.
        </p>
      </div>
    );
  }

  const busy = status === "OPTIMIZING" || status === "IN_QUEUE" || status === "IN_PROGRESS";

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* Form */}
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">Generador desde prompt</h2>

        {isDemo && (
          <div className="mt-4 rounded-2xl border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-[11px] text-cyan-100">
            Modo demo: te quedan {remaining} / {DEMO_LIMIT} imágenes gratuitas.
          </div>
        )}

        {userLoggedIn && (
          <div className="mt-4 rounded-2xl border border-white/10 bg-black/50 px-4 py-2 text-[11px] text-neutral-200">
            <span className="font-semibold text-white">Saldo:</span> {Number(jades || 0)} jade(s) ·{" "}
            <span className="text-neutral-400">
              1 imagen = {cost} jade (${(cost * JADE_VALUE_USD).toFixed(2)})
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
                <span className="font-semibold">Prompt optimizado:</span> {optimizedPrompt}
              </div>
            )}
          </div>

          {/* Toggle optimizer */}
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
                value={steps}
                onChange={(e) => setSteps(e.target.value)}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
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
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
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
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
                disabled={busy}
              />
            </div>
          </div>

          <div className="rounded-2xl bg-black/50 px-4 py-2 text-xs text-neutral-300">
            Estado: {statusText || "Listo para generar."}
          </div>

          {error && <p className="text-xs text-red-400 whitespace-pre-line">{error}</p>}

          <button
            onClick={handleGenerate}
            disabled={
              busy ||
              (isDemo ? demoCount >= DEMO_LIMIT : userLoggedIn && Number(jades || 0) < cost)
            }
            className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {isDemo && demoCount >= DEMO_LIMIT
              ? "Límite demo alcanzado (Crea cuenta)"
              : !isDemo && userLoggedIn && Number(jades || 0) < cost
              ? "Jades insuficientes (Compra plan o pack)"
              : busy
              ? "Generando..."
              : `Generar imagen (${cost} jade)`}
          </button>

          {imageB64 && (
            <button
              onClick={handleDownload}
              className="w-full rounded-2xl border border-white/30 py-2 text-xs text-white hover:bg-white/10"
            >
              {isDemo ? "Descargar (Requiere cuenta)" : "Descargar imagen"}
            </button>
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
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// Panel de generación de video (Prompt + Imagen→Video)
// ---------------------------------------------------------
function VideoPanel() {
  const { user } = useAuth();

  const [mode, setMode] = useState("prompt"); // "prompt" | "img2vid"

  const [prompt, setPrompt] = useState(
    "beautiful woman in an elegant blue dress, confident runway walk towards the camera, studio background, ultra detailed, 8k"
  );
  const [negative, setNegative] = useState("low quality, blurry, deformed, watermark, noisy, pixelated");

  const [autoPrompt, setAutoPrompt] = useState(false);
  const [optimizedPrompt, setOptimizedPrompt] = useState("");
  const [optimizedNegative, setOptimizedNegative] = useState("");

  const [aspectRatio, setAspectRatio] = useState("9:16"); // "1:1" | "9:16" | "16:9"
  const [quality, setQuality] = useState("HD"); // "HD" | "MAX"
  const [duration, setDuration] = useState(5); // 5 | 10

  const [initImagePreviewUrl, setInitImagePreviewUrl] = useState(null);
  const [initImageB64, setInitImageB64] = useState("");

  const [status, setStatus] = useState("IDLE"); // IDLE | OPTIMIZING | GENERATING | DONE | ERROR
  const [statusText, setStatusText] = useState("");
  const [videoUrl, setVideoUrl] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    return () => {
      if (initImagePreviewUrl) URL.revokeObjectURL(initImagePreviewUrl);
    };
  }, [initImagePreviewUrl]);

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
      setInitImageB64(b64);
    } catch (e) {
      console.error("Error leyendo imagen:", e);
      setError(e?.message || String(e));
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
      negativeToUse = await optimizeOne("negative", negative, setOptimizedNegative);
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
          mode, // "prompt" | "img2vid"
          init_image_b64: mode === "img2vid" ? initImageB64 : undefined,
          prompt: promptToUse,
          negative_prompt: negativeToUse,
          aspect_ratio: aspectRatio,
          duration_seconds: duration,
          quality,
          optimize_prompt: !!autoPrompt,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data || !data.ok || !data.videoUrl) {
        console.error("Respuesta /api/generate-video:", data);
        throw new Error(data?.error || "Error en /api/generate-video. Revisa los logs.");
      }

      setVideoUrl(data.videoUrl);
      setStatus("DONE");
      setStatusText("Video generado correctamente.");
    } catch (err) {
      console.error("Error handleGenerateVideo:", err);
      setStatus("ERROR");
      setStatusText("Error al generar el video.");
      setError(err?.message || String(err));
    }
  };

  const busy = status === "GENERATING" || status === "OPTIMIZING";

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* Configuración */}
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">
              {mode === "prompt" ? "Generar video desde prompt" : "Generar video desde imagen"}
            </h2>
            <p className="mt-1 text-xs text-neutral-400">
              Clips cortos listos para reels/anuncios. (Beta)
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
              } ${busy ? "opacity-60" : ""}`}
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
              } ${busy ? "opacity-60" : ""}`}
            >
              Imagen → Video
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-4 text-sm">
          {mode === "img2vid" && (
            <div className="rounded-2xl border border-white/10 bg-black/50 p-4">
              <p className="text-xs text-neutral-300 mb-2">Imagen base (PNG/JPG/WebP)</p>

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
                    Tip: sujeto centrado y bien iluminado. Recomendado 512–1024px.
                  </p>
                </div>

                <div className="w-28 h-28 rounded-2xl bg-black/60 border border-white/10 overflow-hidden flex items-center justify-center">
                  {initImagePreviewUrl ? (
                    <img src={initImagePreviewUrl} alt="Preview" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[10px] text-neutral-500 px-2 text-center">Sin imagen</span>
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
                disabled={busy}
              />
              <span>Optimizar mis prompts con IA (OpenAI)</span>
            </label>
            <span className="text-[10px] text-neutral-500 text-right">
              Ajusta tus textos antes de enviar al motor.
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
                <span className="font-semibold">Negative optimizado:</span> {optimizedNegative}
              </div>
            )}
          </div>

          {/* Aspect ratio */}
          <div className="text-xs">
            <p className="text-neutral-300 text-xs mb-1">Relación de aspecto</p>
            <div className="flex gap-2">
              {["1:1", "9:16", "16:9"].map((r) => (
                <button
                  key={r}
                  type="button"
                  disabled={busy}
                  onClick={() => setAspectRatio(r)}
                  className={`flex-1 rounded-2xl px-3 py-2 ${
                    aspectRatio === r
                      ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                      : "bg-black/60 text-neutral-200 border border-white/10 hover:bg-white/5"
                  } ${busy ? "opacity-60" : ""}`}
                >
                  {r === "1:1" ? "1:1 (cuadrado)" : r === "9:16" ? "9:16 (vertical)" : "16:9 (horizontal)"}
                </button>
              ))}
            </div>
          </div>

          {/* Calidad y duración */}
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
                    {d} segundos
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-black/50 px-4 py-2 text-xs text-neutral-300">
            Estado: {statusText || "Listo para generar un clip de video (beta)."}
          </div>

          {error && <p className="text-xs text-red-400 whitespace-pre-line">{error}</p>}

          <button
            type="button"
            onClick={handleGenerateVideo}
            disabled={busy}
            className="mt-2 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {status === "OPTIMIZING"
              ? "Optimizando..."
              : status === "GENERATING"
              ? "Generando video..."
              : mode === "prompt"
              ? "Generar video desde prompt"
              : "Generar video desde imagen"}
          </button>

          <p className="text-[11px] text-neutral-400">
            Nota: el backend debe devolver <span className="text-neutral-200">videoUrl</span>.
          </p>
        </div>
      </div>

      {/* Resultado */}
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6 flex flex-col">
        <h2 className="text-lg font-semibold text-white">Resultado</h2>
        <div className="mt-4 flex h-[420px] flex-1 items-center justify-center rounded-2xl bg-black/70 text-sm text-neutral-400">
          {videoUrl ? (
            <video src={videoUrl} controls className="h-full w-full rounded-2xl object-contain" />
          ) : (
            <p>Aquí verás tu clip en cuanto termine el proceso.</p>
          )}
        </div>
        {videoUrl && (
          <button
            type="button"
            onClick={() => window.open(videoUrl, "_blank")}
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
// Biblioteca – Supabase
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
        const mapped = (rows || []).map((row) => ({
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

      setItems((prev) => {
        const next = prev.filter((it) => it.id !== selected.id);
        setSelected(next.length > 0 ? next[0] : null);
        return next;
      });
    } catch (e) {
      console.error("Error eliminando imagen:", e);
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
          Aquí aparecen tus imágenes guardadas. Selecciona una para verla en grande.
        </p>

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
                  selected && selected.id === item.id ? "border-cyan-400" : "border-white/10"
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
            <img src={selected.src} alt="Imagen seleccionada" className="h-full w-full rounded-2xl object-contain" />
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

// ---------------------------------------------------------
// Módulo Foto Navideña IA (Premium)
// ---------------------------------------------------------
function XmasPhotoPanel() {
  const { user } = useAuth();

  const [dataUrl, setDataUrl] = useState(null);
  const [pureB64, setPureB64] = useState(null);
  const [extraPrompt, setExtraPrompt] = useState("");

  const [status, setStatus] = useState("IDLE"); // IDLE | IN_QUEUE | IN_PROGRESS | COMPLETED | ERROR
  const [statusText, setStatusText] = useState("");
  const [resultB64, setResultB64] = useState(null);
  const [error, setError] = useState("");

  // Premium gate (temporal)
  const [isPremium, setIsPremium] = useState(false);

  useEffect(() => {
    if (!user) {
      setIsPremium(false);
      return;
    }
    const premiumKey = `isabelaos_premium_${user.id}`;
    // (admin override opcional)
    if (user.email === "exportalling@gmail.com") {
      setIsPremium(true);
      try {
        localStorage.setItem(premiumKey, "1");
      } catch {}
      return;
    }
    try {
      const stored = localStorage.getItem(premiumKey);
      setIsPremium(stored === "1");
    } catch {
      setIsPremium(false);
    }
  }, [user]);

  const fileInputId = "xmas-file-input";

  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
      reader.readAsDataURL(file);
    });

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

    if (!isPremium) {
      setError(`Este módulo requiere Plan Basic (US$${PLANS.basic.price}/mes).`);
      return;
    }

    if (!pureB64) {
      setError("Por favor sube una foto primero.");
      return;
    }

    setResultB64(null);
    setStatus("IN_QUEUE");
    setStatusText("Enviando foto navideña al motor...");

    try {
      const res = await fetch("/api/generate-xmas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_b64: pureB64, description: extraPrompt || "" }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data?.jobId) {
        throw new Error(data?.error || "Error lanzando job navideño.");
      }

      const jobId = data.jobId;
      setStatusText(`Foto enviada. ID: ${jobId}. Consultando estado...`);

      let finished = false;
      while (!finished) {
        await new Promise((r) => setTimeout(r, 2000));

        const statusRes = await fetch(`/api/status?id=${encodeURIComponent(jobId)}`);
        const statusData = await statusRes.json().catch(() => null);

        if (!statusRes.ok || !statusData) throw new Error(statusData?.error || "Error consultando /api/status.");

        const st = statusData.status;
        setStatus(st);
        setStatusText(`Estado actual: ${st}...`);

        if (st === "IN_QUEUE" || st === "IN_PROGRESS") continue;

        finished = true;

        if (st === "COMPLETED" && statusData.output?.image_b64) {
          setResultB64(statusData.output.image_b64);
          setStatusText("Foto navideña generada con éxito.");
        } else {
          throw new Error(statusData?.error || "Job terminado pero sin imagen.");
        }
      }
    } catch (err) {
      console.error("Error handleGenerateXmas:", err);
      setStatus("ERROR");
      setStatusText("Error al generar la foto navideña.");
      setError(err?.message || String(err));
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
        <h2 className="text-lg font-semibold text-white">Foto Navideña IA (Premium)</h2>

        <p className="mt-2 text-sm text-neutral-300">
          Convierte tu foto en un retrato navideño estilo estudio profesional.
        </p>

        {!isPremium && user && (
          <div className="mt-4 rounded-2xl border border-yellow-400/40 bg-yellow-500/10 px-4 py-2 text-[11px] text-yellow-100">
            Este módulo requiere <span className="font-semibold">Plan Basic</span>.
          </div>
        )}

        <div className="mt-5 space-y-4 text-sm">
          <div>
            <p className="text-xs text-neutral-300">1) Sube tu foto (JPG/PNG/WebP)</p>

            <label className="mt-2 flex h-40 w-full cursor-pointer items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/60 text-xs text-neutral-400 hover:border-cyan-400 hover:text-cyan-300">
              {dataUrl ? "Cambiar foto" : "Haz clic para subir una foto"}
              <input id={fileInputId} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
            </label>

            {dataUrl && (
              <div className="mt-3 overflow-hidden rounded-2xl border border-white/10">
                <img src={dataUrl} alt="Foto base" className="w-full object-cover" />
              </div>
            )}
          </div>

          <div>
            <p className="text-xs text-neutral-300">2) Opcional: describe la escena</p>
            <input
              type="text"
              value={extraPrompt}
              onChange={(e) => setExtraPrompt(e.target.value)}
              disabled={!user || busy}
              placeholder="Ejemplo: familia en sala acogedora junto al árbol, luces cálidas."
              className="mt-2 w-full rounded-2xl bg-black/60 px-3 py-2 text-xs text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400 disabled:opacity-60"
            />
          </div>

          <div className="rounded-2xl bg-black/50 px-4 py-2 text-xs text-neutral-300">
            Estado: {statusText || "Listo para generar."}
          </div>

          {error && <p className="text-xs text-red-400 whitespace-pre-line">{error}</p>}

          <button
            type="button"
            onClick={handleGenerateXmas}
            disabled={busy || !pureB64 || !user || !isPremium}
            className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? "Generando..." : "Generar foto navideña IA"}
          </button>

          <p className="text-[11px] text-neutral-400">
            Premium: Plan Basic (incluye módulos especiales).
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
            <p>Aquí verás tu foto navideña cuando termine.</p>
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
// Dashboard (logueado) con sidebar
// ---------------------------------------------------------
function DashboardView() {
  const { user, isAdmin, signOut } = useAuth();
  const [appViewMode, setAppViewMode] = useState("generator"); // generator | video | library | xmas

  const menu = [
    { key: "generator", label: "Generar imágenes" },
    { key: "video", label: "Video (beta)" },
    { key: "library", label: "Biblioteca" },
    { key: "xmas", label: "Foto Navideña IA" },
  ];

  return (
    <div
      className="relative min-h-screen w-full overflow-hidden text-white"
      style={{
        background:
          "radial-gradient(1200px_800px_at_110%_-10%,rgba(255,23,229,0.18),transparent_60%),radial-gradient(900px_650px_at_-10%_0%,rgba(0,229,255,0.14),transparent_55%),radial-gradient(900px_700px_at_50%_120%,rgba(140,90,255,0.18),transparent_60%),linear-gradient(180deg,#0b0f17 0%, #070a12 60%, #05060a 100%)",
      }}
    >
      {/* Top bar */}
      <div className="sticky top-0 z-30 border-b border-white/10 bg-black/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-cyan-500/80 to-fuchsia-500/80" />
            <div>
              <p className="text-sm font-semibold leading-tight">IsabelaOS Studio</p>
              <p className="text-[11px] text-neutral-400 leading-tight">
                {isAdmin ? "Admin" : "Usuario"} · {user?.email}
              </p>
            </div>
          </div>

          <button
            onClick={signOut}
            className="rounded-2xl border border-white/15 bg-black/40 px-4 py-2 text-xs text-white hover:bg-white/5"
          >
            Cerrar sesión
          </button>
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-10">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-white">Panel del creador</h1>
          <p className="mt-1 text-xs text-neutral-400">
            Genera imágenes, usa video beta, administra tu biblioteca y prueba módulos premium.
          </p>
        </div>

        <section className="flex flex-col gap-6 lg:flex-row">
          {/* Sidebar */}
          <div className="w-full lg:w-64">
            <div className="rounded-3xl border border-white/10 bg-black/40 p-3">
              {menu.map((m) => (
                <button
                  key={m.key}
                  onClick={() => setAppViewMode(m.key)}
                  className={`w-full rounded-2xl px-4 py-3 text-left text-sm ${
                    appViewMode === m.key
                      ? "bg-gradient-to-r from-cyan-500/30 to-fuchsia-500/30 border border-white/10"
                      : "hover:bg-white/5"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="mt-4 rounded-3xl border border-white/10 bg-black/30 p-4">
              <p className="text-xs text-neutral-300">
                Estado beta: <span className="font-semibold text-white">Plan Basic activo (sin límite)</span> (texto neutro).
              </p>
              <p className="mt-2 text-[11px] text-neutral-500">
                (Luego lo conectamos a Supabase/Stripe/PayPal real.)
              </p>
            </div>
          </div>

          {/* Contenido */}
          <div className="flex-1 space-y-6">
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
// Landing (sin sesión): estilo neon + 2 hero + secciones
// ---------------------------------------------------------
function LandingView({ onOpenAuth, onStartDemo }) {
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

  const PROMPT_GALLERY = [
    "/landing/prompts/img1.jpg",
    "/landing/prompts/img2.jpg",
    "/landing/prompts/img3.jpg",
    "/landing/prompts/img4.jpg",
    "/landing/prompts/img5.jpg",
    "/landing/prompts/img6.jpg",
    "/landing/prompts/img7.jpg",
    "/landing/prompts/img8.jpg",
    "/landing/prompts/img9.jpg",
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
      <div className="pointer-events-none absolute inset-y-0 left-0 w-40 bg-gradient-to-r from-cyan-500/10 to-transparent blur-2xl" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-40 bg-gradient-to-l from-fuchsia-500/10 to-transparent blur-2xl" />

      {/* Top nav */}
      <div className="sticky top-0 z-30 border-b border-white/10 bg-black/35 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-cyan-500/80 to-fuchsia-500/80" />
            <div>
              <p className="text-sm font-semibold leading-tight">IsabelaOS Studio</p>
              <p className="text-[11px] text-neutral-400 leading-tight">Generación visual con IA</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => scrollToId("pricing")}
              className="hidden sm:inline-flex rounded-2xl border border-white/10 bg-black/30 px-4 py-2 text-xs text-neutral-200 hover:bg-white/5"
            >
              Planes
            </button>
            <button
              onClick={() => scrollToId("gallery")}
              className="hidden sm:inline-flex rounded-2xl border border-white/10 bg-black/30 px-4 py-2 text-xs text-neutral-200 hover:bg-white/5"
            >
              Galería
            </button>
            <button
              onClick={onStartDemo}
              className="rounded-2xl border border-white/10 bg-black/30 px-4 py-2 text-xs text-neutral-200 hover:bg-white/5"
            >
              Probar demo
            </button>
            <button
              onClick={onOpenAuth}
              className="rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-4 py-2 text-xs font-semibold text-white"
            >
              Entrar / Crear cuenta
            </button>
          </div>
        </div>
      </div>

      {/* HERO */}
      <div className="mx-auto max-w-6xl px-4 pt-10">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Hero left (big) */}
          <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-black/40">
            <img src={HERO_MAIN} alt="Hero" className="h-[320px] w-full object-cover opacity-90" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-black/20" />
            <div className="absolute bottom-0 left-0 right-0 p-6">
              <div className="inline-flex rounded-2xl bg-black/45 px-3 py-1 text-[11px] text-neutral-200 ring-1 ring-white/10 backdrop-blur">
                Beta privada · Motor en la nube
              </div>
              <h1 className="mt-3 text-2xl font-semibold leading-tight">
                Genera imágenes y video IA con estética cinematográfica
              </h1>
              <p className="mt-2 text-sm text-neutral-300 max-w-xl">
                Un solo lugar para crear contenido visual: prompt, imagen→video, biblioteca y módulos premium.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={onStartDemo}
                  className="rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-5 py-2 text-sm font-semibold text-white"
                >
                  Probar demo (3 imágenes)
                </button>
                <button
                  onClick={() => scrollToId("img2video")}
                  className="rounded-2xl border border-white/15 bg-black/30 px-5 py-2 text-sm text-white hover:bg-white/5"
                >
                  Ver imagen → video
                </button>
              </div>
            </div>
          </div>

          {/* Hero right (secondary) */}
          <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-black/40">
            <img src={HERO_SIDE} alt="Hero side" className="h-[320px] w-full object-cover opacity-90" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-black/20" />
            <div className="absolute bottom-0 left-0 right-0 p-6">
              <div className="inline-flex rounded-2xl bg-black/45 px-3 py-1 text-[11px] text-neutral-200 ring-1 ring-white/10 backdrop-blur">
                Control creativo · Jades
              </div>
              <h2 className="mt-3 text-xl font-semibold leading-tight">Planes con jades incluidos</h2>
              <p className="mt-2 text-sm text-neutral-300">
                Paga mensual y genera con créditos. Packs disponibles si necesitas más.
              </p>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => scrollToId("pricing")}
                  className="rounded-2xl border border-white/15 bg-black/30 px-5 py-2 text-sm text-white hover:bg-white/5"
                >
                  Ver planes
                </button>
                <button
                  onClick={onOpenAuth}
                  className="rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-5 py-2 text-sm font-semibold text-white"
                >
                  Crear cuenta
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Imagen -> Video section (1 imagen + flecha + video) */}
        <section id="img2video" className="mt-10">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold">Imagen → Video</h3>
              <p className="mt-1 text-xs text-neutral-400">Convierte una imagen en un clip corto (beta).</p>
            </div>
            <button
              onClick={onOpenAuth}
              className="rounded-2xl border border-white/15 bg-black/30 px-4 py-2 text-xs text-white hover:bg-white/5"
            >
              Probar en mi cuenta
            </button>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_120px_1.2fr]">
            <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/40">
              <img src={IMG2VIDEO_IMG} alt="Input" className="h-[260px] w-full object-cover" />
              <div className="p-3 text-xs text-neutral-400">Imagen base</div>
            </div>

            <div className="hidden lg:flex items-center justify-center">
              <div className="h-14 w-14 rounded-full bg-gradient-to-r from-cyan-500 to-fuchsia-500 grid place-items-center shadow-lg">
                <span className="text-xl font-bold">→</span>
              </div>
            </div>

            <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/40">
              <video src={IMG2VIDEO_DEMO} controls className="h-[260px] w-full object-cover" />
              <div className="p-3 text-xs text-neutral-400">Salida (demo)</div>
            </div>
          </div>
        </section>

        {/* Video mosaic */}
        <section className="mt-10">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold">Video desde prompt</h3>
              <p className="mt-1 text-xs text-neutral-400">Biblioteca estilo collage (pon tus videos en /public/landing/mosaic/).</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {MOSAIC_VIDEOS.map((v, idx) => (
              <div
                key={v}
                className={`overflow-hidden rounded-3xl border border-white/10 bg-black/40 ${
                  idx === 0 ? "md:col-span-2 md:row-span-2" : ""
                }`}
              >
                <video src={v} controls className={`w-full object-cover ${idx === 0 ? "h-[360px] md:h-[420px]" : "h-[180px]"}`} />
              </div>
            ))}
          </div>
        </section>

        {/* Prompt image gallery (9 images) */}
        <section id="gallery" className="mt-10">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold">Imágenes generadas desde prompt</h3>
              <p className="mt-1 text-xs text-neutral-400">Galería 3×3 (pon tus imágenes en /public/landing/prompts/).</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {PROMPT_GALLERY.map((img) => (
              <div key={img} className="overflow-hidden rounded-3xl border border-white/10 bg-black/40">
                <img src={img} alt="Prompt" className="h-44 w-full object-cover" />
              </div>
            ))}
          </div>
        </section>

        {/* Xmas highlight */}
        <section className="mt-10">
          <div className="rounded-[28px] border border-white/10 bg-black/40 p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-lg font-semibold">Foto Navideña IA (Premium)</h3>
                <p className="mt-1 text-xs text-neutral-400">
                  Convierte tu foto en un retrato navideño estilo estudio (Plan Basic).
                </p>
              </div>
              <button
                onClick={onOpenAuth}
                className="rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-5 py-2 text-sm font-semibold text-white"
              >
                Activar y usar
              </button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-3xl border border-white/10 bg-black/40 p-4">
                <p className="text-sm font-semibold">✨ Estilo estudio</p>
                <p className="mt-1 text-xs text-neutral-400">Iluminación cuidada + fondo temático.</p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-black/40 p-4">
                <p className="text-sm font-semibold">⚡ Rápido</p>
                <p className="mt-1 text-xs text-neutral-400">Proceso automatizado por job.</p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-black/40 p-4">
                <p className="text-sm font-semibold">🔒 Premium</p>
                <p className="mt-1 text-xs text-neutral-400">Disponible con Plan Basic.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="mt-12 pb-16">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold">Planes y Jades</h3>
              <p className="mt-1 text-xs text-neutral-400">
                Cada acción cuesta jades. 1 jade = ${JADE_VALUE_USD.toFixed(2)}.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {/* Plan Basic */}
            <div className="rounded-[28px] border border-white/10 bg-black/40 p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold">{PLANS.basic.name}</p>
                  <p className="mt-1 text-xs text-neutral-400">Incluye {PLANS.basic.includedJades} jades/mes</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-semibold">${PLANS.basic.price}</p>
                  <p className="text-[11px] text-neutral-400">USD / mes</p>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4 text-xs text-neutral-300">
                <p>✅ Generación de imágenes</p>
                <p>✅ Biblioteca</p>
                <p>✅ Módulos premium (ej. Foto Navideña IA)</p>
                <p className="mt-2 text-[11px] text-neutral-500">
                  Texto beta: <span className="text-neutral-200">Usuario beta – Plan Basic activo (sin límite)</span>
                </p>
              </div>

              <div className="mt-4">
                <p className="text-xs text-neutral-400">Pagar con PayPal:</p>
                <PayPalButton
                  amount={String(PLANS.basic.price)}
                  description={`Suscripción ${PLANS.basic.name}`}
                  containerId="paypal-plan-basic"
                />
              </div>

              <button
                onClick={onOpenAuth}
                className="mt-4 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white"
              >
                Activar en mi cuenta
              </button>
            </div>

            {/* Plan Pro */}
            <div className="rounded-[28px] border border-white/10 bg-black/40 p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold">{PLANS.pro.name}</p>
                  <p className="mt-1 text-xs text-neutral-400">Incluye {PLANS.pro.includedJades} jades/mes</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-semibold">${PLANS.pro.price}</p>
                  <p className="text-[11px] text-neutral-400">USD / mes</p>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4 text-xs text-neutral-300">
                <p>✅ Todo lo de Basic</p>
                <p>✅ Más jades por mes</p>
                <p>✅ Prioridad (cuando se conecte el scheduler)</p>
              </div>

              <div className="mt-4">
                <p className="text-xs text-neutral-400">Pagar con PayPal:</p>
                <PayPalButton
                  amount={String(PLANS.pro.price)}
                  description={`Suscripción ${PLANS.pro.name}`}
                  containerId="paypal-plan-pro"
                />
              </div>

              <button
                onClick={onOpenAuth}
                className="mt-4 w-full rounded-2xl border border-white/15 bg-black/30 py-3 text-sm font-semibold text-white hover:bg-white/5"
              >
                Activar en mi cuenta
              </button>
            </div>
          </div>

          {/* Jade packs */}
          <div className="mt-6 rounded-[28px] border border-white/10 bg-black/40 p-6">
            <h4 className="text-sm font-semibold">Packs de jades</h4>
            <p className="mt-1 text-xs text-neutral-400">Compra créditos extra cuando los necesites.</p>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {JADE_PACKS.map((p) => (
                <div key={p.key} className="rounded-3xl border border-white/10 bg-black/30 p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">{p.jades} jades</p>
                    <p className="text-sm text-neutral-200">${p.price} USD</p>
                  </div>
                  <p className="mt-1 text-[11px] text-neutral-500">
                    Aproximado: ${((p.jades * JADE_VALUE_USD) / 1).toFixed(2)} en valor de jade
                  </p>
                  <PayPalButton
                    amount={String(p.price)}
                    description={`Pack ${p.jades} jades`}
                    containerId={`paypal-pack-${p.key}`}
                  />
                </div>
              ))}
            </div>

            <div className="mt-4 text-[11px] text-neutral-500">
              Costos típicos: imagen {GENERATION_COSTS.img_prompt} jade · video {GENERATION_COSTS.vid_prompt} jades.
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// App principal
// ---------------------------------------------------------
export default function App() {
  const { user, loading } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [viewMode, setViewMode] = useState("landing"); // landing | demo | dashboard

  useEffect(() => {
    const bg =
      "radial-gradient(1200px_800px_at_110%_-10%,rgba(255,23,229,0.14),transparent_60%)," +
      "radial-gradient(900px_600px_at_-10%_0%,rgba(0,229,255,0.12),transparent_55%)," +
      "linear-gradient(180deg,#0A0C12 0%, #06070B 55%, #070816 100%)";

    document.documentElement.style.background = bg;
    document.body.style.background = bg;
    document.body.style.minHeight = "100vh";
  }, []);

  const openAuth = () => setShowAuthModal(true);
  const closeAuth = () => setShowAuthModal(false);

  const handleStartDemo = () => {
    setViewMode("demo");
    try {
      const el = document.getElementById("top");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      else window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      window.scrollTo(0, 0);
    }
  };

  useEffect(() => {
    if (user) setViewMode("dashboard");
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-black/90 text-white">
        <p className="text-sm text-neutral-400">Cargando sesión...</p>
      </div>
    );
  }

  if (user || viewMode === "dashboard") return <DashboardView />;

  if (viewMode === "demo") {
    return (
      <>
        <div id="top" className="mx-auto max-w-6xl px-4 pt-10">
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
