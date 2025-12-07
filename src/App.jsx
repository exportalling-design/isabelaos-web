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
// Panel del creador (RunPod) - Acepta isDemo
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

  // función de suscripción (Paddle) – plan básico imágenes
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

  // Cargar conteo diario desde Supabase
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

  // Contador local para modo Demo
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
              prompt,
              negativePrompt: negative,
              width: Number(width),
              height: Number(height), // ✅ corregido, antes estaba steps
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
        "Plan Basic activado: ya no tienes límite diario en este navegador."
      );
      alert(
        "Bienvenido a tu suscripción mensual de isabelaOs Studio. Con este pago aseguras un precio especial durante un año completo para nuestro siguiente módulo (próximamente)."
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
          allá, podrás activar el plan de $5/mes para generar ilimitadas
          mientras dure la beta.
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
            <strong>{remaining}</strong> imágenes más sin necesidad de
            registrarte. <br />
            <strong>Descarga y acceso a biblioteca requerirán crear cuenta.</strong>
          </div>
        )}

        {userLoggedIn && !isPremium && remaining <= 2 && remaining > 0 && (
          <div className="mt-4 rounded-2xl border border-yellow-400/40 bg-yellow-500/10 px-4 py-2 text-[11px] text-yellow-100">
            ¡Atención! Solo te quedan <strong>{remaining}</strong> imágenes
            gratis hoy. Activa el plan ilimitado de <strong>US$5/mes</strong>{" "}
            para seguir generando.
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
                  Uso de hoy: {currentCount} · Plan Basic activo (sin límite,
                  con precio beta).
                </>
              )}
              {userLoggedIn && !isPremium && !isDemo && (
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
              ? "Límite alcanzado (Crea cuenta / Desbloquea Plan)"
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
// Biblioteca (historial) – ahora separada
// ---------------------------------------------------------
function LibraryView() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) {
      setItems([]);
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const rows = await loadGenerationsForUser(user.id);
        const mapped = rows.map((row) => {
          let b64 = "";
          if (row.image_url && row.image_url.startsWith("data:image")) {
            const parts = row.image_url.split(",");
            b64 = parts[1] || "";
          }
          return {
            id: row.id,
            createdAt: row.created_at,
            image_b64: b64,
          };
        });
        setItems(mapped);
      } catch (e) {
        console.error(e);
        setError("Error cargando tu biblioteca.");
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  if (!user) {
    return (
      <div className="rounded-3xl border border-yellow-400/30 bg-yellow-500/5 p-6 text-sm text-yellow-100">
        Inicia sesión para ver tu biblioteca de imágenes.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-3xl border border-white/10 bg-black/50 p-6 text-sm text-neutral-200">
        Cargando biblioteca...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-3xl border border-red-400/30 bg-red-500/10 p-6 text-sm text-red-100">
        {error}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-3xl border border-white/10 bg-black/50 p-6 text-sm text-neutral-300">
        Aún no tienes imágenes guardadas en tu biblioteca.
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-white/10 bg-black/50 p-6">
      <h2 className="text-lg font-semibold text-white">Biblioteca</h2>
      <p className="mt-1 text-xs text-neutral-400">
        Todas las imágenes generadas desde tu cuenta se guardan en esta
        sección.
      </p>

      <div className="mt-4 grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4">
        {items.map((item) => (
          <div
            key={item.id}
            className="group relative overflow-hidden rounded-xl border border-white/10 bg-black/50"
          >
            <img
              src={`data:image/png;base64,${item.image_b64}`}
              alt="Imagen generada"
              className="h-32 w-full object-cover group-hover:opacity-80"
            />
            <div className="absolute inset-x-0 bottom-0 bg-black/70 px-2 py-1 text-[10px] text-neutral-300">
              {new Date(item.createdAt).toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[10px] text-neutral-500">
        Próximamente podrás eliminar imágenes y organizarlas en carpetas desde
        esta vista.
      </p>
    </div>
  );
}

// ---------------------------------------------------------
// Panel Foto Navideña (Premium – Plan Navidad)
// ---------------------------------------------------------
function XmasPhotoPanel() {
  const { user } = useAuth();
  const [hasXmasPlan, setHasXmasPlan] = useState(false);

  const [filePreview, setFilePreview] = useState(null);
  const [fileB64, setFileB64] = useState(null);
  const [extraPrompt, setExtraPrompt] = useState("");
  const [status, setStatus] = useState("IDLE");
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState("");
  const [resultB64, setResultB64] = useState(null);

  const xmasKey = user ? `isabelaos_xmas_plan_${user.id}` : null;

  useEffect(() => {
    if (!user || !xmasKey) {
      setHasXmasPlan(false);
      return;
    }
    try {
      const stored = localStorage.getItem(xmasKey);
      setHasXmasPlan(stored === "1");
    } catch (e) {
      console.warn("No se pudo leer plan navideño:", e);
      setHasXmasPlan(false);
    }
  }, [user, xmasKey]);

  const markXmasPlanActive = () => {
    if (!user || !xmasKey) return;
    localStorage.setItem(xmasKey, "1");
    setHasXmasPlan(true);
    alert(
      "Plan Navidad marcado como activo en este navegador (modo prueba). Luego lo conectamos a Paddle."
    );
  };

  const handleXmasCheckout = async () => {
    if (!user) {
      alert("Inicia sesión para activar el Plan Navidad.");
      return;
    }

    try {
      const res = await fetch("/api/paddle-checkout-xmas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        console.error("Respuesta Paddle Xmas:", data);
        alert("No se pudo abrir el pago de Navidad. Revisa Paddle.");
      }
    } catch (err) {
      console.error("Error Paddle Xmas:", err);
      alert("Error al conectar con Paddle.");
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Por favor, sube un archivo de imagen (JPG/PNG).");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      setFilePreview(result);
      const [, b64] = String(result).split(",");
      setFileB64(b64 || null);
    };
    reader.readAsDataURL(file);
  };

  const handleGenerateXmas = async () => {
    setError("");

    if (!user) {
      alert("Debes iniciar sesión.");
      return;
    }

    if (!hasXmasPlan) {
      alert("Esta función es exclusiva del Plan Navidad (US$10 en diciembre).");
      return;
    }

    if (!fileB64) {
      alert("Primero sube una foto.");
      return;
    }

    setStatus("IN_QUEUE");
    setStatusText("Enviando foto navideña a RunPod...");
    setResultB64(null);

    try {
      const res = await fetch("/api/generate-xmas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          init_image_b64: fileB64,
          extraPrompt: extraPrompt || "",
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok || !data.jobId) {
        throw new Error(data.error || "Error creando el job navideño.");
      }

      const jobId = data.jobId;
      setStatusText(`Job Navidad enviado. ID: ${jobId}. Consultando estado...`);

      let finished = false;
      while (!finished) {
        await new Promise((r) => setTimeout(r, 2500));

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
          setResultB64(b64);
          setStatusText("Foto navideña generada.");

          try {
            const dataUrl = `data:image/png;base64,${b64}`;
            await saveGenerationInSupabase({
              userId: user.id,
              imageUrl: dataUrl,
              prompt: "FOTO_NAVIDENA_IA",
              negativePrompt: "",
              width: 768,
              height: 1024,
              steps: 30,
            });
          } catch (e) {
            console.error(
              "Error guardando foto navideña en Supabase:",
              e
            );
          }
        } else {
          throw new Error("Job terminado pero sin imagen en la salida.");
        }
      }
    } catch (err) {
      console.error(err);
      setStatus("ERROR");
      setStatusText("Error al generar la foto navideña.");
      setError(err.message || String(err));
    }
  };

  if (!user) {
    return (
      <div className="rounded-3xl border border-yellow-400/30 bg-yellow-500/5 p-6 text-sm text-yellow-100">
        Debes iniciar sesión para usar el generador de foto navideña.
      </div>
    );
  }

  if (!hasXmasPlan) {
    return (
      <div className="rounded-3xl border border-fuchsia-400/40 bg-fuchsia-500/10 p-6 text-sm text-fuchsia-50 space-y-4">
        <h2 className="text-lg font-semibold">
          🎄 Foto Navideña IA – Plan Navidad
        </h2>
        <p className="text-xs text-fuchsia-100/90">
          Esta función convierte tu foto o la de tu familia en un{" "}
          <span className="font-semibold">
            retrato navideño de estudio profesional
          </span>{" "}
          con árbol de navidad, luces cálidas y ambiente premium, como si
          hubieras pagado una sesión en estudio.
        </p>
        <p className="text-xs text-red-400 font-semibold">
          Disponible solo con el Plan Navidad – US$10 (mes de diciembre).
        </p>

        <button
          onClick={handleXmasCheckout}
          className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-2 text-sm font-semibold text-white"
        >
          Activar Plan Navidad – US$10
        </button>

        <button
          type="button"
          onClick={markXmasPlanActive}
          className="w-full rounded-2xl border border-white/30 px-6 py-2 text-[11px] text-neutral-200 hover:bg-white/10"
        >
          (Solo pruebas) Marcar plan como activo en este navegador
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* Columna: subida y controles */}
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">
          🎄 Generador de Foto Navideña
        </h2>
        <p className="text-xs text-neutral-300">
          Sube una foto (tuya, en pareja o familia) y la convertiremos en un
          retrato navideño de estudio profesional.
        </p>

        <div className="mt-2 text-xs text-red-400 font-semibold">
          Estamos trabajando para tener este módulo lo antes posible con la
          máxima calidad de estudio.
        </div>

        <div className="mt-4">
          <label className="text-xs text-neutral-300">
            1. Sube tu foto (JPG/PNG)
          </label>
          <label className="mt-1 flex h-32 w-full cursor-pointer items-center justify-center rounded-2xl border border-dashed border-white/20 bg-black/60 text-xs text-neutral-400 hover:border-cyan-400/60 hover:text-cyan-200">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
            {filePreview ? "Cambiar foto" : "Haz clic aquí para seleccionar tu foto"}
          </label>
          {filePreview && (
            <div className="mt-3 rounded-2xl border border-white/10 overflow-hidden bg-black/60">
              <img
                src={filePreview}
                alt="Foto subida"
                className="h-40 w-full object-cover"
              />
            </div>
          )}
        </div>

        <div className="mt-4">
          <label className="text-xs text-neutral-300">
            2. Opcional: describe brevemente (familia, pareja, niños, etc.)
          </label>
          <input
            type="text"
            value={extraPrompt}
            onChange={(e) => setExtraPrompt(e.target.value)}
            placeholder="Por ejemplo: familia de 4 personas, dos niños pequeños..."
            className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-xs text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
          />
        </div>

        <div className="mt-4 rounded-2xl bg-black/60 px-4 py-2 text-xs text-neutral-300">
          Estado actual:{" "}
          {statusText || "Listo para generar tu foto navideña."}
        </div>

        {error && (
          <p className="text-xs text-red-400 whitespace-pre-line">{error}</p>
        )}

        <button
          onClick={handleGenerateXmas}
          disabled={status === "IN_QUEUE" || status === "IN_PROGRESS"}
          className="mt-4 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {status === "IN_QUEUE" || status === "IN_PROGRESS"
            ? "Generando foto navideña..."
            : "Generar retrato navideño"}
        </button>
      </div>

      {/* Columna: resultado */}
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
            <p>
              Aquí verás tu foto navideña en cuanto se complete el render.
            </p>
          )}
        </div>
        {resultB64 && (
          <button
            onClick={() => {
              const link = document.createElement("a");
              link.href = `data:image/png;base64,${resultB64}`;
              link.download = "isabelaos-foto-navidenia.png";
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
            }}
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
// Vista de video (placeholder – próximamente)
// ---------------------------------------------------------
function VideoPanel() {
  return (
    <div className="rounded-3xl border border-white/10 bg-black/40 p-6 text-sm text-neutral-200">
      <h2 className="text-lg font-semibold text-white">
        Generador de video desde prompt (próximamente)
      </h2>
      <p className="mt-2 text-xs text-red-400 font-semibold">
        Estamos trabajando para tener este módulo de video listo lo antes
        posible. Se conectará a tu mismo motor en la nube para generar secuencias
        animadas desde tus prompts.
      </p>
      <p className="mt-3 text-xs text-neutral-300">
        La interfaz ya está preparada para recibir parámetros de video (frames,
        duración, resolución, motion adapter, etc.). En cuanto definamos el
        pipeline en RunPod, solo conectaremos esta vista al nuevo endpoint.
      </p>
    </div>
  );
}

// ---------------------------------------------------------
// Vista Dashboard (logueado)
// ---------------------------------------------------------
function DashboardView() {
  const { user, isAdmin, signOut } = useAuth();
  const [appViewMode, setAppViewMode] = useState("creator");

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
          "radial-gradient(1200px_800px_at_110%_-10%,rgba(255,23,229,0.20),transparent_60%),radial-gradient(900px_600px_at_-10%_0%,rgba(0,229,255,0.18),transparent_50%),#06070B",
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
        <section className="space-y-6">
          <div>
            <h1 className="text-xl font-semibold text-white">
              Panel del creador
            </h1>
            <p className="mt-1 text-xs text-neutral-400">
              Genera imágenes directamente desde tu cuenta conectada al pipeline
              real en RunPod y accede a funciones avanzadas como la Foto
              Navideña IA.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
            {/* Sidebar */}
            <div className="rounded-3xl border border-white/10 bg-black/50 p-4 text-xs space-y-2">
              <button
                onClick={() => setAppViewMode("creator")}
                className={`w-full rounded-2xl px-3 py-2 text-left ${
                  appViewMode === "creator"
                    ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                    : "bg-black/60 text-neutral-200 hover:bg-white/10"
                }`}
              >
                Generar imagen desde prompt
              </button>

              <button
                onClick={() => setAppViewMode("video")}
                className={`w-full rounded-2xl px-3 py-2 text-left ${
                  appViewMode === "video"
                    ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                    : "bg-black/60 text-neutral-200 hover:bg-white/10"
                }`}
              >
                Generar video desde prompt (próximamente)
              </button>

              <button
                onClick={() => setAppViewMode("library")}
                className={`w-full rounded-2xl px-3 py-2 text-left ${
                  appViewMode === "library"
                    ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                    : "bg-black/60 text-neutral-200 hover:bg-white/10"
                }`}
              >
                Biblioteca
              </button>

              <button
                onClick={() => setAppViewMode("xmas")}
                className={`w-full rounded-2xl px-3 py-2 text-left ${
                  appViewMode === "xmas"
                    ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                    : "bg-black/60 text-neutral-200 hover:bg-white/10"
                }`}
              >
                🎄 Foto Navideña IA (Premium)
              </button>
            </div>

            {/* Contenido principal */}
            <div className="space-y-6">
              {appViewMode === "creator" && <CreatorPanel />}
              {appViewMode === "video" && <VideoPanel />}
              {appViewMode === "library" && <LibraryView />}
              {appViewMode === "xmas" && <XmasPhotoPanel />}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

// ---------------------------------------------------------
// Landing (sin sesión) – mejorada + BodySync
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
          "radial-gradient(1200px_800px_at_110%_-10%,rgba(255,23,229,0.20),transparent_60%),radial-gradient(900px_600px_at_-10%_0%,rgba(0,229,255,0.18),transparent_50%),linear-gradient(135deg,#050509,#060712,#050509)",
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
                Generación visual con IA · Beta
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

      {/* Contenido principal */}
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-10">
        {/* Hero + Galería 2x2 */}
        <section className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
          {/* Columna texto */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300/80">
              Beta privada · Motor de Imagen de Estudio
            </p>
            <h1 className="mt-3 text-4xl font-semibold leading-tight md:text-5xl">
              Genera{" "}
              <span className="bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-violet-400 bg-clip-text text-transparent">
                imágenes fotorrealistas
              </span>{" "}
              con IA en segundos.
            </h1>
            <p className="mt-4 max-w-xl text-sm text-neutral-300">
              isabelaOs Studio es el primer sistema de generación visual con IA
              desarrollado desde{" "}
              <span className="font-semibold text-white">Guatemala</span> para
              creadores, estudios y agencias. Escribe un prompt, elige la
              resolución y obtén resultados con calidad de sesión fotográfica de
              estudio.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-4">
              <button
                onClick={onStartDemo}
                className="rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-500/30"
              >
                Generar mis {DEMO_LIMIT} imágenes GRATIS ahora
              </button>
              <p className="max-w-xs text-[11px] text-neutral-400">
                Prueba la calidad del motor antes de crear tu cuenta y{" "}
                <strong>desbloquea {DAILY_LIMIT} imágenes diarias</strong> al
                registrarte. Ideal para portadas, redes sociales y proyectos
                creativos.
              </p>
            </div>

            <p className="mt-4 text-xs text-neutral-500">
              Próximamente: módulos de{" "}
              <span className="font-semibold text-white">video</span> y nuestro
              motor propio de realismo corporal{" "}
              <span className="font-semibold text-white">BodySync v1</span>.
            </p>
          </div>

          {/* Columna galería 4 imágenes */}
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
              isabelaOs Studio está pensado para creadores que necesitan
              resultados con calidad profesional sin complicarse con modelos y
              configuraciones técnicas.
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
              Interfaz simple para escribir un prompt, ajustar resolución y ver
              el resultado generado por el motor conectado a RunPod. Todo se
              ejecuta en la nube para que no necesites una tarjeta gráfica
              potente.
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

        {/* BodySync – imagen grande */}
        <section className="mt-12">
          <h2 className="text-sm font-semibold text-white mb-4">
            Vista previa de BodySync v1 (próximamente)
          </h2>
          <div className="rounded-3xl border border-fuchsia-400/40 bg-black/60 p-5 text-xs text-neutral-300">
            <p className="text-[11px] text-neutral-300 mb-3">
              BodySync será nuestro módulo de realismo corporal: movimientos,
              poses y composición pensados para creadores que necesitan escenas
              con impacto visual. Esta es una imagen generada durante las
              pruebas internas del modelo.
            </p>
            <div className="rounded-2xl border border-white/10 overflow-hidden bg-black/80">
              {/* 👉 Guarda la imagen en public/gallery/bodysync_back_art.png */}
              <img
                src="/gallery/bodysync_back_art.png"
                alt="Ejemplo generado con BodySync"
                className="w-full object-cover"
              />
            </div>
            <p className="mt-3 text-[10px] text-neutral-500">
              Esta imagen es un ejemplo de la dirección artística que buscamos
              con BodySync: escenas dinámicas, iluminación cuidada y nivel de
              detalle cinematográfico.
            </p>
          </div>
        </section>

        {/* Plan de pago */}
        <section className="mt-14 max-w-xl border-t border-white/10 pt-8">
          <h2 className="text-sm font-semibold text-white">
            Plan beta para creadores
          </h2>
          <p className="mt-2 text-xs text-neutral-300">
            Si llegas al límite de <strong>{DAILY_LIMIT}</strong> imágenes
            gratuitas al día (por usuario registrado) y quieres seguir generando
            sin restricciones, puedes activar el plan ilimitado mientras dure la
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
            siguientes (video, BodySync y más).
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
      <div className="min-h-screen grid place-items-center bg-black text-white">
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
