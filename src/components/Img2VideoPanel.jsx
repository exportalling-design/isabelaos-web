import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabaseClient";

export function Img2VideoPanel({ userStatus }) {
  const { user } = useAuth();

  const STORAGE_KEY = user?.id ? `i2v_job_state_${user.id}` : "i2v_job_state_guest";

  const [dataUrl, setDataUrl] = useState(null);
  const [pureB64, setPureB64] = useState(null);
  const [imageUrl, setImageUrl] = useState("");

  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");

  const [steps, setSteps] = useState(18);
  const [guidanceScale, setGuidanceScale] = useState(5.0);
  const [strength, setStrength] = useState(0.65);
  const [motionStrength, setMotionStrength] = useState(1.0);

  const [seedMode, setSeedMode] = useState("RANDOM");
  const [seedFixed, setSeedFixed] = useState(12345);

  const [generationMode, setGenerationMode] = useState("standard");
  const [useNineSixteen, setUseNineSixteen] = useState(true);
  const [durationSec, setDurationSec] = useState(10);

  const [includeAudio, setIncludeAudio] = useState(false);

  const fps = 16;

  const [status, setStatus] = useState("IDLE");
  const [statusText, setStatusText] = useState("");
  const [jobId, setJobId] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [error, setError] = useState("");

  const [progress, setProgress] = useState(0);
  const [needsManualRefresh, setNeedsManualRefresh] = useState(false);
  const [lastKnownJob, setLastKnownJob] = useState(null);

  const currentJades = userStatus?.jades ?? 0;

  const fileInputId = "img2video-file-input";
  const lockRef = useRef(false);

  const pollTimerRef = useRef(null);
  const progTimerRef = useRef(null);

  const currentParamsRef = useRef({
    steps: 18,
    numFrames: 161,
    durationSec: 10,
    fps: 16,
    generationMode: "standard",
  });

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

  useEffect(() => {
    if (generationMode === "express") {
      setDurationSec(8);
    } else if (generationMode === "standard") {
      if (![10, 15].includes(Number(durationSec))) {
        setDurationSec(10);
      }
    } else {
      setDurationSec(5);
      setIncludeAudio(false);
    }
  }, [generationMode, durationSec]);

  function getDurationOptions() {
    if (generationMode === "express") return [8];
    if (generationMode === "standard") return [10, 15];
    return [5];
  }

  function getCurrentPrice() {
    let base = 0;

    if (generationMode === "express") {
      base = 18;
    } else if (generationMode === "standard") {
      base = Number(durationSec) === 15 ? 24 : 17;
    } else {
      base = 11;
    }

    if ((generationMode === "express" || generationMode === "standard") && includeAudio) {
      base += 4;
    }

    return base;
  }

  const COST_I2V = getCurrentPrice();
  const hasEnough = currentJades >= COST_I2V;

  function getPriceText() {
    if (generationMode === "express") {
      return includeAudio
        ? "Express • 8s = 18 jades • Audio Layer +4 jades"
        : "Express • 8s = 18 jades";
    }

    if (generationMode === "standard") {
      const baseText =
        Number(durationSec) === 15
          ? "Standard • 15s = 24 jades"
          : "Standard • 10s = 17 jades";

      return includeAudio ? `${baseText} • Audio Layer +4 jades` : baseText;
    }

    return "Studio • 5s = 11 jades";
  }

  function getAllPricesText() {
    return "Precios: Express 8s = 18 jades • Express Audio Layer +4 jades • Standard 10s = 17 jades • Standard 15s = 24 jades • Standard Audio Layer +4 jades • Studio 5s = 11 jades";
  }

  function getModeDescription() {
    if (generationMode === "express") {
      return "Modo premium rápido con la mejor calidad de video.";
    }
    if (generationMode === "standard") {
      return "Modo equilibrado para clips más largos y más económicos.";
    }
    return "Modo local con mayor tiempo de espera.";
  }

  function getAudioHelpText() {
    if (generationMode === "express") {
      return includeAudio
        ? "Audio Layer activado: el modelo puede devolver voz o sonido si lo describes en el prompt."
        : "Audio Layer apagado: aunque escribas diálogo en el prompt, el backend forzará un video silencioso.";
    }

    if (generationMode === "standard") {
      return includeAudio
        ? "Audio Layer activado: prueba voz o sonido directamente desde el prompt."
        : "Audio Layer apagado: el backend forzará un video silencioso.";
    }

    return "Studio no soporta audio.";
  }

  async function getAuthHeaders() {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token || null;
    if (!token) throw new Error("MISSING_AUTH_TOKEN");
    return { Authorization: `Bearer ${token}` };
  }

  async function safeFetchJson(url, options = {}) {
    const r = await fetch(url, options);
    const txt = await r.text();

    let j = null;
    try {
      j = JSON.parse(txt);
    } catch {
      j = { ok: false, error: txt?.slice(0, 500) || "El servidor devolvió una respuesta no JSON." };
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

      if (!r.ok || !j?.ok) throw new Error(j?.error || "Falló la optimización del prompt.");

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
    };
  };

  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });

  async function compressImageFile(file, maxWidth = 1280, quality = 0.82) {
    const originalDataUrl = await fileToBase64(file);

    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const width = Math.round(img.width * scale);
        const height = Math.round(img.height * scale);

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas no soportado"));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        const compressed = canvas.toDataURL("image/jpeg", quality);
        resolve(compressed);
      };

      img.onerror = () => reject(new Error("No se pudo cargar la imagen para comprimirla"));
      img.src = originalDataUrl;
    });
  }

  function estimateBase64Bytes(b64) {
    const len = String(b64 || "").length;
    return Math.ceil((len * 3) / 4);
  }

  const handlePickFile = () => {
    const input = document.getElementById(fileInputId);
    if (input) input.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const compressedDataUrl = await compressImageFile(file, 1280, 0.82);
      setDataUrl(compressedDataUrl);

      const parts = String(compressedDataUrl).split(",");
      const onlyB64 = parts[1] || null;

      const estimatedBytes = estimateBase64Bytes(onlyB64);

      if (estimatedBytes > 1400000) {
        setError("La imagen sigue siendo demasiado grande después de comprimirla. Usa una imagen más pequeña o recórtala primero.");
        setPureB64(null);
        return;
      }

      setPureB64(onlyB64);
      setImageUrl("");
      setError("");
    } catch {
      setError("No se pudo leer o comprimir la imagen.");
    }
  };

  async function pollVideoStatus(job_id) {
    const auth = await getAuthHeaders();
    const { r, j } = await safeFetchJson(
      `/api/video-status?job_id=${encodeURIComponent(job_id)}`,
      {
        headers: { ...auth },
      }
    );

    if (!r.ok || !j) throw new Error(j?.error || "error en video-status");
    return j;
  }

  const setErrorState = (msg) => {
    setStatus("ERROR");
    setStatusText("Error.");
    setError(msg || "Ocurrió un error.");
  };

  function clampInt(v, lo, hi, def) {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    const r = Math.round(n);
    return Math.max(lo, Math.min(hi, r));
  }

  function clampFloat(v, lo, hi, def) {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.max(lo, Math.min(hi, n));
  }

  function fixFramesForWan(numFrames) {
    let nf = Math.max(5, Math.round(Number(numFrames) || 0));
    const r = (nf - 1) % 4;
    if (r === 0) return nf;
    return nf + (4 - r);
  }

  function getSeedForRequest() {
    if (seedMode === "FIXED") return clampInt(seedFixed, 0, 2147483647, 12345);
    return Math.floor(Date.now() % 2147483647);
  }

  function isFetchDisconnectError(e) {
    const m = String(e?.message || e || "").toLowerCase();
    return (
      m.includes("failed to fetch") ||
      m.includes("networkerror") ||
      m.includes("network request failed") ||
      m.includes("load failed") ||
      m.includes("fetch")
    );
  }

  function getExpectedSeconds() {
    const p = currentParamsRef.current || {};
    const s = Number(p.steps || 18);
    const f = Number(p.numFrames || 129);
    const dur = Number(p.durationSec || 8);
    const mode = String(p.generationMode || "express");

    const baseByMode = {
      express: 220,
      standard: dur >= 15 ? 480 : 360,
      studio: 1080,
    };

    const base = baseByMode[mode] || 300;
    const stepAdj = Math.max(0, (s - 18) * 8);
    const frameAdj = Math.max(0, (f - 129) * 2);

    const est = base + stepAdj + frameAdj;
    return Math.max(60, Math.min(1800, est));
  }

  function computeProgressFromStartedAt(startedAtIso) {
    if (!startedAtIso) return Math.max(progress, 2);

    const startedAtMs = new Date(startedAtIso).getTime();
    if (!Number.isFinite(startedAtMs)) return Math.max(progress, 2);

    const elapsedS = Math.max(0, (Date.now() - startedAtMs) / 1000);
    const expected = getExpectedSeconds();
    const t = Math.min(1, elapsedS / expected);

    let p = 3;
    if (t <= 0.2) {
      p = 3 + (t / 0.2) * 22;
    } else if (t <= 0.85) {
      p = 25 + ((t - 0.2) / 0.65) * 60;
    } else if (t <= 0.97) {
      p = 85 + ((t - 0.85) / 0.12) * 7;
    } else {
      p = 92;
    }

    return Math.max(3, Math.min(92, Math.round(p)));
  }

  function getEtaText() {
    if (generationMode === "express") {
      return "Espera estimada: 2-4 min";
    }

    if (generationMode === "standard") {
      return Number(durationSec) === 15
        ? "Espera estimada: 4-8 min"
        : "Espera estimada: 3-6 min";
    }

    return "Espera estimada: 15-25 min";
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

  function clearPersistedJob() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  function hardResetPanel() {
    stopPolling();

    setStatus("IDLE");
    setStatusText("");
    setJobId(null);
    setVideoUrl(null);
    setError("");
    setProgress(0);
    setNeedsManualRefresh(false);
    setLastKnownJob(null);

    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  async function refreshStatusOnce(overrideJobId = null) {
    const jid = overrideJobId || jobId;
    if (!jid) return;

    try {
      setNeedsManualRefresh(false);
      setError("");

      const stData = await pollVideoStatus(jid);
      const st = String(stData?.status || "IN_PROGRESS").toUpperCase();

      if (stData?.job) setLastKnownJob(stData.job);

      if (["DONE", "COMPLETED", "SUCCESS", "FINISHED"].includes(st)) {
        const url =
          stData?.video_url ||
          stData?.output?.video_url ||
          stData?.output?.videoUrl ||
          stData?.output?.video?.url ||
          null;

        if (url) {
          setVideoUrl(url);
        }

        setStatus("DONE");
        setStatusText("Video listo.");
        setProgress(100);
        stopPolling();
        clearPersistedJob();
        return;
      }

      if (st === "FAILED" || st === "ERROR") {
        setStatus("FAILED");
        setStatusText("Falló.");
        setError(stData?.error || "La generación falló.");
        setProgress(0);
        stopPolling();
        clearPersistedJob();
        return;
      }

      setStatus("IN_PROGRESS");
      setStatusText(`Estado: ${stData?.rp_status || stData?.status || "IN_PROGRESS"}`);

      const startedAt = stData?.job?.started_at || lastKnownJob?.started_at || null;

      if (startedAt) {
        setProgress((p) => Math.max(p, computeProgressFromStartedAt(startedAt)));
      }
    } catch (e) {
      if (isFetchDisconnectError(e)) {
        setNeedsManualRefresh(true);
        setStatus("IN_PROGRESS");
        setStatusText("Conexión perdida.");
        setError('Conexión perdida. Haz clic en "Actualizar estado".');
        return;
      }

      setErrorState(e?.message || String(e));
    }
  }

  function startPolling(job_id, startedAtIsoMaybe) {
    stopPolling();

    progTimerRef.current = setInterval(() => {
      const startedAt = startedAtIsoMaybe || lastKnownJob?.started_at || null;
      if (!startedAt) return;

      setProgress((p) => {
        const next = computeProgressFromStartedAt(startedAt);
        return Math.max(p, next);
      });
    }, 1000);

    let tick = 0;
    pollTimerRef.current = setInterval(async () => {
      tick += 1;
      if (needsManualRefresh) return;

      if (tick <= 8) {
        await refreshStatusOnce(job_id);
      } else {
        if (tick % 3 === 0) await refreshStatusOnce(job_id);
      }
    }, 2000);
  }

  useEffect(() => {
    if (!user?.id) return;

    const payload = {
      jobId,
      status,
      statusText,
      progress,
      needsManualRefresh,
      lastKnownJob,
      videoUrl,
      error,
      currentParams: currentParamsRef.current,
      savedAt: new Date().toISOString(),
    };

    try {
      if (
        payload.jobId ||
        payload.videoUrl ||
        payload.status === "IN_PROGRESS" ||
        payload.status === "STARTING"
      ) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  }, [
    user?.id,
    jobId,
    status,
    statusText,
    progress,
    needsManualRefresh,
    lastKnownJob,
    videoUrl,
    error,
    STORAGE_KEY,
  ]);

  useEffect(() => {
    if (!user?.id) return;

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const saved = JSON.parse(raw);

      if (!saved?.jobId && !saved?.videoUrl) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }

      if (saved?.status === "FAILED" || saved?.status === "ERROR") {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }

      const savedAt = saved?.savedAt ? new Date(saved.savedAt).getTime() : null;
      const tooOld =
        !savedAt || Number.isNaN(savedAt)
          ? false
          : Date.now() - savedAt > 1000 * 60 * 60 * 2;

      if (tooOld) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }

      if (saved?.currentParams) currentParamsRef.current = saved.currentParams;

      if (saved?.jobId) setJobId(saved.jobId);
      if (saved?.status) setStatus(saved.status);
      if (saved?.statusText) setStatusText(saved.statusText || "");
      if (typeof saved?.progress === "number") setProgress(saved.progress);
      if (typeof saved?.needsManualRefresh === "boolean") {
        setNeedsManualRefresh(saved.needsManualRefresh);
      }
      if (saved?.lastKnownJob) setLastKnownJob(saved.lastKnownJob);
      if (saved?.videoUrl) setVideoUrl(saved.videoUrl);
      if (saved?.error) setError(saved.error);

      const wasRunning =
        saved?.jobId &&
        (saved?.status === "IN_PROGRESS" ||
          saved?.status === "STARTING" ||
          saved?.needsManualRefresh);

      if (wasRunning) {
        setTimeout(async () => {
          try {
            const stData = await pollVideoStatus(saved.jobId);

            if (stData?.job) setLastKnownJob(stData.job);

            const st = String(stData?.status || "").toUpperCase();

            if (["FAILED", "ERROR"].includes(st)) {
              hardResetPanel();
              setStatus("FAILED");
              setStatusText("Falló.");
              setError(stData?.error || "La generación falló.");
              return;
            }

            if (["DONE", "COMPLETED", "SUCCESS", "FINISHED"].includes(st)) {
              setStatus("DONE");
              setStatusText("Video listo.");
              setVideoUrl(
                stData?.video_url ||
                stData?.output?.video_url ||
                stData?.output?.video?.url ||
                null
              );
              setProgress(100);
              stopPolling();
              try {
                localStorage.removeItem(STORAGE_KEY);
              } catch {
                // ignore
              }
              return;
            }

            const startedAt = stData?.job?.started_at || saved?.lastKnownJob?.started_at || null;

            if (startedAt) {
              setProgress((p) => Math.max(p, computeProgressFromStartedAt(startedAt)));
            }

            setStatus("IN_PROGRESS");
            setStatusText(`Estado: ${stData?.rp_status || stData?.status || "IN_PROGRESS"}`);
            startPolling(saved.jobId, startedAt);
          } catch {
            setNeedsManualRefresh(true);
          }
        }, 300);
      }
    } catch {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    }
  }, [user?.id]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && jobId) {
        refreshStatusOnce(jobId);
      }
    };

    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [jobId]);

  useEffect(() => {
    return () => stopPolling();
  }, []);

  async function handleGenerate() {
    if (lockRef.current) return;
    lockRef.current = true;

    let jidLocal = null;

    try {
      setError("");
      setVideoUrl(null);
      setProgress(0);
      setNeedsManualRefresh(false);
      setLastKnownJob(null);

      if (!user) return setErrorState("Debes iniciar sesión para usar Imagen → Video.");
      if (!hasEnough) return setErrorState(`Necesitas ${COST_I2V} jades para este video.`);
      if (!pureB64 && !imageUrl) return setErrorState("Sube una imagen o pega una URL de imagen.");

      if (useOptimized && (!optimizedPrompt || optimizedPrompt.trim().length === 0)) {
        if (!prompt?.trim()) return setErrorState("Escribe un prompt o desactiva el prompt optimizado.");
        await handleOptimize();
      }

      const { finalPrompt, finalNegative } = getEffectivePrompts();

      setStatus("STARTING");
      setStatusText("Enviando trabajo...");

      const auth = await getAuthHeaders();

      const rawFrames = Math.max(1, Math.round(Number(durationSec) * fps));
      const numFrames = fixFramesForWan(rawFrames);

      const aspect_ratio = useNineSixteen ? "9:16" : "";
      const stp = clampInt(steps, 1, 80, 18);
      const gs = clampFloat(guidanceScale, 1.0, 10.0, 5.0);
      const den = clampFloat(strength, 0.1, 1.0, 0.65);
      const ms = clampFloat(motionStrength, 0.1, 2.0, 1.0);
      const seed = getSeedForRequest();

      currentParamsRef.current = {
        steps: stp,
        numFrames,
        durationSec: Number(durationSec),
        fps: Number(fps),
        generationMode,
      };

      const payload = {
        mode: "i2v",
        generation_mode: generationMode,
        is_fast_mode: generationMode === "express",
        prompt: finalPrompt || "",
        negative_prompt: finalNegative || "",
        ...(aspect_ratio ? { aspect_ratio } : {}),
        duration_s: Number(durationSec),
        fps,
        num_frames: numFrames,
        steps: stp,
        guidance_scale: gs,
        strength: den,
        denoise: den,
        motion_strength: ms,
        seed,
        image_b64: pureB64 || null,
        image_url: imageUrl || null,
        include_audio: (generationMode === "express" || generationMode === "standard") && includeAudio,
      };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);

      const { r, j } = await safeFetchJson("/api/generate-img2video", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!r.ok || !j?.ok || !j?.job_id) {
        throw new Error(j?.error || "No se pudo crear el trabajo de Imagen → Video.");
      }

      jidLocal = j.job_id;
      setJobId(jidLocal);
      setStatus("IN_PROGRESS");
      setStatusText(`Generando... Job: ${jidLocal}`);
      setProgress(3);

      await new Promise((t) => setTimeout(t, 700));

      const stData = await pollVideoStatus(jidLocal);
      if (stData?.job) setLastKnownJob(stData.job);

      const startedAt = stData?.job?.started_at || j?.started_at || null;
      if (startedAt) {
        setProgress((p) => Math.max(p, computeProgressFromStartedAt(startedAt)));
      }

      startPolling(jidLocal, startedAt);
    } catch (e) {
      if (e?.name === "AbortError") {
        setNeedsManualRefresh(true);
        setStatus("IN_PROGRESS");
        setStatusText("Tiempo de espera agotado.");
        setError('La solicitud tardó demasiado. Haz clic en "Actualizar estado".');
      } else if (isFetchDisconnectError(e) && (jidLocal || jobId)) {
        setNeedsManualRefresh(true);
        setStatus("IN_PROGRESS");
        setStatusText("Conexión perdida.");
        setError('Conexión perdida. Haz clic en "Actualizar estado".');
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
    await refreshStatusOnce(jobId);
  };

  if (!user) {
    return (
      <div className="rounded-3xl border border-yellow-400/30 bg-yellow-500/5 p-6 text-center text-yellow-100">
        Debes iniciar sesión para usar Imagen → Video.
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">Imagen → Video</h2>

        <div className="mt-3 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 text-[12px] text-cyan-100">
          <span className="font-semibold text-white">Aviso:</span> la mejor calidad de video está en el modo <span className="font-semibold text-cyan-300">Express</span>.
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-xs text-neutral-300">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Estado: {statusText || "Listo."}</span>
            <span>
              Jades: <span className="font-semibold text-white">{userStatus?.jades ?? "..."}</span>
            </span>
          </div>

          <div className="mt-1 text-[11px] text-neutral-400">
            Costo actual: <span className="font-semibold text-red-400">{COST_I2V}</span> <span className="text-red-400">jades</span>
          </div>

          <div className="mt-1 text-[11px] font-semibold text-red-400">{getPriceText()}</div>
          <div className="mt-1 text-[10px] text-red-400">{getAllPricesText()}</div>

          {jobId && <div className="mt-1 text-[10px] text-neutral-500">Job: {jobId}</div>}

          {(status === "IN_PROGRESS" || status === "STARTING" || status === "DONE") && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-[10px] text-neutral-400">
                <span>Progreso</span>
                <span>{Math.max(0, Math.min(100, Number(progress) || 0))}%</span>
              </div>

              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-fuchsia-500 transition-all"
                  style={{ width: `${Math.max(0, Math.min(100, Number(progress) || 0))}%` }}
                />
              </div>

              <div className="mt-2 text-[11px] text-neutral-300">{getEtaText()}</div>

              {needsManualRefresh && (
                <div className="mt-2 text-[11px] text-yellow-200">
                  Conexión perdida. Haz clic en <span className="font-semibold">"Actualizar estado"</span>.
                </div>
              )}
            </div>
          )}

          {(jobId && (status === "IN_PROGRESS" || status === "ERROR" || needsManualRefresh)) && (
            <div className="mt-3">
              <button
                type="button"
                onClick={handleUpdateStatus}
                className="w-full rounded-xl border border-white/20 px-3 py-2 text-[11px] text-white hover:bg-white/10"
              >
                Actualizar estado
              </button>
            </div>
          )}

          <div className="mt-3">
            <button
              type="button"
              onClick={hardResetPanel}
              className="w-full rounded-xl border border-red-400/30 px-3 py-2 text-[11px] text-red-300 hover:bg-red-500/10"
            >
              Reiniciar panel
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
            <div className="text-xs text-neutral-300">Modo</div>

            <div className="mt-3 space-y-2">
              <label className="flex items-center gap-2 text-[12px] text-neutral-200">
                <input
                  type="radio"
                  name="i2v_mode"
                  checked={generationMode === "express"}
                  onChange={() => setGenerationMode("express")}
                  className="h-4 w-4"
                />
                Express
              </label>

              <label className="flex items-center gap-2 text-[12px] text-neutral-200">
                <input
                  type="radio"
                  name="i2v_mode"
                  checked={generationMode === "standard"}
                  onChange={() => setGenerationMode("standard")}
                  className="h-4 w-4"
                />
                Standard
              </label>

              <label className="flex items-center gap-2 text-[12px] text-neutral-200">
                <input
                  type="radio"
                  name="i2v_mode"
                  checked={generationMode === "studio"}
                  onChange={() => setGenerationMode("studio")}
                  className="h-4 w-4"
                />
                Studio
              </label>
            </div>

            <div className="mt-2 text-[10px] text-neutral-500">{getModeDescription()}</div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
            <div className="text-xs text-neutral-300">Formato / tamaño</div>

            <div className="mt-3 flex items-center gap-2">
              <input
                id="i2v_916"
                type="checkbox"
                checked={useNineSixteen}
                onChange={(e) => setUseNineSixteen(e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="i2v_916" className="text-[12px] text-neutral-200">
                Vertical 9:16
              </label>
            </div>

            <div className="mt-2 text-[10px] text-neutral-500">
              {useNineSixteen ? "Formato vertical seleccionado" : "Formato por defecto seleccionado"}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
            <div className="text-xs text-neutral-300">Duración</div>

            <div className="mt-3 space-y-2">
              {getDurationOptions().map((sec) => (
                <label key={sec} className="flex items-center gap-2 text-[12px] text-neutral-200">
                  <input
                    type="radio"
                    name="i2v_duration"
                    checked={Number(durationSec) === sec}
                    onChange={() => setDurationSec(sec)}
                    className="h-4 w-4"
                  />
                  {sec} segundos
                </label>
              ))}
            </div>

            <div className="mt-2 text-[10px] text-neutral-500">
              fps: {fps} • frames: {fixFramesForWan(Math.round(Number(durationSec) * fps))}
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-4 text-sm">
          <div>
            <p className="text-xs text-neutral-300">1. Sube una imagen</p>
            <button
              type="button"
              onClick={handlePickFile}
              className="mt-2 flex h-40 w-full items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/50 text-sm text-neutral-300 hover:bg-white/5"
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
                <img src={dataUrl} alt="Base input" className="w-full object-cover" />
              </div>
            )}
          </div>

          <div>
            <p className="text-xs text-neutral-300">o pega una URL de imagen</p>
            <input
              type="text"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://..."
              className="mt-2 w-full rounded-2xl bg-black/60 px-3 py-2 text-xs text-white outline-none ring-1 ring-white/10"
            />
          </div>

          <div>
            <label className="text-neutral-300">Prompt (opcional)</label>
            <textarea
              className="mt-1 h-20 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe movimiento, cámara, ambiente. Si Audio Layer está activado, escribe aquí lo que debe decir el personaje."
            />
          </div>

          <div>
            <label className="text-neutral-300">Negativo (opcional)</label>
            <textarea
              className="mt-1 h-16 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10"
              value={negative}
              onChange={(e) => setNegative(e.target.value)}
              placeholder="borroso, baja calidad, deformado..."
            />
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-neutral-300">
                Optimización de prompt (OpenAI)
                {optimizedPrompt ? (
                  <span className="ml-2 text-[10px] text-emerald-300">Listo ✓</span>
                ) : (
                  <span className="ml-2 text-[10px] text-neutral-400">Opcional</span>
                )}
              </div>

              <button
                type="button"
                onClick={handleOptimize}
                disabled={isOptimizing || !prompt?.trim()}
                className="rounded-xl border border-white/20 px-3 py-1 text-[11px] text-white hover:bg-white/10 disabled:opacity-50"
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
                Usar prompt optimizado para generar
              </label>
              <span className="ml-auto text-[10px] text-neutral-500">
                {useOptimized && optimizedPrompt ? "Activo" : ""}
              </span>
            </div>

            {optError && (
              <div className="mt-2 whitespace-pre-line text-[11px] text-red-400">{optError}</div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
            <div className="text-xs text-neutral-300">Audio Layer</div>

            <div className="mt-2 flex items-center gap-2">
              <input
                id="i2v_audio"
                type="checkbox"
                checked={includeAudio}
                disabled={generationMode === "studio"}
                onChange={(e) => setIncludeAudio(e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="i2v_audio" className="text-[11px] text-neutral-300">
                {generationMode === "studio"
                  ? "El modo Studio no soporta audio"
                  : "Activar audio o voz desde el prompt (+4 jades)"}
              </label>
            </div>

            <div className="mt-2 text-[10px] text-neutral-500">{getAudioHelpText()}</div>

            {generationMode === "express" && (
              <div className="mt-2 text-[10px] text-cyan-200/80">
                Consejo: en Express, activa Audio Layer si quieres que el video devuelva voz o sonido.
              </div>
            )}

            {generationMode === "standard" && (
              <div className="mt-2 text-[10px] text-cyan-200/80">
                Consejo: en Standard, con Audio Layer activado, escribe el diálogo o sonidos directamente en el prompt.
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="text-neutral-300">Steps</label>
              <input
                type="number"
                min={1}
                max={80}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10"
                value={steps}
                onChange={(e) => setSteps(Number(e.target.value))}
              />
            </div>

            <div>
              <label className="text-neutral-300">Guidance (CFG)</label>
              <input
                type="number"
                step="0.5"
                min={1}
                max={10}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10"
                value={guidanceScale}
                onChange={(e) => setGuidanceScale(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="text-neutral-300">Strength (denoise)</label>
              <input
                type="number"
                step="0.05"
                min={0.1}
                max={1.0}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10"
                value={strength}
                onChange={(e) => setStrength(Number(e.target.value))}
              />
              <div className="mt-2 text-[10px] text-neutral-500">Recomendado: 0.60–0.70</div>
            </div>

            <div>
              <label className="text-neutral-300">Fuerza de movimiento</label>
              <input
                type="number"
                step="0.05"
                min={0.1}
                max={2.0}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10"
                value={motionStrength}
                onChange={(e) => setMotionStrength(Number(e.target.value))}
              />
              <div className="mt-2 text-[10px] text-neutral-500">Recomendado: 0.9–1.1</div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
            <div className="text-xs text-neutral-300">Seed</div>

            <div className="mt-2 flex items-center gap-3">
              <input
                id="i2v_seed_random"
                type="checkbox"
                checked={seedMode === "RANDOM"}
                onChange={(e) => e.target.checked && setSeedMode("RANDOM")}
                className="h-4 w-4"
              />
              <label htmlFor="i2v_seed_random" className="text-[12px] text-neutral-200">
                Aleatorio (recomendado)
              </label>

              <input
                id="i2v_seed_fixed"
                type="checkbox"
                checked={seedMode === "FIXED"}
                onChange={(e) => e.target.checked && setSeedMode("FIXED")}
                className="ml-4 h-4 w-4"
              />
              <label htmlFor="i2v_seed_fixed" className="text-[12px] text-neutral-200">
                Fijo
              </label>
            </div>

            {seedMode === "FIXED" && (
              <input
                type="number"
                min={0}
                max={2147483647}
                value={seedFixed}
                onChange={(e) => setSeedFixed(Number(e.target.value))}
                className="mt-3 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10"
              />
            )}
          </div>

          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 text-[11px] text-cyan-100">
            <div className="font-semibold text-white">Información de precios del video</div>
            <div className="mt-2 text-red-400">{getAllPricesText()}</div>
            <div className="mt-1 text-cyan-200/80">
              Selección actual: <span className="font-semibold text-red-400">{getPriceText()}</span>
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={status === "STARTING" || status === "IN_PROGRESS" || !hasEnough}
              className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {status === "STARTING" || status === "IN_PROGRESS"
                ? "Generando..."
                : !hasEnough
                  ? "No tienes suficientes jades"
                  : generationMode === "express"
                    ? "Generar video Express"
                    : generationMode === "standard"
                      ? "Generar video Standard"
                      : "Generar video Studio"}
            </button>
          </div>

          {error && <p className="whitespace-pre-line text-xs text-red-400">{error}</p>}
        </div>
      </div>

      <div className="flex flex-col rounded-3xl border border-white/10 bg-black/40 p-6">
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
