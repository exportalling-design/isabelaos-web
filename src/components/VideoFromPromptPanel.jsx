// src/components/VideoFromPromptPanel.jsx
// ------------------------------------------------------------
// VideoFromPromptPanel
// - Genera un video SOLO desde texto (T2V)
// - Costo: 10 jades
// - ✅ Incluye Prompt Optimizer (OpenAI) igual que Img2Video
// - Cobra jades ANTES de mandar el job (para no doble cobro)
// ------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { COSTS } from "../lib/pricing";

// ❗️NO export default: App.jsx solo puede tener 1 default (App)
export function VideoFromPromptPanel({ userStatus, spendJades }) {
  const { user } = useAuth();

  // ---------------------------
  // Prompt base escrito por el usuario
  // ---------------------------
  const [prompt, setPrompt] = useState("");

  // ---------------------------
  // Job state
  // ---------------------------
  const [status, setStatus] = useState("IDLE"); // IDLE | STARTING | IN_PROGRESS | DONE | ERROR
  const [statusText, setStatusText] = useState("");
  const [jobId, setJobId] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [error, setError] = useState("");

  // ---------------------------
  // Costo centralizado (fallback 10)
  // ---------------------------
  const COST_T2V = COSTS?.T2V ?? 10;
  const currentJades = userStatus?.jades ?? 0;
  const hasEnough = currentJades >= COST_T2V;

  // Evita doble click / doble request
  const lockRef = useRef(false);

  // ==========================================================
  // ✅ Prompt Optimizer (OpenAI) — mismo patrón que Img2Video
  // ==========================================================
  const [useOptimized, setUseOptimized] = useState(false);
  const [optimizedPrompt, setOptimizedPrompt] = useState("");
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optError, setOptError] = useState("");

  // Si el usuario cambia el prompt, limpiamos el optimizado (para no usar uno viejo)
  useEffect(() => {
    setOptimizedPrompt("");
    setOptError("");
    setUseOptimized(false);
  }, [prompt]);

  // Llama a tu endpoint existente /api/optimize-prompt
  // (lo usamos igual que en Img2Video; negative_prompt vacío)
  const handleOptimize = async () => {
    setOptError("");
    setIsOptimizing(true);

    try {
      const res = await fetch("/api/optimize-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          negative_prompt: "", // T2V no usa negative (por ahora)
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Error optimizando prompt.");

      // Guardamos el optimizado (normalmente viene en inglés y más descriptivo)
      setOptimizedPrompt(String(data.optimizedPrompt || "").trim());
      setUseOptimized(true);
    } catch (e) {
      setOptError(e?.message || String(e));
    } finally {
      setIsOptimizing(false);
    }
  };

  // Decide qué prompt mandar al backend
  const getEffectivePrompt = () => {
    const canUseOpt = useOptimized && optimizedPrompt?.trim()?.length > 0;
    return canUseOpt ? optimizedPrompt.trim() : (prompt || "").trim();
  };

  // ---------------------------
  // Helper de error
  // ---------------------------
  const setErrorState = (msg) => {
    setStatus("ERROR");
    setStatusText("Error.");
    setError(msg || "Ocurrió un error.");
  };

  // ----------------------------------------------------------
  // Generar video (COBRA + crea job)
  // ----------------------------------------------------------
  async function generate() {
    if (lockRef.current) return;
    lockRef.current = true;

    try {
      setError("");
      setVideoUrl(null);

      if (!user) {
        setErrorState("Debes iniciar sesión para generar video.");
        return;
      }

      const finalPrompt = getEffectivePrompt();
      if (!finalPrompt) {
        setErrorState("Escribe un prompt (o activa el optimizado).");
        return;
      }

      if (!hasEnough) {
        setErrorState(`Necesitas ${COST_T2V} jades para Video desde Prompt.`);
        return;
      }

      setStatus("STARTING");
      setStatusText("Cobrando jades y enviando job...");

      // ✅ Cobro (FRONTEND)
      if (typeof spendJades === "function") {
        await spendJades({ amount: COST_T2V, reason: "t2v" });
      }

      // ✅ Crear job en backend
      const r = await fetch("/api/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "t2v",
          prompt: finalPrompt,

          // ✅ indica que YA cobramos en frontend (evita doble cobro backend)
          already_billed: true,

          // ✅ (opcional) para debug / auditoría
          used_optimized: !!(useOptimized && optimizedPrompt?.trim()),
        }),
      });

      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok || !j?.job_id) {
        throw new Error(j?.error || "No se pudo crear el job de video.");
      }

      setJobId(j.job_id);
      setStatus("IN_PROGRESS");
      setStatusText(`Generando... Job: ${j.job_id}`);
    } catch (e) {
      setErrorState(e?.message || String(e));
    } finally {
      lockRef.current = false;
    }
  }

  // ----------------------------------------------------------
  // Poll / status
  // ----------------------------------------------------------
  async function poll() {
    try {
      if (!jobId) return;

      setStatusText("Consultando estado...");

      const r = await fetch(`/api/video-status?job_id=${encodeURIComponent(jobId)}`);
      const j = await r.json().catch(() => null);

      if (!r.ok || !j) throw new Error(j?.error || "Error consultando status.");

      const st = j.status || "IN_PROGRESS";

      if (st === "DONE" || st === "COMPLETED" || st === "SUCCESS") {
        if (j.video_url) {
          setVideoUrl(j.video_url);
          setStatus("DONE");
          setStatusText("Video listo.");
        } else {
          throw new Error("El job terminó pero no devolvió video_url.");
        }
        return;
      }

      if (st === "ERROR" || st === "FAILED") {
        throw new Error(j.error || "El job falló.");
      }

      setStatus("IN_PROGRESS");
      setStatusText(`Estado: ${st}`);
    } catch (e) {
      setErrorState(e?.message || String(e));
    }
  }

  // ✅ Auto-poll cada 5s mientras está generando
  useEffect(() => {
    if (!jobId) return;
    if (status !== "IN_PROGRESS") return;

    const t = setInterval(() => {
      poll().catch(() => {});
    }, 5000);

    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, status]);

  // ----------------------------------------------------------
  // UI
  // ----------------------------------------------------------
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* Panel izquierdo */}
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">Video desde Prompt</h2>
        <p className="mt-1 text-xs text-neutral-400">
          Describe el video y el sistema generará un clip. Costo:{" "}
          <span className="text-white font-semibold">{COST_T2V}</span> jades.
        </p>

        {/* Barra de estado */}
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-xs text-neutral-300">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Estado: {statusText || "Listo."}</span>
            <span className="text-[11px] text-neutral-400">
              Jades: <span className="font-semibold text-white">{userStatus?.jades ?? "..."}</span>
            </span>
          </div>
          {jobId && <div className="mt-1 text-[10px] text-neutral-500">Job: {jobId}</div>}
        </div>

        {/* Prompt */}
        <div className="mt-4">
          <label className="text-xs text-neutral-300">Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe el video..."
            className="mt-2 h-28 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
          />

          {/* Vista del prompt optimizado (si existe) */}
          {optimizedPrompt?.trim()?.length > 0 && (
            <div className="mt-2 rounded-xl border border-white/10 bg-black/50 px-3 py-2">
              <div className="text-[10px] text-neutral-400">
                Prompt optimizado {useOptimized ? "(activo)" : "(no activo)"}:
              </div>
              <div className="mt-1 whitespace-pre-wrap text-[10px] text-neutral-200">
                {optimizedPrompt.trim()}
              </div>
            </div>
          )}
        </div>

        {/* ✅ Optimizer box (igual estilo al otro panel) */}
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-neutral-300">
              Optimización de prompt (OpenAI)
              {optimizedPrompt ? (
                <span className="ml-2 text-[10px] text-emerald-300/90">Listo ✓</span>
              ) : (
                <span className="ml-2 text-[10px] text-neutral-400">Opcional</span>
              )}
            </div>

            <button
              type="button"
              onClick={handleOptimize}
              disabled={isOptimizing || !prompt?.trim()}
              className="rounded-xl border border-white/20 px-3 py-1 text-[11px] text-white hover:bg-white/10 disabled:opacity-60"
            >
              {isOptimizing ? "Optimizando..." : "Optimizar con IA"}
            </button>
          </div>

          <div className="mt-2 flex items-center gap-2">
            <input
              id="useOptT2V"
              type="checkbox"
              checked={useOptimized}
              onChange={(e) => setUseOptimized(e.target.checked)}
              className="h-4 w-4"
            />
            <label htmlFor="useOptT2V" className="text-[11px] text-neutral-300">
              Usar prompt optimizado para generar
            </label>

            <span className="ml-auto text-[10px] text-neutral-500">
              {useOptimized && optimizedPrompt ? "Activo (mandará optimizado)" : "Mandará tu prompt"}
            </span>
          </div>

          {!optimizedPrompt && (
            <div className="mt-2 text-[10px] text-neutral-500">
              Presiona “Optimizar con IA” para generar una versión más descriptiva (en inglés) manteniendo tu idea.
            </div>
          )}

          {optError && <div className="mt-2 text-[11px] text-red-400 whitespace-pre-line">{optError}</div>}
        </div>

        {/* Botones */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={generate}
            disabled={!user || !hasEnough || status === "STARTING" || status === "IN_PROGRESS"}
            className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {status === "STARTING" || status === "IN_PROGRESS"
              ? "Generando..."
              : !hasEnough
              ? "Sin jades"
              : "Generar Video"}
          </button>

          <button
            type="button"
            onClick={poll}
            disabled={!jobId || status === "STARTING"}
            className="w-full rounded-2xl border border-white/20 bg-white/5 py-3 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-60"
          >
            Actualizar estado
          </button>
        </div>

        {error && <p className="mt-3 text-xs text-red-400 whitespace-pre-line">{error}</p>}
      </div>

      {/* Panel derecho */}
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6 flex flex-col">
        <h2 className="text-lg font-semibold text-white">Resultado</h2>

        <div className="mt-4 flex h-[420px] flex-1 items-center justify-center rounded-2xl bg-black/70 text-sm text-neutral-400">
          {videoUrl ? (
            <video src={videoUrl} controls className="h-full w-full rounded-2xl object-contain" />
          ) : (
            <p>Aquí verás el video cuando termine.</p>
          )}
        </div>
      </div>
    </div>
  );
}
