// src/components/GeneratePanel.jsx
// FIXES:
//   - Avatar siempre inicia sin selección (usuario elige manualmente)
//   - Prompt de ejemplo cambiado + aviso de que es solo ejemplo
//   - Aviso legal de suplantación de identidad
//   - Imagen se sube a Supabase Storage antes de guardar en DB
//   - Negative prompt de Realistic Vision agresivo (en rp_handler)

import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { getAuthHeadersGlobal } from "../lib/getAuthHeadersGlobal";
import { getTodayGenerationCount, saveGenerationInSupabase } from "../lib/generations";
import { readDemoPrompt, clearDemoPrompt } from "../lib/demoPrompt";
import { supabase } from "../lib/supabaseClient";

const DAILY_LIMIT = 5;
const DEMO_LIMIT  = 3;

// Prompt de ejemplo — más simple para evitar blur por CLIP truncation
const EXAMPLE_PROMPT    = "Portrait of a woman, natural light, sharp focus, professional photo";
const EXAMPLE_NEGATIVE  = "blurry, low quality, deformed, watermark, text, nude, nsfw";

// ── Sube image_b64 a Supabase Storage y devuelve la URL pública ──────────
async function uploadImageToStorage(b64, userId) {
  try {
    // Convertir base64 a Blob
    const byteChars   = atob(b64);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteNumbers[i] = byteChars.charCodeAt(i);
    }
    const blob      = new Blob([new Uint8Array(byteNumbers)], { type: "image/jpeg" });
    const fileName  = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;

    const { error } = await supabase.storage
      .from("generations")
      .upload(fileName, blob, { contentType: "image/jpeg", upsert: false });

    if (error) {
      console.error("[uploadImage] Storage error:", error.message);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from("generations")
      .getPublicUrl(fileName);

    return urlData?.publicUrl || null;
  } catch (e) {
    console.error("[uploadImage] Exception:", e);
    return null;
  }
}

export default function GeneratePanel({ isDemo = false, onAuthRequired }) {
  const { user }      = useAuth();
  const userLoggedIn  = !isDemo && !!user;

  // ── Estado principal ────────────────────────────────────────────────────
  const [prompt,   setPrompt]   = useState(EXAMPLE_PROMPT);
  const [negative, setNegative] = useState(EXAMPLE_NEGATIVE);
  const [width,    setWidth]    = useState(1080);
  const [height,   setHeight]   = useState(1920);
  const [steps,    setSteps]    = useState(22);

  const [status,     setStatus]     = useState("IDLE");
  const [statusText, setStatusText] = useState("Listo para ejecutar el motor.");
  const [imageB64,   setImageB64]   = useState(null);
  const [error,      setError]      = useState("");

  const [dailyCount,    setDailyCount]    = useState(0);
  const [demoCount,     setDemoCount]     = useState(0);
  const [profilePlan,   setProfilePlan]   = useState("free");
  const [profileJades,  setProfileJades]  = useState(0);

  // ── Avatares ────────────────────────────────────────────────────────────
  const [avatars,         setAvatars]         = useState([]);
  const [avatarsLoading,  setAvatarsLoading]  = useState(false);
  // FIX: siempre inicia vacío — usuario debe elegir manualmente
  const [selectedAvatarId, setSelectedAvatarId] = useState("");

  const selectedAvatar =
    avatars.find((a) => String(a.id) === String(selectedAvatarId)) || null;

  // ── Optimizador de prompt ────────────────────────────────────────────────
  const [useOptimizer,       setUseOptimizer]       = useState(false);
  const [optStatus,          setOptStatus]           = useState("IDLE");
  const [optError,           setOptError]            = useState("");
  const [optimizedPrompt,    setOptimizedPrompt]     = useState("");
  const [optimizedNegative,  setOptimizedNegative]   = useState("");
  const [optSource,          setOptSource]           = useState({ prompt: "", negative: "" });

  const isOptStale =
    optStatus === "READY" &&
    (optSource.prompt !== prompt || optSource.negative !== negative);

  useEffect(() => { setOptError(""); }, [prompt, negative]);

  // ── Prefill desde landing demo ───────────────────────────────────────────
  useEffect(() => {
    if (!userLoggedIn) return;
    try {
      const p = readDemoPrompt();
      if (p?.trim()) { setPrompt(p); clearDemoPrompt(); }
    } catch {}
  }, [userLoggedIn]);

  // ── Cargar profile ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!userLoggedIn) { setProfilePlan("free"); setProfileJades(0); return; }
    (async () => {
      try {
        const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL;
        const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;
        if (!SUPABASE_URL || !SUPABASE_ANON) return;
        const authHeaders = await getAuthHeadersGlobal();
        const r = await fetch(
          `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/profiles?id=eq.${user.id}&select=plan,jade_balance`,
          { headers: { apikey: SUPABASE_ANON, ...authHeaders } }
        );
        const rows = await r.json().catch(() => []);
        const row  = Array.isArray(rows) ? rows[0] : null;
        setProfilePlan(String(row?.plan || "free").toLowerCase());
        setProfileJades(Number(row?.jade_balance || 0));
      } catch (e) { console.error("Error cargando profiles:", e); }
    })();
  }, [userLoggedIn, user?.id]);

  const isFreeUser   = !profilePlan || profilePlan === "free" || profilePlan === "none";
  const hasPaidAccess = !isFreeUser || profileJades > 0;

  // ── Cargar avatares ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!userLoggedIn || !user?.id || isDemo) {
      setAvatars([]); setSelectedAvatarId(""); return;
    }
    (async () => {
      try {
        setAvatarsLoading(true);
        const authHeaders = await getAuthHeadersGlobal();
        const r = await fetch(
          `/api/avatars-list?user_id=${encodeURIComponent(user.id)}`,
          { method: "GET", headers: { ...authHeaders } }
        );
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) throw new Error(j?.error || "Error cargando avatares.");
        const readyAvatars = (Array.isArray(j.avatars) ? j.avatars : []).filter(
          (a) =>
            String(a?.status || "").toUpperCase() === "READY" &&
            String(a?.lora_path || "").trim()
        );
        setAvatars(readyAvatars);
        // FIX: nunca preseleccionar — siempre vacío
        setSelectedAvatarId("");
      } catch (e) {
        console.error("Error cargando avatares:", e);
        setAvatars([]); setSelectedAvatarId("");
      } finally { setAvatarsLoading(false); }
    })();
  }, [userLoggedIn, user?.id, isDemo]);

  // ── Contador diario ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!userLoggedIn) { setDailyCount(0); return; }
    if (hasPaidAccess) { setDailyCount(0); return; }
    (async () => {
      try {
        const countToday = await getTodayGenerationCount(user.id);
        setDailyCount(countToday || 0);
      } catch (e) { console.error("Error dailyCount:", e); setDailyCount(0); }
    })();
  }, [userLoggedIn, user?.id, hasPaidAccess]);

  // ── Demo count ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isDemo) return;
    try {
      setDemoCount(Number(localStorage.getItem("isabelaos_demo_count") || "0"));
    } catch {}
  }, [isDemo]);

  const limitReached = !isDemo && !hasPaidAccess && dailyCount >= DAILY_LIMIT;
  const disabled =
    status === "IN_QUEUE" || status === "IN_PROGRESS" ||
    (!isDemo && !userLoggedIn) || limitReached ||
    (isDemo && demoCount >= DEMO_LIMIT);

  // ── Optimizador ──────────────────────────────────────────────────────────
  async function runOptimizeNow() {
    setOptError(""); setOptStatus("OPTIMIZING");
    try {
      const r = await fetch("/api/optimize-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, negative_prompt: negative }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Error optimizando prompt.");
      const op = String(j.optimizedPrompt  || "").trim();
      const on = String(j.optimizedNegative || "").trim();
      setOptimizedPrompt(op); setOptimizedNegative(on);
      setOptSource({ prompt, negative });
      setOptStatus("READY"); setUseOptimizer(true);
      return { ok: true, optimizedPrompt: op, optimizedNegative: on };
    } catch (e) {
      setOptStatus("ERROR"); setOptError(e?.message || String(e));
      return { ok: false, error: e?.message || String(e) };
    }
  }

  function getEffectivePrompts() {
    const canUseOpt = useOptimizer && optimizedPrompt && !isOptStale;
    return {
      finalPrompt:   canUseOpt ? optimizedPrompt    : prompt,
      finalNegative: canUseOpt ? (optimizedNegative || "") : negative,
    };
  }

  // ── Generación ───────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    setError(""); setOptError("");

    if (!isDemo && !userLoggedIn) { onAuthRequired?.(); return; }
    if (isDemo && demoCount >= DEMO_LIMIT) {
      alert(`Has agotado tus ${DEMO_LIMIT} pruebas. Crea tu cuenta GRATIS para obtener ${DAILY_LIMIT} renders al día.`);
      onAuthRequired?.(); return;
    }
    if (!isDemo && limitReached) {
      setError(`Límite de ${DAILY_LIMIT} renders gratuitos por hoy. Activa una suscripción o compra jades.`);
      return;
    }

    setImageB64(null); setStatus("IN_QUEUE"); setStatusText("Preparando job...");

    try {
      let finalPrompt   = prompt;
      let finalNegative = negative;

      if (useOptimizer) {
        const needsOptimize =
          optStatus !== "READY" || !optimizedPrompt ||
          optSource.prompt !== prompt || optSource.negative !== negative;
        if (needsOptimize) {
          setStatusText("Optimizando prompt con IA...");
          const opt = await runOptimizeNow();
          finalPrompt   = opt.ok && opt.optimizedPrompt ? opt.optimizedPrompt   : prompt;
          finalNegative = opt.ok && opt.optimizedPrompt ? (opt.optimizedNegative || "") : negative;
        } else {
          const eff = getEffectivePrompts();
          finalPrompt = eff.finalPrompt; finalNegative = eff.finalNegative;
        }
      }

      setStatusText("Enviando job a RunPod...");
      const authHeaders = isDemo ? {} : await getAuthHeadersGlobal();

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          prompt:           finalPrompt,
          negative_prompt:  finalNegative,
          width:            Number(width),
          height:           Number(height),
          steps:            Number(steps),
          avatar_id:        selectedAvatar?.id    || null,
          avatar_name:      selectedAvatar?.name  || null,
          avatar_trigger:   selectedAvatar?.trigger    || null,
          avatar_lora_path: selectedAvatar?.lora_path  || null,
          _ui_original_prompt:   prompt,
          _ui_original_negative: negative,
          _ui_used_optimizer:    !!useOptimizer,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Error en /api/generate.");

      const jobId = data.jobId;
      setStatus("IN_PROGRESS"); setStatusText(`Job enviado. Consultando estado...`);

      let finished = false;
      while (!finished) {
        await new Promise((r) => setTimeout(r, 2000));
        const authHeaders2  = isDemo ? {} : await getAuthHeadersGlobal();
        const statusRes     = await fetch(`/api/status?id=${jobId}`, { headers: { ...authHeaders2 } });
        const statusData    = await statusRes.json().catch(() => null);
        if (!statusRes.ok || statusData?.error) throw new Error(statusData?.error || "Error en /api/status.");

        const st = statusData.status;
        setStatus(st); setStatusText(`Estado: ${st}...`);
        if (st === "IN_QUEUE" || st === "IN_PROGRESS") continue;

        finished = true;

        if (st === "COMPLETED" && statusData.output?.image_b64) {
          const b64 = statusData.output.image_b64;
          setImageB64(b64);
          setStatusText("Render completado ✅");

          if (isDemo) {
            const next = demoCount + 1;
            setDemoCount(next);
            localStorage.setItem("isabelaos_demo_count", String(next));
          } else if (userLoggedIn) {
            if (!hasPaidAccess) setDailyCount((prev) => prev + 1);

            // FIX: subir a Storage primero, guardar URL pública en DB
            setStatusText("Guardando en biblioteca...");
            try {
              const publicUrl = await uploadImageToStorage(b64, user.id);
              if (publicUrl) {
                await saveGenerationInSupabase({
                  userId:                  user.id,
                  imageUrl:                publicUrl,   // ← URL pública, no data URL
                  prompt,
                  negativePrompt:          negative,
                  width:                   Number(width),
                  height:                  Number(height),
                  steps:                   Number(steps),
                  optimizedPrompt:         useOptimizer ? (optimizedPrompt || null) : null,
                  optimizedNegativePrompt: useOptimizer ? (optimizedNegative || null) : null,
                  usedOptimizer:           !!useOptimizer,
                });
                setStatusText("Render completado y guardado ✅");
              } else {
                console.error("[GeneratePanel] uploadImageToStorage devolvió null");
                setStatusText("Render completado (error al guardar en biblioteca)");
              }
            } catch (saveErr) {
              console.error("[GeneratePanel] Error guardando:", saveErr);
              setStatusText("Render completado (error al guardar en biblioteca)");
            }
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
    if (isDemo) { alert("Para descargar, crea tu cuenta o inicia sesión."); onAuthRequired?.(); return; }
    if (!imageB64) return;
    const link = document.createElement("a");
    link.href = `data:image/jpeg;base64,${imageB64}`;
    link.download = "isabelaos-image.jpg";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!userLoggedIn && !isDemo) {
    return (
      <div className="rounded-3xl border border-yellow-400/30 bg-yellow-500/5 p-6 text-center text-sm text-yellow-100">
        <p className="font-medium">Debes iniciar sesión para usar el motor de producción visual.</p>
        <p className="mt-1 text-xs text-yellow-200/80">
          Desde tu cuenta podrás ejecutar renders con el motor conectado a GPU.
        </p>
      </div>
    );
  }

  const remaining = isDemo
    ? Math.max(0, DEMO_LIMIT - demoCount)
    : hasPaidAccess ? Infinity
    : Math.max(0, DAILY_LIMIT - dailyCount);

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* ── Panel izquierdo: configuración ── */}
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">Motor de imagen · Producción visual</h2>

        {/* Aviso legal de suplantación */}
        <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/8 px-4 py-3 text-[11px] text-red-200">
          <span className="font-semibold">⚠️ Aviso legal:</span> El uso de esta herramienta para suplantar la identidad de personas reales sin su consentimiento es una violación de la ley y está penado legalmente. Úsala solo con imágenes propias o con autorización explícita.
        </div>

        {isDemo && (
          <div className="mt-3 rounded-2xl border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-[11px] text-cyan-100">
            Modo demo: te quedan {remaining} outputs sin registrarte. Descarga y biblioteca requieren cuenta.
          </div>
        )}
        {!isDemo && !hasPaidAccess && remaining <= 2 && remaining > 0 && (
          <div className="mt-3 rounded-2xl border border-yellow-400/40 bg-yellow-500/10 px-4 py-2 text-[11px] text-yellow-100">
            Atención: solo te quedan {remaining} renders hoy.
          </div>
        )}
        {!isDemo && hasPaidAccess && (
          <div className="mt-3 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-[11px] text-emerald-100">
            Acceso premium activo · <span className="text-emerald-200/80">Jades: {profileJades}</span>
          </div>
        )}

        <div className="mt-4 space-y-4 text-sm">

          {/* Avatar selector */}
          {!isDemo && (
            <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
              <div className="text-sm font-medium text-white">Avatar (opcional)</div>
              <div className="mt-1 text-[11px] text-neutral-400">
                Selecciona un avatar READY para aplicar tu identidad visual al render. Si no eliges ninguno, se genera sin avatar.
              </div>
              <select
                className="mt-3 w-full rounded-2xl bg-black/60 px-3 py-3 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
                value={selectedAvatarId}
                onChange={(e) => setSelectedAvatarId(e.target.value)}
                disabled={avatarsLoading}
              >
                {/* FIX: opción vacía siempre primero y seleccionada por defecto */}
                <option value="">— Sin avatar —</option>
                {avatars.map((avatar) => (
                  <option key={avatar.id} value={avatar.id}>
                    {avatar.name} · {avatar.trigger}
                  </option>
                ))}
              </select>
              <div className="mt-2 text-[11px] text-neutral-500">
                {avatarsLoading
                  ? "Cargando avatares..."
                  : avatars.length > 0
                  ? `${avatars.length} avatar(es) READY disponibles`
                  : "No tienes avatares READY aún"}
              </div>
            </div>
          )}

          {/* Prompt */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-neutral-300">Prompt</label>
              <span className="text-[10px] text-yellow-300/80">
                💡 Ejemplo precargado — bórralo y escribe el tuyo, o prueba con este.
              </span>
            </div>
            <textarea
              className="mt-1 h-24 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>

          {/* Negative prompt */}
          <div>
            <label className="text-neutral-300">Negative prompt</label>
            <textarea
              className="mt-1 h-16 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              value={negative}
              onChange={(e) => setNegative(e.target.value)}
            />
          </div>

          {/* Optimizador */}
          <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-neutral-300">
                Optimización de prompt (OpenAI)
                {optStatus === "READY" && optimizedPrompt ? (
                  <span className="ml-2 text-[10px] text-emerald-300/90">
                    {isOptStale ? "Desactualizado" : "Listo ✓"}
                  </span>
                ) : (
                  <span className="ml-2 text-[10px] text-neutral-400">Opcional</span>
                )}
              </div>
              <button
                type="button"
                onClick={runOptimizeNow}
                disabled={optStatus === "OPTIMIZING" || !prompt?.trim()}
                className="rounded-xl border border-white/20 px-3 py-1 text-[11px] text-white hover:bg-white/10 disabled:opacity-60"
              >
                {optStatus === "OPTIMIZING" ? "Optimizando..." : "Optimizar con IA"}
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                id="useOptImage" type="checkbox"
                checked={useOptimizer}
                onChange={(e) => setUseOptimizer(e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="useOptImage" className="text-[11px] text-neutral-300">
                Usar prompt optimizado para generar
              </label>
              <span className="ml-auto text-[10px] text-neutral-500">
                {useOptimizer && optStatus === "READY" && optimizedPrompt && !isOptStale
                  ? "Activo" : "Inactivo"}
              </span>
            </div>
            {optimizedPrompt && (
              <div className="mt-2">
                <div className="text-[10px] text-neutral-400">Prompt optimizado:</div>
                <div className="mt-1 max-h-20 overflow-auto rounded-xl bg-black/60 p-2 text-[10px] text-neutral-200">
                  {optimizedPrompt}
                </div>
                {isOptStale && (
                  <div className="mt-1 text-[10px] text-yellow-200/90">
                    Cambiaste el prompt — se re-optimizará al generar.
                  </div>
                )}
              </div>
            )}
            {!optimizedPrompt && (
              <div className="mt-2 text-[10px] text-neutral-500">
                Presiona "Optimizar con IA" para mejorar tu prompt automáticamente.
              </div>
            )}
            {optError && <div className="mt-2 text-[11px] text-red-400">{optError}</div>}
          </div>

          {/* Parámetros */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Steps", val: steps,  setVal: setSteps,  min: 5,   max: 50,   step: 1   },
              { label: "Width", val: width,  setVal: setWidth,  min: 256, max: 2048, step: 64  },
              { label: "Height",val: height, setVal: setHeight, min: 256, max: 2048, step: 64  },
            ].map(({ label, val, setVal, min, max, step }) => (
              <div key={label}>
                <label className="text-neutral-300">{label}</label>
                <input
                  type="number" min={min} max={max} step={step}
                  className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
                  value={val}
                  onChange={(e) => setVal(Number(e.target.value))}
                />
              </div>
            ))}
          </div>

          {/* Status */}
          <div className="rounded-2xl bg-black/50 px-4 py-2 text-xs text-neutral-300">
            {statusText || "Listo para ejecutar el motor."}
            <br />
            <span className="text-[11px] text-neutral-400">
              {isDemo
                ? `Demo: ${demoCount}/${DEMO_LIMIT}`
                : hasPaidAccess
                ? `Jades: ${profileJades}`
                : `Renders hoy: ${dailyCount}/${DAILY_LIMIT}`}
              <span className="ml-2 opacity-60">(plan: {profilePlan})</span>
              {useOptimizer && <span className="ml-2 opacity-60">· IA ON</span>}
              {selectedAvatar && <span className="ml-2 opacity-60">· avatar: {selectedAvatar.name}</span>}
            </span>
          </div>

          {error && <p className="whitespace-pre-line text-xs text-red-400">{error}</p>}

          <button
            onClick={handleGenerate}
            disabled={disabled}
            className="mt-2 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {isDemo && demoCount >= DEMO_LIMIT
              ? "Límite alcanzado"
              : !isDemo && limitReached
              ? "Límite alcanzado"
              : status === "IN_QUEUE" || status === "IN_PROGRESS"
              ? "Ejecutando..."
              : isDemo
              ? "Generar (Demo)"
              : "Ejecutar render en el motor"}
          </button>
        </div>
      </div>

      {/* ── Panel derecho: resultado ── */}
      <div className="flex flex-col rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">Resultado</h2>
        <div className="mt-4 flex h-[420px] flex-1 items-center justify-center rounded-2xl bg-black/70 text-sm text-neutral-400">
          {imageB64 ? (
            <img
              src={`data:image/jpeg;base64,${imageB64}`}
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
