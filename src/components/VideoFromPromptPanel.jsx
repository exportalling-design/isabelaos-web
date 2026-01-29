// src/components/VideoFromPromptPanel.jsx
// ------------------------------------------------------------
// VideoFromPromptPanel (T2V)
// - Genera video desde texto (prompt)
// - ✅ Prompt Optimizer (OpenAI)
// - ✅ Negative prompt
// - ✅ Formato simple: Default + checkbox 9:16
// - ✅ Duración simple: checkbox 3s / 5s
// - ✅ AUTH TOKEN: Authorization Bearer
// - ✅ Billing ahora es SERVER-SIDE (para poder refund automático)
// - ✅ JSON safe parsing (arregla error rojo)
// ------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabaseClient";
import { COSTS } from "../lib/pricing";

export function VideoFromPromptPanel({ userStatus }) {
  const { user } = useAuth();

  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");

  // ✅ Nuevo UI simple
  // Default = (sin aspect_ratio)
  // ✅ CAMBIO: NO marcado por default
  const [useNineSixteen, setUseNineSixteen] = useState(false);
  const [durationSec, setDurationSec] = useState(3);

  // ✅ Mantengo fps fijo como estaba
  const fps = 24;

  const [status, setStatus] = useState("IDLE");
  const [statusText, setStatusText] = useState("");
  const [jobId, setJobId] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [error, setError] = useState("");

  const COST_T2V = COSTS?.T2V ?? 10;
  const currentJades = userStatus?.jades ?? 0;
  const hasEnough = currentJades >= COST_T2V;

  const lockRef = useRef(false);

  // ==========================================================
  // Prompt Optimizer
  // ==========================================================
  const [useOptimized, setUseOptimized] = useState(false);
  const [optimizedPrompt, setOptimizedPrompt] = useState("");
  const [optimizedNegative, setOptimizedNegative] = useState("");
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optError, setOptError] = useState("");

  useEffect(() => {
    setOptimizedPrompt("");
    setOptimizedNegative("");
    setOptError("");
    setUseOptimized(false);
  }, [prompt, negative]);

  async function getAuthHeaders() {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token || null;
    if (!token) throw new Error("MISSING_AUTH_TOKEN");
    return { Authorization: `Bearer ${token}` };
  }

  // ✅ JSON safe parse (evita error rojo)
  async function safeFetchJson(url, options = {}) {
    const r = await fetch(url, options);
    const txt = await r.text();
    let j = null;
    try {
      j = JSON.parse(txt);
    } catch {
      j = { ok: false, error: txt?.slice(0, 300) || "Respuesta no-JSON del servidor." };
    }
    return { r, j, txt };
  }

  const handleOptimize = async () => {
    setOptError("");
    setIsOptimizing(true);

    try {
      const { r, j } = await safeFetchJson("/api/optimize-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, negative_prompt: negative || "" }),
      });

      if (!r.ok || !j?.ok) throw new Error(j?.error || "Error optimizando prompt.");

      setOptimizedPrompt(String(j.optimizedPrompt || "").trim());
      setOptimizedNegative(String(j.optimizedNegative || "").trim());
      setUseOptimized(true);
    } catch (e) {
      setOptError(e?.message || String(e));
    } finally {
      setIsOptimizing(false);
    }
  };

  const getEffectivePrompts = () => {
    const canUseOpt = useOptimized && optimizedPrompt?.trim()?.length > 0;
    return {
      finalPrompt: canUseOpt ? optimizedPrompt.trim() : (prompt || "").trim(),
      finalNegative: canUseOpt ? (optimizedNegative || "").trim() : (negative || "").trim(),
      usingOptimized: canUseOpt,
    };
  };

  const setErrorState = (msg) => {
    setStatus("ERROR");
    setStatusText("Error.");
    setError(msg || "Ocurrió un error.");
  };

  // ✅ helpers para checkboxes (solo uno activo)
  const setDuration3 = () => setDurationSec(3);
  const setDuration5 = () => setDurationSec(5);

  async function generate() {
    if (lockRef.current) return;
    lockRef.current = true;

    try {
      setError("");
      setVideoUrl(null);

      if (!user) return setErrorState("Debes iniciar sesión para generar video.");

      // ✅ Si el usuario marcó "Usar prompt optimizado", optimizamos automáticamente si aún no existe.
      if (useOptimized && !optimizedPrompt?.trim()) {
        if (!prompt?.trim()) {
          return setErrorState("Escribe un prompt antes de activar el optimizado.");
        }
        setStatus("STARTING");
        setStatusText("Optimizando prompt con IA...");
        await handleOptimize();
      }

      const { finalPrompt, finalNegative, usingOptimized } = getEffectivePrompts();
      if (!finalPrompt) return setErrorState("Escribe un prompt (o activa el optimizado).");

      if (!hasEnough) return setErrorState(`Necesitas ${COST_T2V} jades para Video desde Prompt.`);

      setStatus("STARTING");
      setStatusText("Enviando job...");

      const auth = await getAuthHeaders();
      const numFrames = Math.max(1, Math.round(Number(durationSec) * fps));

      // ✅ Solo manda ratio si el usuario marcó 9:16
      const aspect_ratio = useNineSixteen ? "9:16" : "";

      const { r, j } = await safeFetchJson("/api/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({
          mode: "t2v",
          prompt: finalPrompt,
          negative_prompt: finalNegative || "",

          // ✅ NUEVO: sin presets ni tamaños. Solo ratio opcional.
          ...(aspect_ratio ? { aspect_ratio } : {}),

          duration_s: Number(durationSec),
          fps,
          num_frames: numFrames,

          // ✅ AHORA backend cobra (NO mandes already_billed true)
          already_billed: false,

          used_optimized: usingOptimized,
        }),
      });

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

  async function poll() {
    try {
      if (!jobId) return;
      setStatusText("Consultando estado...");

      const auth = await getAuthHeaders();

      const { r, j } = await safeFetchJson(`/api/video-status?job_id=${encodeURIComponent(jobId)}`, {
        headers: { ...auth },
      });

      if (!r.ok || !j) throw new Error(j?.error || "Error consultando status.");

      const st = j.status || "IN_PROGRESS";

      if (st === "DONE" || st === "COMPLETED" || st === "SUCCESS") {
        if (j.video_url) {
          setVideoUrl(j.video_url);
          setStatus("DONE");
          setStatusText("Video listo.");
          return;
        }
        throw new Error("El job terminó pero no devolvió video_url.");
      }

      if (st === "ERROR" || st === "FAILED") {
        let extra = "";
        if (j.refunded) extra = `\n✅ Refund: ${j.refund_amount || 0} jades.`;
        if (j.refund_error) extra += `\n⚠️ Refund error: ${j.refund_error}`;
        throw new Error((j.error || "El job falló.") + extra);
      }

      setStatus("IN_PROGRESS");
      setStatusText(`Estado: ${st}`);
    } catch (e) {
      setErrorState(e?.message || String(e));
    }
  }

  useEffect(() => {
    if (!jobId) return;
    if (status !== "IN_PROGRESS") return;

    const t = setInterval(() => {
      poll().catch(() => {});
    }, 5000);

    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, status]);

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">Video desde Prompt</h2>
        <p className="mt-1 text-xs text-neutral-400">
          Describe el video y el sistema generará un clip. Costo:{" "}
          <span className="text-white font-semibold">{COST_T2V}</span> jades.
        </p>

        <div className="mt-4 rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-xs text-neutral-300">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Estado: {statusText || "Listo."}</span>
            <span className="text-[11px] text-neutral-400">
              Jades: <span className="font-semibold text-white">{userStatus?.jades ?? "..."}</span>
            </span>
          </div>
          {jobId && <div className="mt-1 text-[10px] text-neutral-500">Job: {jobId}</div>}
        </div>

        {/* ✅ NUEVO: Formato y Duración con cuadritos */}
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
            <div className="text-xs text-neutral-300">Formato / tamaño</div>

            <div className="mt-3 flex items-center gap-2">
              <input
                id="t2v_916"
                type="checkbox"
                checked={useNineSixteen}
                onChange={(e) => setUseNineSixteen(e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="t2v_916" className="text-[12px] text-neutral-200">
                9:16 (Reels / TikTok)
              </label>
            </div>

            <div className="mt-2 text-[10px] text-neutral-500">
              {useNineSixteen ? "Mandará 9:16" : "Mandará Default (más rápido)"}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
            <div className="text-xs text-neutral-300">Duración</div>

            <div className="mt-3 flex items-center gap-2">
              <input
                id="t2v_3s"
                type="checkbox"
                checked={durationSec === 3}
                onChange={(e) => (e.target.checked ? setDuration3() : null)}
                className="h-4 w-4"
              />
              <label htmlFor="t2v_3s" className="text-[12px] text-neutral-200">
                3 segundos (rápido)
              </label>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <input
                id="t2v_5s"
                type="checkbox"
                checked={durationSec === 5}
                onChange={(e) => (e.target.checked ? setDuration5() : null)}
                className="h-4 w-4"
              />
              <label htmlFor="t2v_5s" className="text-[12px] text-neutral-200">
                5 segundos (máximo)
              </label>
            </div>

            <div className="mt-2 text-[10px] text-neutral-500">
              fps: {fps} · frames aprox: {Math.round(Number(durationSec) * fps)}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <label className="text-xs text-neutral-300">Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe el video..."
            className="mt-2 h-24 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
          />

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

        <div className="mt-4">
          <label className="text-xs text-neutral-300">Negative (opcional)</label>
          <textarea
            value={negative}
            onChange={(e) => setNegative(e.target.value)}
            placeholder="Ej: blurry, low quality, deformed..."
            className="mt-2 h-16 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
          />

          {optimizedNegative?.trim()?.length > 0 && (
            <div className="mt-2 rounded-xl border border-white/10 bg-black/50 px-3 py-2">
              <div className="text-[10px] text-neutral-400">
                Negative optimizado {useOptimized ? "(activo)" : "(no activo)"}:
              </div>
              <div className="mt-1 whitespace-pre-wrap text-[10px] text-neutral-200">
                {optimizedNegative.trim()}
              </div>
            </div>
          )}
        </div>

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