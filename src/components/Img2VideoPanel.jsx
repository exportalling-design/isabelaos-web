// src/components/Img2VideoPanel.jsx
// ---------------------------------------------------------
// Img2VideoPanel (Imagen -> Video)
// - Default 3s y 9:16 NO marcado
// - Selector 3s / 5s
// - Usa Authorization (getAuthHeadersGlobal) para evitar Unauthorized
// - Si "Usar prompt optimizado" está activo => manda optimizedPrompt/optimizedNegative
// ---------------------------------------------------------

import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { COSTS } from "../lib/pricing";

// ❗️NO export default
export function Img2VideoPanel({ userStatus, spendJades }) {
  const { user, getAuthHeadersGlobal } = useAuth();

  // ---------------------------
  // Inputs
  // ---------------------------
  const [dataUrl, setDataUrl] = useState(null);
  const [pureB64, setPureB64] = useState(null);
  const [imageUrl, setImageUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [steps, setSteps] = useState(25);

  // ✅ Default real:
  const [durationS, setDurationS] = useState(3); // default 3
  const [isVertical916, setIsVertical916] = useState(false); // no marcado

  // ---------------------------
  // Job state
  // ---------------------------
  const [status, setStatus] = useState("IDLE");
  const [statusText, setStatusText] = useState("");
  const [jobId, setJobId] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [error, setError] = useState("");

  // costo
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
        body: JSON.stringify({ prompt, negative_prompt: negative }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Error optimizando prompt.");

      setOptimizedPrompt(String(data.optimizedPrompt || "").trim());
      setOptimizedNegative(String(data.optimizedNegative || "").trim());
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
      finalPrompt: canUseOpt ? optimizedPrompt.trim() : (prompt || ""),
      finalNegative: canUseOpt ? (optimizedNegative || "").trim() : (negative || ""),
      usingOptimized: !!canUseOpt,
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
  // Poll status (con auth)
  // ---------------------------
  const pollVideoStatus = async (job_id) => {
    const auth = await getAuthHeadersGlobal();
    const r = await fetch(`/api/video-status?job_id=${encodeURIComponent(job_id)}`, {
      headers: { ...auth },
    });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data) throw new Error(data?.error || "Error /api/video-status");
    return data;
  };

  // ---------------------------
  // Generar
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

      // ✅ Cobro frontend (si lo estás usando así)
      if (typeof spendJades === "function") {
        await spendJades({ amount: cost, reason: "img2video" });
      }

      const { finalPrompt, finalNegative, usingOptimized } = getEffectivePrompts();

      // ✅ auth headers (CLAVE para no ver Unauthorized)
      const auth = await getAuthHeadersGlobal();

      // ✅ crea job
      const res = await fetch("/api/generate-img2video", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({
          prompt: finalPrompt || "",
          negative: finalNegative || "", // igual que generate-video (mapeo en backend)
          steps: Number(steps),

          // duración y aspect ratio igual que video
          duration_s: Number(durationS),
          aspect_ratio: isVertical916 ? "9:16" : "",

          // imagen
          image_b64: pureB64 || null,
          image_url: imageUrl || null,

          // si querés mostrar en logs
          use_optimized: usingOptimized,

          // ✅ evita doble cobro si backend todavía cobra (ideal: backend respeta esto)
          already_billed: true,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data?.job_id) throw new Error(data?.error || "Error /api/generate-img2video");

      const jid = data.job_id;
      setJobId(jid);
      setStatus("IN_PROGRESS");
      setStatusText(`Job enviado. ID: ${jid}. Generando...`);

      // polling
      let finished = false;
      while (!finished) {
        await new Promise((r) => setTimeout(r, 3000));

        const stData = await pollVideoStatus(jid);
        const st = stData.status || "IN_PROGRESS";

        setStatus(st);
        setStatusText(`Estado actual: ${st}...`);

        if (["IN_QUEUE", "IN_PROGRESS", "DISPATCHED", "QUEUED", "RUNNING", "submitted"].includes(st)) continue;

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

  // preset preview
  const fpsPreview = 24;
  const framesPreview = Math.round(fpsPreview * Number(durationS || 3));
  const presetText = isVertical916
    ? `Preset actual: 576×1024 · ${durationS}s · 24fps (${framesPreview} frames)`
    : `Preset actual: default · ${durationS}s · 24fps (${framesPreview} frames)`;

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

        {/* ✅ Barra igual a la de video: 9:16 + duración */}
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs text-neutral-200">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={isVertical916}
                onChange={(e) => setIsVertical916(e.target.checked)}
              />
              9:16 (vertical)
            </label>

            <div className="flex items-center gap-3 text-xs text-neutral-200">
              <span className="text-neutral-300">Duración</span>

              {/* ✅ selector 3/5 (no “solo 5”) */}
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="i2vDuration"
                  checked={Number(durationS) === 3}
                  onChange={() => setDurationS(3)}
                />
                3s
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="i2vDuration"
                  checked={Number(durationS) === 5}
                  onChange={() => setDurationS(5)}
                />
                5s
              </label>
            </div>
          </div>

          <div className="mt-2 text-[11px] text-neutral-400">{presetText}</div>
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
                {useOptimized && optimizedPrompt ? "Activo (mandará optimizado)" : "Mandará tu prompt"}
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