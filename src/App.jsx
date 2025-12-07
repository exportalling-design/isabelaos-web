import { useState, useEffect } from "react";
import { useAuth } from "./context/AuthContext";
import {
  saveGenerationInSupabase,
  loadGenerationsForUser,
  getTodayGenerationCount,
  deleteGenerationInSupabase,
} from "./lib/generations";

// ---------------------------------------------------------
// LÍMITES GLOBALES AJUSTADOS
// ---------------------------------------------------------
const DEMO_LIMIT = 3; // Imágenes para usuarios sin registrar (Modo Invitado)
const DAILY_LIMIT = 5; // Imágenes para usuarios registrados (Modo Beta Gratuito)
// ---------------------------------------------------------


// ---------------------------------------------------------
// PayPal – Client ID
// ---------------------------------------------------------
const PAYPAL_CLIENT_ID =
  import.meta.env.VITE_PAYPAL_CLIENT_ID ||
  "AZgwhtDkXVf9N6VrwtWk6dzwzM3dn3Og4DXgZhbxSxqRu1UWdEtbj12W_7ItmcrNhZDI3mtPG";

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
            color: "black", // fondo oscuro
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

              // 👇 si nos pasan callback, lo llamamos para marcar premium
              if (typeof onPaid === "function") {
                try {
                  onPaid(details);
                } catch (cbErr) {
                  console.error("Error en onPaid PayPal:", cbErr);
                }
              } else {
                // Mensaje genérico solo si NO hay callback
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

    // ¿Ya existe el script?
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

    // Crear script nuevo
    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&currency=USD`;
    script.async = true;
    script.onload = renderButtons;
    document.body.appendChild(script);

    return () => {
      // dejamos el script para reutilizarlo
    };
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
// NUEVO: Vista de la Biblioteca (Historial de Imágenes)
// ---------------------------------------------------------
function LibraryView({ history, onSelectImage, onDeleteImage, isDemo }) {
  const userLoggedIn = !isDemo;

  if (!userLoggedIn && !isDemo) return null;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-10">
      <h1 className="text-xl font-semibold text-white">
        {isDemo ? "Última Imagen Generada (Prueba)" : "Biblioteca de Generaciones"}
      </h1>
      <p className="mt-1 text-xs text-neutral-400">
        {isDemo 
          ? "Esta es tu última imagen de prueba. Regístrate para ver y guardar tu historial completo."
          : "Aquí puedes revisar tu historial completo de imágenes guardadas en tu cuenta."}
      </p>

      {history.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-400">
          Aún no hay imágenes en tu biblioteca. ¡Empieza a generar!
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {(isDemo ? history.slice(0, 1) : history).map((item) => (
            <div
              key={item.id}
              className="group relative overflow-hidden rounded-xl border border-white/10 bg-black/50 cursor-pointer transition-transform hover:scale-[1.02] transform"
            >
              {/* Imagen */}
              <img
                src={`data:image/png;base64,${item.image_b64}`}
                alt={item.prompt || "Imagen generada"}
                className="h-full w-full object-cover"
                onClick={() => onSelectImage(item)}
              />

              {/* Botón de eliminar (solo usuarios logueados) */}
              {userLoggedIn && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteImage(item.id);
                  }}
                  className="absolute right-1 top-1 rounded-full bg-black/70 px-2 text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ✕ Eliminar
                </button>
              )}
               {/* Metadata */}
               <p className="absolute bottom-0 left-0 right-0 bg-black/50 p-2 text-[10px] text-neutral-400 opacity-0 group-hover:opacity-100 transition-opacity">
                Generado: {new Date(item.createdAt).toLocaleDateString()}
               </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------
// Panel del creador (Generador de Prompts)
// ---------------------------------------------------------
function CreatorPanel({ isDemo = false, onAuthRequired, history, setHistory, setDailyCount, currentCount, currentLimit, isPremium, handlePayPalUnlock, setSelectedImageB64 }) {
  const { user } = useAuth();
  const userLoggedIn = !isDemo && user;
  
  // Usaremos el primer elemento del historial como la imagen principal de resultado
  const currentImageB64 = history.length > 0 ? history[0].image_b64 : null;

  const [prompt, setPrompt] = useState(
    "Cinematic portrait, ultra detailed, soft light, 8k"
  );
  const [negative, setNegative] = useState(
    "blurry, low quality, deformed, watermark, text"
  );
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);
  const [steps, setSteps] = useState(22);

  const [status, setStatus] = useState("IDLE");
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState("");

  // Contador local para modo Demo
  const [demoCount, setDemoCount] = useState(0);

  // Leer demoCount de localStorage al iniciar el demo
  useEffect(() => {
    if (isDemo) {
        try {
            const storedDemoCount = localStorage.getItem("isabelaos_demo_count") || "0";
            setDemoCount(Number(storedDemoCount));
        } catch (e) {
            console.warn("Error leyendo demo count:", e);
        }
    }
  }, [isDemo]);
  
  const remaining = currentLimit - (isDemo ? demoCount : currentCount);

  const handleGenerate = async () => {
    setError("");

    // --- LÓGICA DE BLOQUEO DE LÍMITE ---
    if (!isPremium && remaining <= 0) {
      setStatus("ERROR");
      setStatusText("Límite de generación alcanzado.");

      if (isDemo && onAuthRequired) {
        alert(
          `¡Genial! Has agotado tus ${DEMO_LIMIT} imágenes de prueba. ¡Crea tu cuenta GRATIS para obtener ${DAILY_LIMIT} imágenes al día, guardar tu historial y descargar!`
        );
        onAuthRequired();
      } else if (userLoggedIn) {
        setError(
          `Has llegado al límite de ${DAILY_LIMIT} imágenes gratuitas por hoy. Activa la suscripción mensual de US$5 y genera sin límite.`
        );
      }
      return;
    }
    // --- FIN LÓGICA DE BLOQUEO DE LÍMITE ---


    setSelectedImageB64(null); // Limpiar imagen anterior
    setStatus("IN_QUEUE");
    setStatusText("Enviando job a RunPod...");

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          negative_prompt: negative,
          width: Number(width),
          height: Number(height),
          steps: Number(steps),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(
          data?.error || "Error en /api/generate, revisa los logs."
        );
      }

      const jobId = data.jobId;
      setStatusText(`Job enviado. ID: ${jobId}. Consultando estado...`);

      let finished = false;
      while (!finished) {
        await new Promise((r) => setTimeout(r, 2000));

        const statusRes = await fetch(`/api/status?id=${jobId}`);
        const statusData = await statusRes.json();

        if (!statusRes.ok || statusData.error) {
          throw new Error(
            statusData.error || "Error al consultar /api/status."
          );
        }

        const st = statusData.status;
        setStatus(st);
        setStatusText(`Estado actual: ${st}...`);

        if (st === "IN_QUEUE" || st === "IN_PROGRESS") continue;

        finished = true;

        if (st === "COMPLETED" && statusData.output?.image_b64) {
          const b64 = statusData.output.image_b64;
          setSelectedImageB64(b64); // Mostrar imagen en el panel flotante
          setStatusText("Render completado.");

          // ----------------------------------------------------
          // Lógica de conteo y guardado
          // ----------------------------------------------------
          const newItem = {
            id: jobId,
            prompt,
            createdAt: new Date().toISOString(),
            image_b64: b64,
          };
            
          setHistory((prev) => [newItem, ...prev]); 
          
          if (isDemo) {
            // Contamos y guardamos el contador en localStorage para el modo demo
            const newDemoCount = demoCount + 1;
            setDemoCount(newDemoCount);
            localStorage.setItem("isabelaos_demo_count", String(newDemoCount));
          } else if (userLoggedIn) {
            // Lógica para usuario logueado (siempre contamos, guardamos en Supabase)
            setDailyCount((prev) => prev + 1);

            const dataUrl = `data:image/png;base64,${b64}`;
            saveGenerationInSupabase({
              userId: user.id,
              imageUrl: dataUrl,
              prompt: prompt,
              negativePrompt: negative,
              width: Number(width),
              height: Number(height), // CORRECCIÓN: Usamos height aquí
              steps: Number(steps),
            }).catch((e) => {
              console.error("Error guardando en Supabase:", e);
            });
          }
          // ----------------------------------------------------

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
    // Si es demo, forzamos registro/login para descargar
    if (isDemo) {
      alert("Para descargar tu imagen, por favor, crea tu cuenta o inicia sesión.");
      onAuthRequired();
      return;
    }
    
    if (!currentImageB64) return;
    const link = document.createElement("a");
    link.href = `data:image/png;base64,${currentImageB64}`;
    link.download = `isabelaos-image.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  
  const handlePayPalUnlock = () => {
    // Lógica para marcar premium después del pago
    if (!userLoggedIn || !premiumKey) return;
    try {
        localStorage.setItem(premiumKey, "1");
        setIsPremium(true);
        setDailyCount(0); // Reiniciar el contador diario al desbloquear
        setError("");
        setStatus("IDLE");
        setStatusText(
          "Plan Basic activado: ya no tienes límite diario en este navegador."
        );
    } catch (e) {
        console.error("No se pudo guardar premium en localStorage:", e);
    }
  };


  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-10">
      <h1 className="text-xl font-semibold text-white">
        Generador de Imágenes
      </h1>
      <p className="mt-1 text-xs text-neutral-400">
        {userLoggedIn ? "Crea tu imagen fotorrealista con nuestro motor RunPod." : "Panel de prueba gratuito."}
      </p>

      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        {/* Formulario */}
        <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
          
          {isDemo && ( // Mensaje claro para el modo Demo
            <div className="mb-4 rounded-2xl border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-[11px] text-cyan-100">
              **Modo de prueba gratuito:** Genera **{remaining} imágenes** más sin necesidad de registrarte. **Descarga y acceso a biblioteca requerirán crear cuenta.**
            </div>
          )}
            
          {userLoggedIn && !isPremium && remaining <= 2 && remaining > 0 && (
              <div className="mb-4 rounded-2xl border border-yellow-400/40 bg-yellow-500/10 px-4 py-2 text-[11px] text-yellow-100">
                ¡Atención! Solo te quedan **{remaining} imágenes gratis** hoy. Activa el plan ilimitado de **US$5/mes** para seguir generando.
              </div>
          )}
          
          <div className="space-y-4 text-sm">
            {/* Campos de Prompt, Negative Prompt, Steps, Width, Height */}
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
                    Uso de hoy: {currentCount} · Plan Basic activo (sin límite).
                  </>
                )}
                {userLoggedIn && !isPremium && (
                  <>
                    Uso de hoy: {currentCount} / {currentLimit} imágenes restantes.
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
                (!isPremium && remaining <= 0)
              }
              className="mt-4 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {(!isPremium && remaining <= 0)
                ? "Límite alcanzado (Desbloquea Plan)"
                : status === "IN_QUEUE" || status === "IN_PROGRESS"
                ? "Generando..."
                : "Generar imagen desde prompt"}
            </button>

            {/* Opciones de pago si se alcanza el límite (Solo usuarios logueados) */}
            {userLoggedIn && !isPremium && remaining <= 0 && (
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
            {currentImageB64 ? (
              <img
                src={`data:image/png;base64,${currentImageB64}`}
                alt="Imagen generada"
                className="h-full w-full rounded-2xl object-contain"
              />
            ) : (
              <p>Aquí verás el resultado en cuanto se complete el render.</p>
            )}
          </div>
          {currentImageB64 && (
            <button
              onClick={handleDownload}
              className="mt-4 w-full rounded-2xl border border-white/30 py-2 text-xs text-white hover:bg-white/10"
            >
              {isDemo ? "Descargar (Requiere crear cuenta)" : "Descargar imagen"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// Dashboard (Contenedor de Vistas)
// ---------------------------------------------------------
function DashboardView() {
  const { user, isAdmin, signOut } = useAuth();
  const [appViewMode, setAppViewMode] = useState("creator"); // 'creator' o 'library'
  const [history, setHistory] = useState([]); // Historial completo del usuario
  const [dailyCount, setDailyCount] = useState(0); // Conteo diario
  const [selectedImageB64, setSelectedImageB64] = useState(null); // Imagen seleccionada para el resultado

  const [isPremium, setIsPremium] = useState(false);
  const premiumKey = user ? `isabelaos_premium_${user.id}` : null;

  const userLoggedIn = !!user; // true si user existe
  const currentLimit = DAILY_LIMIT; // Límite para usuarios logueados


  // --- LÓGICA DE CARGA DE ESTADO Y PREMIUM ---
  useEffect(() => {
    if (!userLoggedIn) return;

    // 1. Leer estado Premium
    if (user.email === "exportalling@gmail.com") {
      setIsPremium(true);
      if (premiumKey) localStorage.setItem(premiumKey, "1");
    } else {
      try {
        const stored = premiumKey ? localStorage.getItem(premiumKey) : null;
        setIsPremium(stored === "1");
      } catch (e) {
        setIsPremium(false);
      }
    }
    
    // 2. Cargar historial y conteo diario
    (async () => {
      const rows = await loadGenerationsForUser(user.id);
      const mapped = rows.map((row) => ({
        id: row.id,
        prompt: row.prompt,
        createdAt: row.created_at,
        image_b64: row.image_url ? row.image_url.split(',')[1] : null,
      }));

      setHistory(mapped);
      const countToday = await getTodayGenerationCount(user.id);
      setDailyCount(countToday);
    })();
  }, [userLoggedIn, user, premiumKey]);
  
  // --- HANDLERS ---
  const handleContact = () => {
    const subject = encodeURIComponent("Soporte IsabelaOS Studio");
    const body = encodeURIComponent(
      `Hola, necesito ayuda con IsabelaOS Studio.\nUsuario: ${user?.email}\n\n(Escribe aquí tu mensaje)`
    );
    window.location.href = `mailto:contacto@isabelaos.com?subject=${subject}&body=${body}`;
  };

  const handleSelectImage = (item) => {
    // Mueve la imagen seleccionada al panel flotante
    setSelectedImageB64(item.image_b64);
    setAppViewMode("creator"); // Regresa a la vista del generador para verla grande
  };

  const handleDeleteImage = async (id) => {
    if (window.confirm("¿Estás seguro de que quieres eliminar esta imagen del historial?")) {
        try {
            await deleteGenerationInSupabase(id);
            setHistory((prev) => prev.filter((item) => item.id !== id));
            alert("Imagen eliminada de la biblioteca.");
        } catch (e) {
            console.error("Error al eliminar:", e);
            alert("No se pudo eliminar la imagen.");
        }
    }
  };

  const handleDownload = () => {
    if (!selectedImageB64) return;
    const link = document.createElement("a");
    link.href = `data:image/png;base64,${selectedImageB64}`;
    link.download = `isabelaos-studio-${new Date().toISOString()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  
  const handlePayPalUnlock = () => {
    if (!userLoggedIn || !premiumKey) return;
    try {
        localStorage.setItem(premiumKey, "1");
        setIsPremium(true);
        setDailyCount(0);
    } catch (e) {
        console.error("No se pudo guardar premium en localStorage:", e);
    }
  };
  

  // --- RENDERIZADO PRINCIPAL ---
  return (
    <div
      className="min-h-screen w-full text-white"
      style={{
        background:
          "radial-gradient(1200px_800px_at_110%_-10%,rgba(255,23,229,0.12),transparent_60%),radial-gradient(900px_600px_at_-10%_0%,rgba(0,229,255,0.10),transparent_50%),#06070B",
      }}
    >
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/60 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            {/* Logo y Título */}
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
                  Panel del creador · {isPremium ? "Basic (Ilimitado)" : "Beta Gratuita"}
                </div>
              </div>
            </div>
            
            {/* Menú de Navegación (BIBLIOTECA SEPARADA) */}
            <div className="hidden md:flex gap-4 text-xs font-medium">
                <button 
                    onClick={() => setAppViewMode('creator')} 
                    className={`pb-1 border-b-2 transition-colors ${appViewMode === 'creator' ? 'border-fuchsia-400 text-fuchsia-400' : 'border-transparent text-neutral-400 hover:text-white'}`}
                >
                    Generador
                </button>
                <button 
                    onClick={() => setAppViewMode('library')} 
                    className={`pb-1 border-b-2 transition-colors ${appViewMode === 'library' ? 'border-fuchsia-400 text-fuchsia-400' : 'border-transparent text-neutral-400 hover:text-white'}`}
                >
                    Biblioteca ({history.length})
                </button>
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

      <main className="mx-auto max-w-6xl">
        {/* Renderizado Condicional de Vistas */}
        {appViewMode === 'creator' ? (
            <CreatorPanel 
                isDemo={false} // Siempre es false en Dashboard
                history={history}
                setHistory={setHistory}
                setDailyCount={setDailyCount}
                currentCount={dailyCount}
                currentLimit={currentLimit}
                isPremium={isPremium}
                handlePayPalUnlock={handlePayPalUnlock}
                setSelectedImageB64={setSelectedImageB64}
                dailyCount={dailyCount} // Pasar dailyCount explícitamente
            />
        ) : (
            <LibraryView 
                history={history} 
                onSelectImage={handleSelectImage} 
                onDeleteImage={handleDeleteImage} 
            />
        )}
        
        {/* Panel de Resultado Flotante (Se muestra siempre en el dashboard) */}
        {selectedImageB64 && (
            <div className="fixed bottom-0 right-0 z-30 m-4 w-full max-w-sm rounded-3xl border border-white/10 bg-black/80 p-4 shadow-2xl backdrop-blur-md">
                <h3 className="text-sm font-semibold text-white mb-3">Resultado seleccionado</h3>
                <div className="h-48 rounded-2xl overflow-hidden mb-3">
                    <img
                        src={`data:image/png;base64,${selectedImageB64}`}
                        alt="Imagen seleccionada"
                        className="h-full w-full object-cover"
                    />
                </div>
                <button
                    onClick={handleDownload}
                    className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-2 text-xs font-semibold text-white"
                >
                    Descargar imagen
                </button>
            </div>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------
// Landing (sin sesión)
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
        alert(
          "No se pudo abrir el pago con Paddle. Intenta con Paypal."
        );
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
      className="min-h-screen w-full text-white"
      style={{
        // Fondo con gradiente sutil y oscuro
        background:
          "radial-gradient(1200px_800px_at_110%_-10%,rgba(255,23,229,0.12),transparent_60%),radial-gradient(900px_600px_at_-10%_0%,rgba(0,229,255,0.10),transparent_50%),#06070B",
      }}
    >
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/40 backdrop-blur-md">
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

      {/* Hero and Gallery (Combined) */}
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-10">
        <section className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
          {/* Columna de Texto y CTA */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300/80">
              Beta privada · Motor de Imagen de Estudio
            </p>
            <h1 className="mt-3 text-4xl font-semibold leading-tight md:text-5xl">
              Genera **Imágenes Fotorrealistas**{" "}
              <span className="block bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-violet-400 bg-clip-text text-transparent">
                con IA en la nube.
              </span>
            </h1>
            <p className="mt-4 max-w-xl text-sm text-neutral-300">
              Crea imágenes con **calidad de estudio** con el primer sistema de
              generación visual con IA desarrollado desde **Guatemala**.
              Empieza ahora con **{DEMO_LIMIT} imágenes gratis al día.**
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-4">
              <button
                onClick={onStartDemo}
                className="rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-500/30"
              >
                Generar Mis {DEMO_LIMIT} Imágenes GRATIS Ahora
              </button>
              <p className="max-w-xs text-[11px] text-neutral-400">
                Prueba la calidad del motor antes de crear tu cuenta y **desbloquea {DAILY_LIMIT} imágenes diarias**.
              </p>
            </div>

            <p className="mt-4 text-xs text-neutral-500">
              **Próximamente:** Módulos de video y nuestro motor propio de realismo corporal
              <span className="font-semibold text-white"> BodySync v1</span>.
            </p>
          </div>

          {/* Columna de 4 Imágenes (Galería) */}
          <div className="relative order-first lg:order-last">
            <h2 className="text-sm font-semibold text-white mb-3">
              Calidad de estudio · Renderizado con el motor actual
            </h2>
            
            {/* Nuevo Grid 2x2 para equilibrio visual */}
            <div className="grid grid-cols-2 gap-2"> 
              
              <div className="rounded-2xl border border-white/10 overflow-hidden shadow-xl shadow-fuchsia-500/10">
                <img src="/gallery/img1.png?v=2" alt="Imagen generada 1" className="w-full h-auto object-cover" />
              </div>
              <div className="rounded-2xl border border-white/10 overflow-hidden shadow-xl shadow-cyan-500/10">
                <img src="/gallery/img2.png?v=2" alt="Imagen generada 2" className="w-full h-auto object-cover" />
              </div>
              <div className="rounded-2xl border border-white/10 overflow-hidden shadow-xl shadow-fuchsia-500/10">
                <img src="/gallery/img3.png?v=2" alt="Imagen generada 3" className="w-full h-auto object-cover" />
              </div>
              <div className="rounded-2xl border border-white/10 overflow-hidden shadow-xl shadow-cyan-500/10">
                <img src="/gallery/img4.png?v=2" alt="Imagen generada 4" className="w-full h-auto object-cover" />
              </div>
            </div>

            <p className="mt-3 text-[10px] text-neutral-500">
              isabelaOs Studio es el primer sistema de generación visual con IA desarrollado en Guatemala pensando en creadores, estudios y agencias de modelos virtuales.
            </p>
          </div>
        </section>
        
        {/* Vista previa del panel */}
        <section className="mt-12">
          <h2 className="text-sm font-semibold text-white mb-4">
            Flujo de trabajo simple y potente
          </h2>
          <div className="rounded-3xl border border-white/10 bg-black/50 p-5 text-xs text-neutral-300">
            <h3 className="text-sm font-semibold text-white">
              Vista previa del panel del creador
            </h3>
            <p className="mt-2 text-[11px] text-neutral-400">
              Interfaz simple para escribir un prompt, ajustar resolución y ver el resultado generado por el motor conectado a RunPod.
            </p>
            <div className="mt-4 rounded-2xl border border-white/10 overflow-hidden bg-black/60">
              <img
                src="/preview/panel.png"
                alt="Vista previa del panel de isabelaOs Studio"
                className="w-full object-cover"
              />
            </div>
          </div>
        </section>

        {/* Sección de plan de pago */}
        <section className="mt-14 max-w-xl border-t border-white/10 pt-8">
          <h2 className="text-sm font-semibold text-white">
            Plan beta para creadores
          </h2>
          <p className="mt-2 text-xs text-neutral-300">
            Si llegas al límite de **{DAILY_LIMIT} imágenes gratuitas al día** (por usuario registrado) y quieres seguir
            generando sin restricciones, puedes activar el plan ilimitado mientras
            dure la beta.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-4">
            <button
              onClick={handlePaddleCheckout}
              className="rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-2 text-sm font-semibold text-white"
            >
              isabelaOs Basic – US$5/mes (tarjeta / Paddle)
            </button>
            <div className="flex flex-col gap-1 text-[11px] text-neutral-400">
              <span className="text-neutral-300">
                o pagar con <span className="font-semibold">PayPal</span>:
              </span>
              <PayPalButton
                amount="5.00"
                containerId="paypal-button-landing"
              />
            </div>
          </div>

          <p className="mt-3 text-[11px] text-neutral-400">
            Los usuarios que se registren durante la beta mantendrán un{" "}
            <span className="font-semibold text-white">
              precio preferencial durante el primer año
            </span>{" "}
            frente al precio público general cuando lancemos los módulos
            siguientes.
          </p>
        </section>

        {/* Contacto y Footer */}
        <section id="contacto" className="mt-16 max-w-xl">
          <h2 className="text-sm font-semibold text-white">
            Contacto y soporte
          </h2>
          <p className="mt-1 text-xs text-neutral-400">
            Si tienes dudas sobre IsabelaOS Studio, escríbenos y el equipo de
            soporte responderá desde{" "}
            <span className="font-semibold text-white">
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
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              />
            </div>
            <div>
              <label className="text-xs text-neutral-300">Correo</label>
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              />
            </div>
            <div>
              <label className="text-xs text-neutral-300">Mensaje</label>
              <textarea
                rows={4}
                value={contactMessage}
                onChange={(e) => setContactMessage(e.target.value)}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
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
              © {new Date().getFullYear()} isabelaOs Studio · Desarrollado en
              Guatemala, Coban Alta verapaz por Stalling Technologic.
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
  
  const [viewMode, setViewMode] = useState('landing');
  // NUEVO: Estado para gestionar el historial/datos del usuario
  const [history, setHistory] = useState([]);
  const [dailyCount, setDailyCount] = useState(0);
  const [isPremium, setIsPremium] = useState(false);
  
  // Estado para mostrar la imagen grande seleccionada (flotante)
  const [selectedImageB64, setSelectedImageB64] = useState(null); 

  useEffect(() => {
    document.documentElement.style.background = "#06070B";
  }, []);

  const openAuth = () => {
    setShowAuthModal(true);
    setViewMode('landing');
  }
  const closeAuth = () => setShowAuthModal(false);
  
  const handleStartDemo = () => {
    setViewMode('demo');
  }
  
  // Actualizar vista si el usuario cambia
  useEffect(() => {
    if (user && viewMode !== 'dashboard') {
        setViewMode('dashboard');
    } else if (!user && viewMode !== 'landing' && viewMode !== 'demo') {
        setViewMode('landing');
    }
  }, [user, viewMode]);


  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-black text-white">
        <p className="text-sm text-neutral-400">Cargando sesión...</p>
      </div>
    );
  }

  // Definiciones de estado para el Dashboard/CreatorPanel
  const userLoggedIn = !!user;
  const currentLimit = userLoggedIn ? DAILY_LIMIT : DEMO_LIMIT;


  // Lógica de renderizado
  if (user) {
    // Usuario logueado: siempre ve el Dashboard
    return <DashboardView 
        history={history}
        setHistory={setHistory}
        dailyCount={dailyCount}
        setDailyCount={setDailyCount}
        isPremium={isPremium}
        setIsPremium={setIsPremium}
        selectedImageB64={selectedImageB64}
        setSelectedImageB64={setSelectedImageB64}
    />;
  }
  
  if (viewMode === 'demo') {
    // Usuario no logueado, pero activó el botón de prueba
    return (
        <>
            <div id="top" className="pt-10">
              <CreatorPanel 
                isDemo={true} 
                onAuthRequired={openAuth}
                history={history}
                setHistory={setHistory}
                currentCount={history.length} // Usar history.length para demo count en tiempo real
                currentLimit={DEMO_LIMIT}
                setSelectedImageB64={setSelectedImageB64}
                isPremium={false}
                // Las funciones de setDailyCount y PayPal no se usan en demo
              />
            </div>
            {/* Mostramos la landing debajo del panel de prueba */}
            <LandingView onOpenAuth={openAuth} onStartDemo={handleStartDemo} />
            <AuthModal open={showAuthModal} onClose={closeAuth} />
        </>
    );
  }
  
  // Usuario no logueado, en la Landing normal
  return (
    <>
      <LandingView onOpenAuth={openAuth} onStartDemo={handleStartDemo} />
      <AuthModal open={showAuthModal} onClose={closeAuth} />
    </>
  );
}