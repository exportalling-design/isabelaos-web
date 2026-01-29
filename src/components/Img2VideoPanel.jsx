// src/components/Img2VideoPanel.jsx
// ---------------------------------------------------------
// Img2VideoPanel (Imagen -> Video)
// - Cobra jades (frontend) y manda already_billed=true
// - Si "Usar prompt optimizado" está activo, optimiza AUTOMÁTICO al generar
// - UI completa (prompt/negative/optimizer/steps)
// - Rehidrata job activo (mode=i2v) para no perder estado
// - Presets: 9:16 (default ON) y duración 5s (default)
// ---------------------------------------------------------

import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { COSTS } from "../lib/pricing";

// ❗️NO export default
export function Img2VideoPanel({ userStatus, spendJades }) {
  const { user } = useAuth();

  // ---------------------------
  // Inputs
  // ---------------------------
  const [dataUrl, setDataUrl] = useState(null);
  const [pureB64, setPureB64] = useState(null);
  const [imageUrl, setImageUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [steps, setSteps] = useState(25);

  // ✅ Presets (NEW)
  const [usePortrait916, setUsePortrait916] = useState(true); // 9:16 default ON
  const [seconds, setSeconds] = useState(5); // 5s default
  const [fps, setFps] = useState(24); // fijo (puedes ocultarlo si quieres)

  // ---------------------------
  // Job state
  // ---------------------------
  const [status, setStatus] = useState("IDLE");
  const [statusText, setStatusText] = useState("");
  const [jobId, setJobId] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [error, setError] = useState("");

  // ✅ costo desde pricing central (fallback 12)
  const cost = COSTS?.IMG2VIDEO ?? 12;

  const currentJades = userStatus?.jades ?? 0;
  const hasEnough = currentJades >= cost;
  const canUse = !!user;

  const fileInputId = "img2video-file-input";

  // ---------------------------
  // Prompt Optimizer (OpenAI)
  // ---------------------------
  const [useOptimized, setUseOptimized] = useState(false);
  const [optimizedPrompt, setOptimizedPrompt] = useState("");
  const [optimizedNegative, setOptimizedNegative] = useState("");
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optError, setOptError] = useState("");

  useEffect(() => {
    setOptimizedPrompt("");
    setOptimizedNegative("");
    setOptError("");
  }, [prompt, negative]);

  const handleOptimize = async () => {
    setOptError("");
    setIsOptimizing(true);

    try {
      const res = await fetch("/api/optimize-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          negative_prompt: negative,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Error optimizando prompt.");

      setOptimizedPrompt(String(data.optimizedPrompt || "").trim());
      setOptimizedNegative(String(data.optimizedNegative || "").trim());
      setUseOptimized(true);
      return {
        optimizedPrompt: String(data.optimizedPrompt || "").trim(),
        optimizedNegative: String(data.optimizedNegative || "").trim(),
      };
    } catch (e) {
      setOptError(e?.message || String(e));
      throw e;
    } finally {
      setIsOptimizing(false);
    }
  };

  const getEffectivePrompts = () => {
    const canUseOpt = useOptimized && optimizedPrompt?.trim()?.length > 0;
    return {
      finalPrompt: canUseOpt ? optimizedPrompt.trim() : (prompt || ""),
      finalNegative: canUseOpt ? (optimizedNegative || "").trim() : (negative || ""),
    };
  };

  // ---------------------------
  // Base64 helper
  // ---------------------------
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

  // ---------------------------
  // Poll video-status
  // ---------------------------
  const pollVideoStatus = async (job_id) => {
    const r = await fetch(`/api/video-status?job_id=${encodeURIComponent(job_id)}`);
    const data = await r.json().catch(() => null);
    if (!r.ok || !data) throw new Error(data?.error || "Error /api/video-status");
    return data;
  };

  // ✅ Rehidratación job activo i2v
  const rehydrateActiveI2V = async () => {
    if (!user) return null;

    const r = await fetch(`/api/video-status?mode=i2v`);
    const data = await r.json().catch(() => null);
    if (!r.ok || !data?.ok) return null;

    if (data.status === "IDLE" || !data.job_id) return null;

    setJobId(data.job_id);
    setStatus(data.status || "IN_PROGRESS");
    setStatusText(`Estado actual: ${data.status || "IN_PROGRESS"}... (rehidratado)`);

    if (data.video_url) setVideoUrl(data.video_url);
    return data;
  };

  // Auto-rehidratar al entrar
  useEffect(() => {
    setError("");
    setVideoUrl(null);

    if (!user) {
      setJobId(null);
      setStatus("IDLE");
      setStatusText("");
      return;
    }

    rehydrateActiveI2V().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // ---------------------------
  // Helpers presets
  // ---------------------------
  const clampInt = (v, min, max, fallback) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(n)));
  };

  // 9:16 recomendado para preview vertical:
  // 576x1024 (ligero) o 720x1280 (más pesado)
  const getResolution = () => {
    if (usePortrait916) return { width: 576, height: 1024 };
    // horizontal default (si lo quieres): 1024x576
    return { width: 1024, height: 576 };
  };

  const getFrames = () => {
    const sec = clampInt(seconds, 1, 10, 5);
    const _fps = clampInt(fps, 12, 30, 24);
    return { seconds: sec, fps: _fps, num_frames: sec * _fps };
  };

  // ---------------------------
  // Generar (COBRA + crea job)
  // ---------------------------
  const handleGenerate = async () => {
    setError("");
    setVideoUrl(null);

    if (!canUse) {
      setStatus("ERROR");
      setStatusText("Debes iniciar sesión.");
      setError("Debes iniciar sesión para usar Imagen → Video.");
      return;
    }

    // Si ya hay un job en progreso, solo rehidrata
    if (jobId && ["IN_QUEUE", "IN_PROGRESS", "DISPATCHED", "QUEUED", "RUNNING"].includes(status)) {
      setStatusText("Ya hay una generación en curso. Rehidratando estado...");
      await rehydrateActiveI2V();
      return;
    }

    setStatus("IN_QUEUE");
    setStatusText("Enviando Imagen → Video...");

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

      // ✅ Cobro (FRONTEND)
      if (typeof spendJades === "function") {
        await spendJades({ amount: cost, reason: "img2video" });
      }

      // ✅ Si el checkbox está marcado, optimiza AUTOMÁTICO aquí
      // - Solo optimiza si hay prompt base
      // - Si ya existe optimizedPrompt, lo usa sin reoptimizar
      let optP = optimizedPrompt;
      let optN = optimizedNegative;

      if (useOptimized && (prompt || "").trim().length > 0 && !(optimizedPrompt || "").trim()) {
        setStatusText("Optimizando prompt con IA...");
        const out = await handleOptimize(); // lanza /api/optimize-prompt
        optP = out?.optimizedPrompt || "";
        optN = out?.optimizedNegative || "";
      }

      const { finalPrompt, finalNegative } = getEffectivePrompts();

      // Presets
      const { width, height } = getResolution();
      const { fps: finalFps, num_frames } = getFrames();

      // ✅ Crear job
      const res = await fetch("/api/generate-img2video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // prompts normales
          prompt: (prompt || "").trim(),
          negative_prompt: (negative || "").trim(),

          // prompts optimizados (si aplica)
          use_optimized: !!useOptimized,
          optimized_prompt: (optP || "").trim(),
          optimized_negative_prompt: (optN || "").trim(),

          steps: Number(steps),

          // imagen
          image_b64: pureB64 || null,
          image_url: imageUrl || null,

          // ✅ presets: 9:16 y 5s
          width,
          height,
          fps: finalFps,
          num_frames,

          // ✅ evita doble cobro si backend cobra
          already_billed: true,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data?.job_id) throw new Error(data?.error || "Error /api/generate-img2video");

      const jid = data.job_id;
      setJobId(jid);
      setStatus("IN_PROGRESS");
      setStatusText(`Job enviado. ID: ${jid}. Generando...`);

      // Loop polling
      let finished = false;

      while (!finished) {
        await new Promise((r) => setTimeout(r, 3000));

        const stData = await pollVideoStatus(jid);
        const st = stData.status || "IN_PROGRESS";

        setStatus(st);
        setStatusText(`Estado actual: ${st}...`);

        if (["IN_QUEUE", "IN_PROGRESS", "DISPATCHED", "QUEUED", "RUNNING"].includes(st)) continue;

        finished = true;

        if (["COMPLETED", "DONE", "SUCCESS", "FINISHED"].includes(st)) {
          const maybeUrl = stData.video_url || stData.output?.video_url || null;
          if (!maybeUrl) throw new Error("Terminado pero sin video_url.");
          setVideoUrl(maybeUrl);
          setStatusText("Video generado con éxito.");
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

          {/* ✅ Presets: 9:16 y 5s */}
          <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <input
                  id="i2v916"
                  type="checkbox"
                  checked={usePortrait916}
                  onChange={(e) => setUsePortrait916(e.target.checked)}
                  className="h-4 w-4"
                />
                <label htmlFor="i2v916" className="text-[11px] text-neutral-300">
                  9:16 (vertical)
                </label>
              </div>

              <div className="ml-auto flex items-center gap-2">
                <span className="text-[11px] text-neutral-400">Duración</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={seconds}
                  onChange={(e) => setSeconds(Number(e.target.value))}
                  className="w-20 rounded-xl bg-black/60 px-2 py-1 text-[12px] text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
                />
                <span className="text-[11px] text-neutral-400">s</span>
              </div>
            </div>

            <div className="mt-2 text-[10px] text-neutral-500">
              Preset actual: {usePortrait916 ? "576x1024" : "1024x576"} · {seconds}s · {fps}fps (
              {Math.max(1, Math.floor(seconds)) * Math.max(12, Math.min(30, Math.floor(fps)))} frames)
            </div>
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

          {/* Optimizer */}
          <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
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
                id="useOptI2V"
                type="checkbox"
                checked={useOptimized}
                onChange={(e) => setUseOptimized(e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="useOptI2V" className="text-[11px] text-neutral-300">
                Usar prompt optimizado para generar (auto)
              </label>
              <span className="ml-auto text-[10px] text-neutral-500">
                {useOptimized ? "Activo (auto-optimiza al generar)" : "Mandará tu prompt"}
              </span>
            </div>

            {optError && <div className="mt-2 text-[11px] text-red-400 whitespace-pre-line">{optError}</div>}
          </div>

          {/* Steps + Botón */}
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