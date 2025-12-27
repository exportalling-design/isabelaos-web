import { useState, useEffect, useMemo } from "react";
import { useAuth } from "./context/AuthContext";

import { supabase } from "./lib/supabaseClient"; // ✅ ESTE ES EL QUE FALTABA

import {
  saveGenerationInSupabase,
  loadGenerationsForUser,
  getTodayGenerationCount,
  deleteGenerationFromSupabase,
} from "./lib/generations";

// ---------------------------------------------------------
// LÍMITES GLOBALES
// ---------------------------------------------------------
const DEMO_LIMIT = 3; // Imágenes para usuarios sin registrar (Modo Invitado)
const DAILY_LIMIT = 5; // Imágenes para usuarios registrados (Modo Beta Gratuito)

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
function PayPalButton({
  amount = "19.00",
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

    const renderButtons = () => {
      if (!window.paypal) return;

      // ✅ FIX: limpiar contenedor antes de render para evitar duplicados
      const host = document.getElementById(divId);
      if (host) host.innerHTML = "";

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
                  description,
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
      else existingScript.addEventListener("load", renderButtons);
      return;
    }

    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&currency=USD`;
    script.async = true;
    script.onload = renderButtons;
    document.body.appendChild(script);

    return () => {};
  }, [amount, divId, onPaid, description]);

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
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1 text-neutral-400 hover:bg-white/10"
          >
            ✕
          </button>
        </div>

        <p className="mt-2 text-xs text-neutral-400">
          Usa tu correo o entra con Google para acceder al motor de producción
          visual.
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
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "./context/AuthContext";

import {
  saveGenerationInSupabase,
  getTodayGenerationCount,
} from "./lib/generations";

function CreatorPanel({
  isDemo = false,
  onAuthRequired,
  userStatus,
  onRefreshUserStatus, // para refrescar plan/jades después de pagar o tras generar
}) {
  const { user } = useAuth();

  const userLoggedIn = !isDemo && !!user;

  const [prompt, setPrompt] = useState(
    "Cinematic portrait, ultra detailed, soft light, 8k"
  );
  const [negative, setNegative] = useState(
    "blurry, low quality, deformed, watermark, text"
  );
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);
  const [steps, setSteps] = useState(22);

  const [status, setStatus] = useState("IDLE"); // IDLE | RUNNING | DONE | ERROR
  const [statusText, setStatusText] = useState("Listo para ejecutar el motor.");
  const [imageB64, setImageB64] = useState(null);
  const [error, setError] = useState("");

  // Conteo diario SOLO informativo (NO bloquea)
  const [dailyCount, setDailyCount] = useState(0);

  // Fuente de verdad FINAL:
  // plan: profiles.plan
  // jades: profiles.jade_balance
  const jadeBalance = useMemo(() => {
    if (!userLoggedIn) return 0;
    return typeof userStatus?.jade_balance === "number" ? userStatus.jade_balance : 0;
  }, [userLoggedIn, userStatus]);

  const plan = useMemo(() => {
    if (!userLoggedIn) return "free";
    return typeof userStatus?.plan === "string" ? userStatus.plan : "free";
  }, [userLoggedIn, userStatus]);

  // Premium si NO es free (basic/pro/beta/etc). Ajusta si tu DB usa otros nombres.
  const isPremium = useMemo(() => {
    if (!userLoggedIn) return false;
    return plan && plan.toLowerCase() !== "free";
  }, [userLoggedIn, plan]);

  // Si tienes jades > 0, puedes generar aunque el conteo diga 5/5
  const hasCredits = useMemo(() => {
    if (!userLoggedIn) return false;
    return jadeBalance > 0 || isPremium;
  }, [userLoggedIn, jadeBalance, isPremium]);

  // Demo limit (modo invitado)
  const DEMO_LIMIT = 3;
  const demoKey = "isabelaos_demo_count";
  const demoCount = useMemo(() => {
    if (!isDemo) return 0;
    const v = parseInt(localStorage.getItem(demoKey) || "0", 10);
    return Number.isFinite(v) ? v : 0;
  }, [isDemo]);

  const demoRemaining = Math.max(0, DEMO_LIMIT - demoCount);

  const canGenerate = useMemo(() => {
    if (status === "RUNNING") return false;
    if (isDemo) return demoRemaining > 0;
    if (!userLoggedIn) return false;
    return hasCredits;
  }, [status, isDemo, demoRemaining, userLoggedIn, hasCredits]);

  useEffect(() => {
    let alive = true;

    async function loadDaily() {
      try {
        if (!userLoggedIn || !user?.id) return;
        const c = await getTodayGenerationCount(user.id);
        if (!alive) return;
        setDailyCount(typeof c === "number" ? c : 0);
      } catch {
        // No rompas el panel por esto
      }
    }

    loadDaily();
    return () => {
      alive = false;
    };
  }, [userLoggedIn, user?.id]);

  async function handleGenerate() {
    try {
      setError("");
      setImageB64(null);

      // Si no está logueado (modo normal), pedir auth
      if (!isDemo && !userLoggedIn) {
        onAuthRequired?.();
        return;
      }

      // Validación de demo
      if (isDemo && demoRemaining <= 0) {
        setStatus("ERROR");
        setStatusText("Límite demo alcanzado.");
        return;
      }

      // Validación de créditos
      if (!isDemo && userLoggedIn && !hasCredits) {
        setStatus("ERROR");
        setStatusText("Sin jades o plan activo. Desbloquea tu plan.");
        return;
      }

      setStatus("RUNNING");
      setStatusText("Generando...");

      // 🔥 Endpoint real del motor (ajusta si tu ruta es otra)
      const res = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          negative_prompt: negative,
          width,
          height,
          steps,
        }),
      });

      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        const msg = data?.error || data?.message || `Error ${res.status}`;
        throw new Error(msg);
      }

      const b64 = data?.imageB64 || data?.image_b64 || null;
      if (!b64) throw new Error("La API no devolvió imageB64.");

      setImageB64(b64);
      setStatus("DONE");
      setStatusText("Render completado.");

      // Guardar en Supabase (solo si hay usuario)
      if (!isDemo && userLoggedIn && user?.id) {
        await saveGenerationInSupabase({
          user_id: user.id,
          type: "image",
          prompt,
          negative_prompt: negative,
          width,
          height,
          steps,
          image_b64: b64,
        });
      }

      // Actualiza contador demo
      if (isDemo) {
        const next = demoCount + 1;
        localStorage.setItem(demoKey, String(next));
      }

      // Refrescar plan/jades (importantísimo si descuentas jades en DB)
      await onRefreshUserStatus?.();
    } catch (e) {
      setStatus("ERROR");
      setStatusText("Error en generación.");
      setError(e?.message || "Error desconocido");
    } finally {
      // vuelve a IDLE si quedó en RUNNING con error
      // (si quedó DONE, se queda DONE)
      setTimeout(() => {
        setStatus((s) => (s === "RUNNING" ? "IDLE" : s));
      }, 300);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
      <div
        style={{
          background: "rgba(0,0,0,0.35)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 18,
          padding: 18,
        }}
      >
        <h2 style={{ margin: 0, marginBottom: 12, fontSize: 22 }}>
          Motor de imagen · Producción visual
        </h2>

        <label style={{ display: "block", marginTop: 10, opacity: 0.9 }}>
          Prompt
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          style={{
            width: "100%",
            marginTop: 6,
            borderRadius: 14,
            padding: 12,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(0,0,0,0.35)",
            color: "white",
          }}
        />

        <label style={{ display: "block", marginTop: 14, opacity: 0.9 }}>
          Negative prompt
        </label>
        <textarea
          value={negative}
          onChange={(e) => setNegative(e.target.value)}
          rows={3}
          style={{
            width: "100%",
            marginTop: 6,
            borderRadius: 14,
            padding: 12,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(0,0,0,0.35)",
            color: "white",
          }}
        />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 14 }}>
          <div>
            <div style={{ opacity: 0.85, marginBottom: 6 }}>Steps</div>
            <input
              type="number"
              value={steps}
              onChange={(e) => setSteps(parseInt(e.target.value || "0", 10))}
              style={numStyle}
              min={1}
              max={60}
            />
          </div>
          <div>
            <div style={{ opacity: 0.85, marginBottom: 6 }}>Width</div>
            <input
              type="number"
              value={width}
              onChange={(e) => setWidth(parseInt(e.target.value || "0", 10))}
              style={numStyle}
              min={256}
              max={2048}
              step={64}
            />
          </div>
          <div>
            <div style={{ opacity: 0.85, marginBottom: 6 }}>Height</div>
            <input
              type="number"
              value={height}
              onChange={(e) => setHeight(parseInt(e.target.value || "0", 10))}
              style={numStyle}
              min={256}
              max={2048}
              step={64}
            />
          </div>
        </div>

        <div style={{ marginTop: 14, opacity: 0.9, fontSize: 14 }}>
          <div>Estado actual: {statusText}</div>
          {!isDemo && userLoggedIn && (
            <div style={{ opacity: 0.7 }}>Uso de hoy: {dailyCount} renders (solo informativo)</div>
          )}
          {isDemo && (
            <div style={{ opacity: 0.7 }}>Demo: te quedan {demoRemaining} renders</div>
          )}
          {!isDemo && userLoggedIn && (
            <div style={{ opacity: 0.7 }}>
              Plan: <b>{plan}</b> · Jades: <b>{jadeBalance}</b>
            </div>
          )}
        </div>

        {error ? (
          <div style={{ marginTop: 10, color: "#ff7b7b", fontSize: 14 }}>
            {error}
          </div>
        ) : null}

        <button
          onClick={handleGenerate}
          disabled={!canGenerate}
          style={{
            marginTop: 16,
            width: "100%",
            height: 48,
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.14)",
            background: canGenerate
              ? "linear-gradient(90deg, rgba(0,205,255,0.55), rgba(165,55,255,0.55))"
              : "rgba(255,255,255,0.10)",
            color: "white",
            cursor: canGenerate ? "pointer" : "not-allowed",
            fontWeight: 700,
          }}
        >
          {status === "RUNNING"
            ? "Generando..."
            : isDemo
            ? "Generar (Demo)"
            : userLoggedIn
            ? "Generar imagen"
            : "Inicia sesión para generar"}
        </button>

        {!isDemo && userLoggedIn && !hasCredits ? (
          <div style={{ marginTop: 10, opacity: 0.85, fontSize: 13 }}>
            No tienes jades o plan activo. Desbloquea tu plan para continuar.
          </div>
        ) : null}
      </div>

      <div
        style={{
          background: "rgba(0,0,0,0.35)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 18,
          padding: 18,
          minHeight: 420,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {imageB64 ? (
          <img
            src={imageB64.startsWith("data:") ? imageB64 : `data:image/png;base64,${imageB64}`}
            alt="Resultado"
            style={{ width: "100%", borderRadius: 14, objectFit: "contain" }}
          />
        ) : (
          <div style={{ opacity: 0.6 }}>Aquí verás el resultado en cuanto se complete el render.</div>
        )}
      </div>
    </div>
  );
}

const numStyle = {
  width: "100%",
  height: 44,
  borderRadius: 14,
  padding: "0 12px",
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(0,0,0,0.35)",
  color: "white",
};

export default CreatorPanel;

  // =========================================================
  // ✅ TOKEN SUPABASE → HEADER AUTH
  // =========================================================
  const getAuthHeaders = async () => {
    // En modo demo NO mandamos token
    if (isDemo) return {};

    try {
      const { data, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr) {
        console.warn("supabase.getSession error:", sessionErr);
        return {};
      }

      const token = data?.session?.access_token;
      if (!token) return {};

      return { Authorization: `Bearer ${token}` };
    } catch (e) {
      console.warn("No se pudo obtener token:", e);
      return {};
    }
  };

  const handlePaddleCheckout = async () => {
    if (!userLoggedIn) {
      alert("Por favor, inicia sesión para activar el plan.");
      onAuthRequired && onAuthRequired();
      return;
    }

    try {
      const authHeaders = await getAuthHeaders();

      const res = await fetch("/api/paddle-checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
      });

      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        console.error("Respuesta Paddle:", data);
        alert(
          "Estamos trabajando para poder brindarte el cobro por Paddle, por el momento no está disponible."
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
      try {
        const countToday = await getTodayGenerationCount(user.id);
        setDailyCount(countToday || 0);
      } catch (e) {
        console.error("Error leyendo dailyCount:", e);
        setDailyCount(0);
      }
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

  const handleGenerate = async () => {
    setError("");

    const currentLimit = isDemo ? DEMO_LIMIT : DAILY_LIMIT;
    const currentCount = isDemo ? demoCount : dailyCount;

    if (!isPremium && currentCount >= currentLimit) {
      setStatus("ERROR");
      setStatusText("Límite de generación alcanzado.");

      if (isDemo && onAuthRequired) {
        alert(
          `Has agotado tus ${DEMO_LIMIT} pruebas. Crea tu cuenta GRATIS para obtener ${DAILY_LIMIT} renders al día, guardar tu historial y descargar.`
        );
        onAuthRequired();
      } else if (userLoggedIn) {
        setError(
          `Has llegado al límite de ${DAILY_LIMIT} renders gratuitos por hoy. Activa una suscripción mensual para generar sin límite y desbloquear módulos premium.`
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

        const authHeaders2 = await getAuthHeaders();

        const statusRes = await fetch(`/api/status?id=${jobId}`, {
          headers: { ...authHeaders2 },
        });

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
              prompt: "",
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
      setError(err?.message || String(err));
    }
  };

  const handleDownload = () => {
    if (isDemo) {
      alert(
        "Para descargar tu resultado, por favor, crea tu cuenta o inicia sesión."
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

  if (!userLoggedIn && !isDemo) {
    return (
      <div className="rounded-3xl border border-yellow-400/30 bg-yellow-500/5 p-6 text-center text-sm text-yellow-100">
        <p className="font-medium">
          Debes iniciar sesión para usar el motor de producción visual.
        </p>
        <p className="mt-1 text-xs text-yellow-200/80">
          Desde tu cuenta podrás ejecutar renders con el motor conectado a GPU.{" "}
          {DAILY_LIMIT} renders diarios; si quieres ir más allá, podrás activar
          un plan mensual.
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
          Motor de imagen · Producción visual
        </h2>

        {isDemo && (
          <div className="mt-4 rounded-2xl border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-[11px] text-cyan-100">
            Modo de prueba gratuito: te quedan {remaining} outputs sin
            registrarte. La descarga y la biblioteca requieren crear una cuenta.
          </div>
        )}

        {userLoggedIn && !isPremium && remaining <= 2 && remaining > 0 && (
          <div className="mt-4 rounded-2xl border border-yellow-400/40 bg-yellow-500/10 px-4 py-2 text-[11px] text-yellow-100">
            Atención: solo te quedan {remaining} renders gratis hoy. Activa un
            plan ilimitado para seguir ejecutando el motor y desbloquear módulos
            premium.
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
            Estado actual: {statusText || "Listo para ejecutar el motor."}
            <br />
            <span className="text-[11px] text-neutral-400">
              {isDemo && `Uso de prueba: ${currentCount} / ${currentLimit}.`}
              {userLoggedIn && isPremium && (
                <>
                  Uso de hoy: {currentCount}. Plan activo (sin límite y con
                  acceso a módulos premium).
                </>
              )}
              {userLoggedIn && !isPremium && (
                <>
                  Uso de hoy: {currentCount} / {currentLimit} renders.
                </>
              )}
            </span>
          </div>

          {error && (
            <p className="whitespace-pre-line text-xs text-red-400">{error}</p>
          )}

          <button
            onClick={handleGenerate}
            disabled={
              status === "IN_QUEUE" ||
              status === "IN_PROGRESS" ||
              (!isPremium &&
                (isDemo ? demoCount : dailyCount) >=
                  (isDemo ? DEMO_LIMIT : DAILY_LIMIT))
            }
            className="mt-4 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {!isPremium &&
            (isDemo ? demoCount : dailyCount) >= (isDemo ? DEMO_LIMIT : DAILY_LIMIT)
              ? "Límite alcanzado (Crea cuenta / Desbloquea plan)"
              : status === "IN_QUEUE" || status === "IN_PROGRESS"
              ? "Ejecutando..."
              : "Ejecutar render en el motor"}
          </button>

          {userLoggedIn &&
            !isPremium &&
            (isDemo ? demoCount : dailyCount) >= DAILY_LIMIT && (
              <>
                <button
                  type="button"
                  onClick={handlePaddleCheckout}
                  className="mt-3 w-full rounded-2xl border border-yellow-400/60 py-2 text-xs font-semibold text-yellow-100 hover:bg-yellow-500/10"
                >
                  Desbloquear con IsabelaOS Basic – US$19/mes (tarjeta / Paddle)
                </button>

                <div className="mt-3 text-[11px] text-neutral-400">
                  o pagar con <span className="font-semibold">PayPal</span>:
                  <PayPalButton
                    amount="19.00"
                    description="IsabelaOS Studio – Plan Basic (Mensual)"
                    containerId="paypal-button-panel"
                    onPaid={async () => {
                      alert("Pago completado. Actualizando tu estado...");
                      if (typeof onRefreshUserStatus === "function") {
                        await onRefreshUserStatus();
                      } else {
                        alert(
                          "Pago completado. Tu plan se activará automáticamente en tu cuenta en IsabelaOS Studio."
                        );
                      }
                    }}
                  />
                </div>
              </>
            )}
        </div>
      </div>

      {/* Resultado */}
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
      "¿Seguro que quieres eliminar este resultado de tu biblioteca? Esta acción también lo borrará de Supabase."
    );
    if (!confirmDelete) return;

    try {
      setDeleting(true);
      await deleteGenerationFromSupabase(selected.id);

      // ✅ FIX: evitar estado stale con "items"
      setItems((prevItems) => {
        const next = prevItems.filter((it) => it.id !== selected.id);
        setSelected(next.length > 0 ? next[0] : null);
        return next;
      });
    } catch (e) {
      console.error("Error eliminando imagen de Supabase:", e);
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
        <h2 className="text-lg font-semibold text-white">
          Biblioteca de producción
        </h2>
        <p className="mt-1 text-xs text-neutral-400">
          Aquí se almacenan los resultados generados por el motor como parte de
          tu flujo de producción visual. Puedes seleccionar uno para verlo en
          grande y eliminarlo si ya no lo necesitas.
        </p>

        {loading ? (
          <p className="mt-4 text-xs text-neutral-400">Cargando historial...</p>
        ) : items.length === 0 ? (
          <p className="mt-4 text-xs text-neutral-400">
            Aún no tienes resultados guardados en tu cuenta.
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
            <p>Selecciona un resultado de tu biblioteca para verlo en grande.</p>
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
// ✅ APP SHELL — user-status + jades + topbar + library
// ---------------------------------------------------------
function AppShell() {
  const { user } = useAuth();

  const [authOpen, setAuthOpen] = useState(false);
  const [view, setView] = useState("home"); // home | library
  const [userStatus, setUserStatus] = useState(null);
  const [jades, setJades] = useState(0);

  // =========================
  // AUTH HEADERS (TOKEN)
  // =========================
  const getAuthHeaders = async () => {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) return {};
      const token = data?.session?.access_token;
      if (!token) return {};
      return { Authorization: `Bearer ${token}` };
    } catch {
      return {};
    }
  };

  // =========================
  // USER STATUS + JADES
  // =========================
  const refreshUserStatus = async () => {
    const headers = await getAuthHeaders();
    if (!headers.Authorization) {
      setUserStatus(null);
      setJades(0);
      return;
    }

    try {
      const res = await fetch("/api/user-status", { headers });
      const data = await res.json();

      if (!res.ok || !data?.ok) {
        setUserStatus(null);
        setJades(0);
        return;
      }

      setUserStatus(data);
      setJades(Number(data.jades || 0));
    } catch {
      setUserStatus(null);
      setJades(0);
    }
  };

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      if (!mounted) return;
      if (user) await refreshUserStatus();
      else {
        setUserStatus(null);
        setJades(0);
      }
    };

    run();

    const { data: sub } = supabase.auth.onAuthStateChange(async () => {
      if (!mounted) return;
      await refreshUserStatus();
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, [user]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setView("home");
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />

      {/* Top bar */}
      <div className="sticky top-0 z-40 border-b border-white/10 bg-black/60 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500" />
            <div>
              <p className="text-sm font-semibold">IsabelaOS Studio</p>
              <p className="text-[11px] text-neutral-400">Motor visual · Beta</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2 rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-[11px]">
              <span className="text-neutral-400">Jades:</span>
              <span className="font-semibold">{jades}</span>
              <span className="mx-2 h-4 w-px bg-white/10" />
              <span className="text-neutral-400">Plan:</span>
              <span className="font-semibold">
                {userStatus?.subscription_status === "active" ? "Activo" : "Gratis"}
              </span>
            </div>

            <button
              onClick={() => setView("home")}
              className={`rounded-2xl px-3 py-2 text-xs ${
                view === "home" ? "bg-white/10" : "hover:bg-white/10"
              }`}
            >
              Motor
            </button>

            <button
              onClick={() => setView("library")}
              className={`rounded-2xl px-3 py-2 text-xs ${
                view === "library" ? "bg-white/10" : "hover:bg-white/10"
              }`}
            >
              Biblioteca
            </button>

            <button
              onClick={handleLogout}
              className="rounded-2xl border border-white/10 px-3 py-2 text-xs hover:bg-white/10"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-6xl px-4 py-8">
        {view === "library" ? (
          <LibraryView />
        ) : (
          <CreatorPanel
            isDemo={false}
            onAuthRequired={() => setAuthOpen(true)}
            userStatus={userStatus}
            onRefreshUserStatus={refreshUserStatus}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// Módulo: Video desde prompt (logueado) ✅ CORREGIDO (AUTH + headers)
// ---------------------------------------------------------
function VideoFromPromptPanel({ userStatus, spendJades }) {
  const { user } = useAuth();

  const [prompt, setPrompt] = useState(
    "Cinematic short scene, ultra detailed, soft light, 8k"
  );
  const [negative, setNegative] = useState(
    "blurry, low quality, deformed, watermark, text"
  );
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

  // ✅ AUTH HEADERS
  const getAuthHeaders = async () => {
    try {
      const { data, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr) return {};
      const token = data?.session?.access_token;
      if (!token) return {};
      return { Authorization: `Bearer ${token}` };
    } catch {
      return {};
    }
  };

  // ✅ status poll con AUTH
  const pollVideoStatus = async (job_id) => {
    const auth = await getAuthHeaders();
    const r = await fetch(
      `/api/video-status?job_id=${encodeURIComponent(job_id)}`,
      { headers: { ...auth } }
    );
    const data = await r.json().catch(() => null);
    if (!r.ok || !data) {
      throw new Error(data?.error || "Error consultando /api/video-status");
    }
    return data;
  };

  // ✅ fallback spend jades (si no te pasan spendJades)
  const spendJadesFallback = async ({ amount, reason }) => {
    const auth = await getAuthHeaders();
    if (!auth.Authorization) throw new Error("No hay sesión/token para descontar jades.");

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
    if (!r.ok || !data?.ok) {
      throw new Error(data?.error || "No se pudo descontar jades.");
    }
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

      // ✅ Descontar jades (con AUTH)
      if (typeof spendJades === "function") {
        await spendJades({ amount: cost, reason: "video_from_prompt" });
      } else {
        await spendJadesFallback({ amount: cost, reason: "video_from_prompt" });
      }

      const auth = await getAuthHeaders();
      if (!auth.Authorization) {
        throw new Error("No hay sesión/token. Cierra sesión e inicia de nuevo.");
      }

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
        throw new Error(
          data?.error || "Error en /api/generate-video, revisa los logs."
        );
      }

      const jid = data.job_id;
      setJobId(jid);
      setStatus("IN_PROGRESS");
      setStatusText(`Job enviado. ID: ${jid}. Generando video...`);

      let finished = false;
      while (!finished) {
        await new Promise((r) => setTimeout(r, 3000));

        const stData = await pollVideoStatus(jid);

        const st =
          stData.status ||
          stData.state ||
          stData.job_status ||
          stData.phase ||
          "IN_PROGRESS";

        setStatus(st);
        setStatusText(`Estado actual: ${st}...`);

        if (
          st === "IN_QUEUE" ||
          st === "IN_PROGRESS" ||
          st === "DISPATCHED" ||
          st === "QUEUED" ||
          st === "RUNNING"
        ) {
          continue;
        }

        finished = true;

        const out = stData.output || stData.result || stData.data || null;
        const maybeUrl =
          out?.video_url ||
          out?.url ||
          out?.mp4_url ||
          out?.video ||
          stData.video_url ||
          stData.url ||
          null;

        if (
          st === "COMPLETED" ||
          st === "DONE" ||
          st === "SUCCESS" ||
          st === "FINISHED"
        ) {
          if (maybeUrl) {
            setVideoUrl(maybeUrl);
            setStatusText("Video generado con éxito.");
          } else {
            const b64 =
              out?.video_b64 || out?.mp4_b64 || stData.video_b64 || null;

            if (b64) {
              const blob = b64ToBlob(b64, "video/mp4");
              const url = URL.createObjectURL(blob);
              setVideoUrl(url);
              setStatusText("Video generado con éxito.");
            } else {
              throw new Error("Job terminado pero no se recibió video en la salida.");
            }
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
        <h2 className="text-lg font-semibold text-white">
          Motor de video · Producción de clips
        </h2>
        <p className="mt-2 text-sm text-neutral-300">
          Genera clips cortos como parte de un flujo de producción visual, ejecutados en GPU y listos para publicación.
        </p>

        <div className="mt-4 rounded-2xl border border-white/10 bg-black/50 px-4 py-2 text-xs text-neutral-300">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Estado actual: {statusText || "Listo para generar."}</span>
            <span className="text-[11px] text-neutral-400">
              {userStatus?.jades != null ? (
                <>
                  Jades:{" "}
                  <span className="font-semibold text-white">
                    {userStatus.jades}
                  </span>
                </>
              ) : (
                <>Jades: ...</>
              )}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-neutral-400">
            Costo: <span className="font-semibold text-white">{cost}</span> jades por video
          </div>
          {jobId && (
            <div className="mt-1 text-[10px] text-neutral-500">Job: {jobId}</div>
          )}
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
                onChange={(e) => setSteps(e.target.value)}
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
                  ? "Sin jades suficientes"
                  : "Ejecutar render de video"}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-400 whitespace-pre-line">{error}</p>
          )}
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
            <p>Aquí verás el video en cuanto se complete la generación.</p>
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
// Módulo: Imagen -> Video (logueado) ✅ CORREGIDO (AUTH + headers)
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

  const fileInputId = "img2video-file-input";
  const canUse = !!user;

  const cost = COST_IMG2VIDEO;
  const currentJades = userStatus?.jades ?? 0;
  const hasEnough = currentJades >= cost;

  // ✅ AUTH HEADERS
  const getAuthHeaders = async () => {
    try {
      const { data, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr) return {};
      const token = data?.session?.access_token;
      if (!token) return {};
      return { Authorization: `Bearer ${token}` };
    } catch {
      return {};
    }
  };

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
      const dataUrlResult = await fileToBase64(file);
      setDataUrl(dataUrlResult);
      const parts = String(dataUrlResult).split(",");
      setPureB64(parts[1] || null);
      setImageUrl("");
    } catch (err) {
      console.error("Error leyendo archivo:", err);
      setError("No se pudo leer la imagen. Intenta con otra foto.");
    }
  };

  // ✅ status poll con AUTH
  const pollVideoStatus = async (job_id) => {
    const auth = await getAuthHeaders();
    const r = await fetch(
      `/api/video-status?job_id=${encodeURIComponent(job_id)}`,
      { headers: { ...auth } }
    );
    const data = await r.json().catch(() => null);
    if (!r.ok || !data) {
      throw new Error(data?.error || "Error consultando /api/video-status");
    }
    return data;
  };

  // ✅ fallback spend jades (si no te pasan spendJades)
  const spendJadesFallback = async ({ amount, reason }) => {
    const auth = await getAuthHeaders();
    if (!auth.Authorization) throw new Error("No hay sesión/token para descontar jades.");

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
    if (!r.ok || !data?.ok) {
      throw new Error(data?.error || "No se pudo descontar jades.");
    }
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
        setStatusText("No tienes jades suficientes.");
        setError(`Necesitas ${cost} jades para Imagen → Video.`);
        return;
      }

      if (!pureB64 && !imageUrl) {
        setStatus("ERROR");
        setStatusText("Falta imagen.");
        setError("Por favor sube una imagen o pega una URL de imagen.");
        return;
      }

      // ✅ Descontar jades (con AUTH)
      if (typeof spendJades === "function") {
        await spendJades({ amount: cost, reason: "img2video" });
      } else {
        await spendJadesFallback({ amount: cost, reason: "img2video" });
      }

      const auth = await getAuthHeaders();
      if (!auth.Authorization) {
        throw new Error("No hay sesión/token. Cierra sesión e inicia de nuevo.");
      }

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
        throw new Error(
          data?.error || "Error en /api/generate-img2video, revisa los logs."
        );
      }

      const jid = data.job_id;
      setJobId(jid);
      setStatus("IN_PROGRESS");
      setStatusText(`Job enviado. ID: ${jid}. Generando video...`);

      let finished = false;
      while (!finished) {
        await new Promise((r) => setTimeout(r, 3000));

        const stData = await pollVideoStatus(jid);

        const st =
          stData.status ||
          stData.state ||
          stData.job_status ||
          stData.phase ||
          "IN_PROGRESS";

        setStatus(st);
        setStatusText(`Estado actual: ${st}...`);

        if (
          st === "IN_QUEUE" ||
          st === "IN_PROGRESS" ||
          st === "DISPATCHED" ||
          st === "QUEUED" ||
          st === "RUNNING"
        ) {
          continue;
        }

        finished = true;

        const out = stData.output || stData.result || stData.data || null;
        const maybeUrl =
          out?.video_url ||
          out?.url ||
          out?.mp4_url ||
          out?.video ||
          stData.video_url ||
          stData.url ||
          null;

        if (
          st === "COMPLETED" ||
          st === "DONE" ||
          st === "SUCCESS" ||
          st === "FINISHED"
        ) {
          if (maybeUrl) {
            setVideoUrl(maybeUrl);
            setStatusText("Video generado con éxito.");
          } else {
            const b64 =
              out?.video_b64 || out?.mp4_b64 || stData.video_b64 || null;

            if (b64) {
              const blob = b64ToBlob(b64, "video/mp4");
              const url = URL.createObjectURL(blob);
              setVideoUrl(url);
              setStatusText("Video generado con éxito.");
            } else {
              throw new Error("Job terminado pero no se recibió video en la salida.");
            }
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
        <h2 className="text-lg font-semibold text-white">
          Transformación visual · Imagen a video
        </h2>
        <p className="mt-2 text-sm text-neutral-300">
          Sube una imagen (o usa una URL) y conviértela en un clip dentro del flujo de producción.
        </p>

        <div className="mt-4 rounded-2xl border border-white/10 bg-black/50 px-4 py-2 text-xs text-neutral-300">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Estado actual: {statusText || "Listo para generar."}</span>
            <span className="text-[11px] text-neutral-400">
              {userStatus?.jades != null ? (
                <>
                  Jades:{" "}
                  <span className="font-semibold text-white">
                    {userStatus.jades}
                  </span>
                </>
              ) : (
                <>Jades: ...</>
              )}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-neutral-400">
            Costo: <span className="font-semibold text-white">{cost}</span> jades por video
          </div>
          {jobId && (
            <div className="mt-1 text-[10px] text-neutral-500">Job: {jobId}</div>
          )}
        </div>

        <div className="mt-4 space-y-4 text-sm">
          <div>
            <p className="text-xs text-neutral-300">1. Sube tu imagen (JPG/PNG)</p>
            <button
              type="button"
              onClick={handlePickFile}
              className="mt-2 flex h-40 w-full items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/60 text-xs text-neutral-400 hover:border-cyan-400 hover:text-cyan-300"
            >
              {dataUrl ? "Cambiar imagen" : "Haz clic para subir una imagen"}
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
                <img src={dataUrl} alt="Imagen base" className="w-full object-cover" />
              </div>
            )}
          </div>

          <div>
            <p className="text-xs text-neutral-300">o 1. Pega una URL de imagen</p>
            <input
              type="text"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://..."
              className="mt-2 w-full rounded-2xl bg-black/60 px-3 py-2 text-xs text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
            />
            <p className="mt-1 text-[11px] text-neutral-400">
              Si usas URL, no es necesario subir archivo.
            </p>
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
            <label className="text-neutral-300">Negative prompt (opcional)</label>
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
                onChange={(e) => setSteps(e.target.value)}
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
                  ? "Sin jades suficientes"
                  : "Ejecutar Imagen → Video"}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-400 whitespace-pre-line">{error}</p>
          )}
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
            <p>Aquí verás el video en cuanto se complete la generación.</p>
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
// Placeholder de video (próximamente)
// ---------------------------------------------------------
function VideoPlaceholderPanel() {
  return (
    <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
      <h2 className="text-lg font-semibold text-white">
        Motor de video (en expansión)
      </h2>
      <p className="mt-2 text-sm text-neutral-300">
        Estamos ampliando el motor de video para que puedas producir secuencias
        con control cinematográfico dentro del sistema, usando GPU.
      </p>
      <p className="mt-4 text-xs text-red-400 font-semibold">
        Estamos trabajando para tener este módulo lo antes posible con la máxima
        calidad de estudio.
      </p>
      <div className="mt-6 grid gap-4 md:grid-cols-2 text-xs text-neutral-300">
        <div className="rounded-2xl border border-white/10 bg-black/60 p-4">
          <h3 className="text-sm font-semibold text-white">¿Qué podrás hacer?</h3>
          <ul className="mt-2 space-y-1 list-disc list-inside">
            <li>Clips cortos listos para reels.</li>
            <li>Escenas con cámara cinematográfica.</li>
            <li>Opciones de estilo (realista, anime, artístico).</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/60 p-4">
          <h3 className="text-sm font-semibold text-white">Integración con BodySync</h3>
          <p className="mt-2">
            La arquitectura está preparada para combinar este módulo con BodySync
            y aplicar movimiento corporal a tus personajes.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// Módulo Foto Navideña IA (Premium)
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

  const isPremium =
    !!user && (userStatus?.subscription_status === "active");

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

    if (!isPremium) {
      setError(
        "Este módulo forma parte del Plan Basic (US$19/mes). Activa tu plan para usar Foto Navideña IA junto con el motor sin límite."
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

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">Foto Navideña IA (Premium)</h2>
        <p className="mt-2 text-sm text-neutral-300">
          Convierte tu foto (o la de tu familia) en un retrato navideño de
          estudio profesional, con iluminación cuidada y fondo temático
          totalmente generado por IA.
        </p>

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
              2. Opcional: cuéntanos quién aparece y qué escena quieres
            </p>
            <input
              type="text"
              value={extraPrompt}
              onChange={(e) => setExtraPrompt(e.target.value)}
              placeholder="Ejemplo: familia de 4 personas, dos niños pequeños, estilo sala acogedora junto al árbol de Navidad."
              className="mt-2 w-full rounded-2xl bg-black/60 px-3 py-2 text-xs text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
            />
          </div>

          <div className="mt-2 rounded-2xl bg-black/50 px-4 py-2 text-xs text-neutral-300">
            Estado actual: {statusText || "Listo para enviar tu foto al motor."}
          </div>

          {error && <p className="text-xs text-red-400 whitespace-pre-line">{error}</p>}

          <button
            type="button"
            onClick={handleGenerateXmas}
            disabled={status === "IN_QUEUE" || status === "IN_PROGRESS" || !pureB64 || !user}
            className="mt-3 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {status === "IN_QUEUE" || status === "IN_PROGRESS"
              ? "Generando..."
              : "Ejecutar Foto Navideña IA"}
          </button>

          <p className="mt-2 text-[11px] text-neutral-400">
            Este módulo forma parte de las funciones premium incluidas en el Plan Basic.
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
            <p>Aquí verás el resultado en cuanto se complete el render.</p>
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
// Dashboard (logueado) con sidebar de vistas
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
      const r = await fetch(
        `/api/user-status?user_id=${encodeURIComponent(user.id)}`
      );
      const data = await r.json().catch(() => null);
      if (!r.ok || !data?.ok) {
        throw new Error(data?.error || "user-status error");
      }
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

    const r = await fetch("/api/jades-spend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: user.id,
        amount: Number(amount),
        reason: reason || "spend",
      }),
    });

    const data = await r.json().catch(() => null);
    if (!r.ok || !data?.ok) {
      throw new Error(data?.error || "No se pudo descontar jades.");
    }

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
                isabelaOs <span className="text-xs text-neutral-400">Studio</span>
              </div>
              <div className="text-[10px] text-neutral-500">Panel del creador · Beta</div>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <span className="hidden sm:inline text-neutral-300">
              {user?.email} {isAdmin && "· admin"}
            </span>

            <div className="hidden md:flex items-center gap-2 rounded-2xl border border-white/10 bg-black/60 px-3 py-1.5">
              <span className="text-[10px] text-neutral-400">{userPlanLabel}</span>
              <span className="mx-1 h-3 w-px bg-white/10" />
              <span className="text-[11px] text-neutral-300">
                Jades:{" "}
                <span className="font-semibold text-white">
                  {userStatus.loading ? "..." : userStatus.jades ?? 0}
                </span>
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
              <span className="font-semibold text-white">
                Jades: {userStatus.loading ? "..." : userStatus.jades ?? 0}
              </span>
            </div>
          </div>

          <p className="text-[11px] font-semibold text-neutral-300 mb-2">Navegación</p>
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
              Motor de imagen
            </button>
            <button
              type="button"
              onClick={() => setAppViewMode("video_prompt")}
              className={`rounded-2xl px-3 py-1.5 ${
                appViewMode === "video_prompt"
                  ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                  : "bg-white/5 text-neutral-200 hover:bg-white/10"
              }`}
            >
              Motor de video
            </button>
            <button
              type="button"
              onClick={() => setAppViewMode("img2video")}
              className={`rounded-2xl px-3 py-1.5 ${
                appViewMode === "img2video"
                  ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                  : "bg-white/5 text-neutral-200 hover:bg-white/10"
              }`}
            >
              Imagen → Video
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
              Motor de imagen (render)
            </button>

            <button
              type="button"
              onClick={() => setAppViewMode("video_prompt")}
              className={`mb-2 w-full rounded-2xl px-3 py-2 text-left ${
                appViewMode === "video_prompt"
                  ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                  : "bg-white/5 text-neutral-200 hover:bg-white/10"
              }`}
            >
              Motor de video (clips)
            </button>

            <button
              type="button"
              onClick={() => setAppViewMode("img2video")}
              className={`mb-2 w-full rounded-2xl px-3 py-2 text-left ${
                appViewMode === "img2video"
                  ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
                  : "bg-white/5 text-neutral-200 hover:bg-white/10"
              }`}
            >
              Transformación Imagen → Video
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
              Biblioteca de producción
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

          <div className="flex-1 space-y-6">
            <div>
              <h1 className="text-xl font-semibold text-white">Panel del creador</h1>
              <p className="mt-1 text-xs text-neutral-400">
                Controla tu flujo de producción visual: genera, revisa, descarga y administra resultados desde un solo sistema conectado a GPU.
              </p>
            </div>

            {appViewMode === "generator" && <CreatorPanel userStatus={userStatus} />}
            {appViewMode === "video_prompt" && (
              <VideoFromPromptPanel userStatus={userStatus} spendJades={spendJades} />
            )}
            {appViewMode === "img2video" && (
              <Img2VideoPanel userStatus={userStatus} spendJades={spendJades} />
            )}
            {appViewMode === "library" && <LibraryView />}
            {appViewMode === "xmas" && <XmasPhotoPanel userStatus={userStatus} />}
          </div>
        </section>
      </main>
    </div>
  );
}

// ---------------------------------------------------------
// Landing (no sesión) con neon + BodySync
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
              IsabelaOS Studio es un <strong>motor de producción visual con IA</strong> desarrollado en Guatemala, diseñado para creadores,
              estudios y equipos que necesitan velocidad, consistencia y control creativo.
            </p>

            <p className="mt-3 max-w-xl text-xs text-neutral-400">
              No se trata solo de generar imágenes o videos, sino de construir resultados repetibles dentro de un flujo de producción visual.
              La arquitectura del sistema está preparada para módulos avanzados como BodySync, CineCam y Script2Film. Además,
              usa nuestro módulo especial de{" "}
              <span className="font-semibold text-white">Foto Navideña IA</span>{" "}
              para transformar una foto real de tu familia en un retrato navideño de estudio con fondo totalmente generado por IA.
            </p>

            <p className="mt-4 text-xs text-neutral-400">
              Mientras otros venden generación, nosotros vendemos producción confiable con IA.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-4">
              <button
                onClick={onStartDemo}
                className="rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-3 text-sm font-semibold text-white shadow-[0_0_35px_rgba(34,211,238,0.45)] hover:shadow-[0_0_40px_rgba(236,72,153,0.6)] transition-shadow"
              >
                Probar el motor de producción ({DEMO_LIMIT} outputs)
              </button>
              <p className="max-w-xs text-[11px] text-neutral-400">
                Valida el motor antes de crear tu cuenta y desbloquea {DAILY_LIMIT} renders diarios registrándote.
              </p>
            </div>

            <p className="mt-4 text-xs text-neutral-500">
              Arquitectura preparada para el motor de movimiento corporal{" "}
              <span className="font-semibold text-white">BodySync</span> y módulos cinematográficos avanzados.
            </p>
          </div>

          <div className="relative order-first lg:order-last">
            <div className="pointer-events-none absolute -inset-8 -z-10 rounded-[32px] bg-gradient-to-br from-cyan-500/18 via-transparent to-fuchsia-500/25 blur-3xl" />

            <h2 className="text-sm font-semibold text-white mb-3">
              Calidad de estudio · Renderizado con el motor actual
            </h2>

            <div className="mt-2 grid grid-cols-2 gap-2">
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
              isabelaOs Studio es un motor de producción visual con IA desarrollado en Guatemala para creadores, estudios y equipos que buscan consistencia y control.
            </p>
          </div>
        </section>

        {/* ✅ NUEVO: Secciones informativas Video (NO funcionales en Home) */}
        <section className="mt-12 grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-black/50 p-5 text-xs text-neutral-300">
            <h3 className="text-sm font-semibold text-white">Motor de video (módulo en el panel)</h3>
            <p className="mt-2 text-[11px] text-neutral-300">
              Dentro del panel del creador podrás producir clips cortos usando nuestro motor en GPU.
              Este módulo se habilita en tu cuenta y utiliza jades para la generación.
            </p>
            <ul className="mt-2 list-disc list-inside text-[11px] text-neutral-400">
              <li>Clips cortos listos para reels.</li>
              <li>Control por prompt con estilo cinematográfico.</li>
              <li>Seguimiento de estado en tiempo real.</li>
            </ul>
          </div>

          <div className="rounded-3xl border border-white/10 bg-black/50 p-5 text-xs text-neutral-300">
            <h3 className="text-sm font-semibold text-white">Transformación Imagen → Video (módulo en el panel)</h3>
            <p className="mt-2 text-[11px] text-neutral-300">
              Sube una imagen (o usa una URL) y conviértela en un clip. Este módulo está pensado para transformaciones,
              cambios de outfit y escenas cortas basadas en una imagen.
            </p>
            <ul className="mt-2 list-disc list-inside text-[11px] text-neutral-400">
              <li>Ideal para videos tipo “antes / después”.</li>
              <li>Control de estilo por prompt opcional.</li>
              <li>Arquitectura lista para integración futura con BodySync.</li>
            </ul>
          </div>
        </section>

        {/* Sección especial Foto Navideña IA */}
        <section className="mt-12 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="rounded-3xl border border-white/10 bg-black/50 p-5 text-xs text-neutral-300">
            <h3 className="text-sm font-semibold text-white">Especial Navidad · Foto Navideña IA</h3>
            <p className="mt-2 text-[11px] text-neutral-300">
              Sube una foto real tuya o de tu familia y deja que IsabelaOS
              Studio la convierta en un retrato navideño de estudio con fondo,
              luces y decoración generados por IA.
            </p>
            <ul className="mt-2 list-disc list-inside text-[11px] text-neutral-400">
              <li>Ideal para compartir en redes sociales o imprimir.</li>
              <li>Respeta la pose original y cambia el entorno a una escena navideña realista.</li>
              <li>Incluido en el Plan Basic.</li>
            </ul>
          </div>

          <div className="rounded-3xl border border-white/10 bg-black/60 p-4 flex items-center justify-center">
            <img
              src="/gallery/xmas_family_before_after.png"
              alt="Ejemplo de familia antes y después con fondo navideño"
              className="w-full rounded-2xl object-cover"
            />
          </div>
        </section>

        {/* Vista previa del panel */}
        <section className="mt-12">
          <div className="mb-3 h-px w-24 bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-transparent" />
          <h2 className="text-sm font-semibold text-white mb-4">
            Flujo de trabajo simple y potente
          </h2>
          <div className="rounded-3xl border border-white/10 bg-black/50 p-5 text-xs text-neutral-300">
            <h3 className="text-sm font-semibold text-white">Vista previa del panel del creador</h3>
            <p className="mt-2 text-[11px] text-neutral-400">
              Interfaz simple para ejecutar renders, ajustar resolución y ver
              resultados generados por el motor conectado a GPU.
            </p>
            <div className="mt-4 rounded-2xl border border-white/10 overflow-hidden bg-black/60">
              <img src="/preview/panel.png" alt="Vista previa del panel de isabelaOs Studio" className="w-full object-cover" />
            </div>
          </div>
        </section>

        {/* Showcase BodySync */}
        <section className="mt-12">
          <h2 className="text-sm font-semibold text-white mb-2">
            Arquitectura preparada para BodySync · Movimiento corporal IA
          </h2>
          <p className="text-xs text-neutral-300 max-w-2xl">
            Esta imagen fue generada con nuestro modelo de pruebas BodySync.
          </p>

          <div className="mt-6 flex justify-center">
            <div className="max-w-md w-full rounded-3xl border border-white/10 bg-black/70 px-4 py-4 shadow-lg shadow-cyan-500/25">
              <img
                src="/gallery/bodysync_showcase.png"
                alt="Ejemplo generado con BodySync"
                className="w-full rounded-2xl object-cover"
              />
            </div>
          </div>
        </section>

        {/* ✅ CAMBIO: Planes (2 planes) */}
        <section className="mt-14 max-w-6xl border-t border-white/10 pt-8">
          <h2 className="text-sm font-semibold text-white">Planes de suscripción</h2>
          <p className="mt-2 text-xs text-neutral-300 max-w-2xl">
            Planes diseñados para producción: acceso sin límites, módulos premium y créditos (jades) para video.
          </p>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {/* Basic */}
            <div className="rounded-3xl border border-white/10 bg-black/50 p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-white">Basic</h3>
                <div className="text-sm font-semibold text-white">US$19/mes</div>
              </div>
              <p className="mt-2 text-xs text-neutral-300">
                Para creadores que quieren producir sin contar límites y acceder a módulos premium base.
              </p>
              <ul className="mt-3 list-disc list-inside text-[11px] text-neutral-400 space-y-1">
                <li>Motor de imagen (renders ilimitados).</li>
                <li>Motor de video (desde prompt).</li>
                <li>Transformación Imagen → Video.</li>
                <li>Foto Navideña IA (premium).</li>
                <li>100 Jades mensuales.</li>
              </ul>

              <div className="mt-4">
                <div className="text-[11px] text-neutral-400 mb-1">
                  Pagar con <span className="font-semibold text-white">PayPal</span>:
                </div>
                <PayPalButton
                  amount="19.00"
                  description="IsabelaOS Studio – Plan Basic (Mensual)"
                  containerId="paypal-button-basic"
                />
                <button
                  onClick={handlePaddleCheckout}
                  className="mt-3 w-full rounded-2xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-white hover:bg-white/10"
                >
                  Pagar con tarjeta (Paddle) – Basic US$19/mes
                </button>
              </div>
            </div>

            {/* Pro */}
            <div className="rounded-3xl border border-white/10 bg-black/50 p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-white">Pro</h3>
                <div className="text-sm font-semibold text-white">US$39/mes</div>
              </div>
              <p className="mt-2 text-xs text-neutral-300">
                Para creadores avanzados y estudios que quieren máximo control, prioridad y acceso temprano a módulos nuevos.
              </p>
              <ul className="mt-3 list-disc list-inside text-[11px] text-neutral-400 space-y-1">
                <li>Optimización automática de prompts.</li>
                <li>Motor de imagen (renders ilimitados).</li>
                <li>Motor de video (desde prompt e Imagen → Video).</li>
                <li>Foto Navideña IA (premium).</li>
                <li>Acceso temprano a módulos en desarrollo.</li>
                <li>300 Jades mensuales.</li>
              </ul>

              <div className="mt-4">
                <div className="text-[11px] text-neutral-400 mb-1">
                  Pagar con <span className="font-semibold text-white">PayPal</span>:
                </div>
                <PayPalButton
                  amount="39.00"
                  description="IsabelaOS Studio – Plan Pro (Mensual)"
                  containerId="paypal-button-pro"
                />
                <button
                  onClick={handlePaddleCheckout}
                  className="mt-3 w-full rounded-2xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-white hover:bg-white/10"
                >
                  Pagar con tarjeta (Paddle) – Pro US$39/mes
                </button>
              </div>
            </div>
          </div>

          <p className="mt-4 text-[11px] text-neutral-400">
            ¿Te quedaste sin jades? Puedes comprar más dentro del panel (wallet).
          </p>
        </section>

        {/* Contacto */}
        <section id="contacto" className="mt-16 max-w-xl">
          <h2 className="text-sm font-semibold text-white">Contacto y soporte</h2>
          <p className="mt-1 text-xs text-neutral-400">
            Si tienes dudas sobre IsabelaOS Studio, escríbenos y el equipo de
            soporte responderá desde{" "}
            <span className="font-semibold text-white">contacto@isabelaos.com</span>.
          </p>

          <form onSubmit={handleContactSubmit} className="mt-4 space-y-3 text-sm">
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
              <a href="/terms.html" className="hover:text-neutral-300">Términos de servicio</a>
              <span>•</span>
              <a href="/privacy.html" className="hover:text-neutral-300">Política de privacidad</a>
              <span>•</span>
              <a href="/refunds.html" className="hover:text-neutral-300">Política de reembolsos</a>
            </span>
          </div>
        </footer>
      </main>
    </div>
  );
}

// ---------------------------------------------------------
// ✅ APP PRINCIPAL — landing / demo / shell
// ---------------------------------------------------------
export default function App() {
  const { user, loading } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [viewMode, setViewMode] = useState("landing");

  useEffect(() => {
    document.documentElement.style.background = "#06070B";
  }, []);

  const openAuth = () => setShowAuthModal(true);
  const closeAuth = () => setShowAuthModal(false);

  const handleStartDemo = () => setViewMode("demo");

  useEffect(() => {
    if (user) setViewMode("shell");
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-black text-white">
        <p className="text-sm text-neutral-400">Cargando sesión...</p>
      </div>
    );
  }

  // 🔥 USUARIO LOGUEADO → APP REAL
  if (user && viewMode === "shell") {
    return <AppShell />;
  }

  // DEMO
  if (viewMode === "demo") {
    return (
      <>
        <div className="min-h-screen px-4 py-10 text-white bg-[#05060A]">
          <div className="mx-auto max-w-6xl mb-6 flex justify-between">
            <button
              onClick={() => setViewMode("landing")}
              className="rounded-xl border border-white/20 px-4 py-2 text-xs hover:bg-white/10"
            >
              ← Volver
            </button>

            <button
              onClick={openAuth}
              className="rounded-xl border border-white/20 px-4 py-2 text-xs hover:bg-white/10"
            >
              Iniciar sesión / Registrarse
            </button>
          </div>

          <CreatorPanel isDemo={true} onAuthRequired={openAuth} userStatus={null} />
        </div>

        <AuthModal open={showAuthModal} onClose={closeAuth} />
      </>
    );
  }

  // LANDING
  return (
    <>
      <LandingView onOpenAuth={openAuth} onStartDemo={handleStartDemo} />
      <AuthModal open={showAuthModal} onClose={closeAuth} />
    </>
  );
}
