// src/components/Img2VideoPanel.jsx
// ---------------------------------------------------------
// Img2VideoPanel (Image -> Video)
// - AUTH: uses supabase session token (same as VideoFromPromptPanel)
// - Duration: default 3s, checkbox 5s optional
// - Aspect ratio: 9:16 checkbox (NOT checked by default)
// - Prompt Optimizer: if "Use optimized" is checked, it auto-optimizes on Generate
// - Billing assumed SERVER-SIDE (like generate-video)
// ---------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabaseClient";
import { COSTS } from "../lib/pricing";

export function Img2VideoPanel({ userStatus }) {
  const { user } = useAuth();

  // ---------------------------
  // Inputs
  // ---------------------------
  const [dataUrl, setDataUrl] = useState(null);
  const [pureB64, setPureB64] = useState(null);
  const [imageUrl, setImageUrl] = useState("");

  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [steps, setSteps] = useState(18);

  // ✅ UI like VideoFromPromptPanel
  const [useNineSixteen, setUseNineSixteen] = useState(false); // NOT default
  const [durationSec, setDurationSec] = useState(3); // default 3s
  const fps = 16;

  // ---------------------------
  // Job state
  // ---------------------------
  const [status, setStatus] = useState("IDLE");
  const [statusText, setStatusText] = useState("");
  const [jobId, setJobId] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [error, setError] = useState("");

  // ✅ Progress UI
  const [progress, setProgress] = useState(0); // 0..100
  const [needsManualRefresh, setNeedsManualRefresh] = useState(false);
  const [lastKnownJob, setLastKnownJob] = useState(null); // for started_at, etc.

  const COST_I2V = COSTS?.IMG2VIDEO ?? 12;
  const currentJades = userStatus?.jades ?? 0;
  const hasEnough = currentJades >= COST_I2V;

  const fileInputId = "img2video-file-input";
  const lockRef = useRef(false);

  // Poll control refs
  const pollTimerRef = useRef(null);
  const progTimerRef = useRef(null);
  const currentParamsRef = useRef({ steps: 25, numFrames: 72, durationSec: 3, fps: 24 });

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
    // do NOT auto-disable the checkbox; user may want it enabled always
  }, [prompt, negative]);

  async function getAuthHeaders() {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token || null;
    if (!token) throw new Error("MISSING_AUTH_TOKEN");
    return { Authorization: `Bearer ${token}` };
  }

  // ✅ JSON safe parse (same pattern you use in T2V)
  async function safeFetchJson(url, options = {}) {
    const r = await fetch(url, options);
    const txt = await r.text();
    let j = null;
    try {
      j = JSON.parse(txt);
    } catch {
      j = { ok: false, error: txt?.slice(0, 300) || "Server returned non-JSON response." };
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
        body: JSON.stringify({
          prompt,
          negative_prompt: negative || "",
        }),
      });

      if (!r.ok || !j?.ok) throw new Error(j?.error || "Prompt optimization failed.");

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
      setError("");
    } catch {
      setError("Could not read the image.");
    }
  };

  // ---------------------------
  // Poll video-status (job_id)
  // ---------------------------
  async function pollVideoStatus(job_id) {
    const auth = await getAuthHeaders();
    const { r, j } = await safeFetchJson(`/api/video-status?job_id=${encodeURIComponent(job_id)}`, {
      headers: { ...auth },
    });
    if (!r.ok || !j) throw new Error(j?.error || "video-status error");
    return j;
  }

  const setErrorState = (msg) => {
    setStatus("ERROR");
    setStatusText("Error.");
    setError(msg || "An error occurred.");
  };

  // ✅ helpers for duration checkboxes (only one active)
  const setDuration3 = () => setDurationSec(3);
  const setDuration5 = () => setDurationSec(5);

  // ---------------------------
  // Progress helpers (front-only estimation)
  // ---------------------------
  function isFetchDisconnectError(e) {
    const m = String(e?.message || e || "").toLowerCase();
    return (
      m.includes("failed to fetch") ||
      m.includes("networkerror") ||
      m.includes("network request failed") ||
      m.includes("load failed") ||
      m.includes("fetch") // keep broad for mobile webviews
    );
  }

  function getExpectedSeconds() {
    // Estimación estable (solo UI): depende de steps + frames.
    // Mantiene progreso suave y NO toca backend.
    const p = currentParamsRef.current || {};
    const s = Number(p.steps || 25);
    const f = Number(p.numFrames || 72);
    // base + coeficientes (suave)
    const est = 35 + s * 2.0 + f * 1.2; // ~130s default
    return Math.max(45, Math.min(420, est));
  }

  function computeProgressFromStartedAt(startedAtIso) {
    if (!startedAtIso) return Math.max(progress, 5);
    const startedAtMs = new Date(startedAtIso).getTime();
    if (!isFinite(startedAtMs)) return Math.max(progress, 5);

    const elapsedS = Math.max(0, (Date.now() - startedAtMs) / 1000);
    const expected = getExpectedSeconds();

    // Sube hasta 95% mientras corre
    const raw = (elapsedS / expected) * 95;
    const clamped = Math.max(3, Math.min(95, Math.round(raw)));
    return clamped;
  }

  function stopPolling() {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (progTimerRef.current) {
      clearInterval(progTimerRef.current);
      progTimerRef.current = null;
    }
  }

  async function refreshStatusOnce() {
    if (!jobId) return;
    try {
      setNeedsManualRefresh(false);
      setError("");

      const stData = await pollVideoStatus(jobId);
      const st = stData?.status || "IN_PROGRESS";

      // Guardar job si viene
      if (stData?.job) setLastKnownJob(stData.job);

      if (["COMPLETED", "DONE", "SUCCESS", "FINISHED"].includes(st)) {
        const url = stData.video_url || stData.output?.video_url || stData.output?.videoUrl || null;
        if (url) {
          setVideoUrl(url);
          setStatus("DONE");
          setStatusText("Video ready.");
          setProgress(100);
          stopPolling();
          return;
        }
        // DONE pero sin url
        setStatus("DONE");
        setStatusText("Finished.");
        setProgress(100);
        stopPolling();
        return;
      }

      if (st === "FAILED") {
        setStatus("FAILED");
        setStatusText("Failed.");
        setError(stData?.error || "Generation failed.");
        setProgress(0);
        stopPolling();
        return;
      }

      // sigue
      setStatus("IN_PROGRESS");
      setStatusText(`Status: ${stData?.rp_status || st}`);
      const startedAt = stData?.job?.started_at || lastKnownJob?.started_at || null;
      if (startedAt) setProgress((p) => Math.max(p, computeProgressFromStartedAt(startedAt)));
    } catch (e) {
      // ✅ NO matamos el job por errores de red
      if (isFetchDisconnectError(e)) {
        setNeedsManualRefresh(true);
        setStatus("IN_PROGRESS");
        setStatusText("Connection lost.");
        setError("Connection lost. Click “Update status”.");
        return;
      }
      // otros errores sí los mostramos
      setErrorState(e?.message || String(e));
    }
  }

  function startPolling(job_id, startedAtIsoMaybe) {
    stopPolling();

    // progreso suave cada 1s (solo si no está DONE)
    progTimerRef.current = setInterval(() => {
      const startedAt = startedAtIsoMaybe || lastKnownJob?.started_at || null;
      if (!startedAt) return;
      setProgress((p) => {
        const next = computeProgressFromStartedAt(startedAt);
        return Math.max(p, next);
      });
    }, 1000);

    // polling status (rápido al inicio, luego más suave)
    let tick = 0;
    pollTimerRef.current = setInterval(async () => {
      tick += 1;

      // si el user está en manual refresh mode, no spamear
      if (needsManualRefresh) return;

      // primeros ~15s cada 2s, luego cada 5s (hacemos “skip”)
      if (tick <= 8) {
        // correr siempre (2s interval)
        await refreshStatusOnce();
      } else {
        // cada 5s aprox si interval es 2s => uno de cada 3
        if (tick % 3 === 0) await refreshStatusOnce();
      }
    }, 2000);
  }

  // ✅ refrescar al volver al tab (móvil)
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && jobId) {
        refreshStatusOnce();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // cleanup on unmount
  useEffect(() => {
    return () => stopPolling();
  }, []);

  // ---------------------------
  // Generate
  // ---------------------------
  async function handleGenerate() {
    if (lockRef.current) return;
    lockRef.current = true;

    try {
      setError("");
      setVideoUrl(null);
      setProgress(0);
      setNeedsManualRefresh(false);
      setLastKnownJob(null);

      if (!user) return setErrorState("You must be logged in to use Image → Video.");
      if (!hasEnough) return setErrorState(`You need ${COST_I2V} jades to generate Image → Video.`);

      if (!pureB64 && !imageUrl) return setErrorState("Upload an image or paste an image URL.");

      // ✅ If user enabled "Use optimized" but hasn't optimized yet, auto-optimize now
      if (useOptimized && (!optimizedPrompt || optimizedPrompt.trim().length === 0)) {
        if (!prompt?.trim()) return setErrorState("Type a prompt or disable optimized prompt.");
        await handleOptimize(); // sets optimizedPrompt/Negative
      }

      const { finalPrompt, finalNegative } = getEffectivePrompts();

      setStatus("STARTING");
      setStatusText("Submitting job...");

      const auth = await getAuthHeaders();
      const numFrames = Math.max(1, Math.round(Number(durationSec) * fps));
      const aspect_ratio = useNineSixteen ? "9:16" : "";

      // keep params for progress estimate
      currentParamsRef.current = { steps: Number(steps), numFrames, durationSec: Number(durationSec), fps: Number(fps) };

      // IMPORTANT:
      // Make sure your API route name matches this path:
      // - file: /api/generate-img2video.js  -> /api/generate-img2video
      // If your file is named /api/generar-img2video.js then call /api/generar-img2video instead.
      const { r, j } = await safeFetchJson("/api/generate-img2video", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({
          mode: "i2v",

          prompt: finalPrompt || "",
          negative_prompt: finalNegative || "",

          // ratio only if checked
          ...(aspect_ratio ? { aspect_ratio } : {}),

          duration_s: Number(durationSec),
          fps,
          num_frames: numFrames,

          steps: Number(steps),

          image_b64: pureB64 || null,
          image_url: imageUrl || null,
        }),
      });

      if (!r.ok || !j?.ok || !j?.job_id) {
        throw new Error(j?.error || "Could not create Image → Video job.");
      }

      const jid = j.job_id;
      setJobId(jid);
      setStatus("IN_PROGRESS");
      setStatusText(`Generating... Job: ${jid}`);
      setProgress(3);

// primer refresh inmediato + polling
      // NOTA: video-status devuelve job.started_at cuando ya está IN_PROGRESS; al inicio puede ser null.
      await new Promise((t) => setTimeout(t, 700));
      await refreshStatusOnce();
      const startedAt = lastKnownJob?.started_at || null;
      startPolling(jid, startedAt);
    } catch (e) {
      // si es red, no matar; mostrar botón actualizar
      if (isFetchDisconnectError(e) && jobId) {
        setNeedsManualRefresh(true);
        setStatus("IN_PROGRESS");
        setStatusText("Connection lost.");
        setError("Connection lost. Click “Update status”.");
      } else {
        setErrorState(e?.message || String(e));
      }
    } finally {
      lockRef.current = false;
    }
  }

  const handleDownload = () => {
    if (!videoUrl) return;
    const link = document.createElement("a");
    link.href = videoUrl;
    link.download = "isabelaos-img2video.mp4";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleUpdateStatus = async () => {
    await refreshStatusOnce();
  };

  if (!user) {
    return (
      <div className="rounded-3xl border border-yellow-400/30 bg-yellow-500/5 p-6 text-center text-sm text-yellow-100">
        You must be logged in to use Image → Video.
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">Image → Video</h2>

        <div className="mt-4 rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-xs text-neutral-300">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Status: {statusText || "Ready."}</span>
            <span className="text-[11px] text-neutral-400">
              Jades: <span className="font-semibold text-white">{userStatus?.jades ?? "..."}</span>
            </span>
          </div>

          <div className="mt-1 text-[11px] text-neutral-400">
            Cost: <span className="font-semibold text-white">{COST_I2V}</span> jades per video
          </div>

          {jobId && <div className="mt-1 text-[10px] text-neutral-500">Job: {jobId}</div>}

          {/* ✅ Progress bar */}
          {(status === "IN_PROGRESS" || status === "STARTING" || status === "DONE") && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-[10px] text-neutral-400">
                <span>Progress</span>
                <span className="text-neutral-300">{Math.max(0, Math.min(100, Number(progress) || 0))}%</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-fuchsia-500 transition-all duration-300"
                  style={{ width: `${Math.max(0, Math.min(100, Number(progress) || 0))}%` }}
                />
              </div>
              {needsManualRefresh && (
                <div className="mt-2 text-[11px] text-yellow-200">
                  Connection lost. Click <span className="font-semibold">“Update status”</span>.
                </div>
              )}
            </div>
          )}

          {/* ✅ Update status button */}
          {jobId && (status === "IN_PROGRESS" || status === "ERROR" || needsManualRefresh) && (
            <div className="mt-3">
              <button
                type="button"
                onClick={handleUpdateStatus}
                className="w-full rounded-xl border border-white/20 px-3 py-2 text-[11px] text-white hover:bg-white/10"
              >
                Update status
              </button>
            </div>
          )}
        </div>

        {/* Format + Duration like T2V */}
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
            <div className="text-xs text-neutral-300">Format / size</div>

            <div className="mt-3 flex items-center gap-2">
              <input
                id="i2v_916"
                type="checkbox"
                checked={useNineSixteen}
                onChange={(e) => setUseNineSixteen(e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="i2v_916" className="text-[12px] text-neutral-200">
                9:16 (Reels / TikTok)
              </label>
            </div>

            <div className="mt-2 text-[10px] text-neutral-500">
              {useNineSixteen ? "Will send 9:16" : "Will send default (faster)"}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
            <div className="text-xs text-neutral-300">Duration</div>

            <div className="mt-3 flex items-center gap-2">
              <input
                id="i2v_3s"
                type="checkbox"
                checked={durationSec === 3}
                onChange={(e) => (e.target.checked ? setDuration3() : null)}
                className="h-4 w-4"
              />
              <label htmlFor="i2v_3s" className="text-[12px] text-neutral-200">
                3 seconds (default)
              </label>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <input
                id="i2v_5s"
                type="checkbox"
                checked={durationSec === 5}
                onChange={(e) => (e.target.checked ? setDuration5() : null)}
                className="h-4 w-4"
              />
              <label htmlFor="i2v_5s" className="text-[12px] text-neutral-200">
                5 seconds (optional)
              </label>
            </div>

            <div className="mt-2 text-[10px] text-neutral-500">
              fps: {fps} · frames: {Math.round(Number(durationSec) * fps)}
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-4 text-sm">
          <div>
            <p className="text-xs text-neutral-300">1. Upload an image</p>
            <button
              type="button"
              onClick={handlePickFile}
              className="mt-2 flex h-40 w-full items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/60 text-xs text-neutral-400 hover:border-cyan-400 hover:text-cyan-300"
            >
              {dataUrl ? "Change image" : "Click to upload an image"}
            </button>

            <input id={fileInputId} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

            {dataUrl && (
              <div className="mt-3 overflow-hidden rounded-2xl border border-white/10">
                <img src={dataUrl} alt="Base image" className="w-full object-cover" />
              </div>
            )}
          </div>

          <div>
            <p className="text-xs text-neutral-300">or paste an image URL</p>
            <input
              type="text"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://..."
              className="mt-2 w-full rounded-2xl bg-black/60 px-3 py-2 text-xs text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
            />
          </div>

          <div>
            <label className="text-neutral-300">Prompt (optional)</label>
            <textarea
              className="mt-1 h-20 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe motion, camera, mood..."
            />
          </div>

          <div>
            <label className="text-neutral-300">Negative (optional)</label>
            <textarea
              className="mt-1 h-16 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              value={negative}
              onChange={(e) => setNegative(e.target.value)}
              placeholder="blurry, low quality, deformed..."
            />
          </div>

          {/* Optimizer */}
          <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-neutral-300">
                Prompt optimization (OpenAI)
                {optimizedPrompt ? (
                  <span className="ml-2 text-[10px] text-emerald-300/90">Ready ✓</span>
                ) : (
                  <span className="ml-2 text-[10px] text-neutral-400">Optional</span>
                )}
              </div>

              <button
                type="button"
                onClick={handleOptimize}
                disabled={isOptimizing || !prompt?.trim()}
                className="rounded-xl border border-white/20 px-3 py-1 text-[11px] text-white hover:bg-white/10 disabled:opacity-60"
              >
                {isOptimizing ? "Optimizing..." : "Optimize with AI"}
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
                Use optimized prompt for generation (auto)
              </label>
              <span className="ml-auto text-[10px] text-neutral-500">
                {useOptimized && optimizedPrompt ? "Active (will send optimized)" : "Will send your prompt"}
              </span>
            </div>

            {optError && <div className="mt-2 text-[11px] text-red-400 whitespace-pre-line">{optError}</div>}
          </div>

          {/* Steps + Generate */}
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
                disabled={status === "STARTING" || status === "IN_PROGRESS" || !hasEnough}
                className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {status === "STARTING" || status === "IN_PROGRESS"
                  ? "Generating..."
                  : !hasEnough
                  ? "Not enough jades"
                  : "Generate Image → Video"}
              </button>
            </div>
          </div>

          {error && <p className="text-xs text-red-400 whitespace-pre-line">{error}</p>}
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-black/40 p-6 flex flex-col">
        <h2 className="text-lg font-semibold text-white">Result</h2>

        <div className="mt-4 flex h-[420px] flex-1 items-center justify-center rounded-2xl bg-black/70 text-sm text-neutral-400">
          {videoUrl ? (
            <video src={videoUrl} controls className="h-full w-full rounded-2xl object-contain" />
          ) : (
            <p>You will see the video here when it finishes.</p>
          )}
        </div>

        {videoUrl && (
          <button
            onClick={handleDownload}
            className="mt-4 w-full rounded-2xl border border-white/30 py-2 text-xs text-white hover:bg-white/10"
          >
            Download video
          </button>
        )}
      </div>
    </div>
  );
}