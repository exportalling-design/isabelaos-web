// src/components/CreatorPanel.jsx
// ─────────────────────────────────────────────────────────────
// Panel de generación de imágenes — extraído de App.jsx
// Se importa en DashboardView y se renderiza en la pestaña "Imagen"
// Costos: 1 Jade sin avatar | 2 Jades con avatar
// ─────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabaseClient";
import { saveGenerationInSupabase, getTodayGenerationCount } from "../lib/generations";

// ── Helpers de localStorage para demo prompt ──────────────────
const DEMO_PROMPT_KEY = "isabela_demo_prompt_text2img";
function readDemoPrompt()  { try { return localStorage.getItem(DEMO_PROMPT_KEY) || ""; } catch { return ""; } }
function clearDemoPrompt() { try { localStorage.removeItem(DEMO_PROMPT_KEY); } catch {} }

// ── Helper global de auth headers ────────────────────────────
async function getAuthHeadersGlobal() {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  } catch { return {}; }
}

// Límites de uso gratuito
const DAILY_LIMIT = 5;
const DEMO_LIMIT  = 5;

export default function CreatorPanel({ isDemo = false, onAuthRequired }) {
  const { user } = useAuth();
  const userLoggedIn = !isDemo && !!user;

  // ── Estado del formulario ──────────────────────────────────
  const [prompt,    setPrompt]    = useState("Cinematic portrait, ultra detailed, soft light, 8k");
  const [negative,  setNegative]  = useState("blurry, low quality, deformed, watermark, text");
  const [width,     setWidth]     = useState(1080);
  const [height,    setHeight]    = useState(1920);
  const [steps,     setSteps]     = useState(22);
  const [skinMode,  setSkinMode]  = useState("standard");

  const [status,     setStatus]     = useState("IDLE");
  const [statusText, setStatusText] = useState("Listo para ejecutar el motor.");
  const [imageB64,   setImageB64]   = useState(null);
  const [error,      setError]      = useState("");

  const [dailyCount, setDailyCount] = useState(0);
  const [demoCount,  setDemoCount]  = useState(0);

  const [profilePlan,  setProfilePlan]  = useState("free");
  const [profileJades, setProfileJades] = useState(0);

  // ── Avatares / anchors ─────────────────────────────────────
  const [avatars,        setAvatars]        = useState([]);
  const [avatarsLoading, setAvatarsLoading] = useState(false);
  const [selectedAvatarId, setSelectedAvatarId] = useState("");
  const selectedAvatar = avatars.find((a) => String(a.id) === String(selectedAvatarId)) || null;

  // ── Optimizador de prompt ──────────────────────────────────
  const [useOptimizer,       setUseOptimizer]       = useState(false);
  const [optStatus,          setOptStatus]          = useState("IDLE");
  const [optError,           setOptError]           = useState("");
  const [optimizedPrompt,    setOptimizedPrompt]    = useState("");
  const [optimizedNegative,  setOptimizedNegative]  = useState("");
  const [optSource,          setOptSource]          = useState({ prompt: "", negative: "" });

  const isOptStale = optStatus === "READY" &&
    (optSource.prompt !== prompt || optSource.negative !== negative);

  // Resetear error de optimización si cambian los campos
  useEffect(() => { setOptError(""); }, [prompt, negative]);

  // Prefill prompt desde landing demo
  useEffect(() => {
    if (!userLoggedIn) return;
    const p = readDemoPrompt();
    if (p?.trim()) { setPrompt(p); clearDemoPrompt(); }
  }, [userLoggedIn]);

  // ── Cargar perfil (plan + jades) ───────────────────────────
  useEffect(() => {
    if (!userLoggedIn) { setProfilePlan("free"); setProfileJades(0); return; }
    (async () => {
      try {
        const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL;
        const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;
        if (!SUPABASE_URL || !SUPABASE_ANON) return;
        const auth = await getAuthHeadersGlobal();
        const url  = `${SUPABASE_URL.replace(/\/$/,"")}/rest/v1/profiles?id=eq.${user.id}&select=plan,jade_balance`;
        const r    = await fetch(url, { headers: { apikey: SUPABASE_ANON, ...auth } });
        const rows = await r.json().catch(() => []);
        const row  = Array.isArray(rows) ? rows[0] : null;
        setProfilePlan(String(row?.plan || "free").toLowerCase());
        setProfileJades(Number(row?.jade_balance || 0));
      } catch (e) { console.error("Error cargando profiles:", e); }
    })();
  }, [userLoggedIn, user?.id]);

  const isFreeUser   = !profilePlan || profilePlan === "free" || profilePlan === "none";
  const hasPaidAccess = !isFreeUser || profileJades > 0;

  // ── Cargar avatares ────────────────────────────────────────
  useEffect(() => {
    if (!userLoggedIn || !user?.id || isDemo) { setAvatars([]); setSelectedAvatarId(""); return; }
    (async () => {
      try {
        setAvatarsLoading(true);
        const auth = await getAuthHeadersGlobal();
        const r    = await fetch(`/api/avatars-list?user_id=${encodeURIComponent(user.id)}`, { headers: auth });
        const j    = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) throw new Error(j?.error || "No se pudieron cargar los avatares.");
        const ready = (Array.isArray(j.avatars) ? j.avatars : []).filter(
          (a) => String(a?.status || "").toUpperCase() === "READY" && Number(a?.anchor_count || 0) >= 1
        );
        setAvatars(ready);
        setSelectedAvatarId((prev) => {
          if (prev && ready.some((a) => String(a.id) === String(prev))) return prev;
          return ready[0]?.id || "";
        });
      } catch (e) { console.error("Error cargando avatares:", e); setAvatars([]); setSelectedAvatarId(""); }
      finally { setAvatarsLoading(false); }
    })();
  }, [userLoggedIn, user?.id, isDemo]);

  // ── Contador diario ────────────────────────────────────────
  useEffect(() => {
    if (!userLoggedIn || hasPaidAccess) { setDailyCount(0); return; }
    (async () => {
      try { setDailyCount(await getTodayGenerationCount(user.id) || 0); }
      catch (e) { console.error("Error leyendo dailyCount:", e); setDailyCount(0); }
    })();
  }, [userLoggedIn, user?.id, hasPaidAccess]);

  // Demo count desde localStorage
  useEffect(() => {
    if (!isDemo) return;
    try { setDemoCount(Number(localStorage.getItem("isabelaos_demo_count") || "0")); }
    catch {}
  }, [isDemo]);

  const limitReached = !isDemo && !hasPaidAccess && dailyCount >= DAILY_LIMIT;

  const disabled =
    status === "IN_QUEUE" || status === "IN_PROGRESS" ||
    (!isDemo && !userLoggedIn) || limitReached ||
    (isDemo && demoCount >= DEMO_LIMIT);

  // ── Calcular costo en Jades ────────────────────────────────
  // 1 Jade sin avatar | 2 Jades con avatar
  const jadeCost = selectedAvatar ? 2 : 1;

  // ── Optimizar prompt ───────────────────────────────────────
  async function runOptimizeNow() {
    setOptError(""); setOptStatus("OPTIMIZING");
    try {
      const r = await fetch("/api/optimize-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt, negative_prompt: negative, mode: "image",
          skin_mode: skinMode || "standard",
          has_anchor: !!selectedAvatarId,
          image_model: skinMode === "natural" && !!selectedAvatarId ? "realistic_vision" : "flux",
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Error optimizando prompt.");
      const op = String(j.optimizedPrompt || "").trim();
      const on = String(j.optimizedNegative || "").trim();
      setOptimizedPrompt(op); setOptimizedNegative(on);
      setOptSource({ prompt, negative }); setOptStatus("READY"); setUseOptimizer(true);
      return { ok: true, optimizedPrompt: op, optimizedNegative: on };
    } catch (e) {
      setOptStatus("ERROR"); setOptError(e?.message || String(e));
      return { ok: false, error: e?.message || String(e) };
    }
  }

  function getEffectivePrompts() {
    const canUse = useOptimizer && optimizedPrompt && !isOptStale;
    return {
      finalPrompt:    canUse ? optimizedPrompt     : prompt,
      finalNegative:  canUse ? (optimizedNegative || "") : negative,
      usingOptimized: !!canUse,
    };
  }

  // ── Cargar anchor URLs del avatar seleccionado ─────────────
  async function getAvatarAnchors(avatarId) {
    if (!avatarId) return [];
    try {
      const auth = await getAuthHeadersGlobal();
      const r    = await fetch(`/api/avatars-get-anchor-urls?avatar_id=${encodeURIComponent(avatarId)}`, { headers: auth });
      const j    = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || "No se pudieron cargar las anchors.");
      return Array.isArray(j.anchors) ? j.anchors : [];
    } catch (e) { console.error("Error cargando avatar anchors:", e); return []; }
  }

  // ── Generar imagen ─────────────────────────────────────────
  const handleGenerate = async () => {
    setError(""); setOptError("");
    if (!isDemo && !userLoggedIn) { onAuthRequired?.(); return; }
    if (isDemo && demoCount >= DEMO_LIMIT) {
      setStatus("ERROR"); setStatusText("Límite de demo alcanzado.");
      alert(`Has agotado tus ${DEMO_LIMIT} pruebas. Crea tu cuenta GRATIS para obtener ${DAILY_LIMIT} renders al día.`);
      onAuthRequired?.(); return;
    }
    if (!isDemo && limitReached) {
      setStatus("ERROR"); setStatusText("Límite alcanzado.");
      setError(`Has llegado al límite de ${DAILY_LIMIT} renders gratuitos por hoy. Compra Jades para generar sin límite.`);
      return;
    }
    // Verificar Jades si tiene acceso pagado
    if (!isDemo && hasPaidAccess && profileJades < jadeCost) {
      setStatus("ERROR"); setStatusText("Jades insuficientes.");
      setError(`Necesitas ${jadeCost} Jade${jadeCost > 1 ? "s" : ""} para esta generación. Compra más Jades.`);
      return;
    }
    setImageB64(null); setStatus("IN_QUEUE"); setStatusText("Preparando job...");
    try {
      let finalPrompt = prompt, finalNegative = negative;
      if (useOptimizer) {
        const needsOptimize = optStatus !== "READY" || !optimizedPrompt ||
          optSource.prompt !== prompt || optSource.negative !== negative;
        if (needsOptimize) {
          setStatusText("Optimizando prompt con IA...");
          const opt = await runOptimizeNow();
          if (opt.ok && opt.optimizedPrompt) { finalPrompt = opt.optimizedPrompt; finalNegative = opt.optimizedNegative || ""; }
        } else {
          const eff = getEffectivePrompts();
          finalPrompt = eff.finalPrompt; finalNegative = eff.finalNegative;
        }
      }
      let avatarAnchors = [];
      if (selectedAvatar?.id) {
        setStatusText("Cargando referencias faciales del avatar...");
        avatarAnchors = await getAvatarAnchors(selectedAvatar.id);
      }
      setStatusText("Enviando job a RunPod...");
      const authHeaders = isDemo ? {} : await getAuthHeadersGlobal();
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          prompt: finalPrompt, negative_prompt: finalNegative,
          width: Number(width), height: Number(height), steps: Number(steps),
          skin_mode: skinMode,
          avatar_id:           selectedAvatar?.id || null,
          avatar_name:         selectedAvatar?.name || null,
          avatar_anchor_urls:  avatarAnchors.map((a) => a.url).filter(Boolean),
          avatar_anchor_paths: avatarAnchors.map((a) => a.storage_path).filter(Boolean),
          _ui_original_prompt:   prompt,
          _ui_original_negative: negative,
          _ui_used_optimizer:    !!useOptimizer,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Error en /api/generate.");
      const jobId = data.jobId;
      setStatus("IN_PROGRESS"); setStatusText(`Job enviado. Consultando estado...`);
      // Polling hasta completar
      let finished = false;
      while (!finished) {
        await new Promise((r) => setTimeout(r, 2000));
        const authHeaders2 = isDemo ? {} : await getAuthHeadersGlobal();
        const statusRes  = await fetch(`/api/status?id=${jobId}`, { headers: authHeaders2 });
        const statusData = await statusRes.json().catch(() => null);
        if (!statusRes.ok || statusData?.error) throw new Error(statusData?.error || "Error consultando /api/status.");
        const st = statusData.status;
        setStatus(st); setStatusText(`Estado: ${st}...`);
        if (st === "IN_QUEUE" || st === "IN_PROGRESS") continue;
        finished = true;
        if (st === "COMPLETED" && statusData.output?.image_b64) {
          const b64 = statusData.output.image_b64;
          setImageB64(b64); setStatusText("Render completado.");
          if (isDemo) {
            const next = demoCount + 1;
            setDemoCount(next);
            localStorage.setItem("isabelaos_demo_count", String(next));
          } else if (userLoggedIn) {
            if (!hasPaidAccess) setDailyCount((p) => p + 1);
            saveGenerationInSupabase({
              userId: user.id, imageUrl: `data:image/png;base64,${b64}`,
              prompt, negativePrompt: negative,
              width: Number(width), height: Number(height), steps: Number(steps),
              optimizedPrompt:         useOptimizer ? (optimizedPrompt || null) : null,
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
      setStatus("ERROR"); setStatusText("Error al generar la imagen.");
      setError(err?.message || String(err));
    }
  };

  const handleDownload = () => {
    if (isDemo) { alert("Para descargar, crea tu cuenta o inicia sesión."); onAuthRequired?.(); return; }
    if (!imageB64) return;
    const link = document.createElement("a");
    link.href     = `data:image/png;base64,${imageB64}`;
    link.download = "isabelaos-image.png";
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  // Si no está logueado y no es demo, mostrar aviso
  if (!userLoggedIn && !isDemo) {
    return (
      <div className="rounded-3xl border border-yellow-400/30 bg-yellow-500/5 p-6 text-center text-sm text-yellow-100">
        <p className="font-medium">Debes iniciar sesión para usar el motor de producción visual.</p>
        <p className="mt-1 text-xs text-yellow-200/80">Desde tu cuenta podrás ejecutar renders con el motor conectado a GPU.</p>
      </div>
    );
  }

  const remaining = isDemo
    ? Math.max(0, DEMO_LIMIT - demoCount)
    : hasPaidAccess ? Infinity
    : Math.max(0, DAILY_LIMIT - dailyCount);

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* ── Panel izquierdo: controles ── */}
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">Motor de imagen · Producción visual</h2>

        {/* Bandas de estado */}
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
            Acceso activo · renders por Jades.
            <span className="ml-2 text-emerald-200/80">Jades: {profileJades}</span>
            <span className="ml-2 text-emerald-200/60">· Costo: {jadeCost} jade{jadeCost > 1 ? "s" : ""}</span>
          </div>
        )}

        <div className="mt-4 space-y-4 text-sm">
          {/* Selector de avatar */}
          {!isDemo && (
            <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
              <div className="text-sm font-medium text-white">Anchors faciales</div>
              <div className="mt-1 text-[11px] text-neutral-400">
                Elige un anchor guardado para enviar 1 a 3 fotos de referencia al worker.
                {selectedAvatar && <span className="ml-2 text-cyan-300/80">Costo: 2 Jades</span>}
                {!selectedAvatar && <span className="ml-2 text-neutral-500">Sin avatar: 1 Jade</span>}
              </div>
              <select
                className="mt-3 w-full rounded-2xl bg-black/60 px-3 py-3 text-sm text-white outline-none ring-1 ring-cyan-400/60 focus:ring-2 focus:ring-cyan-400"
                value={selectedAvatarId}
                onChange={(e) => setSelectedAvatarId(e.target.value)}
                disabled={avatarsLoading}>
                <option value="">Sin avatar</option>
                {avatars.map((avatar) => (
                  <option key={avatar.id} value={avatar.id}>{avatar.name}</option>
                ))}
              </select>
              <div className="mt-2 text-[11px] text-neutral-500">
                {avatarsLoading ? "Cargando avatares..." :
                  avatars.length > 0 ? `${avatars.length} avatar(es) READY encontrados` :
                  "No hay anchors READY todavía"}
              </div>
            </div>
          )}

          {/* Prompt */}
          <div>
            <label className="text-neutral-300">Prompt</label>
            <textarea className="mt-1 h-24 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </div>

          {/* Negative */}
          <div>
            <label className="text-neutral-300">Negative prompt</label>
            <textarea className="mt-1 h-20 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              value={negative} onChange={(e) => setNegative(e.target.value)} />
          </div>

          {/* Optimizador */}
          <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-neutral-300">
                Optimización de prompt (OpenAI)
                {optStatus === "READY" && optimizedPrompt
                  ? <span className="ml-2 text-[10px] text-emerald-300/90">{isOptStale ? "Desactualizado" : "Listo ✓"}</span>
                  : <span className="ml-2 text-[10px] text-neutral-400">Opcional</span>}
              </div>
              <button type="button" onClick={runOptimizeNow}
                disabled={optStatus === "OPTIMIZING" || !prompt?.trim()}
                className="rounded-xl border border-white/20 px-3 py-1 text-[11px] text-white hover:bg-white/10 disabled:opacity-60">
                {optStatus === "OPTIMIZING" ? "Optimizando..." : "Optimizar con IA"}
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input id="useOptImage" type="checkbox" checked={useOptimizer}
                onChange={(e) => setUseOptimizer(e.target.checked)} className="h-4 w-4" />
              <label htmlFor="useOptImage" className="text-[11px] text-neutral-300">Usar prompt optimizado para generar</label>
              <span className="ml-auto text-[10px] text-neutral-500">
                {useOptimizer && optStatus === "READY" && optimizedPrompt && !isOptStale
                  ? "Activo (mandará optimizado)" : "Mandará tu prompt"}
              </span>
            </div>
            {optimizedPrompt && (
              <div className="mt-2">
                <div className="text-[10px] text-neutral-400">Prompt optimizado:</div>
                <div className="mt-1 max-h-24 overflow-auto rounded-xl bg-black/60 p-2 text-[10px] text-neutral-200">{optimizedPrompt}</div>
                <div className="mt-2 text-[10px] text-neutral-400">Negative optimizado:</div>
                <div className="mt-1 max-h-20 overflow-auto rounded-xl bg-black/60 p-2 text-[10px] text-neutral-200">{optimizedNegative || "(vacío)"}</div>
                {isOptStale && <div className="mt-2 text-[10px] text-yellow-200/90">Cambiaste el prompt: se re-optimizará al generar.</div>}
              </div>
            )}
            {optError && <div className="mt-2 whitespace-pre-line text-[11px] text-red-400">{optError}</div>}
          </div>

          {/* Steps / Width / Height */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-neutral-300">Steps</label>
              <input type="number" min={5} max={50} value={steps} onChange={(e) => setSteps(Number(e.target.value))}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400" />
            </div>
            <div>
              <label className="text-neutral-300">Width</label>
              <input type="number" min={256} max={2048} step={64} value={width} onChange={(e) => setWidth(Number(e.target.value))}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400" />
            </div>
            <div>
              <label className="text-neutral-300">Height</label>
              <input type="number" min={256} max={2048} step={64} value={height} onChange={(e) => setHeight(Number(e.target.value))}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400" />
            </div>
          </div>

          {/* Selector de piel */}
          <div className="mt-3">
            <label className="text-neutral-300">Piel</label>
            <select className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              value={skinMode} onChange={(e) => setSkinMode(e.target.value)}>
              <option value="standard">Standard</option>
              <option value="natural">Skin natural</option>
            </select>
            <div className="mt-1 text-[11px] text-neutral-500">Skin natural reduce el embellecimiento automático.</div>
          </div>

          {/* Estado actual */}
          <div className="mt-2 rounded-2xl bg-black/50 px-4 py-2 text-xs text-neutral-300">
            Estado: {statusText || "Listo para ejecutar el motor."}
            <br />
            <span className="text-[11px] text-neutral-400">
              {isDemo
                ? `Uso: ${demoCount} / ${DEMO_LIMIT}`
                : hasPaidAccess
                  ? `Uso: por Jades · Costo: ${jadeCost}J`
                  : `Uso: ${dailyCount} / ${DAILY_LIMIT}`}
              <span className="ml-2 opacity-70">(plan: {profilePlan})</span>
              {useOptimizer && <span className="ml-2 opacity-70">(IA: ON)</span>}
              {selectedAvatar && <span className="ml-2 opacity-70">(avatar: {selectedAvatar.name})</span>}
              <span className="ml-2 opacity-70">(piel: {skinMode})</span>
            </span>
          </div>

          {error && <p className="whitespace-pre-line text-xs text-red-400">{error}</p>}

          {/* Botón generar */}
          <button onClick={handleGenerate} disabled={disabled}
            className="mt-4 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60">
            {isDemo && demoCount >= DEMO_LIMIT ? "Límite alcanzado"
              : !isDemo && limitReached ? "Límite alcanzado"
              : status === "IN_QUEUE" || status === "IN_PROGRESS" ? "Ejecutando..."
              : isDemo ? "Generar (Demo)"
              : "Ejecutar render en el motor"}
          </button>
        </div>
      </div>

      {/* ── Panel derecho: resultado ── */}
      <div className="flex flex-col rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">Resultado</h2>
        <div className="mt-4 flex h-[420px] flex-1 items-center justify-center rounded-2xl bg-black/70 text-sm text-neutral-400">
          {imageB64
            ? <img src={`data:image/png;base64,${imageB64}`} alt="Imagen generada"
                className="h-full w-full rounded-2xl object-contain" />
            : <p>Aquí verás el resultado en cuanto se complete el render.</p>}
        </div>
        {imageB64 && (
          <button onClick={handleDownload}
            className="mt-4 w-full rounded-2xl border border-white/30 py-2 text-xs text-white hover:bg-white/10">
            {isDemo ? "Descargar (Requiere crear cuenta)" : "Descargar resultado"}
          </button>
        )}
      </div>
    </div>
  );
}
