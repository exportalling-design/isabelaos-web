// src/components/Img2VideoPanel.jsx
// ---------------------------------------------------------
// Img2VideoPanel (Image -> Video)
// - Charges jades (frontend) and sends already_billed=true
// - Keeps full UI (prompt/negative/optimizer/steps)
// - Rehydrates active job (mode=i2v) to avoid losing state
// - FIX: Safe auth header builder (no "a is not a function")
// - UI parity: 9:16 checkbox (NOT default), duration presets 3s/5s (default 3)
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

  // ---------------------------
  // Presets (match Video panel behavior)
  // - Default duration = 3s
  // - 5s only if user selects it
  // - 9:16 checkbox exists but NOT checked by default
  // - Default base resolution stays 1024x576 (landscape)
  // - If 9:16 checked -> 576x1024 (vertical)
  // ---------------------------
  const [isVertical916, setIsVertical916] = useState(false); // NOT default
  const [durationS, setDurationS] = useState(3); // default 3s (user can switch to 5s)
  const fps = 24;

  const width = isVertical916 ? 576 : 1024;
  const height = isVertical916 ? 1024 : 576;
  const num_frames = Math.round(fps * durationS);

  // ---------------------------
  // Job state
  // ---------------------------
  const [status, setStatus] = useState("IDLE");
  const [statusText, setStatusText] = useState("");
  const [jobId, setJobId] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [error, setError] = useState("");

  // ✅ cost from central pricing (fallback 12)
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
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Prompt optimization failed.");

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
      setError("Could not read the image.");
    }
  };

  // ---------------------------
  // Auth headers (SAFE)
  // - Avoids "a is not a function" crashes
  // - Uses existing getAuthHeadersGlobal if present
  // - Falls back to Supabase auth token in localStorage
  // ---------------------------
  const getAuthHeadersSafe = async () => {
    try {
      // If your app exposes a global auth header function, use it (optional).
      // We keep it behind typeof check so it never throws.
      // eslint-disable-next-line no-undef
      if (typeof getAuthHeadersGlobal === "function") {
        // eslint-disable-next-line no-undef
        return await getAuthHeadersGlobal();
      }
    } catch {
      // ignore and fallback below
    }

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
      const key1 = supabaseUrl ? `sb-${supabaseUrl}-auth-token` : null;

      const raw =
        (key1 && localStorage.getItem(key1)) ||
        localStorage.getItem("supabase.auth.token") ||
        null;

      if (!raw) return {};

      const parsed = JSON.parse(raw);
      const access_token =
        parsed?.access_token ||
        parsed?.currentSession?.access_token ||
        parsed?.session?.access_token ||
        null;

      if (!access_token) return {};
      return { Authorization: `Bearer ${access_token}` };
    } catch {
      return {};
    }
  };

  // ---------------------------
  // Poll video-status (AUTHORIZED)
  // ---------------------------
  const pollVideoStatus = async (job_id) => {
    const auth = await getAuthHeadersSafe();

    const r = await fetch(`/api/video-status?job_id=${encodeURIComponent(job_id)}`, {
      headers: { ...auth },
    });

    const data = await r.json().catch(() => null);
    if (!r.ok || !data) throw new Error(data?.error || "Error calling /api/video-status");
    return data;
  };

  // ✅ Rehydrate active i2v job (keeps continuity if user reloads)
  // Note: Your /api/video-status must support mode=i2v, otherwise it will just no-op.
  const rehydrateActiveI2V = async () => {
    if (!user) return null;

    const auth = await getAuthHeadersSafe();

    const r = await fetch(`/api/video-status?mode=i2v`, {
      headers: { ...auth },
    });

    const data = await r.json().catch(() => null);
    if (!r.ok || !data?.ok) return null;

    if (data.status === "IDLE" || !data.job_id) return null;

    setJobId(data.job_id);
    setStatus(data.status || "IN_PROGRESS");
    setStatusText(`Current status: ${data.status || "IN_PROGRESS"}... (rehydrated)`);

    if (data.video_url) setVideoUrl(data.video_url);
    return data;
  };

  // Auto-rehydrate on enter
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
  // Generate (CHARGE + create job)
  // ---------------------------
  const handleGenerate = async () => {
    setError("");
    setVideoUrl(null);

    if (!canUse) {
      setStatus("ERROR");
      setStatusText("You must be logged in.");
      setError("You must be logged in to use Image → Video.");
      return;
    }

    // If there is already an active job, rehydrate instead of creating another
    if (jobId && ["IN_QUEUE", "IN_PROGRESS", "DISPATCHED", "QUEUED", "RUNNING"].includes(status)) {
      setStatusText("A generation is already running. Rehydrating status...");
      await rehydrateActiveI2V();
      return;
    }

    setStatus("IN_QUEUE");
    setStatusText("Sending Image → Video...");

    try {
      if (!hasEnough) {
        setStatus("ERROR");
        setStatusText("Not enough jades.");
        setError(`You need ${cost} jades.`);
        return;
      }

      if (!pureB64 && !imageUrl) {
        setStatus("ERROR");
        setStatusText("Missing image.");
        setError("Upload an image or paste a URL.");
        return;
      }

      // ✅ Charge jades (FRONTEND)
      if (typeof spendJades === "function") {
        await spendJades({ amount: cost, reason: "img2video" });
      }

      const { finalPrompt, finalNegative } = getEffectivePrompts();

      // ✅ Auth header
      const auth = await getAuthHeadersSafe();

      // ✅ Create job
      const res = await fetch("/api/generate-img2video", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({
          prompt: finalPrompt || "",
          negative_prompt: finalNegative || "",
          steps: Number(steps),

          // Preset controls
          fps,
          duration_s: Number(durationS),
          num_frames,
          width,
          height,
          aspect_ratio: isVertical916 ? "9:16" : "",

          image_b64: pureB64 || null,
          image_url: imageUrl || null,

          // ✅ Avoid double-charge if backend also charges
          already_billed: true,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data?.job_id) throw new Error(data?.error || "Error calling /api/generate-img2video");

      const jid = data.job_id;
      setJobId(jid);
      setStatus("IN_PROGRESS");
      setStatusText(`Job submitted. ID: ${jid}. Generating...`);

      // Poll loop
      let finished = false;

      while (!finished) {
        await new Promise((r) => setTimeout(r, 3000));

        const stData = await pollVideoStatus(jid);
        const st = stData.status || "IN_PROGRESS";

        setStatus(st);
        setStatusText(`Current status: ${st}...`);

        if (["IN_QUEUE", "IN_PROGRESS", "DISPATCHED", "QUEUED", "RUNNING"].includes(st)) continue;

        finished = true;

        if (["COMPLETED", "DONE", "SUCCESS", "FINISHED"].includes(st)) {
          const maybeUrl = stData.video_url || stData.output?.video_url || null;
          if (!maybeUrl) throw new Error("Completed but missing video_url.");
          setVideoUrl(maybeUrl);
          setStatusText("Video generated successfully.");
        } else {
          throw new Error(stData.error || "Video generation failed.");
        }
      }
    } catch (err) {
      console.error(err);
      setStatus("ERROR");
      setStatusText("Failed to generate video.");
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
        You must be logged in to use Image → Video.
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">Visual transformation · Image to video</h2>

        <div className="mt-4 rounded-2xl border border-white/10 bg-black/50 px-4 py-2 text-xs text-neutral-300">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Status: {statusText || "Ready."}</span>
            <span className="text-[11px] text-neutral-400">
              Jades: <span className="font-semibold text-white">{userStatus?.jades ?? "..."}</span>
            </span>
          </div>

          <div className="mt-1 text-[11px] text-neutral-400">
            Cost: <span className="font-semibold text-white">{cost}</span> jades per video
          </div>

          {jobId && <div className="mt-1 text-[10px] text-neutral-500">Job: {jobId}</div>}
        </div>

        {/* Preset controls */}
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs text-neutral-200">
              <input
                type="checkbox"
                checked={isVertical916}
                onChange={(e) => setIsVertical916(e.target.checked)}
                className="h-4 w-4"
              />
              9:16 (vertical)
            </label>

            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-300">Duration</span>

              <button
                type="button"
                onClick={() => setDurationS(3)}
                className={`rounded-xl border px-3 py-1 text-[11px] ${
                  durationS === 3
                    ? "border-cyan-400/60 bg-cyan-500/10 text-white"
                    : "border-white/15 text-neutral-200 hover:bg-white/5"
                }`}
              >
                3s
              </button>

              <button
                type="button"
                onClick={() => setDurationS(5)}
                className={`rounded-xl border px-3 py-1 text-[11px] ${
                  durationS === 5
                    ? "border-cyan-400/60 bg-cyan-500/10 text-white"
                    : "border-white/15 text-neutral-200 hover:bg-white/5"
                }`}
              >
                5s
              </button>
            </div>
          </div>

          <div className="mt-2 text-[11px] text-neutral-400">
            Current preset: <span className="text-white">{width}×{height}</span> ·{" "}
            <span className="text-white">{durationS}s</span> ·{" "}
            <span className="text-white">{fps}fps</span> ({num_frames} frames)
          </div>
        </div>

        <div className="mt-4 space-y-4 text-sm">
          <div>
            <p className="text-xs text-neutral-300">1. Upload your image</p>
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
                <img src={dataUrl} alt="Base" className="w-full object-cover" />
              </div>
            )}
          </div>

          <div>
            <p className="text-xs text-neutral-300">or paste a URL</p>
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
            />
          </div>

          <div>
            <label className="text-neutral-300">Negative (optional)</label>
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

          {/* Steps + Button */}
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