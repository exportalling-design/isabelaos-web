// src/components/Img2VideoPanel.jsx
// ─────────────────────────────────────────────────────────────
// Panel de Imagen → Video
// Modos: Express (Veo3 Fast) y Standard (WAN + ElevenLabs + fal-ai/sync-lipsync/v2/pro)
// Lip Sync: fal-ai/sync-lipsync/v2/pro  (video_url + audio_url → video sincronizado)
// ─────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabaseClient";

const FORCED_PREFIX =
  "NO subtitles, NO text overlays, NO captions, NO watermarks, NO generated text of any kind. " +
  "Do NOT invent new characters, objects, or backgrounds not present in the source image. " +
  "Keep all original characters, faces, clothing, and environment exactly as they appear in the image. " +
  "Only add natural realistic motion to existing elements. ";

const ACCENTS = [
  { value: "neutro",       label: "🌎 Neutro latino" },
  { value: "guatemalteco", label: "🇬🇹 Guatemalteco" },
  { value: "colombiano",   label: "🇨🇴 Colombiano"   },
  { value: "mexicano",     label: "🇲🇽 Mexicano"     },
  { value: "argentino",    label: "🇦🇷 Argentino"    },
  { value: "español",      label: "🇪🇸 Español"      },
  { value: "ingles",       label: "🇺🇸 English (US)" },
];

async function checkImageSafety(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 50; canvas.height = 50;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, 50, 50);
      const data = ctx.getImageData(0, 0, 50, 50).data;
      URL.revokeObjectURL(url);
      let skinPixels = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (r > 95 && g > 40 && b > 20 && r > g && r > b &&
            Math.abs(r - g) > 15 && r - b > 15 && g - b > 0) skinPixels++;
      }
      resolve((skinPixels / (50 * 50)) < 0.60);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(true); };
    img.src = url;
  });
}

export function Img2VideoPanel({ userStatus }) {
  const { user } = useAuth();

  const STORAGE_KEY = user?.id ? `i2v_job_state_${user.id}` : "i2v_job_state_guest";

  const [dataUrl,    setDataUrl]    = useState(null);
  const [pureB64,    setPureB64]    = useState(null);
  const [imageUrl,   setImageUrl]   = useState("");
  const [prompt,     setPrompt]     = useState("");
  const [negative,   setNegative]   = useState("");

  const [steps,          setSteps]          = useState(18);
  const [guidanceScale,  setGuidanceScale]  = useState(5.0);
  const [strength,       setStrength]       = useState(0.65);
  const [motionStrength, setMotionStrength] = useState(1.0);

  const [seedMode,  setSeedMode]  = useState("RANDOM");
  const [seedFixed, setSeedFixed] = useState(12345);

  const [generationMode,  setGenerationMode]  = useState("standard");
  const [useNineSixteen,  setUseNineSixteen]  = useState(true);
  const [durationSec,     setDurationSec]     = useState(10);
  const [includeAudio,    setIncludeAudio]    = useState(false);
  const [showModuleInfo,  setShowModuleInfo]  = useState(false);

  // ── ElevenLabs + fal-ai/sync-lipsync/v2/pro (Standard) ───────
  const [enableLipsync,  setEnableLipsync]  = useState(false);
  const [narrationText,  setNarrationText]  = useState("");
  const [voiceAccent,    setVoiceAccent]    = useState("neutro");
  const [voiceGender,    setVoiceGender]    = useState("mujer");

  // ── Consentimiento de imagen ──────────────────────────────────
  const [showPhotoConsent, setShowPhotoConsent] = useState(false);
  const [pendingPhotoFile, setPendingPhotoFile] = useState(null);

  const fps = 16;

  const [status,              setStatus]              = useState("IDLE");
  const [statusText,          setStatusText]          = useState("");
  const [jobId,               setJobId]               = useState(null);
  const [videoUrl,            setVideoUrl]            = useState(null);
  const [error,               setError]               = useState("");
  const [progress,            setProgress]            = useState(0);
  const [needsManualRefresh,  setNeedsManualRefresh]  = useState(false);
  const [lastKnownJob,        setLastKnownJob]        = useState(null);

  const currentJades     = userStatus?.jades ?? 0;
  const fileInputId      = "img2video-file-input";
  const lockRef          = useRef(false);
  const pollTimerRef     = useRef(null);
  const progTimerRef     = useRef(null);
  const currentParamsRef = useRef({ steps: 18, numFrames: 161, durationSec: 10, fps: 16, generationMode: "standard" });

  const [useOptimized,       setUseOptimized]       = useState(false);
  const [optimizedPrompt,    setOptimizedPrompt]    = useState("");
  const [optimizedNegative,  setOptimizedNegative]  = useState("");
  const [isOptimizing,       setIsOptimizing]       = useState(false);
  const [optError,           setOptError]           = useState("");

  useEffect(() => { setOptimizedPrompt(""); setOptimizedNegative(""); setOptError(""); }, [prompt, negative]);

  useEffect(() => {
    if (generationMode === "express") setDurationSec(8);
    else if (generationMode === "standard") { if (![10, 15].includes(Number(durationSec))) setDurationSec(10); }
  }, [generationMode]);

  function getDurationOptions() {
    if (generationMode === "express")  return [8];
    if (generationMode === "standard") return [10, 15];
    return [10];
  }

  function getCurrentPrice() {
    let base = 0;
    if (generationMode === "express") {
      base = 18;
      if (includeAudio) base += 4;
    } else {
      base = Number(durationSec) === 15 ? 24 : 17;
      if (enableLipsync) base += 4;
    }
    return base;
  }

  const COST_I2V  = getCurrentPrice();
  const hasEnough = currentJades >= COST_I2V;

  function getPriceText() {
    if (generationMode === "express") {
      return includeAudio ? "Express • 8s = 18 jades • Audio Layer +4 jades" : "Express • 8s = 18 jades";
    }
    const base = Number(durationSec) === 15 ? "Standard • 15s = 24 jades" : "Standard • 10s = 17 jades";
    return enableLipsync ? `${base} • Voz + Lip Sync +4 jades` : base;
  }

  function getAllPricesText() {
    return "Precios: Express 8s = 18 jades • Express Audio +4 jades • Standard 10s = 17 jades • Standard 15s = 24 jades • Voz + Lip Sync +4 jades";
  }

  function getModeDescription() {
    if (generationMode === "express") return "Modo premium con la mejor calidad de video y voz.";
    return "Modo equilibrado para clips más largos. Incluye voz ElevenLabs + lip sync con Sync Lipsync v2 Pro.";
  }

  function getAudioHelpText() {
    if (generationMode === "express") {
      return includeAudio
        ? "Audio Layer activado: el modelo puede devolver voz o sonido si lo describes en el prompt."
        : "Audio Layer apagado: video silencioso.";
    }
    return enableLipsync
      ? "Voz + Lip Sync: WAN genera video mudo → ElevenLabs genera la voz → Sync Lipsync v2 Pro sincroniza los labios."
      : "Sin voz: el video Standard se entrega mudo.";
  }

  async function getAuthHeaders() {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token || null;
    if (!token) throw new Error("MISSING_AUTH_TOKEN");
    return { Authorization: `Bearer ${token}` };
  }

  async function safeFetchJson(url, options = {}) {
    const r   = await fetch(url, options);
    const txt = await r.text();
    let j = null;
    try { j = JSON.parse(txt); } catch { j = { ok: false, error: txt?.slice(0, 500) || "Respuesta no JSON." }; }
    return { r, j, txt };
  }

  const handleOptimize = async () => {
    setOptError(""); setIsOptimizing(true);
    try {
      const { r, j } = await safeFetchJson("/api/optimize-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, negative_prompt: negative || "" }),
      });
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Falló la optimización.");
      setOptimizedPrompt(String(j.optimizedPrompt || "").trim());
      setOptimizedNegative(String(j.optimizedNegative || "").trim());
      setUseOptimized(true);
    } catch (e) { setOptError(e?.message || String(e)); }
    finally { setIsOptimizing(false); }
  };

  const getEffectivePrompts = () => {
    const canUse      = useOptimized && optimizedPrompt?.trim()?.length > 0;
    const rawPrompt   = canUse ? optimizedPrompt.trim()    : (prompt || "").trim();
    const rawNegative = canUse ? (optimizedNegative || "").trim() : (negative || "").trim();
    const finalPrompt   = FORCED_PREFIX + (rawPrompt || "Animate this image naturally with subtle realistic motion.");
    const finalNegative = "subtitles, text, captions, watermarks, letters, words, typography, new characters, new backgrounds, new objects, " + (rawNegative || "blurry, low quality, deformed");
    return { finalPrompt, finalNegative };
  };

  const fileToBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });

  async function compressImageFile(file, maxWidth = 1280, quality = 0.82) {
    const original = await fileToBase64(file);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale  = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("Canvas no soportado")); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("No se pudo cargar la imagen."));
      img.src = original;
    });
  }

  function estimateBase64Bytes(b64) { return Math.ceil((String(b64 || "").length * 3) / 4); }

  const handlePickFile = () => document.getElementById(fileInputId)?.click();

  const processFile = async (file) => {
    try {
      const compressed = await compressImageFile(file, 1280, 0.82);
      setDataUrl(compressed);
      const b64 = compressed.split(",")[1] || null;
      if (estimateBase64Bytes(b64) > 1400000) { setError("Imagen demasiado grande."); setPureB64(null); return; }
      setPureB64(b64); setImageUrl(""); setError("");
    } catch { setError("No se pudo leer o comprimir la imagen."); }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const isSafe = await checkImageSafety(file);
    if (!isSafe) { setError("La imagen fue bloqueada por contener contenido inapropiado."); return; }
    setPendingPhotoFile(file);
    setShowPhotoConsent(true);
  };

  async function pollVideoStatus(job_id) {
    const auth = await getAuthHeaders();
    const { r, j } = await safeFetchJson(`/api/video-status?job_id=${encodeURIComponent(job_id)}`, { headers: { ...auth } });
    if (!r.ok || !j) throw new Error(j?.error || "error en video-status");
    return j;
  }

  const setErrorState = (msg) => { setStatus("ERROR"); setStatusText("Error."); setError(msg || "Ocurrió un error."); };

  function clampInt(v, lo, hi, def)   { const n = Number(v); return !Number.isFinite(n) ? def : Math.max(lo, Math.min(hi, Math.round(n))); }
  function clampFloat(v, lo, hi, def) { const n = Number(v); return !Number.isFinite(n) ? def : Math.max(lo, Math.min(hi, n)); }

  function fixFramesForWan(numFrames) { let nf = Math.max(5, Math.round(Number(numFrames) || 0)); const r = (nf - 1) % 4; return r === 0 ? nf : nf + (4 - r); }
  function getSeedForRequest()        { if (seedMode === "FIXED") return clampInt(seedFixed, 0, 2147483647, 12345); return Math.floor(Date.now() % 2147483647); }

  function isFetchDisconnectError(e) {
    const m = String(e?.message || e || "").toLowerCase();
    return m.includes("failed to fetch") || m.includes("networkerror") || m.includes("network request failed") || m.includes("load failed");
  }

  function getExpectedSeconds() {
    const p = currentParamsRef.current || {};
    const s = Number(p.steps || 18), f = Number(p.numFrames || 129), dur = Number(p.durationSec || 8), mode = String(p.generationMode || "express");
    // Standard con Sync Lipsync v2 Pro tarda menos que Latentsync (más eficiente en fal.ai)
    const base = mode === "express" ? 220 : (dur >= 15 ? 700 : 520);
    return Math.max(60, Math.min(2400, base + Math.max(0,(s-18)*8) + Math.max(0,(f-129)*2)));
  }

  function computeProgressFromStartedAt(startedAtIso) {
    if (!startedAtIso) return Math.max(progress, 2);
    const elapsed  = Math.max(0, (Date.now() - new Date(startedAtIso).getTime()) / 1000);
    const expected = getExpectedSeconds();
    const t = Math.min(1, elapsed / expected);
    let p = 3;
    if      (t <= 0.20) p = 3  + (t / 0.20) * 22;
    else if (t <= 0.85) p = 25 + ((t - 0.20) / 0.65) * 60;
    else if (t <= 0.97) p = 85 + ((t - 0.85) / 0.12) * 7;
    else                p = 92;
    return Math.max(3, Math.min(92, Math.round(p)));
  }

  function getEtaText() {
    if (generationMode === "express") return "Espera estimada: 2-4 min";
    if (enableLipsync) return Number(durationSec) === 15 ? "Espera estimada: 7-13 min (WAN + ElevenLabs + Sync Lipsync v2 Pro)" : "Espera estimada: 5-10 min (WAN + ElevenLabs + Sync Lipsync v2 Pro)";
    return Number(durationSec) === 15 ? "Espera estimada: 4-8 min" : "Espera estimada: 3-6 min";
  }

  function stopPolling()     { if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; } if (progTimerRef.current) { clearInterval(progTimerRef.current); progTimerRef.current = null; } }
  function clearPersistedJob() { try { localStorage.removeItem(STORAGE_KEY); } catch {} }

  function hardResetPanel() {
    stopPolling();
    setStatus("IDLE"); setStatusText(""); setJobId(null); setVideoUrl(null);
    setError(""); setProgress(0); setNeedsManualRefresh(false); setLastKnownJob(null);
    clearPersistedJob();
  }

  async function refreshStatusOnce(overrideJobId = null) {
    const jid = overrideJobId || jobId;
    if (!jid) return;
    try {
      setNeedsManualRefresh(false); setError("");
      const stData = await pollVideoStatus(jid);
      const st     = String(stData?.status || "IN_PROGRESS").toUpperCase();
      if (stData?.job) setLastKnownJob(stData.job);
      if (["DONE","COMPLETED","SUCCESS","FINISHED"].includes(st)) {
        const url = stData?.video_url || stData?.output?.video_url || stData?.output?.video?.url || null;
        if (url) setVideoUrl(url);
        setStatus("DONE"); setStatusText("Video listo."); setProgress(100);
        stopPolling(); clearPersistedJob(); return;
      }
      if (["FAILED","ERROR"].includes(st)) {
        setStatus("FAILED"); setStatusText("Falló.");
        setError(stData?.error || "La generación falló.");
        setProgress(0); stopPolling(); clearPersistedJob(); return;
      }

      // ── Estados intermedios del pipeline ──────────────────────
      // provider_status viene de tu backend: "elevenlabs_processing" | "synclipsync_processing" | "wan_processing"
      const providerStatus = stData?.job?.provider_status || "";
      let friendlyStatus = `Estado: ${stData?.rp_status || stData?.status || "IN_PROGRESS"}`;
      if (providerStatus === "wan_processing")          friendlyStatus = "🎬 Generando video con WAN...";
      if (providerStatus === "elevenlabs_processing")   friendlyStatus = "🎙️ Generando voz con ElevenLabs...";
      if (providerStatus === "synclipsync_processing")  friendlyStatus = "👄 Sincronizando labios con Sync Lipsync v2 Pro...";

      setStatus("IN_PROGRESS"); setStatusText(friendlyStatus);
      const startedAt = stData?.job?.started_at || lastKnownJob?.started_at || null;
      if (startedAt) setProgress((p) => Math.max(p, computeProgressFromStartedAt(startedAt)));
    } catch (e) {
      if (isFetchDisconnectError(e)) { setNeedsManualRefresh(true); setStatus("IN_PROGRESS"); setStatusText("Conexión perdida."); setError('Conexión perdida. Haz clic en "Actualizar estado".'); return; }
      setErrorState(e?.message || String(e));
    }
  }

  function startPolling(job_id, startedAtIsoMaybe) {
    stopPolling();
    progTimerRef.current = setInterval(() => {
      const startedAt = startedAtIsoMaybe || lastKnownJob?.started_at || null;
      if (!startedAt) return;
      setProgress((p) => Math.max(p, computeProgressFromStartedAt(startedAt)));
    }, 1000);
    let tick = 0;
    pollTimerRef.current = setInterval(async () => {
      tick += 1;
      if (needsManualRefresh) return;
      if (tick <= 8 || tick % 3 === 0) await refreshStatusOnce(job_id);
    }, 2000);
  }

  useEffect(() => {
    if (!user?.id) return;
    const payload = { jobId, status, statusText, progress, needsManualRefresh, lastKnownJob, videoUrl, error, currentParams: currentParamsRef.current, savedAt: new Date().toISOString() };
    try {
      if (payload.jobId || payload.videoUrl || ["IN_PROGRESS","STARTING"].includes(payload.status)) localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, [user?.id, jobId, status, statusText, progress, needsManualRefresh, lastKnownJob, videoUrl, error, STORAGE_KEY]);

  useEffect(() => {
    if (!user?.id) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved?.jobId && !saved?.videoUrl) { localStorage.removeItem(STORAGE_KEY); return; }
      if (["FAILED","ERROR"].includes(saved?.status)) { localStorage.removeItem(STORAGE_KEY); return; }
      const savedAt = saved?.savedAt ? new Date(saved.savedAt).getTime() : null;
      if (savedAt && Date.now() - savedAt > 1000 * 60 * 60 * 2) { localStorage.removeItem(STORAGE_KEY); return; }
      if (saved?.currentParams) currentParamsRef.current = saved.currentParams;
      if (saved?.jobId)          setJobId(saved.jobId);
      if (saved?.status)         setStatus(saved.status);
      if (saved?.statusText)     setStatusText(saved.statusText || "");
      if (typeof saved?.progress === "number") setProgress(saved.progress);
      if (typeof saved?.needsManualRefresh === "boolean") setNeedsManualRefresh(saved.needsManualRefresh);
      if (saved?.lastKnownJob)   setLastKnownJob(saved.lastKnownJob);
      if (saved?.videoUrl)       setVideoUrl(saved.videoUrl);
      if (saved?.error)          setError(saved.error);
      const wasRunning = saved?.jobId && (["IN_PROGRESS","STARTING"].includes(saved?.status) || saved?.needsManualRefresh);
      if (wasRunning) {
        setTimeout(async () => {
          try {
            const stData = await pollVideoStatus(saved.jobId);
            if (stData?.job) setLastKnownJob(stData.job);
            const st = String(stData?.status || "").toUpperCase();
            if (["FAILED","ERROR"].includes(st)) { hardResetPanel(); setStatus("FAILED"); setError(stData?.error || "Falló."); return; }
            if (["DONE","COMPLETED","SUCCESS","FINISHED"].includes(st)) {
              setStatus("DONE"); setStatusText("Video listo.");
              setVideoUrl(stData?.video_url || stData?.output?.video_url || stData?.output?.video?.url || null);
              setProgress(100); stopPolling(); clearPersistedJob(); return;
            }
            const startedAt = stData?.job?.started_at || saved?.lastKnownJob?.started_at || null;
            if (startedAt) setProgress((p) => Math.max(p, computeProgressFromStartedAt(startedAt)));
            setStatus("IN_PROGRESS");
            startPolling(saved.jobId, startedAt);
          } catch { setNeedsManualRefresh(true); }
        }, 300);
      }
    } catch { try { localStorage.removeItem(STORAGE_KEY); } catch {} }
  }, [user?.id]);

  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible" && jobId) refreshStatusOnce(jobId); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [jobId]);

  useEffect(() => () => stopPolling(), []);

  async function handleGenerate() {
    if (lockRef.current) return;
    lockRef.current = true;
    let jidLocal = null;
    try {
      setError(""); setVideoUrl(null); setProgress(0); setNeedsManualRefresh(false); setLastKnownJob(null);
      if (!user)      return setErrorState("Debes iniciar sesión.");
      if (!hasEnough) return setErrorState(`Necesitas ${COST_I2V} jades para este video.`);
      if (!pureB64 && !imageUrl) return setErrorState("Sube una imagen o pega una URL.");
      if (generationMode === "standard" && enableLipsync && !narrationText.trim()) {
        return setErrorState("Escribe el texto que dirá el personaje para activar el lip sync.");
      }
      if (useOptimized && !optimizedPrompt?.trim()) {
        if (!prompt?.trim()) return setErrorState("Escribe un prompt o desactiva el optimizado.");
        await handleOptimize();
      }
      const { finalPrompt, finalNegative } = getEffectivePrompts();
      setStatus("STARTING"); setStatusText("Enviando trabajo...");
      const auth      = await getAuthHeaders();
      const numFrames = fixFramesForWan(Math.max(1, Math.round(Number(durationSec) * fps)));
      const stp = clampInt(steps, 1, 80, 18);
      const gs  = clampFloat(guidanceScale, 1.0, 10.0, 5.0);
      const den = clampFloat(strength, 0.1, 1.0, 0.65);
      const ms  = clampFloat(motionStrength, 0.1, 2.0, 1.0);
      currentParamsRef.current = { steps: stp, numFrames, durationSec: Number(durationSec), fps, generationMode };

      const payload = {
        mode: "i2v", generation_mode: generationMode,
        is_fast_mode: generationMode === "express",
        prompt:          finalPrompt,
        negative_prompt: finalNegative,
        ...(useNineSixteen ? { aspect_ratio: "9:16" } : {}),
        duration_s: Number(durationSec), fps, num_frames: numFrames,
        steps: stp, guidance_scale: gs, strength: den, denoise: den,
        motion_strength: ms, seed: getSeedForRequest(),
        image_b64: pureB64 || null, image_url: imageUrl || null,
        include_audio: generationMode === "express" ? includeAudio : false,
        // ElevenLabs + fal-ai/sync-lipsync/v2/pro para Standard
        narration_text: generationMode === "standard" ? narrationText.trim() : "",
        voice_accent:   voiceAccent,
        voice_gender:   voiceGender,
        enable_lipsync: generationMode === "standard" && enableLipsync,
        // Indica al backend qué modelo de lipsync usar
        lipsync_model:  "fal-ai/sync-lipsync/v2/pro",
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
      if (!r.ok || !j?.ok || !j?.job_id) throw new Error(j?.error || "No se pudo crear el trabajo.");
      jidLocal = j.job_id;
      setJobId(jidLocal); setStatus("IN_PROGRESS"); setStatusText(`Generando... Job: ${jidLocal}`); setProgress(3);
      await new Promise((t) => setTimeout(t, 700));
      const stData = await pollVideoStatus(jidLocal);
      if (stData?.job) setLastKnownJob(stData.job);
      const startedAt = stData?.job?.started_at || j?.started_at || null;
      if (startedAt) setProgress((p) => Math.max(p, computeProgressFromStartedAt(startedAt)));
      startPolling(jidLocal, startedAt);
    } catch (e) {
      if (e?.name === "AbortError") {
        setNeedsManualRefresh(true); setStatus("IN_PROGRESS");
        setError('La solicitud tardó demasiado. Haz clic en "Actualizar estado".');
      } else if (isFetchDisconnectError(e) && (jidLocal || jobId)) {
        setNeedsManualRefresh(true); setStatus("IN_PROGRESS");
        setError('Conexión perdida. Haz clic en "Actualizar estado".');
      } else {
        setErrorState(e?.message || String(e));
      }
    } finally { lockRef.current = false; }
  }

  const handleDownload = () => {
    if (!videoUrl) return;
    const link = document.createElement("a");
    link.href = videoUrl; link.download = "isabelaos-img2video.mp4";
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  if (!user) {
    return <div className="rounded-3xl border border-yellow-400/30 bg-yellow-500/5 p-6 text-center text-yellow-100">Debes iniciar sesión para usar Imagen → Video.</div>;
  }

  return (
    <>
      {/* ══ MODAL CONSENTIMIENTO ══════════════════════════════════ */}
      {showPhotoConsent && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4">
          <div className="w-full max-w-md bg-[#0a0a0c] border border-white/10 rounded-3xl overflow-hidden shadow-2xl">
            <div className="bg-gradient-to-r from-cyan-500/10 to-fuchsia-500/10 border-b border-white/10 p-5">
              <h3 className="text-lg font-bold text-white">📸 Consentimiento de imagen</h3>
              <p className="mt-1 text-xs text-neutral-400">Antes de subir esta fotografía, confirma lo siguiente:</p>
            </div>
            <div className="p-5">
              <div className="space-y-3 text-sm text-neutral-300">
                {[
                  "Soy el titular de los derechos de esta fotografía, o tengo el consentimiento expreso de la persona que aparece en ella.",
                  "No usaré esta imagen para suplantar identidades, difamar, engañar o causar daño a terceros.",
                  "Asumo toda la responsabilidad por el uso que haga del contenido generado.",
                ].map((t, i) => (
                  <div key={i} className="flex gap-3 p-3 rounded-xl border border-white/10 bg-white/3">
                    <span className="text-cyan-400 mt-0.5 flex-shrink-0">☑</span>
                    <span>{t}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-5 pt-0 flex gap-3">
              <button onClick={async () => { setShowPhotoConsent(false); if (pendingPhotoFile) { await processFile(pendingPhotoFile); setPendingPhotoFile(null); } }}
                className="flex-1 bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-black font-bold text-sm rounded-2xl py-3 cursor-pointer hover:opacity-90">
                ✓ Acepto y subo la imagen
              </button>
              <button onClick={() => { setShowPhotoConsent(false); setPendingPhotoFile(null); }}
                className="border border-white/15 text-neutral-400 text-sm rounded-2xl px-5 py-3 cursor-pointer hover:bg-white/5">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        {/* ── Panel izquierdo ────────────────────────────────────── */}
        <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">Imagen → Video</h2>
            <button type="button" onClick={() => setShowModuleInfo(true)}
              className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-[11px] font-medium text-cyan-200 hover:bg-cyan-500/15">
              Sobre este módulo
            </button>
          </div>

          <div className="mt-3 rounded-2xl border border-yellow-400/20 bg-yellow-500/5 px-4 py-3 text-[12px] text-yellow-200">
            <span className="font-semibold text-yellow-100">⚠️ Importante:</span>{" "}
            Al subir una fotografía declaras que posees los derechos sobre ella o tienes el consentimiento de las personas que aparecen.
          </div>

          <div className="mt-3 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 text-[12px] text-cyan-100">
            <span className="font-semibold text-white">Recomendación:</span> para la mejor calidad de video y voz usa el modo{" "}
            <span className="font-semibold text-cyan-300">Express</span>. Para Standard con voz activa <span className="font-semibold text-cyan-300">Voz + Lip Sync</span>.
          </div>

          {/* Estado y Jades */}
          <div className="mt-4 rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-xs text-neutral-300">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>Estado: {statusText || "Listo."}</span>
              <span>Jades: <span className="font-semibold text-white">{userStatus?.jades ?? "..."}</span></span>
            </div>
            <div className="mt-1 text-[11px] text-neutral-400">Costo actual: <span className="font-semibold text-red-400">{COST_I2V} jades</span></div>
            <div className="mt-1 text-[11px] font-semibold text-red-400">{getPriceText()}</div>
            <div className="mt-1 text-[10px] text-red-400">{getAllPricesText()}</div>
            {jobId && <div className="mt-1 text-[10px] text-neutral-500">Job: {jobId}</div>}

            {["IN_PROGRESS","STARTING","DONE"].includes(status) && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-[10px] text-neutral-400">
                  <span>Progreso</span><span>{Math.max(0, Math.min(100, Number(progress) || 0))}%</span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-fuchsia-500 transition-all" style={{ width: `${Math.max(0, Math.min(100, Number(progress) || 0))}%` }} />
                </div>
                <div className="mt-2 text-[11px] text-neutral-300">{getEtaText()}</div>
                {needsManualRefresh && <div className="mt-2 text-[11px] text-yellow-200">Conexión perdida. Haz clic en <span className="font-semibold">"Actualizar estado"</span>.</div>}
              </div>
            )}

            {jobId && ["IN_PROGRESS","ERROR"].includes(status) && (
              <div className="mt-3">
                <button type="button" onClick={() => refreshStatusOnce(jobId)}
                  className="w-full rounded-xl border border-white/20 px-3 py-2 text-[11px] text-white hover:bg-white/10">
                  Actualizar estado
                </button>
              </div>
            )}
            <div className="mt-3">
              <button type="button" onClick={hardResetPanel}
                className="w-full rounded-xl border border-red-400/30 px-3 py-2 text-[11px] text-red-300 hover:bg-red-500/10">
                Reiniciar panel
              </button>
            </div>
          </div>

          {/* Modo, Formato, Duración */}
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
              <div className="text-xs text-neutral-300">Modo</div>
              <div className="mt-3 space-y-2">
                {[["express","Express"],["standard","Standard"]].map(([v,l]) => (
                  <label key={v} className="flex items-center gap-2 text-[12px] text-neutral-200">
                    <input type="radio" name="i2v_mode" checked={generationMode === v} onChange={() => setGenerationMode(v)} className="h-4 w-4" />
                    {l}
                  </label>
                ))}
              </div>
              <div className="mt-2 text-[10px] text-neutral-500">{getModeDescription()}</div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
              <div className="text-xs text-neutral-300">Formato</div>
              <div className="mt-3 flex items-center gap-2">
                <input id="i2v_916" type="checkbox" checked={useNineSixteen} onChange={(e) => setUseNineSixteen(e.target.checked)} className="h-4 w-4" />
                <label htmlFor="i2v_916" className="text-[12px] text-neutral-200">Vertical 9:16</label>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
              <div className="text-xs text-neutral-300">Duración</div>
              <div className="mt-3 space-y-2">
                {getDurationOptions().map((sec) => (
                  <label key={sec} className="flex items-center gap-2 text-[12px] text-neutral-200">
                    <input type="radio" name="i2v_duration" checked={Number(durationSec) === sec} onChange={() => setDurationSec(sec)} className="h-4 w-4" />
                    {sec} segundos
                  </label>
                ))}
              </div>
              <div className="mt-2 text-[10px] text-neutral-500">fps: {fps} • frames: {fixFramesForWan(Math.round(Number(durationSec) * fps))}</div>
            </div>
          </div>

          {/* Formulario */}
          <div className="mt-4 space-y-4 text-sm">
            {/* Imagen */}
            <div>
              <p className="text-xs text-neutral-300">1. Sube una imagen</p>
              <button type="button" onClick={handlePickFile}
                className="mt-2 flex h-40 w-full items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/50 text-sm text-neutral-300 hover:bg-white/5">
                {dataUrl ? "Cambiar imagen" : "Haz clic para subir una imagen"}
              </button>
              <input id={fileInputId} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
              {dataUrl && <div className="mt-3 overflow-hidden rounded-2xl border border-white/10"><img src={dataUrl} alt="Base" className="w-full object-cover" /></div>}
            </div>

            <div>
              <p className="text-xs text-neutral-300">o pega una URL de imagen</p>
              <input type="text" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://..."
                className="mt-2 w-full rounded-2xl bg-black/60 px-3 py-2 text-xs text-white outline-none ring-1 ring-white/10" />
            </div>

            <div>
              <label className="text-neutral-300">Prompt (opcional)</label>
              <textarea className="mt-1 h-20 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10"
                value={prompt} onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe movimiento, cámara, ambiente..." />
              <div className="mt-1 text-[10px] text-neutral-500">ℹ️ Se añaden instrucciones automáticas para evitar subtítulos.</div>
            </div>

            <div>
              <label className="text-neutral-300">Negativo (opcional)</label>
              <textarea className="mt-1 h-16 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10"
                value={negative} onChange={(e) => setNegative(e.target.value)} placeholder="borroso, baja calidad..." />
            </div>

            {/* Optimizador */}
            <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-neutral-300">
                  Optimización de prompt (OpenAI)
                  {optimizedPrompt ? <span className="ml-2 text-[10px] text-emerald-300">Listo ✓</span> : <span className="ml-2 text-[10px] text-neutral-400">Opcional</span>}
                </div>
                <button type="button" onClick={handleOptimize} disabled={isOptimizing || !prompt?.trim()}
                  className="rounded-xl border border-white/20 px-3 py-1 text-[11px] text-white hover:bg-white/10 disabled:opacity-50">
                  {isOptimizing ? "Optimizando..." : "Optimizar con IA"}
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input id="useOptI2V" type="checkbox" checked={useOptimized} onChange={(e) => setUseOptimized(e.target.checked)} className="h-4 w-4" />
                <label htmlFor="useOptI2V" className="text-[11px] text-neutral-300">Usar prompt optimizado para generar</label>
              </div>
              {optError && <div className="mt-2 text-[11px] text-red-400">{optError}</div>}
            </div>

            {/* Audio Express */}
            {generationMode === "express" && (
              <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
                <div className="text-xs text-neutral-300">Audio Layer</div>
                <div className="mt-2 flex items-center gap-2">
                  <input id="i2v_audio" type="checkbox" checked={includeAudio} onChange={(e) => setIncludeAudio(e.target.checked)} className="h-4 w-4" />
                  <label htmlFor="i2v_audio" className="text-[11px] text-neutral-300">Activar audio o voz desde el prompt (+4 jades)</label>
                </div>
                <div className="mt-2 text-[10px] text-neutral-500">{getAudioHelpText()}</div>
              </div>
            )}

            {/* ── Voz ElevenLabs + Sync Lipsync v2 Pro para Standard ── */}
            {generationMode === "standard" && (
              <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-white">🎙️ Voz ElevenLabs + Lip Sync</p>
                    <p className="text-[10px] text-neutral-400 mt-0.5">
                      WAN genera mudo → ElevenLabs agrega voz → <span className="text-cyan-300 font-medium">Sync Lipsync v2 Pro</span> sincroniza labios
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input id="enable_lipsync" type="checkbox" checked={enableLipsync} onChange={e => setEnableLipsync(e.target.checked)} className="h-4 w-4" />
                    <label htmlFor="enable_lipsync" className="text-[11px] text-neutral-300">Activar (+4 jades)</label>
                  </div>
                </div>

                {enableLipsync && (
                  <>
                    <div>
                      <label className="text-[11px] text-neutral-400">Texto que dirá el personaje</label>
                      <textarea
                        className="mt-1 h-20 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-xs text-white outline-none ring-1 ring-white/10 focus:ring-cyan-400"
                        value={narrationText}
                        onChange={e => setNarrationText(e.target.value)}
                        placeholder="Escribe aquí lo que el personaje debe decir en el video..."
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] text-neutral-400">Acento / Región</label>
                        <select value={voiceAccent} onChange={e => setVoiceAccent(e.target.value)}
                          className="mt-1 w-full rounded-xl bg-black/60 px-3 py-2 text-xs text-white outline-none ring-1 ring-white/10 focus:ring-cyan-400">
                          {ACCENTS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] text-neutral-400">Género de voz</label>
                        <div className="mt-2 space-y-2">
                          {[["mujer","Femenina"],["hombre","Masculina"]].map(([v,l]) => (
                            <label key={v} className="flex items-center gap-2 text-[12px] text-neutral-200">
                              <input type="radio" name="voice_gender" checked={voiceGender === v} onChange={() => setVoiceGender(v)} className="h-4 w-4" />
                              {l}
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Badge del modelo de lipsync */}
                    <div className="rounded-xl border border-cyan-400/20 bg-cyan-500/5 px-3 py-2 flex items-center gap-2">
                      <span className="text-cyan-300 text-lg">✦</span>
                      <div>
                        <p className="text-[11px] font-semibold text-white">Sync Lipsync v2 Pro <span className="text-[10px] font-normal text-cyan-300">(fal.ai)</span></p>
                        <p className="text-[10px] text-neutral-400">Alta fidelidad facial · Dientes naturales · Rasgos únicos preservados</p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-yellow-400/20 bg-yellow-500/5 px-3 py-2 text-[10px] text-yellow-200">
                      ⏱️ El proceso toma 5-10 min: WAN genera el video → ElevenLabs crea la voz → Sync Lipsync v2 Pro sincroniza los labios vía fal.ai.
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Parámetros avanzados */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-neutral-300">Steps</label>
                <input type="number" min={1} max={80} value={steps} onChange={(e) => setSteps(Number(e.target.value))}
                  className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10" />
              </div>
              <div>
                <label className="text-neutral-300">Guidance (CFG)</label>
                <input type="number" step="0.5" min={1} max={10} value={guidanceScale} onChange={(e) => setGuidanceScale(Number(e.target.value))}
                  className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-neutral-300">Strength</label>
                <input type="number" step="0.05" min={0.1} max={1.0} value={strength} onChange={(e) => setStrength(Number(e.target.value))}
                  className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10" />
                <div className="mt-1 text-[10px] text-neutral-500">Rec: 0.60–0.70</div>
              </div>
              <div>
                <label className="text-neutral-300">Movimiento</label>
                <input type="number" step="0.05" min={0.1} max={2.0} value={motionStrength} onChange={(e) => setMotionStrength(Number(e.target.value))}
                  className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10" />
                <div className="mt-1 text-[10px] text-neutral-500">Rec: 0.9–1.1</div>
              </div>
            </div>

            {/* Seed */}
            <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
              <div className="text-xs text-neutral-300">Seed</div>
              <div className="mt-2 flex items-center gap-3">
                <input id="i2v_seed_random" type="checkbox" checked={seedMode === "RANDOM"} onChange={(e) => e.target.checked && setSeedMode("RANDOM")} className="h-4 w-4" />
                <label htmlFor="i2v_seed_random" className="text-[12px] text-neutral-200">Aleatorio</label>
                <input id="i2v_seed_fixed" type="checkbox" checked={seedMode === "FIXED"} onChange={(e) => e.target.checked && setSeedMode("FIXED")} className="ml-4 h-4 w-4" />
                <label htmlFor="i2v_seed_fixed" className="text-[12px] text-neutral-200">Fijo</label>
              </div>
              {seedMode === "FIXED" && (
                <input type="number" min={0} max={2147483647} value={seedFixed} onChange={(e) => setSeedFixed(Number(e.target.value))}
                  className="mt-3 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10" />
              )}
            </div>

            {/* Resumen precios */}
            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 text-[11px] text-cyan-100">
              <div className="font-semibold text-white">Precios</div>
              <div className="mt-1 text-red-400">{getAllPricesText()}</div>
              <div className="mt-1 text-cyan-200/80">Selección actual: <span className="font-semibold text-red-400">{getPriceText()}</span></div>
            </div>

            {/* Botón generar */}
            <button type="button" onClick={handleGenerate}
              disabled={["STARTING","IN_PROGRESS"].includes(status) || !hasEnough}
              className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-50">
              {["STARTING","IN_PROGRESS"].includes(status)
                ? "Generando..."
                : !hasEnough
                  ? "No tienes suficientes jades"
                  : `Generar video ${generationMode === "express" ? "Express" : "Standard"}`}
            </button>

            {error && <p className="whitespace-pre-line text-xs text-red-400">{error}</p>}
          </div>
        </div>

        {/* ── Panel derecho: resultado ─────────────────────────── */}
        <div className="flex flex-col rounded-3xl border border-white/10 bg-black/40 p-6">
          <h2 className="text-lg font-semibold text-white">Resultado</h2>
          <div className="mt-4 flex h-[420px] flex-1 items-center justify-center rounded-2xl bg-black/70 text-sm text-neutral-400">
            {videoUrl
              ? <video src={videoUrl} controls className="h-full w-full rounded-2xl object-contain" />
              : <p>Aquí verás el video cuando termine.</p>}
          </div>
          {videoUrl && (
            <button onClick={handleDownload} className="mt-4 w-full rounded-2xl border border-white/30 py-2 text-xs text-white hover:bg-white/10">
              Descargar video
            </button>
          )}
        </div>
      </div>

      {/* ── Modal: Sobre este módulo ────────────────────────────── */}
      {showModuleInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="relative w-full max-w-4xl rounded-3xl border border-white/10 bg-[#05070d] p-5 shadow-2xl">
            <button type="button" onClick={() => setShowModuleInfo(false)}
              className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/5 text-lg text-white hover:bg-white/10">✕</button>
            <div className="pr-12">
              <h3 className="text-xl font-semibold text-white">Sobre este módulo</h3>
              <p className="mt-1 text-sm text-neutral-300">Convierte una imagen en video con Express (Veo3) o Standard (WAN + ElevenLabs + Sync Lipsync v2 Pro).</p>
            </div>
            <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black">
              <video src="/videoinstruvideo.mp4" controls className="h-full max-h-[420px] w-full object-contain" />
            </div>
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-neutral-300 space-y-2">
              <div className="font-semibold text-white">Cómo usar</div>
              <p><span className="font-semibold text-white">1.</span> Sube una imagen o pega una URL.</p>
              <p><span className="font-semibold text-white">2.</span> Elige el modo:</p>
              <div className="ml-4 space-y-1 text-[13px]">
                <p><span className="font-semibold text-cyan-300">Express:</span> mejor calidad, voz más natural (Veo3).</p>
                <p><span className="font-semibold text-cyan-300">Standard:</span> más económico, clips más largos, con opción de voz ElevenLabs + lip sync de alta fidelidad.</p>
              </div>
              <p><span className="font-semibold text-white">3.</span> En Standard, activa <span className="font-semibold">Voz + Lip Sync</span> y escribe lo que debe decir el personaje.</p>
              <p><span className="font-semibold text-white">4.</span> Elige acento y género de voz.</p>
              <p><span className="font-semibold text-white">5.</span> Haz clic en Generar y espera.</p>
              <div className="rounded-xl border border-cyan-400/20 bg-cyan-500/5 px-3 py-2 text-[12px] text-cyan-200">
                ✦ El lip sync usa <span className="font-semibold">Sync Lipsync v2 Pro</span> (fal.ai) — preserva dientes naturales y rasgos faciales únicos para un resultado más realista.
              </div>
              <div className="rounded-xl border border-yellow-400/20 bg-yellow-500/5 px-3 py-2 text-[12px] text-yellow-200">
                ⏱️ Standard con Lip Sync tarda 5-10 min porque procesa WAN → ElevenLabs → Sync Lipsync v2 Pro en secuencia.
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
