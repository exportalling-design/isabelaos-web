import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";

// AJUSTA estas importaciones a las rutas reales donde ya las tengas
import { getAuthHeadersGlobal } from "../lib/getAuthHeadersGlobal";
import { getTodayGenerationCount, saveGenerationInSupabase } from "../lib/generations";
import { readDemoPrompt, clearDemoPrompt } from "../lib/demoPrompt";

const DAILY_LIMIT = 5;
const DEMO_LIMIT = 3;

export default function GeneratePanel({ isDemo = false, onAuthRequired }) {
  const { user } = useAuth();

  const userLoggedIn = !isDemo && !!user;

  const [prompt, setPrompt] = useState("Cinematic portrait, ultra detailed, soft light, 8k");
  const [negative, setNegative] = useState("blurry, low quality, deformed, watermark, text");
  const [width, setWidth] = useState(1080);
  const [height, setHeight] = useState(1920);
  const [steps, setSteps] = useState(22);

  const [status, setStatus] = useState("IDLE");
  const [statusText, setStatusText] = useState("Listo para ejecutar el motor.");
  const [imageB64, setImageB64] = useState(null);
  const [error, setError] = useState("");

  const [dailyCount, setDailyCount] = useState(0);
  const [demoCount, setDemoCount] = useState(0);

  const [profilePlan, setProfilePlan] = useState("free");
  const [profileJades, setProfileJades] = useState(0);

  // ---------------------------------------------------------
  // Avatares LoRA
  // ---------------------------------------------------------
  const [avatars, setAvatars] = useState([]);
  const [avatarsLoading, setAvatarsLoading] = useState(false);
  const [selectedAvatarId, setSelectedAvatarId] = useState("");

  const selectedAvatar =
    avatars.find((a) => String(a.id) === String(selectedAvatarId)) || null;

  // ---------------------------------------------------------
  // Prefill prompt desde landing demo
  // ---------------------------------------------------------
  useEffect(() => {
    if (!userLoggedIn) return;
    try {
      const p = readDemoPrompt();
      if (p?.trim()) {
        setPrompt(p);
        clearDemoPrompt();
      }
    } catch {}
  }, [userLoggedIn]);

  // ---------------------------------------------------------
  // Optimizador de prompt
  // ---------------------------------------------------------
  const [useOptimizer, setUseOptimizer] = useState(false);
  const [optStatus, setOptStatus] = useState("IDLE");
  const [optError, setOptError] = useState("");
  const [optimizedPrompt, setOptimizedPrompt] = useState("");
  const [optimizedNegative, setOptimizedNegative] = useState("");
  const [optSource, setOptSource] = useState({ prompt: "", negative: "" });

  useEffect(() => {
    setOptError("");
  }, [prompt, negative]);

  const isOptStale =
    optStatus === "READY" &&
    (optSource.prompt !== prompt || optSource.negative !== negative);

  async function runOptimizeNow() {
    setOptError("");
    setOptStatus("OPTIMIZING");

    try {
      const r = await fetch("/api/optimize-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          negative_prompt: negative,
        }),
      });

      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        throw new Error(j?.error || "Error optimizando prompt.");
      }

      const op = String(j.optimizedPrompt || "").trim();
      const on = String(j.optimizedNegative || "").trim();

      setOptimizedPrompt(op);
      setOptimizedNegative(on);
      setOptSource({ prompt, negative });
      setOptStatus("READY");
      setUseOptimizer(true);

      return { ok: true, optimizedPrompt: op, optimizedNegative: on };
    } catch (e) {
      setOptStatus("ERROR");
      setOptError(e?.message || String(e));
      return { ok: false, error: e?.message || String(e) };
    }
  }

  function getEffectivePrompts() {
    const canUseOpt = useOptimizer && optimizedPrompt && !isOptStale;
    return {
      finalPrompt: canUseOpt ? optimizedPrompt : prompt,
      finalNegative: canUseOpt ? (optimizedNegative || "") : negative,
      usingOptimized: !!canUseOpt,
    };
  }

  // ---------------------------------------------------------
  // Cargar profile desde Supabase
  // ---------------------------------------------------------
  useEffect(() => {
    if (!userLoggedIn) {
      setProfilePlan("free");
      setProfileJades(0);
      return;
    }

    (async () => {
      try {
        const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
        const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;
        if (!SUPABASE_URL || !SUPABASE_ANON) {
          console.warn("Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");
          return;
        }

        const authHeaders = await getAuthHeadersGlobal();
        const url =
          `${SUPABASE_URL.replace(/\/$/, "")}` +
          `/rest/v1/profiles?id=eq.${user.id}&select=plan,jade_balance`;

        const r = await fetch(url, {
          headers: {
            apikey: SUPABASE_ANON,
            ...authHeaders,
          },
        });

        const rows = await r.json().catch(() => []);
        const row = Array.isArray(rows) ? rows[0] : null;

        const plan = String(row?.plan || "free").toLowerCase();
        const jades = Number(row?.jade_balance || 0);

        setProfilePlan(plan);
        setProfileJades(jades);
      } catch (e) {
        console.error("Error cargando profiles:", e);
      }
    })();
  }, [userLoggedIn, user?.id]);

  const isFreeUser = !profilePlan || profilePlan === "free" || profilePlan === "none";
  const hasPaidAccess = !isFreeUser || profileJades > 0;

  // ---------------------------------------------------------
  // Cargar avatares desde /api/avatars-list
  // ---------------------------------------------------------
  useEffect(() => {
    if (!userLoggedIn || !user?.id || isDemo) {
      setAvatars([]);
      setSelectedAvatarId("");
      return;
    }

    (async () => {
      try {
        setAvatarsLoading(true);

        const authHeaders = await getAuthHeadersGlobal();
        const r = await fetch(
          `/api/avatars-list?user_id=${encodeURIComponent(user.id)}`,
          {
            method: "GET",
            headers: {
              ...authHeaders,
            },
          }
        );

        const j = await r.json().catch(() => null);

        if (!r.ok || !j?.ok) {
          throw new Error(j?.error || "No se pudieron cargar los avatares.");
        }

        const readyAvatars = (Array.isArray(j.avatars) ? j.avatars : []).filter(
          (a) =>
            String(a?.status || "").toUpperCase() === "READY" &&
            String(a?.lora_path || "").trim()
        );

        setAvatars(readyAvatars);

        setSelectedAvatarId((prev) => {
          if (prev && readyAvatars.some((a) => String(a.id) === String(prev))) {
            return prev;
          }
          return readyAvatars[0]?.id || "";
        });
      } catch (e) {
        console.error("Error cargando avatares:", e);
        setAvatars([]);
        setSelectedAvatarId("");
      } finally {
        setAvatarsLoading(false);
      }
    })();
  }, [userLoggedIn, user?.id, isDemo]);

  // ---------------------------------------------------------
  // Contador diario
  // ---------------------------------------------------------
  useEffect(() => {
    if (!userLoggedIn) {
      setDailyCount(0);
      return;
    }
    if (hasPaidAccess) {
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
  }, [userLoggedIn, user?.id, hasPaidAccess]);

  // ---------------------------------------------------------
  // Demo count
  // ---------------------------------------------------------
  useEffect(() => {
    if (!isDemo) return;
    try {
      const stored = localStorage.getItem("isabelaos_demo_count") || "0";
      setDemoCount(Number(stored));
    } catch (e) {
      console.warn("Error leyendo demo count:", e);
    }
  }, [isDemo]);

  const limitReached = !isDemo && !hasPaidAccess && dailyCount >= DAILY_LIMIT;

  const disabled =
    status === "IN_QUEUE" ||
    status === "IN_PROGRESS" ||
    (!isDemo && !userLoggedIn) ||
    limitReached ||
    (isDemo && demoCount >= DEMO_LIMIT);

  const handleGenerate = async () => {
    setError("");
    setOptError("");

    if (!isDemo && !userLoggedIn) {
      onAuthRequired?.();
      return;
    }

    if (isDemo && demoCount >= DEMO_LIMIT) {
      setStatus("ERROR");
      setStatusText("Límite de demo alcanzado.");
      alert(
        `Has agotado tus ${DEMO_LIMIT} pruebas. Crea tu cuenta GRATIS para obtener ${DAILY_LIMIT} renders al día, guardar tu historial y descargar.`
      );
      onAuthRequired?.();
      return;
    }

    if (!isDemo && limitReached) {
      setStatus("ERROR");
      setStatusText("Límite de generación alcanzado.");
      setError(
        `Has llegado al límite de ${DAILY_LIMIT} renders gratuitos por hoy. Activa una suscripción o compra jades para generar sin límite.`
      );
      return;
    }

    setImageB64(null);
    setStatus("IN_QUEUE");
    setStatusText("Preparando job...");

    try {
      let finalPrompt = prompt;
      let finalNegative = negative;

      if (useOptimizer) {
        const needsOptimize =
          optStatus !== "READY" ||
          !optimizedPrompt ||
          optSource.prompt !== prompt ||
          optSource.negative !== negative;

        if (needsOptimize) {
          setStatusText("Optimizando prompt con IA...");
          const opt = await runOptimizeNow();

          if (!opt.ok || !opt.optimizedPrompt) {
            finalPrompt = prompt;
            finalNegative = negative;
          } else {
            finalPrompt = opt.optimizedPrompt;
            finalNegative = opt.optimizedNegative || "";
          }
        } else {
          const eff = getEffectivePrompts();
          finalPrompt = eff.finalPrompt;
          finalNegative = eff.finalNegative;
        }
      }

      setStatusText("Enviando job a RunPod...");

      const authHeaders = isDemo ? {} : await getAuthHeadersGlobal();

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({
          prompt: finalPrompt,
          negative_prompt: finalNegative,
          width: Number(width),
          height: Number(height),
          steps: Number(steps),

          avatar_id: selectedAvatar?.id || null,
          avatar_name: selectedAvatar?.name || null,
          avatar_trigger: selectedAvatar?.trigger || null,
          avatar_lora_path: selectedAvatar?.lora_path || null,

          _ui_original_prompt: prompt,
          _ui_original_negative: negative,
          _ui_used_optimizer: !!useOptimizer,
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

        const authHeaders2 = isDemo ? {} : await getAuthHeadersGlobal();
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
            if (!hasPaidAccess) setDailyCount((prev) => prev + 1);

            const dataUrl = `data:image/png;base64,${b64}`;
            saveGenerationInSupabase({
              userId: user.id,
              imageUrl: dataUrl,
              prompt,
              negativePrompt: negative,
              width: Number(width),
              height: Number(height),
              steps: Number(steps),
              optimizedPrompt: useOptimizer ? (optimizedPrompt || null) : null,
              optimizedNegativePrompt: useOptimizer ? (optimizedNegative || null) : null,
              usedOptimizer: !!useOptimizer,
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
        <p className="mt-1 text-xs text-yellow-200/80">
          Desde tu cuenta podrás ejecutar renders con el motor conectado a GPU.
        </p>
      </div>
    );
  }

  const remaining = isDemo
    ? Math.max(0, DEMO_LIMIT - demoCount)
    : hasPaidAccess
    ? Infinity
    : Math.max(0, DAILY_LIMIT - dailyCount);

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">Motor de imagen · Producción visual</h2>

        {isDemo && (
          <div className="mt-4 rounded-2xl border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-[11px] text-cyan-100">
            Modo demo: te quedan {remaining} outputs sin registrarte. Descarga y biblioteca requieren cuenta.
          </div>
        )}

        {!isDemo && !hasPaidAccess && remaining <= 2 && remaining > 0 && (
          <div className="mt-4 rounded-2xl border border-yellow-400/40 bg-yellow-500/10 px-4 py-2 text-[11px] text-yellow-100">
            Atención: solo te quedan {remaining} renders hoy.
          </div>
        )}

        {!isDemo && hasPaidAccess && (
          <div className="mt-4 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-[11px] text-emerald-100">
            Acceso premium activo: renders limitados por plan o jades.
            <span className="ml-2 text-emerald-200/80">Jades: {profileJades}</span>
          </div>
        )}

        <div className="mt-4 space-y-4 text-sm">
          {!isDemo && (
            <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
              <div className="text-sm font-medium text-white">Avatar LoRA</div>
              <div className="mt-1 text-[11px] text-neutral-400">
                Elige un avatar READY para usar su trigger y LoRA al generar.
              </div>

              <select
                className="mt-3 w-full rounded-2xl bg-black/60 px-3 py-3 text-sm text-white outline-none ring-1 ring-cyan-400/60 focus:ring-2 focus:ring-cyan-400"
                value={selectedAvatarId}
                onChange={(e) => setSelectedAvatarId(e.target.value)}
                disabled={avatarsLoading}
              >
                <option value="">Sin avatar</option>
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
                  ? `${avatars.length} avatar(es) READY encontrados`
                  : "No hay avatares READY con LoRA todavía"}
              </div>
            </div>
          )}

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
                id="useOptImage"
                type="checkbox"
                checked={useOptimizer}
                onChange={(e) => setUseOptimizer(e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="useOptImage" className="text-[11px] text-neutral-300">
                Usar prompt optimizado para generar
              </label>

              <span className="ml-auto text-[10px] text-neutral-500">
                {useOptimizer && optStatus === "READY" && optimizedPrompt && !isOptStale
                  ? "Activo (mandará optimizado)"
                  : "Mandará tu prompt"}
              </span>
            </div>

            {optimizedPrompt ? (
              <div className="mt-2">
                <div className="text-[10px] text-neutral-400">
                  Prompt optimizado (se envía al motor si está activo):
                </div>
                <div className="mt-1 max-h-24 overflow-auto rounded-xl bg-black/60 p-2 text-[10px] text-neutral-200">
                  {optimizedPrompt}
                </div>

                <div className="mt-2 text-[10px] text-neutral-400">Negative optimizado:</div>
                <div className="mt-1 max-h-20 overflow-auto rounded-xl bg-black/60 p-2 text-[10px] text-neutral-200">
                  {optimizedNegative || "(vacío)"}
                </div>

                {isOptStale && (
                  <div className="mt-2 text-[10px] text-yellow-200/90">
                    Cambiaste el prompt/negative: al generar se re-optimizará automáticamente.
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-2 text-[10px] text-neutral-500">
                Presiona “Optimizar con IA” para generar una versión más descriptiva (en inglés) manteniendo tu idea.
              </div>
            )}

            {optError && (
              <div className="mt-2 whitespace-pre-line text-[11px] text-red-400">{optError}</div>
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
                onChange={(e) => setSteps(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="text-neutral-300">Width</label>
              <input
                type="number"
                min={256}
                max={2048}
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
                max={2048}
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
              {isDemo ? (
                <>Uso: {demoCount} / {DEMO_LIMIT}</>
              ) : hasPaidAccess ? (
                <>Uso: limitado (por plan o jades)</>
              ) : (
                <>Uso: {dailyCount} / {DAILY_LIMIT}</>
              )}
              <span className="ml-2 opacity-70">(plan: {profilePlan})</span>
              {useOptimizer && <span className="ml-2 opacity-70">(IA: ON)</span>}
              {selectedAvatar && (
                <span className="ml-2 opacity-70">(avatar: {selectedAvatar.name})</span>
              )}
            </span>
          </div>

          {error && <p className="whitespace-pre-line text-xs text-red-400">{error}</p>}

          <button
            onClick={handleGenerate}
            disabled={disabled}
            className="mt-4 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60"
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
