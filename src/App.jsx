import { useState, useEffect } from "react";

import { useAuth } from "./context/AuthContext";
import {
  saveGenerationInSupabase,
  loadGenerationsForUser,
  getTodayGenerationCount,
} from "./lib/generations";

// ---------------------------------------------------------
// LÍMITES GLOBALES AJUSTADOS
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

              // callback para marcar premium
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
// Panel del creador (RunPod) - ahora SIN lógica de biblioteca
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

  const [status, setStatus] = useState("IDLE");
  const [statusText, setStatusText] = useState("");
  const [imageB64, setImageB64] = useState(null);
  const [error, setError] = useState("");

  const [dailyCount, setDailyCount] = useState(0);
  const [isPremium, setIsPremium] = useState(false);

  // Clave local para este usuario (modo beta)
  const premiumKey = userLoggedIn ? `isabelaos_premium_${user.id}` : null;

  // Leer premium desde localStorage + tu correo siempre premium
  useEffect(() => {
    if (!userLoggedIn) {
      setIsPremium(false);
      setDailyCount(0);
      return;
    }

    // Tu cuenta siempre premium
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

  // función de suscripción (Paddle)
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

  // Cargar solo el conteo diario desde Supabase (historial se maneja en LibraryView)
  useEffect(() => {
    if (!userLoggedIn) {
      setDailyCount(0);
      return;
    }

    (async () => {
      try {
        const countToday = await getTodayGenerationCount(user.id);
        setDailyCount(countToday);
      } catch (e) {
        console.error("Error obteniendo conteo diario:", e);
      }
    })();
  }, [userLoggedIn, user]);

  // Contador local para modo Demo
  const [demoCount, setDemoCount] = useState(0);

  // Intentar leer demoCount de localStorage al iniciar el demo
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

    // --- LÓGICA DE BLOQUEO DE LÍMITE ---
    const currentLimit = isDemo ? DEMO_LIMIT : DAILY_LIMIT;
    const currentCount = isDemo ? demoCount : dailyCount;

    // Bloqueo para modo Demo o usuario Logueado (No Premium)
    if (!isPremium && currentCount >= currentLimit) {
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

    setImageB64(null);
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
          setImageB64(b64);
          setStatusText("Render completado.");

          // ----------------------------------------------------
          // Lógica de conteo y guardado
          // ----------------------------------------------------
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
              // BUG ARREGLADO: ahora usamos height real, no steps
              height: Number(height),
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
        "Plan Basic activado: ya no tienes límite diario en este navegador."
      );
      alert(
        "Bienvenido a tu suscripción mensual de isabelaOs Studio. Con este pago aseguras un precio especial durante un año completo para nuestro siguiente módulo (próximamente)."
      );
    } catch (e) {
      console.error("No se pudo guardar premium en localStorage:", e);
    }
  };

  // Muestra un mensaje de advertencia si estamos en modo Demo.
  if (!userLoggedIn && !isDemo) {
    return (
      <div className="rounded-3xl border border-yellow-400/30 bg-yellow-500/5 p-6 text-center text-sm text-yellow-100">
        <p className="font-medium">
          Debes iniciar sesión para usar el generador de imágenes.
        </p>
        <p className="mt-1 text-xs text-yellow-200/80">
          Desde tu cuenta podrás crear imágenes con nuestro motor real conectado
          a RunPod. {DAILY_LIMIT} imágenes diarias gratis; si quieres ir más
          allá, podrás activar el plan de $5/mes para generar ilimitadas mientras
          dure la beta.
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
            <strong>Modo de prueba gratuito:</strong> Genera{" "}
            <strong>{remaining} imágenes</strong> más sin necesidad de
            registrarte. <br />
            <strong>Descarga y acceso a biblioteca requerirán crear cuenta.</strong>
          </div>
        )}

        {userLoggedIn && !isPremium && remaining <= 2 && remaining > 0 && (
          <div className="mt-4 rounded-2xl border border-yellow-400/40 bg-yellow-500/10 px-4 py-2 text-[11px] text-yellow-100">
            ¡Atención! Solo te quedan <strong>{remaining} imágenes gratis</strong>{" "}
            hoy. Activa el plan ilimitado de <strong>US$5/mes</strong> para
            seguir generando.
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
              {isDemo &&
                `Uso de prueba: ${currentCount} / ${currentLimit} imágenes.`}
              {userLoggedIn && isPremium && (
                <>
                  Uso de hoy: {currentCount} · Plan Basic activo (sin límite, con
                  precio beta).
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
            className="mt-4 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60 shadow-lg shadow-cyan-500/30"
          >
            {!isPremium && currentCount >= currentLimit
              ? "Límite alcanzado (Crea cuenta / Desbloquea Plan)"
              : status === "IN_QUEUE" || status === "IN_PROGRESS"
              ? "Generando..."
              : "Generar imagen desde prompt"}
          </button>

          {/* Opciones de pago si se alcanza el límite (Solo usuarios logueados) */}
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
            {isDemo
              ? "Descargar (Requiere crear cuenta)"
              : "Descargar imagen"}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// LibraryView – HISTORIAL separado del CreatorPanel
// ---------------------------------------------------------
function LibraryView() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;

    (async () => {
      try {
        setLoading(true);
        const rows = await loadGenerationsForUser(user.id);

        const mapped = rows.map((row) => {
          let b64 = "";
          if (row.image_url && row.image_url.startsWith("data:image")) {
            const parts = row.image_url.split(",");
            b64 = parts[1] || "";
          }
          return {
            id: row.id,
            prompt: row.prompt || "",
            createdAt: row.created_at,
            image_b64: b64,
          };
        });

        setItems(mapped);
        setSelected(mapped[0] || null);
      } catch (e) {
        console.error("Error cargando biblioteca:", e);
        setError(
          "No se pudo cargar tu biblioteca de imágenes. Intenta de nuevo más tarde."
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const handleDeleteLocal = (id) => {
    // Eliminación local (solo de la vista actual)
    setItems((prev) => prev.filter((it) => it.id !== id));
    if (selected && selected.id === id) {
      setSelected(null);
    }
  };

  if (!user) {
    return (
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6 text-sm text-neutral-300">
        Debes iniciar sesión para ver tu biblioteca.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6 text-sm text-neutral-300">
        Cargando tu biblioteca...
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1.1fr_1.1fr]">
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">Tu biblioteca</h2>
        <p className="mt-1 text-xs text-neutral-400">
          Aquí se muestran las imágenes generadas desde tu cuenta y guardadas
          en Supabase.
        </p>

        {error && (
          <p className="mt-3 text-xs text-red-400 whitespace-pre-line">
            {error}
          </p>
        )}

        {items.length === 0 ? (
          <p className="mt-4 text-xs text-neutral-400">
            Aún no tienes imágenes en tu biblioteca. Genera una desde el panel
            del creador.
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {items.map((item) => (
              <div
                key={item.id}
                className={`group relative overflow-hidden rounded-xl border bg-black/50 cursor-pointer ${
                  selected && selected.id === item.id
                    ? "border-cyan-400/60"
                    : "border-white/10"
                }`}
                onClick={() => setSelected(item)}
              >
                <img
                  src={`data:image/png;base64,${item.image_b64}`}
                  alt={item.prompt}
                  className="h-24 w-full object-cover group-hover:opacity-80"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteLocal(item.id);
                  }}
                  className="absolute right-1 top-1 rounded-full bg-black/70 px-2 text-[10px] text-white opacity-0 group-hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <p className="mt-3 text-[10px] text-neutral-500">
          Nota: por ahora la eliminación es solo local (de esta vista). Más
          adelante se conectará con el borrado en la base de datos.
        </p>
      </div>

      {/* Vista grande de la imagen seleccionada */}
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6 flex flex-col">
        <h2 className="text-lg font-semibold text-white">
          Detalle de la imagen
        </h2>
        <div className="mt-4 flex h-[420px] flex-1 items-center justify-center rounded-2xl bg-black/70 text-sm text-neutral-400">
          {selected && selected.image_b64 ? (
            <img
              src={`data:image/png;base64,${selected.image_b64}`}
              alt={selected.prompt}
              className="h-full w-full rounded-2xl object-contain"
            />
          ) : (
            <p>Selecciona una imagen de tu biblioteca para verla en grande.</p>
          )}
        </div>
        {selected && (
          <div className="mt-3 text-[11px] text-neutral-400">
            <p className="font-semibold text-neutral-200">
              Prompt usado (si se guardó):
            </p>
            <p className="mt-1 line-clamp-3">
              {selected.prompt || "Sin prompt guardado para esta imagen."}
            </p>
            <p className="mt-1 opacity-70">
              Fecha:{" "}
              {selected.createdAt
                ? new Date(selected.createdAt).toLocaleString()
                : "Desconocida"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// Vista Dashboard (logueado) – ahora con appViewMode
// ---------------------------------------------------------
function DashboardView() {
  const { user, isAdmin, signOut } = useAuth();
  const [appViewMode, setAppViewMode] = useState("creator"); // "creator" | "library"

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
            {/* Navegación interna: Generador / Biblioteca */}
            <div className="hidden md:flex items-center gap-1 rounded-2xl bg-white/5 p-1">
              <button
                type="button"
                onClick={() => setAppViewMode("creator")}
                className={`rounded-2xl px-3 py-1 text-[11px] transition ${
                  appViewMode === "creator"
                    ? "bg-white text-black shadow shadow-cyan-500/40"
                    : "text-neutral-300 hover:bg-white/10"
                }`}
              >
                Generador
              </button>
              <button
                type="button"
                onClick={() => setAppViewMode("library")}
                className={`rounded-2xl px-3 py-1 text-[11px] transition ${
                  appViewMode === "library"
                    ? "bg-white text-black shadow shadow-fuchsia-500/40"
                    : "text-neutral-300 hover:bg-white/10"
                }`}
              >
                Biblioteca
              </button>
            </div>

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
        <section className="space-y-6">
          <div>
            <h1 className="text-xl font-semibold text-white">
              {appViewMode === "creator"
                ? "Panel del creador"
                : "Biblioteca de imágenes"}
            </h1>
            <p className="mt-1 text-xs text-neutral-400">
              {appViewMode === "creator"
                ? "Genera imágenes directamente desde tu cuenta conectada al pipeline real en RunPod."
                : "Revisa y organiza las imágenes que has generado con tu cuenta en isabelaOs Studio."}
            </p>
          </div>

          {appViewMode === "creator" ? (
            <CreatorPanel />
          ) : (
            <LibraryView />
          )}
        </section>
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
      className="min-h-screen w-full text-white"
      style={{
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

      {/* Hero + Galería */}
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-10">
        <section className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
          {/* Texto y CTA */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300/80">
              Beta privada · Motor de Imagen de Estudio
            </p>
            <h1 className="mt-3 text-4xl font-semibold leading-tight md:text-5xl">
              Genera <span className="font-bold">Imágenes Fotorrealistas</span>{" "}
              <span className="block bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-violet-400 bg-clip-text text-transparent">
                con IA en la nube.
              </span>
            </h1>
            <p className="mt-4 max-w-xl text-sm text-neutral-300">
              Crea imágenes con <strong>calidad de estudio</strong> con el
              primer sistema de generación visual con IA desarrollado desde{" "}
              <strong>Guatemala</strong>. Empieza ahora con{" "}
              <strong>{DEMO_LIMIT} imágenes gratis al día</strong>.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-4">
              <button
                onClick={onStartDemo}
                className="rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-500/30"
              >
                Generar Mis {DEMO_LIMIT} Imágenes GRATIS Ahora
              </button>
              <p className="max-w-xs text-[11px] text-neutral-400">
                Prueba la calidad del motor antes de crear tu cuenta y{" "}
                <strong>desbloquea {DAILY_LIMIT} imágenes diarias</strong>.
              </p>
            </div>

            <p className="mt-4 text-xs text-neutral-500">
              <strong>Próximamente:</strong> Módulos de video y nuestro motor
              propio de realismo corporal{" "}
              <span className="font-semibold text-white">BodySync v1</span>.
            </p>
          </div>

          {/* Galería 4 imágenes */}
          <div className="relative order-first lg:order-last">
            <h2 className="text-sm font-semibold text-white mb-3">
              Calidad de estudio · Renderizado con el motor actual
            </h2>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-white/10 overflow-hidden shadow-xl shadow-fuchsia-500/10">
                <img
                  src="/gallery/img1.png?v=2"
                  alt="Imagen generada 1"
                  className="w-full h-auto object-cover"
                />
              </div>
              <div className="rounded-2xl border border-white/10 overflow-hidden shadow-xl shadow-cyan-500/10">
                <img
                  src="/gallery/img2.png?v=2"
                  alt="Imagen generada 2"
                  className="w-full h-auto object-cover"
                />
              </div>
              <div className="rounded-2xl border border-white/10 overflow-hidden shadow-xl shadow-fuchsia-500/10">
                <img
                  src="/gallery/img3.png?v=2"
                  alt="Imagen generada 3"
                  className="w-full h-auto object-cover"
                />
              </div>
              <div className="rounded-2xl border border-white/10 overflow-hidden shadow-xl shadow-cyan-500/10">
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

        {/* Vista previa panel */}
        <section className="mt-12">
          <h2 className="text-sm font-semibold text-white mb-4">
            Flujo de trabajo simple y potente
          </h2>
          <div className="rounded-3xl border border-white/10 bg-black/50 p-5 text-xs text-neutral-300">
            <h3 className="text-sm font-semibold text-white">
              Vista previa del panel del creador
            </h3>
            <p className="mt-2 text-[11px] text-neutral-400">
              Interfaz simple para escribir un prompt, ajustar resolución y ver
              el resultado generado por el motor conectado a RunPod.
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

        {/* Plan pago */}
        <section className="mt-14 max-w-xl border-t border-white/10 pt-8">
          <h2 className="text-sm font-semibold text-white">
            Plan beta para creadores
          </h2>
          <p className="mt-2 text-xs text-neutral-300">
            Si llegas al límite de <strong>{DAILY_LIMIT} imágenes gratuitas</strong>{" "}
            al día (por usuario registrado) y quieres seguir generando sin
            restricciones, puedes activar el plan ilimitado mientras dure la
            beta.
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
              <PayPalButton amount="5.00" containerId="paypal-button-landing" />
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

        {/* Contacto */}
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
      <div className="min-h-screen grid place-items-center bg-black text-white">
        <p className="text-sm text-neutral-400">Cargando sesión...</p>
      </div>
    );
  }

  // Usuario logueado: siempre ve el Dashboard
  if (user) {
    return <DashboardView />;
  }

  // Usuario no logueado, en modo demo
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

  // Usuario no logueado, Landing normal
  return (
    <>
      <LandingView onOpenAuth={openAuth} onStartDemo={handleStartDemo} />
      <AuthModal open={showAuthModal} onClose={closeAuth} />
    </>
  );
}
