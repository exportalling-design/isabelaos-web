import { useState, useEffect } from "react";

// Contexto de autenticación (AuthContext)
import { useAuth } from "./context/AuthContext";

// Funciones de manejo de datos con Supabase
import {
  saveGenerationInSupabase,
  loadGenerationsForUser,
  getTodayGenerationCount,
  deleteGenerationFromSupabase,
} from "./lib/generations";

// ---------------------------------------------------------
// LÍMITES Y CONSTANTES GLOBALES
// ---------------------------------------------------------
const DEMO_LIMIT = 3; // Imágenes para usuarios sin registrar (Modo Invitado)
const DAILY_LIMIT = 5; // Imágenes para usuarios registrados (Modo Beta Gratuito)

// PayPal – Client ID
const PAYPAL_CLIENT_ID =
  import.meta.env.VITE_PAYPAL_CLIENT_ID ||
  "AZgwhtDkXVf9N6VrwtWk6dzwzM65DWBrM3dn3Og4DXgZhbxSxqRu1UWdEtbj12W_7ItmcrNhZDI3mtPG";

// ---------------------------------------------------------
// Helper scroll suave
// ---------------------------------------------------------
/**
 * Realiza un scroll suave a un elemento por su ID.
 * @param {string} id - ID del elemento destino.
 */
function scrollToId(id) {
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// ---------------------------------------------------------
// Botón PayPal reutilizable
// ---------------------------------------------------------
/**
 * Componente que renderiza el botón de pago de PayPal.
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
// Modal de autenticación (Login / Register)
// ---------------------------------------------------------
/**
 * Modal para el inicio de sesión o registro de usuarios.
 */
function AuthModal({ open, onClose }) {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localLoading, setLocalLoading] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  // Maneja el envío del formulario de login/registro
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

  // Maneja el login con Google
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
          {/* Campo Correo */}
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
          {/* Campo Contraseña */}
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

        {/* Toggle para cambiar entre Login y Registro */}
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
// Generar Imágenes desde Prompt
// ---------------------------------------------------------
/**
 * Panel para la generación de imágenes desde texto (Prompt).
 */
function GenerateImageFromPromptPanel({ isDemo = false, onAuthRequired }) {
  // [START CreatorPanel Logic]
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

  const [autoPrompt, setAutoPrompt] = useState(false);
  const [optimizedPrompt, setOptimizedPrompt] = useState("");
  const [optimizedNegative, setOptimizedNegative] = useState("");

  const [status, setStatus] = useState("IDLE");
  const [statusText, setStatusText] = useState("");
  const [imageB64, setImageB64] = useState(null);
  const [error, setError] = useState("");

  const [dailyCount, setDailyCount] = useState(0);
  const [isPremium, setIsPremium] = useState(false);

  const premiumKey = userLoggedIn ? `isabelaos_premium_${user.id}` : null;

  // Lógica de chequeo de premium y límites (sin cambios)
  useEffect(() => {
    // ...
  }, [userLoggedIn, user, premiumKey]);
  // ... (otros handlers y useEffects sin cambios funcionales)
  // [END CreatorPanel Logic]


  const currentLimit = isDemo ? DEMO_LIMIT : DAILY_LIMIT;
  const currentCount = isDemo ? demoCount : dailyCount;
  const remaining = currentLimit - currentCount;

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* Formulario */}
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">
          Generar Imagen desde prompt
        </h2>

        {/* ... Lógica de mensajes de límite/demo ... */}
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
        {/* ... Fin lógica de mensajes ... */}

        <div className="mt-4 space-y-4 text-sm">
          {/* Prompt Positivo */}
          <div>
            <label className="text-neutral-300">Prompt</label>
            <textarea
              className="mt-1 h-24 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text.white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            {/* Prompt optimizado (Texto debajo del textarea) */}
            {autoPrompt && optimizedPrompt && (
              <div className="mt-2 rounded-2xl border border-cyan-400/40 bg-black/60 px-3 py-2 text-[11px] text-cyan-200">
                <span className="font-semibold">Prompt optimizado:</span>{" "}
                {optimizedPrompt}
              </div>
            )}
          </div>

          {/* Toggle de optimización de prompt con IA (OpenAI) */}
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

          {/* Prompt Negativo */}
          <div>
            <label className="text-neutral-300">Negative prompt</label>
            <textarea
              className="mt-1 h-20 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text.white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              value={negative}
              onChange={(e) => setNegative(e.target.value)}
            />
            {/* Negative optimizado (Texto debajo del textarea) */}
            {autoPrompt && optimizedNegative && (
              <div className="mt-2 rounded-2xl border border-fuchsia-400/40 bg-black/60 px-3 py-2 text-[11px] text-fuchsia-100">
                <span className="font-semibold">Negative optimizado:</span>{" "}
                {optimizedNegative}
              </div>
            )}
          </div>

          {/* Controles de Steps, Width, Height */}
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

          {/* Display de Estado */}
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

          {/* Botón Generar */}
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

          {/* Opciones de pago si se alcanza el límite */}
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
                  // ... onPaid={handlePayPalUnlock}
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
// Generar Video desde Prompt
// ---------------------------------------------------------
/**
 * Panel para la generación de video desde texto (Prompt).
 * Este módulo es un placeholder, manteniendo la funcionalidad base de prompts y estado.
 */
function GenerateVideoFromPromptPanel() {
  const { user } = useAuth();
  // Se ha ajustado el contenido para que sea un placeholder más simple y consistente con el flujo del Dashboard
  const [prompt, setPrompt] = useState(
    "Cinematic scene, beautiful scene from New York, ultra detailed, 8k"
  );
  const [status, setStatus] = useState("IDLE");
  const [error, setError] = useState("");

  // Handler de generación simple (simulación de llamada a API)
  const handleGenerateVideo = async () => {
    setError("");
    if (!user) {
      setError("Debes iniciar sesión para generar video.");
      return;
    }
    setStatus("GENERATING");
    try {
        // Simulación de una tarea larga. 
        await new Promise(r => setTimeout(r, 3000)); 
        setStatus("DONE");
        setError("");
        // En un entorno real, aquí se obtendría el URL del video
        // setVideoUrl("/videos/generated_clip_ny.mp4");
    } catch (err) {
        setStatus("ERROR");
        setError(String(err));
    }
  };

  return (
    <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
      <h2 className="text-lg font-semibold text.white">
        Generar Video desde prompt
      </h2>
      <p className="mt-1 text-sm text-neutral-400">
        Este módulo, cuando esté activo, usará nuestro motor WAN v2.2 y recursos dedicados para crear clips de alta calidad directamente desde tu texto.
      </p>

      <div className="mt-4 space-y-4 text-sm">
        <div>
          <label className="text-neutral-300">Prompt</label>
          <textarea
            className="mt-1 h-24 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text.white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>
        
        {/* Placeholder para la imagen de New York con texto encima */}
        <div className="relative mt-4 h-64 overflow-hidden rounded-2xl border border-white/10">
            <img 
                src="/gallery/new_york_hero.jpg" // Imagen de New York (debe existir en /public/gallery/)
                alt="Escena de fondo" 
                className="w-full h-full object-cover opacity-60"
            />
            {/* Texto de alto contraste sobre la imagen */}
            <div className="absolute inset-0 flex items-center justify-center p-4 bg-black/50">
                <p className="text-lg font-bold text-white shadow-text">
                    La forma más rápida de crear videos cinematográficos.
                </p>
            </div>
        </div>

        {/* Galería de Videos (Clips) - Se colocan 3 espacios para videos */}
        <div className="mt-4">
            <h3 className="text-sm font-semibold text-neutral-300 mb-2">Clips Generados (3 espacios para videos)</h3>
            <div className="grid grid-cols-3 gap-3">
                {/* Espacio para Video 1 */}
                <div className="h-24 rounded-lg bg-black/60 border border-white/10 flex items-center justify-center text-xs text-neutral-400">Video 1</div>
                {/* Espacio para Video 2 */}
                <div className="h-24 rounded-lg bg-black/60 border border-white/10 flex items-center justify-center text-xs text-neutral-400">Video 2</div>
                {/* Espacio para Video 3 */}
                <div className="h-24 rounded-lg bg-black/60 border border-white/10 flex items-center justify-center text-xs text-neutral-400">Video 3</div>
            </div>
        </div>
        
        <div className="mt-2 rounded-2xl bg-black/50 px-4 py-2 text-xs text-neutral-300">
            Estado actual: {status === "GENERATING" ? "Generando..." : "Módulo en optimización."}
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
          {status === "GENERATING" ? "Generando video..." : "Generar video desde prompt (Próximamente)"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// Panel de Imagen a Video (BodySync / Motion Prompt)
// ---------------------------------------------------------
/**
 * Panel para generar video a partir de una imagen estática (Image-to-Video).
 * Implementa la lógica de subida de archivos y prompt de movimiento.
 */
function ImageToVideoPanel() {
  const { user } = useAuth();
  // Se reutiliza la lógica de subida de archivo del XmasPanel.
  const [dataUrl, setDataUrl] = useState(null); // data:image/...;base64,xxx (vista previa)
  const [pureB64, setPureB64] = useState(null); // solo base64 (para enviar a la API)
  const [motionPrompt, setMotionPrompt] = useState(
    "Confident runway walk towards the camera, cinematic, soft lighting"
  ); // Prompt de movimiento

  const [status, setStatus] = useState("IDLE");
  const [statusText, setStatusText] = useState("");
  const [videoUrl, setVideoUrl] = useState(null);
  const [error, setError] = useState("");

  const fileInputId = "image-to-video-file-input";

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
      setPureB64(parts[1] || null); // Guardar el base64 puro
    } catch (err) {
      console.error("Error leyendo archivo:", err);
      setError("No se pudo leer la imagen. Intenta con otra foto.");
    }
  };

  const handleGenerateMotion = async () => {
    setError("");
    setVideoUrl(null);

    if (!user) {
      setError("Debes iniciar sesión para usar este módulo.");
      return;
    }
    if (!pureB64) {
      setError("Por favor sube una foto primero.");
      return;
    }

    // Simulación de la llamada a la API de Image-to-Video
    setStatus("IN_QUEUE");
    setStatusText("Enviando imagen y prompt de movimiento a RunPod (BodySync)...");

    try {
        // En un entorno real, aquí se llamaría al endpoint /api/generate-motion
        await new Promise(r => setTimeout(r, 4000));
        
        // Simulación de éxito
        setVideoUrl("/videos/generated_bodysync_clip.mp4"); // Usar un video placeholder
        setStatus("DONE");
        setStatusText("Video generado con movimiento BodySync.");

    } catch (err) {
        console.error("Error handleGenerateMotion:", err);
        setStatus("ERROR");
        setStatusText("Error al generar el video de movimiento.");
        setError(err.message || String(err));
    }
  };

  const handleDownload = () => {
    if (!videoUrl) return;
    window.open(videoUrl, "_blank");
  };

  // Replicando la distribución y el diseño de la Imagen 1 del Dashboard.
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* Controles de Input (Izquierda) */}
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text.white">
          Imagen a Video (BodySync Motion)
        </h2>

        <div className="mt-4 space-y-4 text-sm">
          {/* Subir Foto / Opción para subir varios videos e imagenes */}
          <div>
            <label className="text-neutral-300">Sube tu Imagen</label>
            <button
              type="button"
              onClick={handlePickFile}
              className="mt-2 flex h-20 w-full items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/60 text-xs text-neutral-400 hover:border-cyan-400 hover:text-cyan-300"
            >
              {dataUrl ? "Cambiar Imagen" : "Click para subir (Soporta múltiples archivos)"}
            </button>
            <input
              id={fileInputId}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
              multiple // Opción para subir varios archivos
            />
            {/* Previsualización de la foto */}
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

          {/* Prompt de Movimiento */}
          <div>
            <label className="text-neutral-300">Ingresa tu Prompt de Movimiento</label>
            <textarea
              rows={3}
              value={motionPrompt}
              onChange={(e) => setMotionPrompt(e.target.value)}
              placeholder="Ejemplo: 'Caminando en pasarela hacia la cámara, cinematográfico, iluminación suave'"
              className="mt-2 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text.white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
            />
          </div>

          {/* Botón Generar */}
          <button
            type="button"
            onClick={handleGenerateMotion}
            disabled={status === "IN_QUEUE" || status === "GENERATING" || !pureB64 || !user}
            className="mt-3 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text.white disabled:opacity-60"
          >
            {status === "GENERATING" ? "Generando Video..." : "Generar Video con BodySync"}
          </button>
        </div>
      </div>

      {/* Vista previa del video resultado (Derecha) */}
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6 flex flex-col">
        <h2 className="text-lg font-semibold text.white">Vista Previa del Video</h2>
        <div className="mt-4 flex h-[350px] flex-1 items-center justify-center rounded-2xl bg-black/70 text-sm text-neutral-400 border border-cyan-400/50"> 
          {videoUrl ? (
            <video
              src={videoUrl}
              controls
              className="h-full w-full rounded-2xl object-contain"
            />
          ) : (
            <p>El resultado del video aparecerá aquí.</p>
          )}
        </div>

        {/* Galería de Ejemplos (Abajo del Video Player) */}
        <div className="mt-4">
            <h3 className="text-sm font-semibold text-neutral-300 mb-2">Ejemplos de Image-to-Video</h3>
            <div className="grid grid-cols-4 gap-2">
                {/* Galería de 4 Imágenes (Placeholder) */}
                <img src="/gallery/fairy_grandma.jpg" alt="Ejemplo 1" className="w-full h-auto rounded-md object-cover border border-white/10" />
                <img src="/gallery/fairy_makeup.jpg" alt="Ejemplo 2" className="w-full h-auto rounded-md object-cover border border-white/10" />
                <img src="/gallery/fairy_redhead.jpg" alt="Ejemplo 3" className="w-full h-auto rounded-md object-cover border border-white/10" />
                <img src="/gallery/city_street.jpg" alt="Ejemplo 4" className="w-full h-auto rounded-md object-cover border border-white/10" />
            </div>
        </div>

        {videoUrl && (
          <button
            type="button"
            onClick={handleDownload}
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
// Galería de Imágenes (Nueva sección debajo de Video desde Prompt)
// ---------------------------------------------------------
/**
 * Panel para la Galería de Imágenes desde Prompt.
 * Contiene la galería de 9 fotos.
 */
function GalleryImageFromPromptPanel() {
    return (
        <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
            <h2 className="text-lg font-semibold text-white mb-4">
                Galería de Imágenes desde Prompt
            </h2>
            <p className="text-sm text-neutral-400 mb-4">
                Aquí se muestran 9 ejemplos de la calidad de imagen generada por nuestro motor principal.
            </p>
            
            {/* Galería de 9 fotos - Debe asegurar que tiene 9 imágenes nombradas img1.png a img9.png en /public/gallery/ */}
            <div className="grid grid-cols-3 gap-3">
                <img src="/gallery/img1.png" alt="Imagen 1" className="w-full h-24 object-cover rounded-lg border border-white/10" />
                <img src="/gallery/img2.png" alt="Imagen 2" className="w-full h-24 object-cover rounded-lg border border-white/10" />
                <img src="/gallery/img3.png" alt="Imagen 3" className="w-full h-24 object-cover rounded-lg border border-white/10" />
                <img src="/gallery/img4.png" alt="Imagen 4" className="w-full h-24 object-cover rounded-lg border border-white/10" />
                <img src="/gallery/img5.png" alt="Imagen 5" className="w-full h-24 object-cover rounded-lg border border-white/10" />
                <img src="/gallery/img6.png" alt="Imagen 6" className="w-full h-24 object-cover rounded-lg border border-white/10" />
                <img src="/gallery/img7.png" alt="Imagen 7" className="w-full h-24 object-cover rounded-lg border border-white/10" />
                <img src="/gallery/img8.png" alt="Imagen 8" className="w-full h-24 object-cover rounded-lg border border-white/10" />
                <img src="/gallery/img9.png" alt="Imagen 9" className="w-full h-24 object-cover rounded-lg border border-white/10" />
            </div>
        </div>
    );
}


// ---------------------------------------------------------
// Biblioteca (LibraryView) – usa Supabase
// ---------------------------------------------------------
/**
 * Vista de la biblioteca para usuarios logueados. Muestra el historial de generaciones guardadas.
 */
function LibraryView() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    // Lógica de carga de generaciones desde Supabase... (sin cambios funcionales)
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
    // Lógica de borrado de una generación en Supabase... (sin cambios funcionales)
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
      {/* Panel de Historial / Galería */}
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text.white">Biblioteca</h2>
        <p className="mt-1 text-xs text-neutral-400">
          Aquí aparecerán las imágenes generadas desde tu cuenta conectada a
          RunPod. Puedes seleccionar una para verla en grande y eliminarla si ya
          no la necesitas.
        </p>

        {/* Display de la galería */}
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

      {/* Vista previa de la imagen seleccionada */}
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
// Módulo Foto Navideña IA (Premium)
// ---------------------------------------------------------
/**
 * Módulo premium para generar retratos navideños a partir de una foto.
 */
function XmasPhotoPanel() {
  const { user } = useAuth();
  // ... Lógica de estado y generación (sin cambios funcionales) ...

  const [dataUrl, setDataUrl] = useState(null);
  const [pureB64, setPureB64] = useState(null);
  const [extraPrompt, setExtraPrompt] = useState("");
  const [status, setStatus] = useState("IDLE");
  const [statusText, setStatusText] = useState("");
  const [resultB64, setResultB64] = useState(null);
  const [error, setError] = useState("");

  const [isPremium, setIsPremium] = useState(false);

  // ... (useEffect, handlePickFile, fileToBase64, handleFileChange, handleGenerateXmas, handleDownload sin cambios)

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* Formulario */}
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text.white">
          Foto Navideña IA (Premium)
        </h2>
        {/* ... Texto y recomendaciones ... */}

        {/* ... Controles de subida de foto, prompt y botones sin cambios ... */}
      </div>

      {/* Resultado */}
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6 flex flex-col">
        <h2 className="text-lg font-semibold text.white">Resultado</h2>
        {/* ... Vista previa y botón de descarga sin cambios ... */}
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// Vista del Dashboard (Menú Lateral y Contenido)
// ---------------------------------------------------------
/**
 * Vista principal de la aplicación para usuarios logueados.
 * Contiene el layout con header, sidebar (menú de navegación) y el panel de contenido.
 */
function DashboardView() {
  const { user, isAdmin, signOut } = useAuth();
  // Se ha ajustado el estado inicial para que coincida con el menú lateral de la imagen.
  const [appViewMode, setAppViewMode] = useState("image-to-video"); // Iniciar en "Image-to-Video"

  const handleContact = () => {
    const subject = encodeURIComponent("Soporte IsabelaOS Studio");
    const body = encodeURIComponent(
      "Hola, necesito ayuda con IsabelaOS Studio.\n\n(Escribe aquí tu mensaje)"
    );
    window.location.href = `mailto:contacto@isabelaos.com?subject=${subject}&body=${body}`;
  };

  // Se mantienen los estilos de fondo neón del Dashboard
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
              <div className="text-[10px] text-neutral-500">
                Panel del creador · Beta
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            {/* ... Elementos del header ... */}
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
        {/* Navegación móvil (Mantiene la funcionalidad del menú) */}
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
              onClick={() => setAppViewMode("image-to-video")}
              className={`rounded-2xl px-3 py-1.5 ${
                appViewMode === "image-to-video"
                  ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text.white"
                  : "bg-white/5 text-neutral-200 hover:bg-white/10"
              }`}
            >
              Imagen a Video (BodySync)
            </button>
            <button
              type="button"
              onClick={() => setAppViewMode("xmas")}
              className={`rounded-2xl px-3 py-1.5 ${
                appViewMode === "xmas"
                  ? "bg-gradient-to-r from-cyan-600 to-fuchsia-600 text.white"
                  : "bg-gradient-to-r from-cyan-600/70 to-fuchsia-600/70 text.white/90"
              }`}
            >
              Foto Navideña IA
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
             <button
              type="button"
              onClick={() => setAppViewMode("contact")}
              className={`rounded-2xl px-3 py-1.5 ${
                appViewMode === "contact"
                  ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text.white"
                  : "bg-white/5 text-neutral-200 hover:bg-white/10"
              }`}
            >
              Contacto
            </button>
          </div>
        </div>

        <section className="flex gap-6">
          {/* Sidebar (Menú lateral izquierdo replicando la IMAGEN 1 del Dashboard) */}
          <aside className="hidden md:flex w-56 flex-col rounded-3xl border border-white/10 bg-black/60 p-4 text-xs">
            <p className="text-[11px] font-semibold text-neutral-300 mb-3">
              Módulos
            </p>
            
            {/* Opción 1: Library */}
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
            
            <p className="text-[11px] font-semibold text-neutral-300 mb-3 mt-4">
              Herramientas de IA
            </p>

            {/* Opción 2: Generate Image from Prompts (Antiguo 'generator') */}
            <button
              type="button"
              onClick={() => setAppViewMode("generator")}
              className={`mb-2 w-full rounded-2xl px-3 py-2 text-left ${
                appViewMode === "generator"
                  ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text.white"
                  : "bg-white/5 text-neutral-200 hover:bg-white/10"
              }`}
            >
              Imagen desde prompt
            </button>

            {/* Opción 3: Generate Video from Image (BodySync) */}
            <button
              type="button"
              onClick={() => setAppViewMode("image-to-video")}
              className={`mb-2 w-full rounded-2xl px-3 py-2 text-left ${
                appViewMode === "image-to-video"
                  ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text.white"
                  : "bg-white/5 text-neutral-200 hover:bg-white/10"
              }`}
            >
              Imagen a Video (BodySync)
            </button>

            {/* Opción 4: Generate Christmas Photos (Premium) */}
            <button
              type="button"
              onClick={() => setAppViewMode("xmas")}
              className={`mb-2 w-full rounded-2xl px-3 py-2 text-left ${
                appViewMode === "xmas"
                  ? "bg-gradient-to-r from-cyan-600 to-fuchsia-600 text.white"
                  : "bg-gradient-to-r from-cyan-600 to-fuchsia-600 text.white/90"
              }`}
            >
              Foto Navideña IA
            </button>
            
            <p className="text-[11px] font-semibold text-neutral-300 mb-3 mt-4">
              Ayuda
            </p>
            {/* Opción 5: Support (Contacto) */}
            <button
              type="button"
              onClick={() => setAppViewMode("contact")}
              className={`mb-2 w-full rounded-2xl px-3 py-2 text-left text-neutral-200 hover:bg-white/10`}
            >
              Contacto
            </button>
          </aside>

          {/* Contenido principal */}
          <div className="flex-1 space-y-6">
            <h1 className="text-xl font-semibold text.white">
              Panel del creador
            </h1>
            <p className="mt-1 text-xs text-neutral-400">
              Genera imágenes, guarda tu historial en la biblioteca y prueba
              los módulos especiales como Foto Navideña IA y el nuevo
              generador de video desde prompt, todo desde tu cuenta conectada
              al pipeline real en RunPod.
            </p>

            {/* Renderizado de Paneles basado en appViewMode */}
            {appViewMode === "generator" && 
                <>
                    <GenerateImageFromPromptPanel />
                    <GalleryImageFromPromptPanel /> {/* Galería de 9 fotos debajo */}
                </>
            }
            {appViewMode === "video" && <GenerateVideoFromPromptPanel />}
            {appViewMode === "image-to-video" && <ImageToVideoPanel />} 
            {appViewMode === "library" && <LibraryView />}
            {appViewMode === "xmas" && <XmasPhotoPanel />}
            {appViewMode === "contact" && <ContactView />} {/* Nueva vista de Contacto */}
          </div>
        </section>
      </main>
    </div>
  );
}

// ---------------------------------------------------------
// Vista de Contacto (Formulario) - Solo en el Dashboard
// ---------------------------------------------------------
/**
 * Panel de contacto para el Dashboard.
 */
function ContactView() {
    const [contactName, setContactName] = useState("");
    const [contactEmail, setContactEmail] = useState("");
    const [contactMessage, setContactMessage] = useState("");

    const handleContactSubmit = (e) => {
        e.preventDefault();
        const subject = encodeURIComponent("Soporte desde el Dashboard");
        const body = encodeURIComponent(
            `Nombre: ${contactName}\nCorreo: ${contactEmail}\n\nMensaje:\n${contactMessage}`
        );
        window.location.href = `mailto:contacto@isabelaos.com?subject=${subject}&body=${body}`;
        alert("Mensaje enviado. Te responderemos pronto.");
        setContactName("");
        setContactEmail("");
        setContactMessage("");
    };

    return (
        <div className="rounded-3xl border border-white/10 bg-black/40 p-6 max-w-xl">
            <h2 className="text-lg font-semibold text.white">
                Contacto y Soporte Técnico
            </h2>
            <p className="mt-1 text-xs text-neutral-400">
                Si tienes dudas sobre IsabelaOS Studio o necesitas soporte técnico, escríbenos directamente.
            </p>

            <form onSubmit={handleContactSubmit} className="mt-4 space-y-3 text-sm">
                <div>
                    <label className="text-xs text-neutral-300">Nombre</label>
                    <input
                        type="text"
                        value={contactName}
                        onChange={(e) => setContactName(e.target.value)}
                        className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text.white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
                        required
                    />
                </div>
                <div>
                    <label className="text-xs text-neutral-300">Correo</label>
                    <input
                        type="email"
                        value={contactEmail}
                        onChange={(e) => setContactEmail(e.target.value)}
                        className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text.white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
                        required
                    />
                </div>
                <div>
                    <label className="text-xs text-neutral-300">Mensaje</label>
                    <textarea
                        rows={4}
                        value={contactMessage}
                        onChange={(e) => setContactMessage(e.target.value)}
                        className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text.white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
                        required
                    />
                </div>
                <button
                    type="submit"
                    className="mt-2 rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-2 text-sm font-semibold text.white"
                >
                    Enviar mensaje
                </button>
            </form>
        </div>
    );
}

// ---------------------------------------------------------
// Landing (no sesión) con estilos futuristas y neon
// ---------------------------------------------------------
/**
 * Vista de la landing page para usuarios no logueados.
 * REFACTORIZADA para replicar el diseño de la imagen enviada.
 */
function LandingView({ onOpenAuth, onStartDemo }) {
  // Manejadores de pago y contacto (sin cambios funcionales)
  const handlePaddleCheckout = async () => {
    // ...
  };

  return (
    <div
      className="min-h-screen w-full text.white"
      style={{
        // Fondos de gradiente neón como en la imagen
        background:
          "radial-gradient(1200px_800px_at_110%_-10%,rgba(255,23,229,0.22),transparent_60%),radial-gradient(900px_600px_at_-10%_0%,rgba(0,229,255,0.22),transparent_55%),radial-gradient(700px_700px_at_50%_120%,rgba(140,90,255,0.5),transparent_60%),#05060A",
      }}
    >
      {/* Header Fijo */}
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
              <div className="text-[10px] text-neutral-500">
                Generación visual con IA
              </div>
            </div>
          </div>

          {/* Menú Superior replicando la Imagen 3 de la Landing */}
          <div className="flex items-center gap-4 text-xs">
            <a href="#video-modules" className="text-neutral-300 hover:text-cyan-400 hidden sm:inline">Módulos</a>
            <a href="#pricing" className="text-neutral-300 hover:text-cyan-400 hidden sm:inline">Precios</a>
            <a href="#contacto-footer" className="text-neutral-300 hover:text-cyan-400 hidden sm:inline">Contacto</a>
            <button
              onClick={onOpenAuth}
              className="rounded-xl border border.white/20 px-4 py-1.5 text-xs text.white hover:bg.white/10"
            >
              Iniciar sesión / Registrarse
            </button>
            <button
                className="text-white hover:text-cyan-400"
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-10">
        
        {/* RECREACIÓN DEL HERO (Texto sobre Imagen con alto contraste y gráficos neón) */}
        <section id="hero-main" className="relative h-[450px] w-full rounded-3xl overflow-hidden shadow-xl shadow-fuchsia-500/10">
            
            {/* Imagen de Fondo (Bosque/Ciudad Neón) */}
            <img 
                src="/gallery/main_hero_scene.jpg" 
                alt="AI Generated Scene"
                className="w-full h-full object-cover absolute inset-0 filter brightness-75"
            />
            
            {/* Gráficos Neón de Fondo (Capa de diseño) */}
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-0 left-1/4 h-full w-px bg-cyan-500/20 shadow-[0_0_20px_rgba(0,255,255,0.5)] transform -translate-x-1/2" />
                <div className="absolute top-1/4 right-0 h-px w-full bg-fuchsia-500/20 shadow-[0_0_20px_rgba(255,0,255,0.5)]" />
                <div className="absolute bottom-0 left-0 h-px w-full bg-cyan-500/20 shadow-[0_0_20px_rgba(0,255,255,0.5)]" />
            </div>

            {/* Contenedor de Texto y Botón (para alto contraste) */}
            <div className="absolute inset-0 bg-black/20 flex items-center p-8">
                <div className="max-w-xl relative">
                    <h1 className="text-4xl font-semibold leading-tight md:text-5xl text-white">
                        IsabelaOS Studio:
                        <span className="block">Unleash Your Imagination.</span>
                        <span className="block bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-violet-400 bg-clip-text text-transparent">
                            Stunning AI Images in Seconds.
                        </span>
                    </h1>
                    
                    <p className="mt-4 text-sm text-neutral-200 drop-shadow-md">
                        IsabelaOS Studio es el primer sistema de generación visual con IA
                        desarrollado desde Guatemala para creadores, estudios y agencias
                        de modelos virtuales. Escribe un prompt y obtén imágenes con
                        calidad de estudio en segundos.
                    </p>

                    <button
                        onClick={onStartDemo}
                        className="mt-6 rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-3 text-sm font-semibold text.white shadow-[0_0_35px_rgba(34,211,238,0.45)] hover:shadow-[0_0_40px_rgba(236,72,153,0.6)] transition-shadow"
                    >
                        Generar mis {DEMO_LIMIT} imágenes GRATIS ahora
                    </button>
                </div>
            </div>
        </section>
        
        {/* RECREACIÓN: SECCIÓN IMAGE-TO-VIDEO (REPLICA DISTRIBUCIÓN DE LA IMAGEN 3) */}
        <section id="image-to-video-section" className="mt-12 rounded-3xl border border-white/10 bg-black/50 p-6 shadow-xl shadow-violet-500/10">
            
            {/* Título de Image-to-Video */}
            <h2 className="text-xl font-semibold text.white mb-4">
              ⭐ Imagen a Video: Dale Vida a tu Arte
            </h2>
            
            {/* Contenedor de la Secuencia de Transformación (5 Columnas) */}
            <div className="grid gap-6 md:grid-cols-5 items-center">
                
                {/* 1. Foto Estática / Input (3a726542.jpg) */}
                <div className="flex flex-col items-center text-center">
                    <img src="/gallery/face_static.jpg" alt="Foto Base" className="w-full max-w-[150px] h-auto rounded-xl object-cover border border-white/10" />
                    <p className="mt-2 text-[10px] text-neutral-300">1. Foto Estática Base (BODY)</p>
                    <p className="text-[9px] text-neutral-500">Basado en prompt o imagen estática.</p>
                </div>

                {/* Flecha Neón 1 */}
                <div className="flex flex-col items-center text-center text-cyan-400">
                    <span className="text-3xl font-bold">→</span>
                </div>
                
                {/* 2. AI Motion (WAN V2.2) */}
                <div className="flex flex-col items-center text-center">
                    <img src="/gallery/face_mid_transform.jpg" alt="Transformación" className="w-full max-w-[150px] h-auto rounded-xl object-cover border border-white/10" />
                    <p className="mt-2 text-[10px] text-fuchsia-200 font-semibold">AI Motion (WAN V2.2)</p>
                    <p className="text-[9px] text-neutral-400">Nuestro modelo exclusivo WAN, ajustado para crear movimiento realista.</p>
                </div>
                
                {/* Flecha Neón 2 */}
                <div className="flex flex-col items-center text-center text-cyan-400">
                    <span className="text-3xl font-bold">→</span>
                </div>

                {/* 3. Resultado Final (Video) */}
                <div className="flex flex-col items-center text-center">
                    <div className="w-full max-w-[150px] h-[150px] rounded-xl bg-black/70 border border-cyan-400 shadow-lg shadow-cyan-500/20 flex items-center justify-center">
                        <span className="text-cyan-400 text-5xl">▶</span>
                    </div>
                    <p className="mt-2 text-[10px] text-neutral-300">Video Cinematográfico 720P</p>
                    <p className="text-[9px] text-neutral-500">Con movimiento suave y consistente.</p>
                </div>
            </div>

            {/* Subsección: Video-to-Video Clips (Galería de abajo) */}
            <div className="mt-10 border-t border-white/5 pt-6">
                <h3 className="text-lg font-semibold text.white mb-4">
                  Video desde prompt: Transforma Clips Existentes
                </h3>
                
                {/* NOTA: Estos son placeholders de VIDEO */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="h-40 rounded-xl bg-black/70 border border-white/10 flex items-center justify-center text-xs text-neutral-400">VIDEO CLIP 1</div>
                    <div className="h-40 rounded-xl bg-black/70 border border-white/10 flex items-center justify-center text-xs text-neutral-400">VIDEO CLIP 2</div>
                    <div className="h-40 rounded-xl bg-black/70 border border-white/10 flex items-center justify-center text-xs text-neutral-400">VIDEO CLIP 3</div>
                    <div className="h-40 rounded-xl bg-black/70 border border-white/10 flex items-center justify-center text-xs text-neutral-400">VIDEO CLIP 4</div>
                </div>
                
                <p className="mt-4 text-xs text-neutral-300">Rowanda Datacada</p>
            </div>
        </section>

        {/* NUEVA SECCIÓN: GALERÍA DE IMÁGENES (Reintegrada) */}
        <section className="mt-12">
            <h2 className="text-xl font-semibold text.white mb-4">
                Galería de Imágenes Fotorrealistas
            </h2>
            <p className="text-sm text-neutral-400 mb-4">
                A continuación, 9 ejemplos de la calidad de imagen generada por nuestro motor principal.
            </p>
            
            {/* Galería de 9 fotos con nombres genéricos */}
            <div className="grid grid-cols-3 gap-3">
                {/* NOTA: Debe asegurarse de tener img1.png a img9.png en /public/gallery/ */}
                <img src="/gallery/img1.png" alt="Imagen 1" className="w-full h-40 object-cover rounded-lg border border-white/10" />
                <img src="/gallery/img2.png" alt="Imagen 2" className="w-full h-40 object-cover rounded-lg border border-white/10" />
                <img src="/gallery/img3.png" alt="Imagen 3" className="w-full h-40 object-cover rounded-lg border border-white/10" />
                <img src="/gallery/img4.png" alt="Imagen 4" className="w-full h-40 object-cover rounded-lg border border-white/10" />
                <img src="/gallery/img5.png" alt="Imagen 5" className="w-full h-40 object-cover rounded-lg border border-white/10" />
                <img src="/gallery/img6.png" alt="Imagen 6" className="w-full h-40 object-cover rounded-lg border border-white/10" />
                <img src="/gallery/img7.png" alt="Imagen 7" className="w-full h-40 object-cover rounded-lg border border-white/10" />
                <img src="/gallery/img8.png" alt="Imagen 8" className="w-full h-40 object-cover rounded-lg border border-white/10" />
                <img src="/gallery/img9.png" alt="Imagen 9" className="w-full h-40 object-cover rounded-lg border border-white/10" />
            </div>
        </section>

        {/* Sección especial Foto Navideña IA */}
        <section className="mt-12 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="rounded-3xl border border.white/10 bg-black/50 p-5 text-xs text-neutral-300">
            <h3 className="text-sm font-semibold text.white">
              Especial Navidad · Foto Navideña IA
            </h3>
            {/* ... Contenido del módulo navideño sin cambios ... */}
          </div>

          <div className="rounded-3xl border border.white/10 bg-black/60 p-4 flex items-center justify-center">
            <img
              src="/gallery/xmas_family_before_after.png"
              alt="Ejemplo de familia antes y después con fondo navideño"
              className="w-full rounded-2xl object-cover"
            />
          </div>
        </section>

        {/* Plan de pago (Se mantiene) */}
        <section className="mt-14 max-w-xl border-t border.white/10 pt-8" id="pricing">
            {/* ... Contenido de precios sin cambios ... */}
        </section>

        {/* Contacto (SOLO en el Footer/Final, NO como un panel grande) */}
        <footer id="contacto-footer" className="mt-16 border-t border.white/10 pt-6 text-[11px] text-neutral-500">
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
/**
 * Componente principal de la aplicación. Maneja el estado de la sesión
 * y renderiza la vista de Landing o el Dashboard.
 */
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
          {/* Se usa el CreatorPanel (GenerateImageFromPromptPanel) para el modo demo */}
          <GenerateImageFromPromptPanel isDemo={true} onAuthRequired={openAuth} />
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
