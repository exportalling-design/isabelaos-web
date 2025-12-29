import { useEffect, useMemo, useState } from "react";
import { useAuth } from "./context/AuthContext";

import { supabase } from "./lib/supabaseClient";

import {
  saveGenerationInSupabase,
  loadGenerationsForUser,
  getTodayGenerationCount,
  deleteGenerationFromSupabase,
} from "./lib/generations";

import { PLANS, COSTS } from "./lib/pricing";

// ---------------------------------------------------------
// LÍMITES GLOBALES
// ---------------------------------------------------------
const DEMO_LIMIT = 3; // Invitado
const DAILY_LIMIT = 5; // Beta gratis (logueado)

// ---------------------------------------------------------
// COSTOS DE TOKENS (JADES)
// ---------------------------------------------------------
const COST_VIDEO_FROM_PROMPT = 20;
const COST_IMG2VIDEO = 25;
const COST_XMAS_PHOTO = 10;

// ---------------------------------------------------------
// PayPal – Client ID
// ---------------------------------------------------------
const PAYPAL_CLIENT_ID =
  import.meta.env.VITE_PAYPAL_CLIENT_ID ||
  "AZgwhtDkXVf9N6VrwtWk6dzwzM65DWBrM3dn3Og4DXgZhbxSxqRu1UWdEtbj12W_7ItmcrNhZDI3mtPG";

// ---------------------------------------------------------
// PayPal – Plan IDs (Subscriptions)
// ---------------------------------------------------------
const PAYPAL_PLAN_ID_BASIC = import.meta.env.VITE_PAYPAL_PLAN_ID_BASIC || "";
const PAYPAL_PLAN_ID_PRO = import.meta.env.VITE_PAYPAL_PLAN_ID_PRO || "";

// ---------------------------------------------------------
// Helper scroll suave
// ---------------------------------------------------------
function scrollToId(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------------------------------------------------
// Helpers base64
// ---------------------------------------------------------
function b64ToBlob(b64, contentType = "application/octet-stream") {
  const byteCharacters = atob(String(b64));
  const byteArrays = [];
  const sliceSize = 1024;

  for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
    const slice = byteCharacters.slice(offset, offset + sliceSize);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) byteNumbers[i] = slice.charCodeAt(i);
    byteArrays.push(new Uint8Array(byteNumbers));
  }
  return new Blob(byteArrays, { type: contentType });
}

// ---------------------------------------------------------
// ✅ TOKEN SUPABASE → HEADER AUTH (GLOBAL HELPER)
// ---------------------------------------------------------
async function getAuthHeadersGlobal() {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return {};
    const token = data?.session?.access_token;
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

// ---------------------------------------------------------
// Botón PayPal reutilizable (ORDER / SUBSCRIPTION)
// ---------------------------------------------------------
function PayPalButton({
  mode = "order", // "order" | "subscription"
  amount = "19.00",
  description = "IsabelaOS Studio",
  planId = null,
  customId = null,
  containerId,
  onPaid,
}) {
  const divId = containerId || "paypal-button-container";

  useEffect(() => {
    if (!PAYPAL_CLIENT_ID) {
      console.warn("No hay PAYPAL_CLIENT_ID configurado");
      return;
    }

    const renderButtons = () => {
      if (!window.paypal) return;

      const host = document.getElementById(divId);
      if (host) host.innerHTML = "";

      const common = {
        style: {
          layout: "horizontal",
          color: "black",
          shape: "pill",
          label: "paypal",
        },
        onError: (err) => {
          console.error("Error PayPal:", err);
          alert("Error al conectar con PayPal.");
        },
      };

      if (mode === "subscription") {
        if (!planId) {
          console.warn("PayPalButton: mode=subscription pero falta planId (P-xxxx)");
          const host2 = document.getElementById(divId);
          if (host2)
            host2.innerHTML = `<div style="color:#fff;font-size:12px;padding:6px 10px;">Falta planId de PayPal</div>`;
          return;
        }

        window.paypal
          .Buttons({
            ...common,
            createSubscription: (data, actions) => {
              return actions.subscription.create({
                plan_id: planId,
                ...(customId ? { custom_id: customId } : {}),
              });
            },
            onApprove: async (data, actions) => {
              try {
                const subscriptionID = data?.subscriptionID || null;

                let details = null;
                try {
                  if (actions?.subscription?.get && subscriptionID) {
                    details = await actions.subscription.get();
                  }
                } catch (e) {
                  console.warn("No se pudo obtener detalles de la suscripción:", e);
                }

                console.log("Suscripción PayPal aprobada:", {
                  subscriptionID,
                  details,
                });

                if (typeof onPaid === "function") {
                  await onPaid({
                    type: "subscription",
                    subscriptionID,
                    details,
                    planId,
                    customId: customId || null,
                  });
                } else {
                  alert(
                    "Suscripción creada. En breve se acreditarán tus jades automáticamente cuando el webhook confirme."
                  );
                }
              } catch (err) {
                console.error("Error en aprobación de suscripción PayPal:", err);
                alert("Ocurrió un error al confirmar la suscripción con PayPal.");
              }
            },
          })
          .render(`#${divId}`);

        return;
      }

      window.paypal
        .Buttons({
          ...common,
          createOrder: (data, actions) =>
            actions.order.create({
              purchase_units: [
                {
                  amount: { value: amount, currency_code: "USD" },
                  description,
                },
              ],
            }),
          onApprove: async (data, actions) => {
            try {
              const details = await actions.order.capture();
              console.log("Pago PayPal completado:", details);
              if (typeof onPaid === "function") {
                await onPaid({ type: "order", details });
              } else {
                alert(
                  "Pago completado con PayPal. En la siguiente versión marcaremos automáticamente tu plan como activo."
                );
              }
            } catch (err) {
              console.error("Error al capturar pago PayPal:", err);
              alert("Ocurrió un error al confirmar el pago con PayPal.");
            }
          },
        })
        .render(`#${divId}`);
    };

    const sdkParams =
      mode === "subscription"
        ? `client-id=${PAYPAL_CLIENT_ID}&currency=USD&vault=true&intent=subscription`
        : `client-id=${PAYPAL_CLIENT_ID}&currency=USD`;

    const sdkSrc = `https://www.paypal.com/sdk/js?${sdkParams}`;
    const existingScript = document.querySelector(`script[src="${sdkSrc}"]`);

    if (existingScript) {
      if (window.paypal) renderButtons();
      else existingScript.addEventListener("load", renderButtons);
      return;
    }

    const script = document.createElement("script");
    script.src = sdkSrc;
    script.async = true;
    script.onload = renderButtons;
    document.body.appendChild(script);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, divId, onPaid, description, mode, planId, customId]);

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
        alert("Cuenta creada. Si Supabase lo requiere, revisa tu correo para confirmar la cuenta.");
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
      onClose();
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
          <button onClick={onClose} className="rounded-lg px-3 py-1 text-neutral-400 hover:bg-white/10">
            ✕
          </button>
        </div>

        <p className="mt-2 text-xs text-neutral-400">
          Usa tu correo o entra con Google para acceder al motor de producción visual.
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
// CreatorPanel (RunPod) ✅ UNA SOLA VERSIÓN
// ---------------------------------------------------------
function CreatorPanel({ isDemo = false, onAuthRequired }) {
  const { user } = useAuth();

  const userLoggedIn = !isDemo && !!user;

  const [prompt, setPrompt] = useState("Cinematic portrait, ultra detailed, soft light, 8k");
  const [negative, setNegative] = useState("blurry, low quality, deformed, watermark, text");
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);
  const [steps, setSteps] = useState(22);

  const [status, setStatus] = useState("IDLE");
  const [statusText, setStatusText] = useState("Listo para ejecutar el motor.");
  const [imageB64, setImageB64] = useState(null);
  const [error, setError] = useState("");

  const [dailyCount, setDailyCount] = useState(0);
  const [demoCount, setDemoCount] = useState(0);

  useEffect(() => {
    if (!userLoggedIn) {
      setDailyCount(0);
      return;
    }
    (async () => {
      try {
        const countToday = await getTodayGenerationCount(user.id);
        setDailyCount(countToday || 0);
      } catch (e) {
        console.error("Error leyendo dailyCount:", e);
        setDailyCount(0);
      }
    })();
  }, [userLoggedIn, user?.id]);

  useEffect(() => {
    if (!isDemo) return;
    try {
      const stored = localStorage.getItem("isabelaos_demo_count") || "0";
      setDemoCount(Number(stored));
    } catch (e) {
      console.warn("Error leyendo demo count:", e);
    }
  }, [isDemo]);

  const currentLimit = isDemo ? DEMO_LIMIT : DAILY_LIMIT;
  const currentCount = isDemo ? demoCount : dailyCount;
  const remaining = Math.max(0, currentLimit - currentCount);

  const disabled =
    status === "IN_QUEUE" ||
    status === "IN_PROGRESS" ||
    (!isDemo && !userLoggedIn) ||
    currentCount >= currentLimit;

  const getAuthHeaders = async () => {
    if (isDemo) return {};
    return await getAuthHeadersGlobal();
  };

  const handleGenerate = async () => {
    setError("");

    if (!isDemo && !userLoggedIn) {
      onAuthRequired?.();
      return;
    }

    if (currentCount >= currentLimit) {
      setStatus("ERROR");
      setStatusText("Límite de generación alcanzado.");

      if (isDemo && onAuthRequired) {
        alert(
          `Has agotado tus ${DEMO_LIMIT} pruebas. Crea tu cuenta GRATIS para obtener ${DAILY_LIMIT} renders al día, guardar tu historial y descargar.`
        );
        onAuthRequired();
      } else if (userLoggedIn) {
        setError(
          `Has llegado al límite de ${DAILY_LIMIT} renders gratuitos por hoy. Activa una suscripción mensual para generar sin límite.`
        );
      }
      return;
    }

    setImageB64(null);
    setStatus("IN_QUEUE");
    setStatusText("Enviando job a RunPod...");

    try {
      const authHeaders = await getAuthHeaders();

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({
          prompt,
          negative_prompt: negative,
          width: Number(width),
          height: Number(height),
          steps: Number(steps),
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Error en /api/generate, revisa logs.");
      }

      const jobId = data.jobId;
      setStatus("IN_PROGRESS");
      setStatusText(`Job enviado. ID: ${jobId}. Consultando estado...`);

      let finished = false;
      while (!finished) {
        await new Promise((r) => setTimeout(r, 2000));

        const authHeaders2 = await getAuthHeaders();
        const statusRes = await fetch(`/api/status?id=${jobId}`, {
          headers: { ...authHeaders2 },
        });

        const statusData = await statusRes.json().catch(() => null);
        if (!statusRes.ok || statusData?.error) {
          throw new Error(statusData?.error || "Error consultando /api/status.");
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
            const next = demoCount + 1;
            setDemoCount(next);
            localStorage.setItem("isabelaos_demo_count", String(next));
          } else if (userLoggedIn) {
            setDailyCount((prev) => prev + 1);

            const dataUrl = `data:image/png;base64,${b64}`;
            saveGenerationInSupabase({
              userId: user.id,
              imageUrl: dataUrl,
              prompt,
              negativePrompt: negative,
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
      setError(err?.message || String(err));
    }
  };

  const handleDownload = () => {
    if (isDemo) {
      alert("Para descargar, por favor crea tu cuenta o inicia sesión.");
      onAuthRequired?.();
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

  if (!userLoggedIn && !isDemo) {
    return (
      <div className="rounded-3xl border border-yellow-400/30 bg-yellow-500/5 p-6 text-center text-sm text-yellow-100">
        <p className="font-medium">Debes iniciar sesión para usar el motor de producción visual.</p>
        <p className="mt-1 text-xs text-yellow-200/80">Desde tu cuenta podrás ejecutar renders con el motor conectado a GPU.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">Motor de imagen · Producción visual</h2>

        {isDemo && (
          <div className="mt-4 rounded-2xl border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-[11px] text-cyan-100">
            Modo demo: te quedan {remaining} outputs sin registrarte. Descarga y biblioteca requieren cuenta.
          </div>
        )}

        {!isDemo && remaining <= 2 && remaining > 0 && (
          <div className="mt-4 rounded-2xl border border-yellow-400/40 bg-yellow-500/10 px-4 py-2 text-[11px] text-yellow-100">
            Atención: solo te quedan {remaining} renders hoy.
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
                onChange={(e) => setSteps(Number(e.target.value))}
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
                onChange={(e) => setWidth(Number(e.target.value))}
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
                onChange={(e) => setHeight(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="mt-2 rounded-2xl bg-black/50 px-4 py-2 text-xs text-neutral-300">
            Estado actual: {statusText || "Listo para ejecutar el motor."}
            <br />
            <span className="text-[11px] text-neutral-400">
              Uso: {currentCount} / {currentLimit}
            </span>
          </div>

          {error && <p className="whitespace-pre-line text-xs text-red-400">{error}</p>}

          <button
            onClick={handleGenerate}
            disabled={disabled}
            className="mt-4 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {currentCount >= currentLimit
              ? "Límite alcanzado"
              : status === "IN_QUEUE" || status === "IN_PROGRESS"
              ? "Ejecutando..."
              : isDemo
              ? "Generar (Demo)"
              : "Ejecutar render en el motor"}
          </button>
        </div>
      </div>

      <div className="flex flex-col rounded-3xl border border-white/10 bg-black/40 p-6">
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
            {isDemo ? "Descargar (Requiere crear cuenta)" : "Descargar resultado"}
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
        if (mapped.length > 0) setSelected(mapped[0]);
      } catch (e) {
        console.error("Error cargando biblioteca:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const handleDeleteSelected = async () => {
    if (!selected || !user) return;
    const ok = window.confirm("¿Seguro que quieres eliminar este resultado? Esto también lo borrará de Supabase.");
    if (!ok) return;

    try {
      setDeleting(true);
      await deleteGenerationFromSupabase(selected.id);
      setItems((prev) => {
        const next = prev.filter((it) => it.id !== selected.id);
        setSelected(next.length > 0 ? next[0] : null);
        return next;
      });
    } catch (e) {
      console.error("Error eliminando:", e);
      alert("No se pudo eliminar. Intenta de nuevo.");
    } finally {
      setDeleting(false);
    }
  };

  if (!user) {
    return (
      <div className="rounded-3xl border border-yellow-400/30 bg-yellow-500/5 p-6 text-center text-sm text-yellow-100">
        Inicia sesión para acceder a tu biblioteca de producción.
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1.1fr_1.4fr]">
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">Biblioteca de producción</h2>
        <p className="mt-1 text-xs text-neutral-400">Resultados guardados por tu cuenta.</p>

        {loading ? (
          <p className="mt-4 text-xs text-neutral-400">Cargando historial...</p>
        ) : items.length === 0 ? (
          <p className="mt-4 text-xs text-neutral-400">Aún no tienes resultados guardados.</p>
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
            <img src={selected.src} alt="Seleccionada" className="h-full w-full rounded-2xl object-contain" />
          ) : (
            <p>Selecciona un resultado para verlo.</p>
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
// Video desde prompt (logueado) ✅ AUTH + spend jades
// ---------------------------------------------------------
function VideoFromPromptPanel({ userStatus, spendJades }) {
  const { user } = useAuth();

  const [prompt, setPrompt] = useState("Cinematic short scene, ultra detailed, soft light, 8k");
  const [negative, setNegative] = useState("blurry, low quality, deformed, watermark, text");
  const [steps, setSteps] = useState(25);

  const [status, setStatus] = useState("IDLE");
  const [statusText, setStatusText] = useState("");
  const [jobId, setJobId] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [error, setError] = useState("");

  const canUse = !!user;
  const cost = COST_VIDEO_FROM_PROMPT;
  const currentJades = userStatus?.jades ?? 0;
  const hasEnough = currentJades >= cost;

  const pollVideoStatus = async (job_id) => {
    const auth = await getAuthHeadersGlobal();
    const r = await fetch(`/api/video-status?job_id=${encodeURIComponent(job_id)}`, {
      headers: { ...auth },
    });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data) throw new Error(data?.error || "Error /api/video-status");
    return data;
  };

  const spendJadesFallback = async ({ amount, reason }) => {
    const auth = await getAuthHeadersGlobal();
    if (!auth.Authorization) throw new Error("No hay sesión/token.");

    const r = await fetch("/api/jades-spend", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({
        user_id: user?.id || null,
        amount: Number(amount),
        reason: reason || "spend",
      }),
    });

    const data = await r.json().catch(() => null);
    if (!r.ok || !data?.ok) throw new Error(data?.error || "No se pudo descontar jades.");
    return data;
  };

  const handleGenerateVideo = async () => {
    setError("");
    setVideoUrl(null);
    setJobId(null);

    if (!canUse) {
      setStatus("ERROR");
      setStatusText("Debes iniciar sesión.");
      setError("Debes iniciar sesión para usar el motor de video.");
      return;
    }

    setStatus("IN_QUEUE");
    setStatusText("Enviando job de video a RunPod...");

    try {
      if (!hasEnough) {
        setStatus("ERROR");
        setStatusText("No tienes jades suficientes.");
        setError(`Necesitas ${cost} jades para generar este video.`);
        return;
      }

      if (typeof spendJades === "function") {
        await spendJades({ amount: cost, reason: "video_from_prompt" });
      } else {
        await spendJadesFallback({ amount: cost, reason: "video_from_prompt" });
      }

      const auth = await getAuthHeadersGlobal();
      if (!auth.Authorization) throw new Error("No hay sesión/token.");

      const res = await fetch("/api/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({
          user_id: user?.id || null,
          prompt,
          negative_prompt: negative,
          steps: Number(steps),
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data?.job_id) {
        throw new Error(data?.error || "Error /api/generate-video");
      }

      const jid = data.job_id;
      setJobId(jid);
      setStatus("IN_PROGRESS");
      setStatusText(`Job enviado. ID: ${jid}. Generando...`);

      let finished = false;
      while (!finished) {
        await new Promise((r) => setTimeout(r, 3000));
        const stData = await pollVideoStatus(jid);

        const st = stData.status || stData.state || stData.job_status || stData.phase || "IN_PROGRESS";

        setStatus(st);
        setStatusText(`Estado actual: ${st}...`);

        if (["IN_QUEUE", "IN_PROGRESS", "DISPATCHED", "QUEUED", "RUNNING"].includes(st)) continue;

        finished = true;

        const out = stData.output || stData.result || stData.data || null;
        const maybeUrl =
          out?.video_url || out?.url || out?.mp4_url || out?.video || stData.video_url || stData.url || null;

        if (["COMPLETED", "DONE", "SUCCESS", "FINISHED"].includes(st)) {
          if (maybeUrl) {
            setVideoUrl(maybeUrl);
            setStatusText("Video generado con éxito.");
          } else {
            const b64 = out?.video_b64 || out?.mp4_b64 || stData.video_b64 || null;
            if (!b64) throw new Error("Terminado pero sin video.");
            const blob = b64ToBlob(b64, "video/mp4");
            setVideoUrl(URL.createObjectURL(blob));
            setStatusText("Video generado con éxito.");
          }
        } else {
          throw new Error(stData.error || "Error al generar el video.");
        }
      }
    } catch (err) {
      console.error(err);
      setStatus("ERROR");
      setStatusText("Error al generar el video.");
      setError(err?.message || String(err));
    }
  };

  const handleDownload = async () => {
    if (!videoUrl) return;
    const link = document.createElement("a");
    link.href = videoUrl;
    link.download = "isabelaos-video.mp4";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!canUse) {
    return (
      <div className="rounded-3xl border border-yellow-400/30 bg-yellow-500/5 p-6 text-center text-sm text-yellow-100">
        Debes iniciar sesión para usar el motor de video.
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">Motor de video · Producción de clips</h2>

        <div className="mt-4 rounded-2xl border border-white/10 bg-black/50 px-4 py-2 text-xs text-neutral-300">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Estado: {statusText || "Listo."}</span>
            <span className="text-[11px] text-neutral-400">
              Jades: <span className="font-semibold text-white">{userStatus?.jades ?? "..."}</span>
            </span>
          </div>
          <div className="mt-1 text-[11px] text-neutral-400">
            Costo: <span className="font-semibold text-white">{cost}</span> jades por video
          </div>
          {jobId && <div className="mt-1 text-[10px] text-neutral-500">Job: {jobId}</div>}
        </div>

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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-neutral-300">Steps</label>
              <input
                type="number"
                min={5}
                max={60}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
                value={steps}
                onChange={(e) => setSteps(Number(e.target.value))}
              />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={handleGenerateVideo}
                disabled={status === "IN_QUEUE" || status === "IN_PROGRESS" || !hasEnough}
                className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {status === "IN_QUEUE" || status === "IN_PROGRESS"
                  ? "Generando..."
                  : !hasEnough
                  ? "Sin jades"
                  : "Generar video"}
              </button>
            </div>
          </div>

          {error && <p className="text-xs text-red-400 whitespace-pre-line">{error}</p>}
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-black/40 p-6 flex flex-col">
        <h2 className="text-lg font-semibold text-white">Resultado</h2>
        <div className="mt-4 flex h-[420px] flex-1 items-center justify-center rounded-2xl bg-black/70 text-sm text-neutral-400">
          {videoUrl ? (
            <video src={videoUrl} controls className="h-full w-full rounded-2xl object-contain" />
          ) : (
            <p>Aquí verás el video cuando termine.</p>
          )}
        </div>
        {videoUrl && (
          <button
            onClick={handleDownload}
            className="mt-4 w-full rounded-2xl border border-white/30 py-2 text-xs text-white hover:bg-white/10"
          >
            Descargar video
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// Imagen -> Video (logueado)
// ---------------------------------------------------------
function Img2VideoPanel({ userStatus, spendJades }) {
  const { user } = useAuth();

  const [dataUrl, setDataUrl] = useState(null);
  const [pureB64, setPureB64] = useState(null);
  const [imageUrl, setImageUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [steps, setSteps] = useState(25);

  const [status, setStatus] = useState("IDLE");
  const [statusText, setStatusText] = useState("");
  const [jobId, setJobId] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [error, setError] = useState("");

  const canUse = !!user;
  const cost = COST_IMG2VIDEO;
  const currentJades = userStatus?.jades ?? 0;
  const hasEnough = currentJades >= cost;

  const fileInputId = "img2video-file-input";

  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });

  const handlePickFile = () => {
    const input = document.getElementById(fileInputId);
    if (input) input.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const durl = await fileToBase64(file);
      setDataUrl(durl);
      const parts = String(durl).split(",");
      setPureB64(parts[1] || null);
      setImageUrl("");
    } catch (err) {
      console.error(err);
      setError("No se pudo leer la imagen.");
    }
  };

  const pollVideoStatus = async (job_id) => {
    const auth = await getAuthHeadersGlobal();
    const r = await fetch(`/api/video-status?job_id=${encodeURIComponent(job_id)}`, {
      headers: { ...auth },
    });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data) throw new Error(data?.error || "Error /api/video-status");
    return data;
  };

  const spendJadesFallback = async ({ amount, reason }) => {
    const auth = await getAuthHeadersGlobal();
    if (!auth.Authorization) throw new Error("No hay sesión/token.");
    const r = await fetch("/api/jades-spend", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({
        user_id: user?.id || null,
        amount: Number(amount),
        reason: reason || "spend",
      }),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data?.ok) throw new Error(data?.error || "No se pudo descontar jades.");
    return data;
  };

  const handleGenerate = async () => {
    setError("");
    setVideoUrl(null);
    setJobId(null);

    if (!canUse) {
      setStatus("ERROR");
      setStatusText("Debes iniciar sesión.");
      setError("Debes iniciar sesión para usar Imagen → Video.");
      return;
    }

    setStatus("IN_QUEUE");
    setStatusText("Enviando Imagen → Video a RunPod...");

    try {
      if (!hasEnough) {
        setStatus("ERROR");
        setStatusText("Sin jades.");
        setError(`Necesitas ${cost} jades.`);
        return;
      }

      if (!pureB64 && !imageUrl) {
        setStatus("ERROR");
        setStatusText("Falta imagen.");
        setError("Sube una imagen o pega una URL.");
        return;
      }

      if (typeof spendJades === "function") {
        await spendJades({ amount: cost, reason: "img2video" });
      } else {
        await spendJadesFallback({ amount: cost, reason: "img2video" });
      }

      const auth = await getAuthHeadersGlobal();
      if (!auth.Authorization) throw new Error("No hay sesión/token.");

      const res = await fetch("/api/generate-img2video", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({
          user_id: user?.id || null,
          prompt: prompt || "",
          negative_prompt: negative || "",
          steps: Number(steps),
          image_b64: pureB64 || null,
          image_url: imageUrl || null,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data?.job_id) {
        throw new Error(data?.error || "Error /api/generate-img2video");
      }

      const jid = data.job_id;
      setJobId(jid);
      setStatus("IN_PROGRESS");
      setStatusText(`Job enviado. ID: ${jid}. Generando...`);

      let finished = false;
      while (!finished) {
        await new Promise((r) => setTimeout(r, 3000));
        const stData = await pollVideoStatus(jid);

        const st = stData.status || stData.state || stData.job_status || stData.phase || "IN_PROGRESS";

        setStatus(st);
        setStatusText(`Estado actual: ${st}...`);

        if (["IN_QUEUE", "IN_PROGRESS", "DISPATCHED", "QUEUED", "RUNNING"].includes(st)) continue;

        finished = true;

        const out = stData.output || stData.result || stData.data || null;
        const maybeUrl =
          out?.video_url || out?.url || out?.mp4_url || out?.video || stData.video_url || stData.url || null;

        if (["COMPLETED", "DONE", "SUCCESS", "FINISHED"].includes(st)) {
          if (maybeUrl) {
            setVideoUrl(maybeUrl);
            setStatusText("Video generado con éxito.");
          } else {
            const b64 = out?.video_b64 || out?.mp4_b64 || stData.video_b64 || null;
            if (!b64) throw new Error("Terminado pero sin video.");
            const blob = b64ToBlob(b64, "video/mp4");
            setVideoUrl(URL.createObjectURL(blob));
            setStatusText("Video generado con éxito.");
          }
        } else {
          throw new Error(stData.error || "Error al generar el video.");
        }
      }
    } catch (err) {
      console.error(err);
      setStatus("ERROR");
      setStatusText("Error al generar el video.");
      setError(err?.message || String(err));
    }
  };

  const handleDownload = async () => {
    if (!videoUrl) return;
    const link = document.createElement("a");
    link.href = videoUrl;
    link.download = "isabelaos-img2video.mp4";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!canUse) {
    return (
      <div className="rounded-3xl border border-yellow-400/30 bg-yellow-500/5 p-6 text-center text-sm text-yellow-100">
        Debes iniciar sesión para usar Imagen → Video.
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">Transformación visual · Imagen a video</h2>

        <div className="mt-4 rounded-2xl border border-white/10 bg-black/50 px-4 py-2 text-xs text-neutral-300">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Estado: {statusText || "Listo."}</span>
            <span className="text-[11px] text-neutral-400">
              Jades: <span className="font-semibold text-white">{userStatus?.jades ?? "..."}</span>
            </span>
          </div>
          <div className="mt-1 text-[11px] text-neutral-400">
            Costo: <span className="font-semibold text-white">{cost}</span> jades por video
          </div>
          {jobId && <div className="mt-1 text-[10px] text-neutral-500">Job: {jobId}</div>}
        </div>

        <div className="mt-4 space-y-4 text-sm">
          <div>
            <p className="text-xs text-neutral-300">1. Sube tu imagen</p>
            <button
              type="button"
              onClick={handlePickFile}
              className="mt-2 flex h-40 w-full items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/60 text-xs text-neutral-400 hover:border-cyan-400 hover:text-cyan-300"
            >
              {dataUrl ? "Cambiar imagen" : "Haz clic para subir una imagen"}
            </button>
            <input id={fileInputId} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
            {dataUrl && (
              <div className="mt-3 overflow-hidden rounded-2xl border border-white/10">
                <img src={dataUrl} alt="Imagen base" className="w-full object-cover" />
              </div>
            )}
          </div>

          <div>
            <p className="text-xs text-neutral-300">o pega una URL</p>
            <input
              type="text"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://..."
              className="mt-2 w-full rounded-2xl bg-black/60 px-3 py-2 text-xs text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
            />
          </div>

          <div>
            <label className="text-neutral-300">Prompt (opcional)</label>
            <textarea
              className="mt-1 h-20 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>

          <div>
            <label className="text-neutral-300">Negative (opcional)</label>
            <textarea
              className="mt-1 h-16 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              value={negative}
              onChange={(e) => setNegative(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-neutral-300">Steps</label>
              <input
                type="number"
                min={5}
                max={60}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
                value={steps}
                onChange={(e) => setSteps(Number(e.target.value))}
              />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={status === "IN_QUEUE" || status === "IN_PROGRESS" || !hasEnough}
                className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {status === "IN_QUEUE" || status === "IN_PROGRESS"
                  ? "Generando..."
                  : !hasEnough
                  ? "Sin jades"
                  : "Generar Imagen → Video"}
              </button>
            </div>
          </div>

          {error && <p className="text-xs text-red-400 whitespace-pre-line">{error}</p>}
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-black/40 p-6 flex flex-col">
        <h2 className="text-lg font-semibold text-white">Resultado</h2>
        <div className="mt-4 flex h-[420px] flex-1 items-center justify-center rounded-2xl bg-black/70 text-sm text-neutral-400">
          {videoUrl ? (
            <video src={videoUrl} controls className="h-full w-full rounded-2xl object-contain" />
          ) : (
            <p>Aquí verás el video cuando termine.</p>
          )}
        </div>
        {videoUrl && (
          <button
            onClick={handleDownload}
            className="mt-4 w-full rounded-2xl border border-white/30 py-2 text-xs text-white hover:bg-white/10"
          >
            Descargar video
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// Foto Navideña IA (Premium)
// ---------------------------------------------------------
function XmasPhotoPanel({ userStatus }) {
  const { user } = useAuth();

  const [dataUrl, setDataUrl] = useState(null);
  const [pureB64, setPureB64] = useState(null);
  const [extraPrompt, setExtraPrompt] = useState("");
  const [status, setStatus] = useState("IDLE");
  const [statusText, setStatusText] = useState("");
  const [resultB64, setResultB64] = useState(null);
  const [error, setError] = useState("");

  const isPremium = !!user && userStatus?.subscription_status === "active";
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
      const durl = await fileToBase64(file);
      setDataUrl(durl);
      const parts = String(durl).split(",");
      setPureB64(parts[1] || null);
    } catch (err) {
      console.error(err);
      setError("No se pudo leer la imagen.");
    }
  };

  const handleGenerateXmas = async () => {
    setError("");

    if (!user) {
      setError("Debes iniciar sesión para usar este módulo.");
      return;
    }
    if (!isPremium) {
      setError(
        "Este módulo forma parte del Plan Basic (US$19/mes). Activa tu plan para usar Foto Navideña IA."
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
      const auth = await getAuthHeadersGlobal();

      const res = await fetch("/api/generate-xmas", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({
          image_b64: pureB64,
          description: extraPrompt || "",
          cost: COST_XMAS_PHOTO,
        }),
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

        const auth2 = await getAuthHeadersGlobal();
        const statusRes = await fetch(`/api/status?id=${jobId}`, {
          headers: { ...auth2 },
        });
        const statusData = await statusRes.json().catch(() => null);

        if (!statusRes.ok || !statusData) {
          throw new Error(statusData?.error || "Error consultando /api/status.");
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
          throw new Error("Job terminado pero sin imagen.");
        }
      }
    } catch (err) {
      console.error(err);
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

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">Foto Navideña IA (Premium)</h2>

        <div className="mt-5 space-y-4 text-sm">
          <div>
            <p className="text-xs text-neutral-300">1. Sube tu foto (JPG/PNG)</p>
            <button
              type="button"
              onClick={handlePickFile}
              className="mt-2 flex h-40 w-full items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/60 text-xs text-neutral-400 hover:border-cyan-400 hover:text-cyan-300"
            >
              {dataUrl ? "Cambiar foto" : "Haz clic para subir una foto"}
            </button>
            <input id={fileInputId} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
            {dataUrl && (
              <div className="mt-3 overflow-hidden rounded-2xl border border-white/10">
                <img src={dataUrl} alt="Foto base" className="w-full object-cover" />
              </div>
            )}
          </div>

          <div>
            <p className="text-xs text-neutral-300">2. Opcional: describe escena</p>
            <input
              type="text"
              value={extraPrompt}
              onChange={(e) => setExtraPrompt(e.target.value)}
              placeholder="Ejemplo: familia, sala acogedora, árbol de navidad..."
              className="mt-2 w-full rounded-2xl bg-black/60 px-3 py-2 text-xs text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
            />
          </div>

          <div className="mt-2 rounded-2xl bg-black/50 px-4 py-2 text-xs text-neutral-300">Estado: {statusText || "Listo."}</div>

          {error && <p className="text-xs text-red-400 whitespace-pre-line">{error}</p>}

          <button
            type="button"
            onClick={handleGenerateXmas}
            disabled={status === "IN_QUEUE" || status === "IN_PROGRESS" || !pureB64 || !user}
            className="mt-3 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {status === "IN_QUEUE" || status === "IN_PROGRESS" ? "Generando..." : `Generar Foto Navideña IA (${COST_XMAS_PHOTO} jades)`}
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-black/40 p-6 flex flex-col">
        <h2 className="text-lg font-semibold text-white">Resultado</h2>
        <div className="mt-4 flex h-[420px] flex-1 items-center justify-center rounded-2xl bg-black/70 text-sm text-neutral-400">
          {resultB64 ? (
            <img
              src={`data:image/png;base64,${resultB64}`}
              alt="Resultado navideño"
              className="h-full w-full rounded-2xl object-contain"
            />
          ) : (
            <p>Aquí verás el resultado cuando termine.</p>
          )}
        </div>
        {resultB64 && (
          <button
            onClick={handleDownload}
            className="mt-4 w-full rounded-2xl border border-white/30 py-2 text-xs text-white hover:bg-white/10"
          >
            Descargar resultado
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// Dashboard (logueado)
// ---------------------------------------------------------
function DashboardView() {
  const { user, isAdmin, signOut } = useAuth();
  const [appViewMode, setAppViewMode] = useState("generator");

  const [userStatus, setUserStatus] = useState({
    loading: true,
    plan: null,
    subscription_status: "none",
    jades: 0,
  });

  const fetchUserStatus = async () => {
    if (!user?.id) return;
    try {
      const auth = await getAuthHeadersGlobal();

      const r = await fetch(`/api/user-status?user_id=${encodeURIComponent(user.id)}`, {
        headers: { ...auth },
      });

      const data = await r.json().catch(() => null);
      if (!r.ok || !data?.ok) throw new Error(data?.error || "user-status error");

      setUserStatus({
        loading: false,
        plan: data.plan,
        subscription_status: data.subscription_status,
        jades: data.jades ?? 0,
      });
    } catch (e) {
      console.warn("Error user-status:", e);
      setUserStatus((prev) => ({ ...prev, loading: false }));
    }
  };

  useEffect(() => {
    if (!user?.id) return;
    fetchUserStatus();
    const t = setInterval(fetchUserStatus, 15000);
    return () => clearInterval(t);
  }, [user?.id]);

  const spendJades = async ({ amount, reason }) => {
    if (!user?.id) throw new Error("No user");

    const auth = await getAuthHeadersGlobal();
    const r = await fetch("/api/jades-spend", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({
        user_id: user.id,
        amount: Number(amount),
        reason: reason || "spend",
      }),
    });

    const data = await r.json().catch(() => null);
    if (!r.ok || !data?.ok) throw new Error(data?.error || "No se pudo descontar jades.");

    await fetchUserStatus();
    return data;
  };

  const userPlanLabel = useMemo(() => {
    if (userStatus.loading) return "Cargando...";
    if (userStatus.subscription_status === "active" && userStatus.plan) {
      return `Usuario beta – Plan ${userStatus.plan} activo (sin límite)`;
    }
    return "Usuario beta – Plan Basic activo (sin límite)";
  }, [userStatus.loading, userStatus.subscription_status, userStatus.plan]);

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

            <div className="hidden md:flex items-center gap-2 rounded-2xl border border-white/10 bg-black/60 px-3 py-1.5">
              <span className="text-[10px] text-neutral-400">{userPlanLabel}</span>
              <span className="mx-1 h-3 w-px bg-white/10" />
              <span className="text-[11px] text-neutral-300">
                Jades:{" "}
                <span className="font-semibold text-white">{userStatus.loading ? "..." : userStatus.jades ?? 0}</span>
              </span>
            </div>

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
        <div className="mb-4 md:hidden">
          <div className="mb-3 rounded-2xl border border-white/10 bg-black/60 px-4 py-2 text-[11px] text-neutral-300">
            <div className="flex items-center justify-between gap-2">
              <span className="text-neutral-400">{userPlanLabel}</span>
              <span className="font-semibold text-white">Jades: {userStatus.loading ? "..." : userStatus.jades ?? 0}</span>
            </div>
          </div>

          <p className="text-[11px] font-semibold text-neutral-300 mb-2">Navegación</p>
          <div className="flex flex-wrap gap-2 text-xs">
            {[
              ["generator", "Motor de imagen"],
              ["video_prompt", "Motor de video"],
              ["img2video", "Imagen → Video"],
              ["library", "Biblioteca"],
              ["xmas", "🎄 Foto Navideña IA"],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setAppViewMode(key)}
                className={`rounded-2xl px-3 py-1.5 ${
                  appViewMode === key
                    ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                    : "bg-white/5 text-neutral-200 hover:bg-white/10"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <section className="flex gap-6">
          <aside className="hidden md:flex w-56 flex-col rounded-3xl border border-white/10 bg-black/60 p-4 text-xs">
            <p className="text-[11px] font-semibold text-neutral-300 mb-3">Navegación</p>

            {[
              ["generator", "Motor de imagen (render)"],
              ["video_prompt", "Motor de video (clips)"],
              ["img2video", "Transformación Imagen → Video"],
              ["library", "Biblioteca de producción"],
              ["xmas", "🎄 Foto Navideña IA (Premium)"],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setAppViewMode(key)}
                className={`mb-2 w-full rounded-2xl px-3 py-2 text-left ${
                  appViewMode === key
                    ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                    : "bg-white/5 text-neutral-200 hover:bg-white/10"
                }`}
              >
                {label}
              </button>
            ))}
          </aside>

          <div className="flex-1 space-y-6">
            <div>
              <h1 className="text-xl font-semibold text-white">Panel del creador</h1>
              <p className="mt-1 text-xs text-neutral-400">
                Genera, revisa, descarga y administra resultados desde un solo sistema conectado a GPU.
              </p>
            </div>

            {/* Planes / Suscripción */}
            <section className="rounded-3xl border border-white/10 bg-black/60 p-6">
              <div className="flex flex-col gap-2">
                <h2 className="text-lg font-semibold text-white">Planes</h2>
                <p className="text-xs text-neutral-400">
                  Suscripción mensual. Al activarse, el sistema acreditará tus jades automáticamente por webhook.
                </p>
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-xs text-neutral-300">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Estado:{" "}
                    <span className="font-semibold text-white">{userStatus.loading ? "..." : userStatus.subscription_status}</span>
                  </span>

                  <span className="text-neutral-400">
                    Plan:{" "}
                    <span className="font-semibold text-white">{userStatus.loading ? "..." : userStatus.plan || "none"}</span>
                  </span>

                  <span className="text-neutral-400">
                    Jades:{" "}
                    <span className="font-semibold text-white">{userStatus.loading ? "..." : userStatus.jades ?? 0}</span>
                  </span>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-3xl border border-white/10 bg-black/40 p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-white">Basic</h3>
                    <span className="text-sm text-neutral-300">$19/mes</span>
                  </div>
                  <p className="mt-2 text-xs text-neutral-400">Ideal para creators en beta. Incluye jades mensuales.</p>

                  <div className="mt-4">
                    {!PAYPAL_PLAN_ID_BASIC ? (
                      <div className="rounded-2xl border border-yellow-400/30 bg-yellow-500/10 p-3 text-xs text-yellow-200">
                        Falta VITE_PAYPAL_PLAN_ID_BASIC en tu .env
                      </div>
                    ) : (
                      <PayPalButton
                        mode="subscription"
                        planId={PAYPAL_PLAN_ID_BASIC}
                        customId={user.id}
                        containerId="pp-sub-basic"
                        onPaid={() => {
                          alert(
                            "Suscripción Basic creada. En breve se acreditan tus jades cuando el webhook confirme."
                          );
                        }}
                      />
                    )}
                  </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-black/40 p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-white">Pro</h3>
                    <span className="text-sm text-neutral-300">$39/mes</span>
                  </div>
                  <p className="mt-2 text-xs text-neutral-400">Más jades y potencia para producción constante.</p>

                  <div className="mt-4">
                    {!PAYPAL_PLAN_ID_PRO ? (
                      <div className="rounded-2xl border border-yellow-400/30 bg-yellow-500/10 p-3 text-xs text-yellow-200">
                        Falta VITE_PAYPAL_PLAN_ID_PRO en tu .env
                      </div>
                    ) : (
                      <PayPalButton
                        mode="subscription"
                        planId={PAYPAL_PLAN_ID_PRO}
                        customId={user.id}
                        containerId="pp-sub-pro"
                        onPaid={() => {
                          alert("Suscripción Pro creada. En breve se acreditan tus jades cuando el webhook confirme.");
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>

              <p className="mt-4 text-[10px] text-neutral-500">
                Nota: si el webhook tarda unos segundos, refresca la página. El crédito de jades se aplica cuando PayPal
                confirma el evento.
              </p>
            </section>

            {appViewMode === "generator" && <CreatorPanel isDemo={false} />}
            {appViewMode === "video_prompt" && <VideoFromPromptPanel userStatus={userStatus} spendJades={spendJades} />}
            {appViewMode === "img2video" && <Img2VideoPanel userStatus={userStatus} spendJades={spendJades} />}
            {appViewMode === "library" && <LibraryView />}
            {appViewMode === "xmas" && <XmasPhotoPanel userStatus={userStatus} />}
          </div>
        </section>
      </main>
    </div>
  );
}

// ---------------------------------------------------------
// Landing: sección de planes
// ---------------------------------------------------------
function PricingSection({ onOpenAuth }) {
  const features = useMemo(
    () => ({
      basic: [
        "Acceso al motor en la web",
        `Incluye ${PLANS?.basic?.included_jades ?? 100} jades / mes`,
        "Biblioteca personal (historial y descargas)",
        "Actualizaciones del motor (beta)",
        "Soporte básico por contacto",
      ],
      pro: [
        "Todo lo de Basic",
        `Incluye ${PLANS?.pro?.included_jades ?? 300} jades / mes`,
        "Más capacidad de generación (prioridad)",
        "Acceso anticipado a nuevas funciones",
        "Soporte prioritario (beta)",
      ],
    }),
    []
  );

  const estimate = (includedJades = 0) => {
    const cImg = Number(COSTS?.img_prompt ?? 1);
    const cVidPrompt = Number(COSTS?.vid_prompt ?? 10);
    const cImg2Vid = Number(COSTS?.vid_img2vid ?? 12);

    const images = cImg > 0 ? Math.floor(includedJades / cImg) : 0;
    const videosPrompt = cVidPrompt > 0 ? Math.floor(includedJades / cVidPrompt) : 0;
    const videosImg2Vid = cImg2Vid > 0 ? Math.floor(includedJades / cImg2Vid) : 0;

    return { images, videosPrompt, videosImg2Vid };
  };

  const estBasic = estimate(PLANS?.basic?.included_jades ?? 100);
  const estPro = estimate(PLANS?.pro?.included_jades ?? 300);

  return (
    <section id="planes" className="mt-16">
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-white">Planes</h3>
            <p className="mt-1 text-xs text-neutral-400">
              Suscripción mensual. Cancela cuando quieras. (Los jades se cargan mensualmente.)
            </p>
          </div>

          <button
            onClick={onOpenAuth}
            className="rounded-2xl border border-white/15 bg-white/5 px-4 py-2 text-xs text-white hover:bg-white/10"
          >
            Ya tengo cuenta → Iniciar sesión
          </button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-black/40 p-6">
            <div className="pointer-events-none absolute -inset-10 -z-10 bg-gradient-to-br from-cyan-500/15 via-transparent to-fuchsia-500/10 blur-2xl" />

            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-white">Plan Basic</p>
                <p className="mt-1 text-[11px] text-neutral-400">
                  Para creadores que quieren entrar al motor y producir de forma constante.
                </p>
              </div>

              <div className="text-right">
                <p className="text-2xl font-semibold text-white">
                  ${PLANS?.basic?.price_usd ?? 19}
                  <span className="text-xs text-neutral-400">/mes</span>
                </p>
                <p className="text-[10px] text-neutral-500">{PLANS?.basic?.included_jades ?? 100} jades incluidos</p>
              </div>
            </div>

            <ul className="mt-4 space-y-2 text-[12px] text-neutral-200">
              {features.basic.map((t) => (
                <li key={t} className="flex gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-cyan-300" />
                  <span className="text-neutral-300">{t}</span>
                </li>
              ))}
            </ul>

            <div className="mt-4 rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-[11px] text-neutral-300">
              <div className="text-neutral-400">Con los jades incluidos puedes generar aprox:</div>
              <div className="mt-1">
                • <span className="text-white font-semibold">{estBasic.images}</span> imágenes
              </div>
              <div>
                • <span className="text-white font-semibold">{estBasic.videosPrompt}</span> videos (desde prompt)
              </div>
              <div>
                • <span className="text-white font-semibold">{estBasic.videosImg2Vid}</span> videos (imagen → video)
              </div>
            </div>

            <div className="mt-5">
              <button
                onClick={onOpenAuth}
                className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white"
              >
                Inicia sesión para suscribirte
              </button>
              <p className="mt-2 text-[10px] text-neutral-500 text-center">
                (El pago solo se realiza dentro de tu cuenta para poder asignar plan y jades al usuario.)
              </p>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-3xl border border-fuchsia-400/25 bg-black/40 p-6">
            <div className="pointer-events-none absolute -inset-10 -z-10 bg-gradient-to-br from-fuchsia-500/18 via-transparent to-violet-500/18 blur-2xl" />

            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-fuchsia-400/30 bg-fuchsia-500/10 px-3 py-1 text-[10px] font-semibold text-fuchsia-200">
                  Recomendado
                </div>
                <p className="mt-2 text-sm font-semibold text-white">Plan Pro</p>
                <p className="mt-1 text-[11px] text-neutral-400">
                  Para usuarios que quieren más jades, más potencia y prioridad en generación.
                </p>
              </div>

              <div className="text-right">
                <p className="text-2xl font-semibold text-white">
                  ${PLANS?.pro?.price_usd ?? 39}
                  <span className="text-xs text-neutral-400">/mes</span>
                </p>
                <p className="text-[10px] text-neutral-500">{PLANS?.pro?.included_jades ?? 300} jades incluidos</p>
              </div>
            </div>

            <ul className="mt-4 space-y-2 text-[12px] text-neutral-200">
              {features.pro.map((t) => (
                <li key={t} className="flex gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-fuchsia-300" />
                  <span className="text-neutral-300">{t}</span>
                </li>
              ))}
            </ul>

            <div className="mt-4 rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-[11px] text-neutral-300">
              <div className="text-neutral-400">Con los jades incluidos puedes generar aprox:</div>
              <div className="mt-1">
                • <span className="text-white font-semibold">{estPro.images}</span> imágenes
              </div>
              <div>
                • <span className="text-white font-semibold">{estPro.videosPrompt}</span> videos (desde prompt)
              </div>
              <div>
                • <span className="text-white font-semibold">{estPro.videosImg2Vid}</span> videos (imagen → video)
              </div>
            </div>

            <div className="mt-5">
              <button
                onClick={onOpenAuth}
                className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white"
              >
                Inicia sesión para suscribirte
              </button>
              <p className="mt-2 text-[10px] text-neutral-500 text-center">
                (El pago solo se realiza dentro de tu cuenta para poder asignar plan y jades al usuario.)
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------
// Landing (no sesión) + demo
// ---------------------------------------------------------
function LandingView({ onOpenAuth, onStartDemo }) {
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactMessage, setContactMessage] = useState("");

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
              <div className="text-[10px] text-neutral-500">Motor de producción visual</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => scrollToId("planes")}
              className="hidden sm:inline rounded-xl border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10"
            >
              Planes
            </button>
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
        <section className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-cyan-400/40 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300/90 shadow-[0_0_25px_rgba(34,211,238,0.35)]">
              <span className="h-1 w-1 rounded-full bg-cyan-300" />
              <span>BETA PRIVADA · MOTOR DE PRODUCCIÓN VISUAL CON IA</span>
            </p>

            <h1 className="mt-3 text-4xl font-semibold leading-tight md:text-5xl">
              Produce contenido visual con IA{" "}
              <span className="block bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-violet-400 bg-clip-text text-transparent">
                como un sistema, no como un experimento.
              </span>
            </h1>

            <div className="mt-3 h-[2px] w-40 rounded-full bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-transparent shadow-[0_0_20px_rgba(168,85,247,0.7)]" />

            <p className="mt-4 max-w-xl text-sm text-neutral-300">
              IsabelaOS Studio es un <strong>motor de producción visual con IA</strong> desarrollado en Guatemala,
              diseñado para creadores, estudios y equipos que necesitan velocidad, consistencia y control creativo.
            </p>

            <p className="mt-3 max-w-xl text-xs text-neutral-400">
              No se trata solo de generar imágenes o videos, sino de construir resultados repetibles dentro de un flujo
              de producción visual.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-4">
              <button
                onClick={onStartDemo}
                className="rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-3 text-sm font-semibold text-white shadow-[0_0_35px_rgba(34,211,238,0.45)] hover:shadow-[0_0_40px_rgba(236,72,153,0.6)] transition-shadow"
              >
                Probar el motor ({DEMO_LIMIT} outputs)
              </button>
              <p className="max-w-xs text-[11px] text-neutral-400">
                Luego crea tu cuenta para desbloquear {DAILY_LIMIT} renders diarios y biblioteca.
              </p>
            </div>
          </div>

          <div className="relative order-first lg:order-last">
            <div className="pointer-events-none absolute -inset-8 -z-10 rounded-[32px] bg-gradient-to-br from-cyan-500/18 via-transparent to-fuchsia-500/25 blur-3xl" />

            <h2 className="text-sm font-semibold text-white mb-3">Calidad de estudio · Render del motor actual</h2>

            <div className="mt-2 grid grid-cols-2 gap-2">
              {["img1.png", "img2.png", "img3.png", "img4.png"].map((p, i) => (
                <div
                  key={p}
                  className={`rounded-2xl border border-white/10 overflow-hidden shadow-xl ${
                    i % 2 === 0 ? "shadow-fuchsia-500/10" : "shadow-cyan-500/10"
                  }`}
                >
                  <img src={`/gallery/${p}?v=2`} alt={p} className="w-full h-auto object-cover" />
                </div>
              ))}
            </div>

            <p className="mt-3 text-[10px] text-neutral-500">
              IsabelaOS Studio · motor de producción visual con IA desarrollado en Guatemala.
            </p>
          </div>
        </section>

        <PricingSection onOpenAuth={onOpenAuth} />

        <section id="contacto" className="mt-16 rounded-3xl border border-white/10 bg-black/40 p-6">
          <h3 className="text-lg font-semibold text-white">Contacto</h3>
          <p className="mt-2 text-xs text-neutral-400">Escríbenos y te respondemos lo antes posible.</p>

          <form onSubmit={handleContactSubmit} className="mt-5 grid gap-3 md:grid-cols-2">
            <input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Nombre"
              className="rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
            />
            <input
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="Correo"
              type="email"
              className="rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
            />
            <textarea
              value={contactMessage}
              onChange={(e) => setContactMessage(e.target.value)}
              placeholder="Mensaje"
              className="md:col-span-2 h-28 resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
            />
            <button type="submit" className="md:col-span-2 rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white">
              Enviar
            </button>
          </form>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-black/30">
        <div className="mx-auto max-w-6xl px-4 py-6 text-center text-[11px] text-neutral-400">
          IsabelaOS 2025 creado por Stalling Technologic Cobán, Alta Verapaz.
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------
// Root App
// ---------------------------------------------------------
export default function App() {
  const { user } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [demoMode, setDemoMode] = useState(false);

  if (user) return <DashboardView />;

  return (
    <>
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />

      {demoMode ? (
        <div className="min-h-screen bg-neutral-950 text-white">
          <div className="mx-auto max-w-6xl px-4 py-8">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">IsabelaOS Studio</p>
                <p className="text-[11px] text-neutral-400">Demo del motor</p>
              </div>
              <button
                onClick={() => setDemoMode(false)}
                className="rounded-2xl border border-white/20 px-4 py-2 text-xs hover:bg-white/10"
              >
                Volver
              </button>
            </div>

            <CreatorPanel isDemo={true} onAuthRequired={() => setAuthOpen(true)} />
          </div>
        </div>
      ) : (
        <LandingView onOpenAuth={() => setAuthOpen(true)} onStartDemo={() => setDemoMode(true)} />
      )}
    </>
  );
}
