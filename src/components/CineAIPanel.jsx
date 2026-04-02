// ─────────────────────────────────────────────────────────────────────────────
// src/components/CineAIPanel.jsx
//
// Panel principal del módulo CineAI de IsabelaOS.
// Features:
//   - Selector de modo: TikTok Trends vs Escena Cinematográfica
//   - Upload de foto del usuario (I2V / R2V+face)
//   - Upload de video de referencia para copiar movimiento exacto (R2V)
//   - Selector de duración: 5s / 10s / 15s
//   - Selector de formato: 9:16 / 16:9 / 1:1
//   - Prompt libre con presets por modo
//   - Bloqueo de celebridades en tiempo real (frontend + backend)
//   - Polling automático cada 4s hasta completar
//   - Extracción del último frame para CONTINUAR la escena
//   - Botón "Continuar escena" que pre-carga el panel con el último frame
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

// ── Modos principales ─────────────────────────────────────────────────────────
// "tiktok" = optimizado para trends y baile
// "cine"   = escenas cinematográficas tipo Hollywood
const MODES = [
  { id: "tiktok", label: "TikTok Trends", icon: "🕺", desc: "Copia bailes y trends virales" },
  { id: "cine",   label: "Escena Cine",   icon: "🎬", desc: "Calidad cinematográfica Hollywood" },
];

// ── Presets por modo ──────────────────────────────────────────────────────────
const PRESETS = {
  tiktok: [
    { id: "trend",   icon: "🔥", label: "Trend",    prompt: "Person doing a viral TikTok dance trend, high energy, professional studio lighting, smooth camera orbit, beat-synced fluid movement, vertical format" },
    { id: "transition", icon: "✨", label: "Transición", prompt: "Smooth outfit transition effect, person spins and outfit changes, colorful background, satisfying motion, TikTok style" },
    { id: "lip",     icon: "🎤", label: "Lip Sync",  prompt: "Person confidently lip syncing to music, close-up to wide shot, expressive performance, ring light, TikTok aesthetic" },
    { id: "comedy",  icon: "😂", label: "Comedy",    prompt: "Person doing a funny reaction skit, exaggerated expressions, dynamic camera cuts, bright colors, TikTok humor style" },
    { id: "glow",    icon: "💅", label: "Glow Up",   prompt: "Dramatic glow-up transformation reveal, person steps forward into light, slow motion hair flip, cinematic beauty lighting" },
    { id: "custom",  icon: "✏️", label: "Custom",    prompt: "" },
  ],
  cine: [
    { id: "action",  icon: "⚡", label: "Acción",    prompt: "Person sprinting across rooftops at golden hour, dynamic parkour moves, cinematic slow motion impact, film grain, dramatic orchestral score, tracking shot" },
    { id: "fight",   icon: "🥊", label: "Pelea",     prompt: "Intense rooftop fistfight scene, bullet-time slow motion punch impact, neon lights reflecting on wet concrete, cinematic action thriller style, deep dramatic shadows" },
    { id: "drama",   icon: "🎭", label: "Drama",     prompt: "Cinematic close-up of person standing in heavy rain at night, intense emotional expression, city lights bokeh, film noir lighting, slow dolly push-in" },
    { id: "epic",    icon: "🌅", label: "Épico",     prompt: "Aerial drone shot descending to reveal person standing at cliff edge overlooking city at sunset, golden hour light, epic orchestral atmosphere, National Geographic quality" },
    { id: "noir",    icon: "🕵️", label: "Noir",      prompt: "Detective walking down rain-soaked alley at night, neon signs reflecting in puddles, steam rising from manholes, slow dolly follow shot, film noir, 1940s meets cyberpunk" },
    { id: "custom",  icon: "✏️", label: "Custom",    prompt: "" },
  ],
};

// ── Duraciones disponibles ────────────────────────────────────────────────────
const DURATIONS = [
  { value: 5,  label: "5s",  jades: 40,  desc: "Rápido" },
  { value: 10, label: "10s", jades: 75,  desc: "Balance" },
  { value: 15, label: "15s", jades: 110, desc: "Máximo" },
];

// ── Formatos de video ─────────────────────────────────────────────────────────
const RATIOS = [
  { value: "9:16",  label: "9:16",  desc: "TikTok / Reels" },
  { value: "16:9",  label: "16:9",  desc: "Cine / YouTube" },
  { value: "1:1",   label: "1:1",   desc: "Instagram" },
];

// ── Lista de nombres bloqueados (validación rápida en frontend) ───────────────
// El backend tiene la lista completa. Esta es solo para UX inmediata.
const BLOCKED_PREVIEW = [
  "tom cruise","brad pitt","scarlett johansson","jennifer lopez","bad bunny",
  "taylor swift","beyonce","beyoncé","rihanna","will smith","elon musk",
  "zuckerberg","trump","obama","kim kardashian","kanye","shakira","maluma",
  "messi","ronaldo","neymar","lebron","spiderman","spider-man","batman",
  "superman","iron man","darth vader","mickey mouse","disney","marvel",
  "j balvin","ozuna","daddy yankee","selena gomez","billie eilish",
];

function hasBlockedName(text) {
  const lower = (text || "").toLowerCase();
  return BLOCKED_PREVIEW.find((n) => lower.includes(n)) || null;
}

// ── Extraer último frame de un video usando canvas en el browser ──────────────
// Retorna un Blob de imagen PNG con el último frame del video.
function extractLastFrame(videoSrc) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.src = videoSrc;
    video.muted = true;

    video.addEventListener("loadedmetadata", () => {
      // Ir al último frame (duración total - 0.1s de margen)
      video.currentTime = Math.max(0, video.duration - 0.1);
    });

    video.addEventListener("seeked", () => {
      const canvas = document.createElement("canvas");
      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("No se pudo extraer el frame"));
      }, "image/png");
    });

    video.addEventListener("error", () => reject(new Error("Error cargando video para extracción de frame")));
    video.load();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────────────────────
export default function CineAIPanel() {

  // ── Modo (tiktok / cine) ──────────────────────────────────────────────────
  const [activeMode, setActiveMode]       = useState("tiktok");

  // ── Preset seleccionado ───────────────────────────────────────────────────
  const [selectedPreset, setSelectedPreset] = useState("trend");

  // ── Prompt y descripción del personaje ───────────────────────────────────
  const [subjectDesc, setSubjectDesc]     = useState(""); // quién aparece
  const [customPrompt, setCustomPrompt]   = useState(""); // prompt libre

  // ── Uploads ──────────────────────────────────────────────────────────────
  const [faceImageUrl, setFaceImageUrl]   = useState(null);   // URL Supabase Storage
  const [facePreview, setFacePreview]     = useState(null);   // preview local blob
  const [refVideoUrl, setRefVideoUrl]     = useState(null);   // URL Supabase Storage
  const [refVideoPreview, setRefVideoPreview] = useState(null); // preview local blob
  const [uploadingFace, setUploadingFace] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);

  // ── Configuración de generación ───────────────────────────────────────────
  const [duration, setDuration]           = useState(10);
  const [ratio, setRatio]                 = useState("9:16");

  // ── Estado del job ────────────────────────────────────────────────────────
  const [generating, setGenerating]       = useState(false);
  const [currentTaskId, setCurrentTaskId] = useState(null);
  const [jobStatus, setJobStatus]         = useState(null);
  const [videoUrl, setVideoUrl]           = useState(null);
  const [error, setError]                 = useState(null);
  const [blockedWarning, setBlockedWarning] = useState(null);

  // ── Continuación de video ─────────────────────────────────────────────────
  const [extractingFrame, setExtractingFrame] = useState(false);
  const [lastFrameUrl, setLastFrameUrl]   = useState(null); // URL del último frame en Storage
  const [isContinuation, setIsContinuation] = useState(false); // modo continuación activo

  // ── Refs ──────────────────────────────────────────────────────────────────
  const faceInputRef  = useRef();
  const videoInputRef = useRef();
  const pollRef       = useRef();

  // ── Computed ──────────────────────────────────────────────────────────────
  const currentPresets = PRESETS[activeMode];
  const preset = currentPresets.find((p) => p.id === selectedPreset) || currentPresets[0];
  const jadeCost = DURATIONS.find((d) => d.value === duration)?.jades || 75;

  // Prompt final que se enviará al API
  const getFinalPrompt = () => {
    if (selectedPreset === "custom") return customPrompt;
    const base = preset?.prompt || "";
    return subjectDesc ? `${subjectDesc}. ${base}` : base;
  };

  // Chequeo en vivo de nombres bloqueados
  const promptText = getFinalPrompt();
  const liveBlocked = hasBlockedName(promptText) || hasBlockedName(subjectDesc);

  // Label del modo activo para el pill del header
  const modeLabel = isContinuation
    ? "Continuando escena anterior 🎬"
    : refVideoUrl
      ? faceImageUrl ? "Copiar movimiento + tu cara 🔥" : "Copiar movimiento del video"
      : faceImageUrl ? "Animar tu foto"
      : "Solo texto";

  // ── Cuando cambia el modo, resetear preset al primero del nuevo modo ──────
  useEffect(() => {
    const firstPreset = PRESETS[activeMode][0];
    setSelectedPreset(firstPreset.id);
  }, [activeMode]);

  // ── Cleanup del intervalo de polling al desmontar ─────────────────────────
  useEffect(() => () => clearInterval(pollRef.current), []);

  // ── Upload genérico a Supabase Storage ───────────────────────────────────
  const uploadToStorage = async (file, folder, setUrl, setPreview, setUploading) => {
    setUploading(true);
    setError(null);
    try {
      const ext = file.name.split(".").pop();
      const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("user-uploads")
        .upload(path, file, { upsert: true });

      if (upErr) throw upErr;

      const { data } = supabase.storage.from("user-uploads").getPublicUrl(path);
      setUrl(data.publicUrl);
      setPreview(URL.createObjectURL(file));
    } catch (e) {
      setError("Error subiendo archivo. Verifica que el bucket 'user-uploads' existe en Supabase.");
    } finally {
      setUploading(false);
    }
  };

  // ── Polling del estado del job ────────────────────────────────────────────
  const startPolling = useCallback((taskId) => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res  = await fetch(`/api/cineai/status/${taskId}`);
        const data = await res.json();
        setJobStatus(data.status);

        if (data.status === "completed") {
          setVideoUrl(data.videoUrl);
          setGenerating(false);
          clearInterval(pollRef.current);
        } else if (data.status === "failed") {
          setError(data.error || "La generación falló");
          setGenerating(false);
          clearInterval(pollRef.current);
        }
      } catch {
        // Silencioso — seguir intentando
      }
    }, 4000); // cada 4 segundos
  }, []);

  // ── Generar video ─────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    const prompt = getFinalPrompt();

    if (!prompt.trim() || prompt.length < 5) {
      setError("Escribe una descripción de la escena");
      return;
    }
    if (liveBlocked) {
      setError(`No puedes usar "${liveBlocked}" — describe un personaje original`);
      return;
    }

    setError(null);
    setBlockedWarning(null);
    setVideoUrl(null);
    setJobStatus(null);
    setLastFrameUrl(null);
    setGenerating(true);

    try {
      const res = await fetch("/api/cineai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          // En modo continuación, el último frame se usa como imagen de entrada
          imageUrl:    isContinuation ? lastFrameUrl : (faceImageUrl || null),
          refVideoUrl: isContinuation ? null          : (refVideoUrl  || null),
          duration,
          aspectRatio: ratio,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.blocked) setBlockedWarning(data.error);
        throw new Error(data.error || "Error del servidor");
      }

      setCurrentTaskId(data.taskId);
      setJobStatus("pending");
      startPolling(data.taskId);
    } catch (e) {
      setError(e.message);
      setGenerating(false);
    }
  };

  // ── Extraer último frame y preparar continuación ──────────────────────────
  const handleContinueScene = async () => {
    if (!videoUrl) return;
    setExtractingFrame(true);
    setError(null);

    try {
      // 1. Extraer último frame del video como PNG blob
      const frameBlob = await extractLastFrame(videoUrl);

      // 2. Subir el frame a Supabase Storage
      const path = `cineai/frames/${Date.now()}_lastframe.png`;
      const { error: upErr } = await supabase.storage
        .from("user-uploads")
        .upload(path, frameBlob, { contentType: "image/png", upsert: true });

      if (upErr) throw upErr;

      const { data } = supabase.storage.from("user-uploads").getPublicUrl(path);

      // 3. Activar modo continuación
      setLastFrameUrl(data.publicUrl);
      setIsContinuation(true);

      // 4. Resetear resultado anterior para nueva generación
      setVideoUrl(null);
      setJobStatus(null);
      setCurrentTaskId(null);

    } catch (e) {
      setError("No se pudo extraer el último frame: " + e.message);
    } finally {
      setExtractingFrame(false);
    }
  };

  // ── Reset completo ────────────────────────────────────────────────────────
  const handleReset = () => {
    setVideoUrl(null);
    setJobStatus(null);
    setCurrentTaskId(null);
    setError(null);
    setBlockedWarning(null);
    setGenerating(false);
    setIsContinuation(false);
    setLastFrameUrl(null);
    clearInterval(pollRef.current);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="cp">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Syne:wght@400;500;700&display=swap');

        /* ── Reset base ── */
        .cp *, .cp *::before, .cp *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .cp {
          font-family: 'Syne', sans-serif;
          background: #060608;
          min-height: 100vh;
          color: #ddd8cc;
        }

        /* ── Header ── */
        .cp-header {
          padding: 36px 28px 24px;
          border-bottom: 1px solid #111;
          position: relative;
          overflow: hidden;
        }
        .cp-header::after {
          content: '';
          position: absolute;
          bottom: 0; left: 0; right: 0; height: 1px;
          background: linear-gradient(90deg, transparent, rgba(200,160,80,0.3), transparent);
        }
        .cp-eyebrow { font-size: 10px; letter-spacing: 4px; color: #333; text-transform: uppercase; margin-bottom: 4px; }
        .cp-title {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 52px;
          letter-spacing: 8px;
          line-height: 1;
          color: #f0e8d0;
        }
        .cp-title em { color: #c8a050; font-style: normal; }
        .cp-tagline { font-size: 11px; color: #444; letter-spacing: 1px; margin-top: 6px; }
        .cp-mode-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-top: 12px;
          background: rgba(200,160,80,0.07);
          border: 1px solid rgba(200,160,80,0.18);
          border-radius: 20px;
          padding: 5px 14px;
          font-size: 11px;
          color: #c8a050;
          letter-spacing: 1px;
        }
        .cp-dot { width: 6px; height: 6px; border-radius: 50%; background: #c8a050; animation: blink 2s infinite; }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }

        /* ── Selector de modo (TikTok / Cine) ── */
        .mode-selector {
          display: grid;
          grid-template-columns: 1fr 1fr;
          border-bottom: 1px solid #111;
        }
        .mode-btn {
          padding: 18px 24px;
          background: transparent;
          border: none;
          cursor: pointer;
          text-align: left;
          transition: all 0.15s;
          border-bottom: 3px solid transparent;
          color: #444;
        }
        .mode-btn:hover { background: rgba(255,255,255,0.02); color: #888; }
        .mode-btn.active {
          color: #f0e8d0;
          border-bottom-color: #c8a050;
          background: rgba(200,160,80,0.03);
        }
        .mode-btn-icon { font-size: 24px; display: block; margin-bottom: 4px; }
        .mode-btn-label { font-family: 'Bebas Neue', sans-serif; font-size: 18px; letter-spacing: 3px; display: block; }
        .mode-btn-desc { font-size: 10px; letter-spacing: 1px; opacity: 0.5; margin-top: 2px; }

        /* ── Grid principal ── */
        .cp-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1px;
          background: #0e0e0e;
        }
        .cp-cell { background: #060608; padding: 22px 26px; }
        .cp-cell-full { grid-column: 1 / -1; }

        /* ── Section label ── */
        .sec-label {
          font-size: 9px;
          letter-spacing: 4px;
          text-transform: uppercase;
          color: #2e2e2e;
          margin-bottom: 14px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .sec-label::after { content: ''; flex: 1; height: 1px; background: #111; }

        /* ── Presets ── */
        .preset-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
        .preset-btn {
          background: #0a0a0c;
          border: 1px solid #161616;
          border-radius: 8px;
          padding: 12px 4px 10px;
          cursor: pointer;
          text-align: center;
          transition: all 0.15s;
          color: #333;
        }
        .preset-btn:hover { border-color: #2a2820; color: #777; }
        .preset-btn.active { border-color: #c8a050; background: rgba(200,160,80,0.05); color: #c8a050; }
        .preset-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .pi { font-size: 20px; display: block; margin-bottom: 4px; }
        .pn { font-size: 9px; letter-spacing: 2px; text-transform: uppercase; }

        /* ── Upload zones ── */
        .upload-zone {
          border: 1px dashed #1a1a1a;
          border-radius: 10px;
          padding: 16px;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s;
          min-height: 100px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 5px;
          position: relative;
        }
        .upload-zone:hover { border-color: #c8a050; background: rgba(200,160,80,0.02); }
        .upload-zone.has-file { border-style: solid; border-color: #2a2820; }
        .upload-zone.uploading { border-color: rgba(200,160,80,0.4); animation: pulse-border 1s infinite; }
        @keyframes pulse-border { 50% { border-color: rgba(200,160,80,0.1); } }

        .uz-thumb { width: 64px; height: 64px; object-fit: cover; border-radius: 6px; border: 2px solid #c8a050; }
        .uz-video-thumb { width: 100%; max-height: 80px; border-radius: 6px; border: 2px solid #c8a050; object-fit: cover; }
        .uz-label { font-size: 11px; color: #333; line-height: 1.5; }
        .uz-hint { font-size: 10px; color: #c8a050; letter-spacing: 1px; }
        .uz-badge {
          position: absolute; top: 6px; right: 6px;
          background: rgba(200,160,80,0.12);
          border: 1px solid rgba(200,160,80,0.25);
          border-radius: 4px;
          font-size: 8px; color: #c8a050;
          padding: 2px 6px; letter-spacing: 1px; text-transform: uppercase;
        }
        .remove-btn {
          background: none; border: none;
          color: #803030; font-size: 10px;
          cursor: pointer; letter-spacing: 1px;
          text-transform: uppercase; padding: 4px 0;
          font-family: 'Syne', sans-serif;
        }
        .remove-btn:hover { color: #e07070; }

        /* ── Continuación badge ── */
        .continuation-badge {
          background: rgba(80,180,100,0.08);
          border: 1px solid rgba(80,180,100,0.2);
          border-radius: 8px;
          padding: 10px 14px;
          font-size: 12px;
          color: #60c870;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .continuation-badge img {
          width: 40px; height: 40px;
          border-radius: 4px;
          border: 1px solid rgba(80,180,100,0.3);
          object-fit: cover;
        }
        .continuation-cancel {
          margin-left: auto;
          background: none; border: none;
          color: #803030; font-size: 11px;
          cursor: pointer; letter-spacing: 1px;
          font-family: 'Syne', sans-serif;
        }

        /* ── Inputs ── */
        .cp-input, .cp-textarea {
          width: 100%;
          background: #0a0a0c;
          border: 1px solid #161616;
          border-radius: 8px;
          color: #ddd8cc;
          font-family: 'Syne', sans-serif;
          font-size: 13px;
          padding: 11px 13px;
          outline: none;
          transition: border-color 0.2s;
        }
        .cp-input:focus, .cp-textarea:focus { border-color: #2a2820; }
        .cp-input::placeholder, .cp-textarea::placeholder { color: #222; }
        .cp-input.warn, .cp-textarea.warn { border-color: rgba(200,60,60,0.4); }
        .cp-textarea { resize: vertical; min-height: 88px; margin-top: 10px; display: block; }

        .prompt-preview {
          margin-top: 10px;
          padding: 10px 13px;
          background: #080808;
          border: 1px solid #111;
          border-radius: 8px;
          font-size: 11px;
          color: #252525;
          line-height: 1.7;
          font-style: italic;
        }

        /* ── Blocked warning ── */
        .blocked-banner {
          background: rgba(200,60,60,0.06);
          border: 1px solid rgba(200,60,60,0.18);
          border-radius: 8px;
          padding: 10px 14px;
          font-size: 12px;
          color: #e07070;
          line-height: 1.5;
          margin-top: 10px;
          display: flex;
          gap: 8px;
        }

        /* ── Toggles (duración / ratio) ── */
        .toggle-row { display: flex; gap: 6px; }
        .toggle-btn {
          flex: 1;
          background: #0a0a0c;
          border: 1px solid #161616;
          border-radius: 8px;
          padding: 12px 6px;
          cursor: pointer;
          text-align: center;
          transition: all 0.15s;
          color: #333;
        }
        .toggle-btn:hover { border-color: #2a2820; color: #777; }
        .toggle-btn.active { border-color: #c8a050; background: rgba(200,160,80,0.05); color: #c8a050; }
        .toggle-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .tm { display: block; font-family: 'Bebas Neue', sans-serif; font-size: 17px; letter-spacing: 2px; }
        .ts { display: block; font-size: 9px; letter-spacing: 1px; opacity: 0.5; margin-top: 2px; }

        /* ── CTA / Jade cost ── */
        .cta-cell {
          grid-column: 1 / -1;
          padding: 20px 26px 28px;
          border-top: 1px solid #0e0e0e;
          background: #060608;
        }
        .jade-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 13px 17px;
          background: rgba(200,160,80,0.04);
          border: 1px solid rgba(200,160,80,0.1);
          border-radius: 10px;
          margin-bottom: 13px;
        }
        .jade-left { font-size: 10px; color: #333; letter-spacing: 2px; text-transform: uppercase; }
        .jade-right { display: flex; align-items: baseline; gap: 4px; }
        .jade-num { font-family: 'Bebas Neue', sans-serif; font-size: 26px; color: #c8a050; letter-spacing: 2px; }
        .jade-unit { font-size: 11px; color: #444; }

        .gen-btn {
          width: 100%;
          background: #c8a050;
          border: none;
          border-radius: 10px;
          color: #060608;
          font-family: 'Bebas Neue', sans-serif;
          font-size: 22px;
          letter-spacing: 5px;
          padding: 17px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .gen-btn:hover:not(:disabled) { background: #d4aa5a; transform: translateY(-1px); }
        .gen-btn:disabled { background: #141414; color: #2a2a2a; cursor: not-allowed; transform: none; }

        .error-box {
          background: rgba(200,60,60,0.06);
          border: 1px solid rgba(200,60,60,0.15);
          border-radius: 8px;
          padding: 10px 14px;
          font-size: 12px;
          color: #e07070;
          margin-bottom: 12px;
        }

        /* ── Result / Status ── */
        .result-cell {
          grid-column: 1 / -1;
          padding: 28px;
          text-align: center;
          border-bottom: 1px solid #0e0e0e;
          background: #060608;
        }
        .spinner {
          width: 34px; height: 34px;
          border: 2px solid #161616;
          border-top-color: #c8a050;
          border-radius: 50%;
          animation: spin 0.9s linear infinite;
          margin: 0 auto 14px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .result-title {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 24px;
          letter-spacing: 4px;
          color: #f0e8d0;
          margin-bottom: 5px;
        }
        .result-sub { font-size: 11px; color: #2e2e2e; letter-spacing: 1px; }
        .dots span {
          display: inline-block;
          width: 5px; height: 5px;
          border-radius: 50%;
          background: #c8a050;
          margin: 0 3px;
          animation: db 1.2s infinite;
        }
        .dots span:nth-child(2) { animation-delay: 0.2s; }
        .dots span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes db { 0%,100%{transform:translateY(0);opacity:0.3} 50%{transform:translateY(-5px);opacity:1} }

        .result-video {
          width: 100%;
          max-height: 440px;
          border-radius: 10px;
          background: #000;
          margin-bottom: 16px;
        }
        .result-actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
        .ra-btn {
          background: transparent;
          border: 1px solid #1e1e1e;
          border-radius: 8px;
          color: #666;
          font-family: 'Syne', sans-serif;
          font-size: 12px;
          padding: 10px 18px;
          cursor: pointer;
          transition: all 0.15s;
          letter-spacing: 1px;
          text-decoration: none;
          display: inline-block;
        }
        .ra-btn:hover { border-color: #c8a050; color: #c8a050; }
        .ra-btn.gold { background: #c8a050; color: #060608; border-color: #c8a050; font-weight: 700; }
        .ra-btn.gold:hover { background: #d4aa5a; }
        .ra-btn.green { background: rgba(80,180,100,0.1); border-color: rgba(80,180,100,0.3); color: #60c870; }
        .ra-btn.green:hover { background: rgba(80,180,100,0.18); }
        .ra-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        /* ── Responsive ── */
        @media (max-width: 600px) {
          .cp-grid { grid-template-columns: 1fr; }
          .cp-cell-full, .result-cell, .cta-cell { grid-column: 1; }
          .cp-title { font-size: 38px; }
          .preset-grid { grid-template-columns: repeat(2, 1fr); }
          .mode-selector { grid-template-columns: 1fr 1fr; }
        }
      `}</style>

      {/* ══ HEADER ══════════════════════════════════════════════════════════ */}
      <div className="cp-header">
        <p className="cp-eyebrow">IsabelaOS Studio</p>
        <h1 className="cp-title">CINE<em>AI</em></h1>
        <p className="cp-tagline">Escenas cinematográficas e trends virales con IA · Seedance 2.0</p>
        <div className="cp-mode-pill">
          <span className="cp-dot" />
          {modeLabel}
        </div>
      </div>

      {/* ══ SELECTOR DE MODO ════════════════════════════════════════════════ */}
      <div className="mode-selector">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`mode-btn ${activeMode === m.id ? "active" : ""}`}
            onClick={() => { setActiveMode(m.id); handleReset(); }}
            disabled={generating}
          >
            <span className="mode-btn-icon">{m.icon}</span>
            <span className="mode-btn-label">{m.label}</span>
            <span className="mode-btn-desc">{m.desc}</span>
          </button>
        ))}
      </div>

      <div className="cp-grid">

        {/* ══ RESULTADO / STATUS ══════════════════════════════════════════════ */}
        {(generating || videoUrl || (error && currentTaskId)) && (
          <div className="result-cell">

            {/* Generando */}
            {generating && !videoUrl && (
              <>
                <div className="spinner" />
                <div className="result-title">
                  {{ pending: "En cola...", processing: "Renderizando..." }[jobStatus] || "Procesando..."}
                </div>
                <p className="result-sub">Seedance 2.0 está creando tu escena · 1–3 minutos</p>
                <div className="dots" style={{ marginTop: 14 }}>
                  <span /><span /><span />
                </div>
              </>
            )}

            {/* Video listo */}
            {videoUrl && (
              <>
                <video
                  className="result-video"
                  src={videoUrl}
                  controls autoPlay loop playsInline
                />
                <div className="result-actions">
                  {/* Descargar */}
                  <a href={videoUrl} download className="ra-btn gold">⬇ Descargar</a>

                  {/* Continuar escena — extrae último frame */}
                  <button
                    className="ra-btn green"
                    onClick={handleContinueScene}
                    disabled={extractingFrame}
                  >
                    {extractingFrame ? "Extrayendo frame..." : "▶ Continuar escena"}
                  </button>

                  {/* Nueva escena desde cero */}
                  <button className="ra-btn" onClick={handleReset}>
                    ✦ Nueva escena
                  </button>
                </div>
              </>
            )}

            {/* Error */}
            {error && currentTaskId && !videoUrl && (
              <>
                <div style={{ fontSize: 30, marginBottom: 10 }}>⚠️</div>
                <div className="result-title">Falló</div>
                <p className="result-sub" style={{ color: "#c05050" }}>{error}</p>
                <button className="ra-btn" style={{ marginTop: 14 }} onClick={handleReset}>
                  Reintentar
                </button>
              </>
            )}
          </div>
        )}

        {/* ══ PRESETS DE ESCENA ═══════════════════════════════════════════════ */}
        <div className="cp-cell">
          <p className="sec-label">
            {activeMode === "tiktok" ? "Tipo de trend" : "Tipo de escena"}
          </p>
          <div className="preset-grid">
            {currentPresets.map((p) => (
              <button
                key={p.id}
                className={`preset-btn ${selectedPreset === p.id ? "active" : ""}`}
                onClick={() => setSelectedPreset(p.id)}
                disabled={generating}
              >
                <span className="pi">{p.icon}</span>
                <span className="pn">{p.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ══ UPLOAD FOTO DEL USUARIO ══════════════════════════════════════════ */}
        <div className="cp-cell">
          <p className="sec-label">Tu foto (opcional)</p>

          {/* Si está en modo continuación, mostrar el frame extraído */}
          {isContinuation && lastFrameUrl ? (
            <div className="continuation-badge">
              <img src={lastFrameUrl} alt="último frame" />
              <div>
                <div style={{ fontSize: 11, color: "#60c870", letterSpacing: 1 }}>CONTINUANDO</div>
                <div style={{ fontSize: 10, color: "#444", marginTop: 2 }}>Desde el último frame del video anterior</div>
              </div>
              <button className="continuation-cancel" onClick={() => { setIsContinuation(false); setLastFrameUrl(null); }}>
                × cancelar
              </button>
            </div>
          ) : (
            <>
              <div
                className={`upload-zone ${facePreview ? "has-file" : ""} ${uploadingFace ? "uploading" : ""}`}
                onClick={() => !facePreview && faceInputRef.current?.click()}
              >
                {facePreview ? (
                  <>
                    <div className="uz-badge">✓ foto</div>
                    <img src={facePreview} className="uz-thumb" alt="face preview" />
                  </>
                ) : uploadingFace ? (
                  <p style={{ fontSize: 11, color: "#c8a050", letterSpacing: 2 }}>Subiendo...</p>
                ) : (
                  <>
                    <span style={{ fontSize: 26 }}>👤</span>
                    <p className="uz-label">Sube tu foto para<br />aparecer en la escena</p>
                    <p className="uz-hint">JPG / PNG</p>
                  </>
                )}
              </div>
              {facePreview && (
                <button className="remove-btn" onClick={() => { setFacePreview(null); setFaceImageUrl(null); }}>
                  × quitar foto
                </button>
              )}
              <input
                ref={faceInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files[0];
                  if (f) uploadToStorage(f, "cineai/faces", setFaceImageUrl, setFacePreview, setUploadingFace);
                }}
              />
            </>
          )}
        </div>

        {/* ══ UPLOAD VIDEO DE REFERENCIA (R2V) ════════════════════════════════ */}
        {!isContinuation && (
          <div className="cp-cell cp-cell-full">
            <p className="sec-label">
              {activeMode === "tiktok"
                ? "Video del trend a copiar — sube el baile y el modelo copia el movimiento exacto"
                : "Video de referencia — copia la coreografía o movimiento de cámara"}
            </p>
            <div
              className={`upload-zone ${refVideoPreview ? "has-file" : ""} ${uploadingVideo ? "uploading" : ""}`}
              style={{ minHeight: 110 }}
              onClick={() => !refVideoPreview && videoInputRef.current?.click()}
            >
              {refVideoPreview ? (
                <>
                  <div className="uz-badge">✓ referencia</div>
                  <video
                    src={refVideoPreview}
                    className="uz-video-thumb"
                    muted autoPlay loop playsInline
                  />
                  <p style={{ fontSize: 10, color: "#555", marginTop: 6, letterSpacing: 1 }}>
                    {faceImageUrl
                      ? "🔥 Tu cara copiará este movimiento exacto"
                      : "El personaje copiará este movimiento"}
                  </p>
                </>
              ) : uploadingVideo ? (
                <p style={{ fontSize: 11, color: "#c8a050", letterSpacing: 2 }}>Subiendo video...</p>
              ) : (
                <>
                  <span style={{ fontSize: 30 }}>🎬</span>
                  <p className="uz-label">
                    {activeMode === "tiktok"
                      ? "Sube el video del trend que quieres replicar"
                      : "Sube un video para copiar el movimiento o estilo de cámara"}
                  </p>
                  <p className="uz-hint">MP4 · máx recomendado 15s</p>
                </>
              )}
            </div>
            {refVideoPreview && (
              <button className="remove-btn" onClick={() => { setRefVideoPreview(null); setRefVideoUrl(null); }}>
                × quitar video
              </button>
            )}
            <input
              ref={videoInputRef}
              type="file"
              accept="video/mp4,video/mov,video/quicktime,video/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files[0];
                if (f) uploadToStorage(f, "cineai/refs", setRefVideoUrl, setRefVideoPreview, setUploadingVideo);
              }}
            />
          </div>
        )}

        {/* ══ DESCRIBE LA ESCENA / PROMPT ══════════════════════════════════════ */}
        <div className="cp-cell cp-cell-full">
          <p className="sec-label">Describe la escena</p>

          {selectedPreset !== "custom" ? (
            <>
              {/* Descripción del personaje */}
              <input
                className={`cp-input ${liveBlocked ? "warn" : ""}`}
                placeholder={
                  activeMode === "tiktok"
                    ? "¿Quién baila? ej: mujer joven con outfit colorido, hombre con sombrero..."
                    : "¿Quién aparece? ej: hombre con saco negro, mujer con vestido rojo..."
                }
                value={subjectDesc}
                onChange={(e) => { setSubjectDesc(e.target.value); setBlockedWarning(null); }}
                disabled={generating}
              />
              {/* Preview del prompt completo */}
              <div className="prompt-preview">
                {subjectDesc ? `${subjectDesc}. ` : ""}{preset?.prompt}
              </div>
            </>
          ) : (
            /* Prompt libre */
            <textarea
              className={`cp-textarea ${liveBlocked ? "warn" : ""}`}
              placeholder={
                activeMode === "tiktok"
                  ? "Describe el trend: personaje, movimiento, iluminación, energía, estética..."
                  : "Describe tu escena: personaje, acción, iluminación, cámara, atmósfera, estilo cinematográfico..."
              }
              value={customPrompt}
              onChange={(e) => { setCustomPrompt(e.target.value); setBlockedWarning(null); }}
              disabled={generating}
            />
          )}

          {/* Warning en vivo si detecta celebridad */}
          {liveBlocked && (
            <div className="blocked-banner">
              <span>🚫</span>
              <span>
                <strong>"{liveBlocked}"</strong> no está permitido. No puedes generar videos con rostros de celebridades o personajes con copyright. Describe un personaje original.
              </span>
            </div>
          )}

          {/* Warning del servidor */}
          {blockedWarning && !liveBlocked && (
            <div className="blocked-banner">
              <span>⚠️</span>
              <span>{blockedWarning}</span>
            </div>
          )}
        </div>

        {/* ══ DURACIÓN ════════════════════════════════════════════════════════ */}
        <div className="cp-cell">
          <p className="sec-label">Duración</p>
          <div className="toggle-row">
            {DURATIONS.map((d) => (
              <button
                key={d.value}
                className={`toggle-btn ${duration === d.value ? "active" : ""}`}
                onClick={() => setDuration(d.value)}
                disabled={generating}
              >
                <span className="tm">{d.label}</span>
                <span className="ts">{d.jades} Jades</span>
              </button>
            ))}
          </div>
        </div>

        {/* ══ FORMATO ═════════════════════════════════════════════════════════ */}
        <div className="cp-cell">
          <p className="sec-label">Formato</p>
          <div className="toggle-row">
            {RATIOS.map((r) => (
              <button
                key={r.value}
                className={`toggle-btn ${ratio === r.value ? "active" : ""}`}
                onClick={() => setRatio(r.value)}
                disabled={generating}
              >
                <span className="tm">{r.label}</span>
                <span className="ts">{r.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ══ CTA: COSTO + BOTÓN ══════════════════════════════════════════════ */}
        <div className="cta-cell">
          <div className="jade-row">
            <span className="jade-left">Costo de esta escena</span>
            <div className="jade-right">
              <span className="jade-num">{jadeCost}</span>
              <span className="jade-unit">Jades</span>
            </div>
          </div>

          {/* Error sin taskId (validación local) */}
          {error && !currentTaskId && (
            <div className="error-box">{error}</div>
          )}

          <button
            className="gen-btn"
            onClick={handleGenerate}
            disabled={generating || uploadingFace || uploadingVideo || !!liveBlocked}
          >
            {generating
              ? "GENERANDO..."
              : isContinuation
                ? "▶ CONTINUAR ESCENA"
                : "✦ CREAR ESCENA"}
          </button>
        </div>

      </div>
    </div>
  );
}
