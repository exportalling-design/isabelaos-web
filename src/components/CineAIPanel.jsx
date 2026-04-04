// src/components/CineAIPanel.jsx
// ─────────────────────────────────────────────────────────────
// Panel CineAI de IsabelaOS — Seedance 2.0 via PiAPI
//
// FIXES v3:
//   - output.video es el campo real de PiAPI (no output.video_url)
//   - animateExact tiene prompt mucho más fuerte para respetar fondo
//   - Aviso claro: R2V copia movimiento pero NO el fondo del video
//   - Upload de audio para Lip Sync (cualquier preset, opcional)
//   - Campo para pegar URL externa de video (TikTok, YouTube, etc.)
//   - Logs en consola para debug de generación
// ─────────────────────────────────────────────────────────────
import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

const MODES = [
  { id: "tiktok", label: "TikTok Trends", icon: "🕺", desc: "Copia bailes y trends virales" },
  { id: "cine",   label: "Escena Cine",   icon: "🎬", desc: "Calidad cinematográfica Hollywood" },
];

const PRESETS = {
  tiktok: [
    { id: "trend",      icon: "🔥", label: "Trend",      prompt: "Person doing a viral TikTok dance trend, high energy, professional studio lighting, smooth camera orbit, beat-synced fluid movement, vertical format" },
    { id: "transition", icon: "✨", label: "Transición",  prompt: "Smooth outfit transition effect, person spins and outfit changes, colorful background, satisfying motion, TikTok style" },
    { id: "lip",        icon: "🎤", label: "Lip Sync",    prompt: "Person confidently lip syncing to music, close-up to wide shot, expressive performance, ring light, TikTok aesthetic" },
    { id: "comedy",     icon: "😂", label: "Comedy",      prompt: "Person doing a funny reaction skit, exaggerated expressions, dynamic camera cuts, bright colors, TikTok humor style" },
    { id: "glow",       icon: "💅", label: "Glow Up",     prompt: "Dramatic glow-up transformation reveal, person steps forward into light, slow motion hair flip, cinematic beauty lighting" },
    { id: "custom",     icon: "✏️", label: "Custom",      prompt: "" },
  ],
  cine: [
    { id: "action",  icon: "⚡", label: "Acción",   prompt: "Person sprinting across rooftops at golden hour, dynamic parkour moves, cinematic slow motion impact, film grain, dramatic orchestral score, tracking shot" },
    { id: "fight",   icon: "🥊", label: "Pelea",    prompt: "Intense epic fight scene in heavy rain at night, slow motion combat moves, neon lights reflecting on wet concrete, cinematic action thriller, deep dramatic shadows, bullet time camera effect" },
    { id: "drama",   icon: "🎭", label: "Drama",    prompt: "Cinematic close-up of person standing in heavy rain at night, intense emotional expression, city lights bokeh, film noir lighting, slow dolly push-in" },
    { id: "epic",    icon: "🌅", label: "Épico",    prompt: "Medium close-up shot of person standing heroically at cliff edge, city visible behind them at sunset, camera slowly pulls back revealing the epic landscape, golden hour light hitting their face, cinematic epic atmosphere" },
    { id: "noir",    icon: "🕵️", label: "Noir",     prompt: "Detective walking down rain-soaked alley at night, neon signs reflecting in puddles, steam rising from manholes, slow dolly follow shot, film noir, 1940s meets cyberpunk" },
    { id: "custom",  icon: "✏️", label: "Custom",   prompt: "" },
  ],
};

const DURATIONS = [
  { value: 5,  label: "5s",  jades: 40  },
  { value: 10, label: "10s", jades: 75  },
  { value: 15, label: "15s", jades: 110 },
];

const RATIOS = [
  { value: "9:16", label: "9:16", desc: "TikTok / Reels" },
  { value: "16:9", label: "16:9", desc: "Cine / YouTube"  },
  { value: "1:1",  label: "1:1",  desc: "Instagram"       },
];

const BLOCKED_PREVIEW = [
  "tom cruise","brad pitt","scarlett johansson","jennifer lopez","bad bunny",
  "taylor swift","beyonce","beyoncé","rihanna","will smith","elon musk",
  "zuckerberg","trump","obama","kim kardashian","kanye","shakira","maluma",
  "messi","ronaldo","neymar","lebron","spiderman","spider-man","batman",
  "superman","iron man","darth vader","mickey mouse","disney","marvel",
  "j balvin","ozuna","daddy yankee","selena gomez","billie eilish",
  "bruce lee","brucelle","bruce willis","jackie chan",
];

function hasBlockedName(text) {
  const lower = (text || "").toLowerCase();
  return BLOCKED_PREVIEW.find((n) => {
    const escaped = n.replace(/[-]/g, "\\-");
    const regex = new RegExp(`\\b${escaped}\\b`, "i");
    return regex.test(lower);
  }) || null;
}

// ── Clave localStorage para términos aceptados ────────────────
const TERMS_ACCEPTED_KEY = "isabelaos_cineai_terms_v1";

// ── Verificación básica de contenido inapropiado en imagen ────
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
        const r = data[i], g = data[i+1], b = data[i+2];
        if (r > 95 && g > 40 && b > 20 && r > g && r > b &&
            Math.abs(r-g) > 15 && r-b > 15 && g-b > 0) skinPixels++;
      }
      // Más del 60% de tonos piel → posible desnudo → bloquear
      resolve((skinPixels / (50*50)) < 0.60);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(true); };
    img.src = url;
  });
}

function extractLastFrame(videoSrc) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.src = videoSrc;
    video.muted = true;
    video.addEventListener("loadedmetadata", () => {
      video.currentTime = Math.max(0, video.duration - 0.1);
    });
    video.addEventListener("seeked", () => {
      const canvas = document.createElement("canvas");
      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("No se pudo extraer el frame"));
      }, "image/png");
    });
    video.addEventListener("error", () => reject(new Error("Error cargando video")));
    video.load();
  });
}

const HOW_IT_WORKS = [
  { icon: "🕺", title: "TikTok Trends", desc: "Selecciona el tipo de trend. Si subes un video de referencia, el modelo copia el movimiento exacto. Si subes tu foto, tu cara aparece en el video." },
  { icon: "🎬", title: "Escena Cinematográfica", desc: "Elige el tipo de escena (acción, pelea, drama, épico, noir). El modelo genera una escena de calidad Hollywood. Puedes subir tu foto para aparecer." },
  { icon: "👤", title: "Tu foto (opcional)", desc: "Sube una foto tuya de frente con buena iluminación. El modelo usará tu cara como personaje principal." },
  { icon: "🖼️", title: "Animar foto exacta", desc: "Activa esta opción para animar tu foto respetando el fondo y personajes originales. Ideal si tienes una foto en un escenario específico que quieres animar." },
  { icon: "🎥", title: "Video de referencia", desc: "Sube el video del baile o pega la URL. El modelo copia el movimiento exacto. IMPORTANTE: el fondo siempre viene de tu foto o del prompt, nunca del video de referencia." },
  { icon: "🎵", title: "Audio para Lip Sync", desc: "Sube un audio MP3 o WAV para que el personaje haga lip sync de esa canción específica. Funciona con cualquier preset, especialmente con el preset Lip Sync." },
  { icon: "▶", title: "Continuar escena", desc: "Cuando termina un video, el botón 'Continuar escena' extrae el último fotograma y lo usa como punto de partida del siguiente clip. Puedes encadenar clips y crear escenas de 1-2 minutos." },
  { icon: "🚫", title: "Celebridades bloqueadas", desc: "No puedes generar videos con Tom Cruise, Bad Bunny, Messi, Spider-Man, Batman, etc. El sistema lo bloquea automáticamente. Describe un personaje original." },
  { icon: "💎", title: "Costo en Jades", desc: "5 segundos = 40 Jades · 10 segundos = 75 Jades · 15 segundos = 110 Jades. Los Jades se reembolsan automáticamente si hay error del servidor." },
];

export default function CineAIPanel() {
  const [activeMode,     setActiveMode]     = useState("tiktok");
  const [selectedPreset, setSelectedPreset] = useState("trend");
  const [subjectDesc,    setSubjectDesc]    = useState("");
  const [customPrompt,   setCustomPrompt]   = useState("");

  // Uploads
  const [faceImageUrl,    setFaceImageUrl]    = useState(null);
  const [facePreview,     setFacePreview]     = useState(null);
  const [refVideoUrl,     setRefVideoUrl]     = useState(null);
  const [refVideoPreview, setRefVideoPreview] = useState(null);
  const [refVideoExtUrl,  setRefVideoExtUrl]  = useState("");   // URL externa pegada
  const [audioUrl,        setAudioUrl]        = useState(null);
  const [audioName,       setAudioName]       = useState(null);
  const [uploadingFace,   setUploadingFace]   = useState(false);
  const [uploadingVideo,  setUploadingVideo]  = useState(false);
  const [uploadingAudio,  setUploadingAudio]  = useState(false);

  // Opciones
  const [animateExact, setAnimateExact] = useState(false);
  const [duration,     setDuration]     = useState(10);
  const [ratio,        setRatio]        = useState("9:16");

  // Estado del job
  const [generating,     setGenerating]     = useState(false);
  const [currentTaskId,  setCurrentTaskId]  = useState(null);
  const [jobStatus,      setJobStatus]      = useState(null);
  const [videoUrl,       setVideoUrl]       = useState(null);
  const [error,          setError]          = useState(null);
  const [blockedWarning, setBlockedWarning] = useState(null);

  // Continuación
  const [extractingFrame, setExtractingFrame] = useState(false);
  const [lastFrameUrl,    setLastFrameUrl]    = useState(null);
  const [isContinuation,  setIsContinuation]  = useState(false);
  const [frameExtracted,  setFrameExtracted]  = useState(false); // confirmación visual

  // UI
  const [showHowItWorks,  setShowHowItWorks]  = useState(false);
  const [videoFullscreen, setVideoFullscreen] = useState(false);

  // ── Modales de seguridad ──────────────────────────────────
  const [showTermsModal,   setShowTermsModal]   = useState(false);
  const [termsAccepted,    setTermsAccepted]    = useState(() => {
    try { return !!localStorage.getItem(TERMS_ACCEPTED_KEY); } catch { return false; }
  });
  const [showPhotoConsent, setShowPhotoConsent] = useState(false);
  const [pendingPhotoFile, setPendingPhotoFile] = useState(null);
  const [showExtUrlInput, setShowExtUrlInput] = useState(false); // toggle URL externa

  const faceInputRef  = useRef();
  const videoInputRef = useRef();
  const audioInputRef = useRef();
  const pollRef       = useRef();

  const currentPresets = PRESETS[activeMode];
  const preset   = currentPresets.find((p) => p.id === selectedPreset) || currentPresets[0];
  const jadeCost = DURATIONS.find((d) => d.value === duration)?.jades || 75;

  const getFinalPrompt = () => {
    if (selectedPreset === "custom") return customPrompt;
    const base = preset?.prompt || "";
    return subjectDesc ? `${subjectDesc}. ${base}` : base;
  };

  const promptText  = getFinalPrompt();
  const liveBlocked = hasBlockedName(promptText) || hasBlockedName(subjectDesc);

  // El video de referencia efectivo es el subido o el de URL externa
  const effectiveRefVideoUrl = refVideoUrl || (refVideoExtUrl.trim() ? refVideoExtUrl.trim() : null);

  const modeLabel = isContinuation
    ? "Continuando escena anterior 🎬"
    : animateExact && faceImageUrl
      ? "Animar foto exacta — respeta fondo original 🖼️"
      : audioUrl
        ? "Lip sync con audio 🎵"
        : effectiveRefVideoUrl
          ? faceImageUrl ? "Copiar movimiento + tu cara 🔥" : "Copiar movimiento del video"
          : faceImageUrl ? "Animar tu foto"
          : "Solo texto";

  useEffect(() => {
    setSelectedPreset(PRESETS[activeMode][0].id);
  }, [activeMode]);

  useEffect(() => () => clearInterval(pollRef.current), []);

  // Mostrar modal de términos si es la primera vez
  useEffect(() => {
    try {
      if (!localStorage.getItem(TERMS_ACCEPTED_KEY)) {
        setShowTermsModal(true);
      }
    } catch {}
  }, []);

  const uploadToStorage = async (file, folder, setUrl, setPreview, setUploading, previewMode = "url") => {
    setUploading(true);
    setError(null);
    try {
      const ext  = file.name.split(".").pop();
      const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("user-uploads")
        .upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("user-uploads").getPublicUrl(path);
      setUrl(data.publicUrl);
      if (previewMode === "url") setPreview(URL.createObjectURL(file));
      else setPreview(file.name);
    } catch (e) {
      setError("Error subiendo archivo: " + (e.message || "verifica el bucket user-uploads en Supabase"));
    } finally {
      setUploading(false);
    }
  };

  const startPolling = useCallback((taskId) => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const res  = await fetch(`/api/cineai/status/${taskId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        console.log("[CineAI] poll:", data.status, data.videoUrl || "");
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
      } catch (e) {
        console.error("[CineAI] poll error:", e.message);
      }
    }, 4000);
  }, []);

  const handleGenerate = async () => {
    const prompt = getFinalPrompt();
    if (!prompt.trim() || prompt.length < 5) {
      setError("Escribe una descripción de la escena"); return;
    }
    if (liveBlocked) {
      setError(`"${liveBlocked}" está bloqueado por derechos de autor`); return;
    }

    setError(null);
    setBlockedWarning(null);
    setVideoUrl(null);
    setJobStatus(null);
    setLastFrameUrl(null);
    setGenerating(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch("/api/cineai/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization:  `Bearer ${token}`,
        },
        body: JSON.stringify({
          prompt,
          imageUrl:     isContinuation ? lastFrameUrl : (faceImageUrl          || null),
          refVideoUrl:  isContinuation ? null          : (effectiveRefVideoUrl  || null),
          audioUrl:     audioUrl || null,
          animateExact: !isContinuation && animateExact && !!faceImageUrl,
          duration,
          aspectRatio:  ratio,
          sceneMode:    activeMode,
        }),
      });

      const data = await res.json();
      console.log("[CineAI] generate response:", data);

      if (!res.ok) {
        if (data.blocked) setBlockedWarning(data.error);
        throw new Error(data.error || data.detail || "Error del servidor");
      }

      setCurrentTaskId(data.taskId);
      setJobStatus("pending");
      startPolling(data.taskId);
    } catch (e) {
      setError(e.message);
      setGenerating(false);
    }
  };

  const handleContinueScene = async () => {
    if (!videoUrl) return;
    setExtractingFrame(true);
    setFrameExtracted(false);
    setError(null);
    try {
      const frameBlob = await extractLastFrame(videoUrl);
      const path = `cineai/frames/${Date.now()}_lastframe.png`;
      const { error: upErr } = await supabase.storage
        .from("user-uploads")
        .upload(path, frameBlob, { contentType: "image/png", upsert: true });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("user-uploads").getPublicUrl(path);
      setLastFrameUrl(data.publicUrl);
      setFrameExtracted(true); // mostrar confirmación
      // Esperar 1.5s para que el usuario vea el mensaje, luego activar modo continuación
      setTimeout(() => {
        setIsContinuation(true);
        setVideoUrl(null);
        setJobStatus(null);
        setCurrentTaskId(null);
        setFrameExtracted(false);
      }, 1500);
    } catch (e) {
      setError("No se pudo extraer el último frame: " + e.message);
    } finally {
      setExtractingFrame(false);
    }
  };

  const handleReset = () => {
    setVideoUrl(null);
    setJobStatus(null);
    setCurrentTaskId(null);
    setError(null);
    setBlockedWarning(null);
    setGenerating(false);
    setIsContinuation(false);
    setLastFrameUrl(null);
    setFrameExtracted(false);
    clearInterval(pollRef.current);
  };

  return (
    <div className="cp">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Syne:wght@400;500;700&display=swap');
        .cp*,.cp *::before,.cp *::after{box-sizing:border-box;margin:0;padding:0;}
        .cp{font-family:'Syne',sans-serif;background:#060608;min-height:100vh;color:#ddd8cc;}

        /* Header */
        .cp-header{padding:32px 26px 20px;border-bottom:1px solid #111;position:relative;overflow:hidden;}
        .cp-header::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(200,160,80,0.3),transparent);}
        .cp-eyebrow{font-size:10px;letter-spacing:4px;color:#333;text-transform:uppercase;margin-bottom:4px;}
        .cp-title{font-family:'Bebas Neue',sans-serif;font-size:48px;letter-spacing:8px;line-height:1;color:#f0e8d0;}
        .cp-title em{color:#c8a050;font-style:normal;}
        .cp-tagline{font-size:11px;color:#444;letter-spacing:1px;margin-top:6px;}
        .cp-header-row{display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;}
        .cp-mode-pill{display:inline-flex;align-items:center;gap:6px;margin-top:12px;background:rgba(200,160,80,0.07);border:1px solid rgba(200,160,80,0.18);border-radius:20px;padding:5px 14px;font-size:11px;color:#c8a050;letter-spacing:1px;}
        .cp-dot{width:6px;height:6px;border-radius:50%;background:#c8a050;animation:blink 2s infinite;}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0.2}}
        .how-btn{background:rgba(200,160,80,0.08);border:1px solid rgba(200,160,80,0.2);border-radius:8px;color:#c8a050;font-family:'Syne',sans-serif;font-size:12px;padding:8px 16px;cursor:pointer;letter-spacing:1px;white-space:nowrap;transition:all 0.15s;margin-top:12px;}
        .how-btn:hover{background:rgba(200,160,80,0.15);}

        /* Banner celebridades */
        .blocked-banner-top{background:rgba(200,60,60,0.07);border-bottom:1px solid rgba(200,60,60,0.15);padding:10px 26px;font-size:12px;color:#e07070;display:flex;align-items:center;gap:10px;line-height:1.5;}
        .blocked-banner-top strong{color:#f09090;}

        /* Selector modo */
        .mode-selector{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #111;}
        .mode-btn{padding:16px 22px;background:transparent;border:none;cursor:pointer;text-align:left;transition:all 0.15s;border-bottom:3px solid transparent;color:#444;}
        .mode-btn:hover{background:rgba(255,255,255,0.02);color:#888;}
        .mode-btn.active{color:#f0e8d0;border-bottom-color:#c8a050;background:rgba(200,160,80,0.03);}
        .mode-btn:disabled{opacity:0.4;cursor:not-allowed;}
        .mode-btn-icon{font-size:22px;display:block;margin-bottom:3px;}
        .mode-btn-label{font-family:'Bebas Neue',sans-serif;font-size:17px;letter-spacing:3px;display:block;}
        .mode-btn-desc{font-size:10px;letter-spacing:1px;opacity:0.5;margin-top:1px;}

        /* Grid */
        .cp-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#0e0e0e;}
        .cp-cell{background:#060608;padding:20px 24px;}
        .cp-cell-full{grid-column:1/-1;}
        .sec-label{font-size:9px;letter-spacing:4px;text-transform:uppercase;color:#2e2e2e;margin-bottom:14px;display:flex;align-items:center;gap:10px;}
        .sec-label::after{content:'';flex:1;height:1px;background:#111;}

        /* Presets */
        .preset-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;}
        .preset-btn{background:#0a0a0c;border:1px solid #161616;border-radius:8px;padding:12px 4px 10px;cursor:pointer;text-align:center;transition:all 0.15s;color:#333;}
        .preset-btn:hover{border-color:#2a2820;color:#777;}
        .preset-btn.active{border-color:#c8a050;background:rgba(200,160,80,0.05);color:#c8a050;}
        .preset-btn:disabled{opacity:0.4;cursor:not-allowed;}
        .pi{font-size:20px;display:block;margin-bottom:4px;}
        .pn{font-size:9px;letter-spacing:2px;text-transform:uppercase;}

        /* Upload zones */
        .upload-zone{border:1px dashed #1a1a1a;border-radius:10px;padding:16px;text-align:center;cursor:pointer;transition:all 0.2s;min-height:96px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;position:relative;}
        .upload-zone:hover{border-color:#c8a050;background:rgba(200,160,80,0.02);}
        .upload-zone.has-file{border-style:solid;border-color:#2a2820;}
        .upload-zone.uploading{border-color:rgba(200,160,80,0.4);animation:pb 1s infinite;}
        @keyframes pb{50%{border-color:rgba(200,160,80,0.1);}}
        .uz-thumb{width:60px;height:60px;object-fit:cover;border-radius:6px;border:2px solid #c8a050;}
        .uz-video-thumb{width:auto;max-width:100%;max-height:110px;border-radius:6px;border:2px solid #c8a050;object-fit:contain;background:#000;display:block;margin:0 auto;}
        .uz-label{font-size:11px;color:#333;line-height:1.5;}
        .uz-hint{font-size:10px;color:#c8a050;letter-spacing:1px;}
        .uz-badge{position:absolute;top:6px;right:6px;background:rgba(200,160,80,0.12);border:1px solid rgba(200,160,80,0.25);border-radius:4px;font-size:8px;color:#c8a050;padding:2px 6px;letter-spacing:1px;text-transform:uppercase;}
        .remove-btn{background:none;border:none;color:#803030;font-size:10px;cursor:pointer;letter-spacing:1px;text-transform:uppercase;padding:4px 0;font-family:'Syne',sans-serif;}
        .remove-btn:hover{color:#e07070;}

        /* Audio zone */
        .audio-zone{border:1px dashed #1a1a1a;border-radius:10px;padding:12px 16px;display:flex;align-items:center;gap:12px;cursor:pointer;transition:all 0.2s;margin-top:10px;}
        .audio-zone:hover{border-color:#c8a050;background:rgba(200,160,80,0.02);}
        .audio-zone.has-file{border-style:solid;border-color:#2a2820;}
        .audio-zone-text{flex:1;text-align:left;}
        .audio-zone-label{font-size:11px;color:#c8a050;letter-spacing:1px;}
        .audio-zone-name{font-size:12px;color:#ddd8cc;margin-top:2px;}
        .audio-zone-hint{font-size:10px;color:#333;letter-spacing:1px;}

        /* Toggle animar exacta */
        .animate-toggle{display:flex;align-items:center;gap:10px;margin-top:10px;padding:10px 12px;background:rgba(200,160,80,0.04);border:1px solid rgba(200,160,80,0.1);border-radius:8px;cursor:pointer;transition:all 0.15s;}
        .animate-toggle:hover{border-color:rgba(200,160,80,0.2);}
        .animate-toggle.active{border-color:rgba(200,160,80,0.35);background:rgba(200,160,80,0.08);}
        .animate-toggle input{accent-color:#c8a050;width:16px;height:16px;cursor:pointer;}
        .animate-toggle-label{font-size:12px;color:#888;letter-spacing:1px;cursor:pointer;}
        .animate-toggle.active .animate-toggle-label{color:#c8a050;}
        .animate-toggle-desc{font-size:10px;color:#444;margin-left:26px;margin-top:4px;letter-spacing:0.5px;line-height:1.4;}

        /* Aviso R2V fondo */
        .r2v-notice{background:rgba(100,150,255,0.05);border:1px solid rgba(100,150,255,0.15);border-radius:8px;padding:8px 12px;font-size:11px;color:#7090e0;margin-top:8px;line-height:1.5;}

        /* URL externa input */
        .ext-url-toggle{font-size:11px;color:#c8a050;cursor:pointer;letter-spacing:1px;margin-top:8px;display:inline-block;text-decoration:underline;}
        .ext-url-input{width:100%;background:#0a0a0c;border:1px solid #1e1e1e;border-radius:8px;color:#ddd8cc;font-family:'Syne',sans-serif;font-size:12px;padding:10px 13px;outline:none;margin-top:8px;transition:border-color 0.2s;}
        .ext-url-input:focus{border-color:#c8a050;}
        .ext-url-input::placeholder{color:#2a2a2a;}

        /* Continuation badge */
        .continuation-badge{background:rgba(80,180,100,0.08);border:1px solid rgba(80,180,100,0.2);border-radius:8px;padding:10px 14px;font-size:12px;color:#60c870;display:flex;align-items:center;gap:10px;}
        .continuation-badge img{width:40px;height:40px;border-radius:4px;border:1px solid rgba(80,180,100,0.3);object-fit:cover;}
        .continuation-cancel{margin-left:auto;background:none;border:none;color:#803030;font-size:11px;cursor:pointer;letter-spacing:1px;font-family:'Syne',sans-serif;}

        /* Inputs */
        .cp-input,.cp-textarea{width:100%;background:#0a0a0c;border:1px solid #161616;border-radius:8px;color:#ddd8cc;font-family:'Syne',sans-serif;font-size:13px;padding:11px 13px;outline:none;transition:border-color 0.2s;}
        .cp-input:focus,.cp-textarea:focus{border-color:#2a2820;}
        .cp-input::placeholder,.cp-textarea::placeholder{color:#222;}
        .cp-input.warn,.cp-textarea.warn{border-color:rgba(200,60,60,0.4);}
        .cp-textarea{resize:vertical;min-height:86px;margin-top:10px;display:block;}
        .prompt-preview{margin-top:10px;padding:10px 13px;background:#080808;border:1px solid #111;border-radius:8px;font-size:11px;color:#252525;line-height:1.7;font-style:italic;}
        .blocked-banner{background:rgba(200,60,60,0.06);border:1px solid rgba(200,60,60,0.18);border-radius:8px;padding:10px 14px;font-size:12px;color:#e07070;line-height:1.5;margin-top:10px;display:flex;gap:8px;}

        /* Toggles */
        .toggle-row{display:flex;gap:6px;}
        .toggle-btn{flex:1;background:#0a0a0c;border:1px solid #161616;border-radius:8px;padding:12px 6px;cursor:pointer;text-align:center;transition:all 0.15s;color:#333;}
        .toggle-btn:hover{border-color:#2a2820;color:#777;}
        .toggle-btn.active{border-color:#c8a050;background:rgba(200,160,80,0.05);color:#c8a050;}
        .toggle-btn:disabled{opacity:0.4;cursor:not-allowed;}
        .tm{display:block;font-family:'Bebas Neue',sans-serif;font-size:17px;letter-spacing:2px;}
        .ts{display:block;font-size:9px;letter-spacing:1px;opacity:0.5;margin-top:2px;}

        /* CTA */
        .cta-cell{grid-column:1/-1;padding:18px 24px 26px;border-top:1px solid #0e0e0e;background:#060608;}
        .jade-row{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:rgba(200,160,80,0.04);border:1px solid rgba(200,160,80,0.1);border-radius:10px;margin-bottom:12px;}
        .jade-left{font-size:10px;color:#333;letter-spacing:2px;text-transform:uppercase;}
        .jade-right{display:flex;align-items:baseline;gap:4px;}
        .jade-num{font-family:'Bebas Neue',sans-serif;font-size:26px;color:#c8a050;letter-spacing:2px;}
        .jade-unit{font-size:11px;color:#444;}
        .gen-btn{width:100%;background:#c8a050;border:none;border-radius:10px;color:#060608;font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:5px;padding:16px;cursor:pointer;transition:all 0.2s;}
        .gen-btn:hover:not(:disabled){background:#d4aa5a;transform:translateY(-1px);}
        .gen-btn:disabled{background:#141414;color:#2a2a2a;cursor:not-allowed;transform:none;}
        .error-box{background:rgba(200,60,60,0.06);border:1px solid rgba(200,60,60,0.15);border-radius:8px;padding:10px 14px;font-size:12px;color:#e07070;margin-bottom:12px;}

        /* Resultado */
        .result-cell{grid-column:1/-1;padding:26px;text-align:center;border-bottom:1px solid #0e0e0e;background:#060608;}
        .spinner{width:32px;height:32px;border:2px solid #161616;border-top-color:#c8a050;border-radius:50%;animation:spin 0.9s linear infinite;margin:0 auto 14px;}
        @keyframes spin{to{transform:rotate(360deg);}}
        .result-title{font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:4px;color:#f0e8d0;margin-bottom:5px;}
        .result-sub{font-size:11px;color:#2e2e2e;letter-spacing:1px;}
        .dots span{display:inline-block;width:5px;height:5px;border-radius:50%;background:#c8a050;margin:0 3px;animation:db 1.2s infinite;}
        .dots span:nth-child(2){animation-delay:0.2s;}.dots span:nth-child(3){animation-delay:0.4s;}
        @keyframes db{0%,100%{transform:translateY(0);opacity:0.3}50%{transform:translateY(-5px);opacity:1}}
        .result-video{width:100%;max-height:420px;border-radius:10px;background:#000;margin-bottom:14px;}
        .result-actions{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;}
        .ra-btn{background:transparent;border:1px solid #1e1e1e;border-radius:8px;color:#666;font-family:'Syne',sans-serif;font-size:12px;padding:10px 18px;cursor:pointer;transition:all 0.15s;letter-spacing:1px;text-decoration:none;display:inline-block;}
        .ra-btn:hover{border-color:#c8a050;color:#c8a050;}
        .ra-btn.gold{background:#c8a050;color:#060608;border-color:#c8a050;font-weight:700;}
        .ra-btn.gold:hover{background:#d4aa5a;}
        .ra-btn.green{background:rgba(80,180,100,0.1);border-color:rgba(80,180,100,0.3);color:#60c870;}
        .ra-btn.green:hover{background:rgba(80,180,100,0.18);}
        .ra-btn:disabled{opacity:0.4;cursor:not-allowed;}

        /* Modal */
        .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:1000;display:flex;align-items:flex-start;justify-content:flex-end;padding:16px;overflow-y:auto;}
        .modal-box{background:#0a0a0c;border:1px solid #1e1e1e;border-radius:16px;width:100%;max-width:480px;padding:24px;position:relative;max-height:90vh;overflow-y:auto;}
        .modal-title{font-family:'Bebas Neue',sans-serif;font-size:28px;letter-spacing:4px;color:#f0e8d0;margin-bottom:20px;}
        .modal-close{position:absolute;top:16px;right:16px;background:none;border:1px solid #2a2a2a;border-radius:6px;color:#666;font-size:14px;padding:4px 10px;cursor:pointer;}
        .modal-close:hover{color:#c8a050;border-color:#c8a050;}
        .modal-item{display:flex;gap:12px;margin-bottom:18px;}
        .modal-icon{font-size:22px;flex-shrink:0;margin-top:2px;}
        .modal-item-title{font-size:13px;font-weight:700;color:#f0e8d0;margin-bottom:4px;letter-spacing:1px;}
        .modal-item-desc{font-size:12px;color:#666;line-height:1.6;}

        /* Fullscreen */
        .fs-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px;}
        .fs-close{position:absolute;top:20px;right:20px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:50%;color:#fff;font-size:20px;width:44px;height:44px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s;}
        .fs-close:hover{background:rgba(200,160,80,0.3);border-color:#c8a050;}
        .fs-video{max-width:100%;max-height:90vh;border-radius:12px;}

        @media(max-width:600px){
          .cp-grid{grid-template-columns:1fr;}
          .cp-cell-full,.result-cell,.cta-cell{grid-column:1;}
          .cp-title{font-size:36px;}
          .preset-grid{grid-template-columns:repeat(2,1fr);}
        }
      `}</style>

      {/* ══ MODAL TÉRMINOS — primera vez ════════════════════ */}
      {showTermsModal && (
        <div className="modal-overlay" style={{ zIndex: 3000, alignItems: "center", justifyContent: "center" }}>
          <div className="modal-box" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-title" style={{ fontSize: 22, marginBottom: 6 }}>⚖️ TÉRMINOS DE USO — CINEAI</div>
            <p style={{ fontSize: 11, color: "#555", marginBottom: 20, letterSpacing: 1 }}>
              Lee y acepta antes de continuar
            </p>

            <div style={{ fontSize: 12, color: "#888", lineHeight: 1.8, maxHeight: 340, overflowY: "auto", paddingRight: 8 }}>

              <p style={{ color: "#c8a050", fontWeight: 700, marginBottom: 6 }}>1. USO RESPONSABLE</p>
              <p style={{ marginBottom: 14 }}>
                CineAI es una herramienta de generación de video con inteligencia artificial. El usuario es el único y exclusivo responsable del contenido que genera, solicita o publica usando esta plataforma. IsabelaOS Studio no asume ninguna responsabilidad por el uso inadecuado de esta tecnología.
              </p>

              <p style={{ color: "#c8a050", fontWeight: 700, marginBottom: 6 }}>2. PROHIBICIÓN DE SUPLANTACIÓN DE IDENTIDAD</p>
              <p style={{ marginBottom: 14 }}>
                Queda estrictamente prohibido usar CineAI para suplantar la identidad de cualquier persona, ya sea pública o privada, con fines de engaño, fraude, difamación, acoso o cualquier actividad que cause daño. El uso de la imagen de terceros sin su consentimiento explícito es responsabilidad total del usuario.
              </p>

              <p style={{ color: "#c8a050", fontWeight: 700, marginBottom: 6 }}>3. DERECHOS DE IMAGEN Y COPYRIGHT</p>
              <p style={{ marginBottom: 14 }}>
                Al subir fotografías, el usuario declara que posee los derechos sobre dichas imágenes o cuenta con el consentimiento expreso de las personas que aparecen en ellas. IsabelaOS Studio no es responsable por violaciones de derechos de imagen o copyright cometidas por los usuarios.
              </p>

              <p style={{ color: "#c8a050", fontWeight: 700, marginBottom: 6 }}>4. CONTENIDO PROHIBIDO</p>
              <p style={{ marginBottom: 14 }}>
                Está terminantemente prohibido generar contenido de carácter sexual explícito, violencia real contra personas identificables, material que involucre menores de edad, propaganda de odio, o cualquier contenido ilegal según las leyes aplicables. Las violaciones pueden resultar en la suspensión permanente de la cuenta.
              </p>

              <p style={{ color: "#c8a050", fontWeight: 700, marginBottom: 6 }}>5. EXENCIÓN DE RESPONSABILIDAD</p>
              <p style={{ marginBottom: 14 }}>
                IsabelaOS Studio proporciona esta tecnología como herramienta creativa. Cualquier uso que viole estos términos, las leyes locales o los derechos de terceros es responsabilidad exclusiva del usuario. La plataforma se reserva el derecho de suspender cuentas que violen estos términos sin previo aviso.
              </p>

              <p style={{ color: "#c8a050", fontWeight: 700, marginBottom: 6 }}>6. COOPERACIÓN LEGAL</p>
              <p style={{ marginBottom: 6 }}>
                IsabelaOS Studio cooperará con las autoridades competentes ante cualquier reporte de uso ilegal o dañino de la plataforma, proporcionando la información disponible sobre el usuario responsable.
              </p>
            </div>

            <div style={{
              marginTop: 20,
              padding: "12px 14px",
              background: "rgba(200,160,80,0.06)",
              border: "1px solid rgba(200,160,80,0.15)",
              borderRadius: 8,
              fontSize: 11,
              color: "#666",
              lineHeight: 1.6,
            }}>
              Al hacer click en <strong style={{ color: "#c8a050" }}>"Acepto los términos"</strong> confirmas que has leído, entendido y aceptas estos términos de uso. Eres el único responsable del contenido que generes.
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button
                onClick={() => {
                  try { localStorage.setItem(TERMS_ACCEPTED_KEY, "1"); } catch {}
                  setTermsAccepted(true);
                  setShowTermsModal(false);
                }}
                style={{
                  flex: 1,
                  background: "#c8a050",
                  border: "none",
                  borderRadius: 10,
                  color: "#060608",
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 18,
                  letterSpacing: 3,
                  padding: "14px",
                  cursor: "pointer",
                }}
              >
                ✓ ACEPTO LOS TÉRMINOS
              </button>
              <button
                onClick={() => setShowTermsModal(false)}
                style={{
                  background: "transparent",
                  border: "1px solid #222",
                  borderRadius: 10,
                  color: "#555",
                  fontFamily: "'Syne', sans-serif",
                  fontSize: 12,
                  padding: "14px 18px",
                  cursor: "pointer",
                }}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL CONSENTIMIENTO FOTO ════════════════════════ */}
      {showPhotoConsent && (
        <div className="modal-overlay" style={{ zIndex: 3000, alignItems: "center", justifyContent: "center" }}>
          <div className="modal-box" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-title" style={{ fontSize: 20, marginBottom: 6 }}>📸 CONSENTIMIENTO DE IMAGEN</div>

            <div style={{ fontSize: 13, color: "#888", lineHeight: 1.8 }}>
              <p style={{ marginBottom: 12 }}>
                Antes de subir esta fotografía, confirma lo siguiente:
              </p>

              <div style={{ background: "rgba(200,160,80,0.05)", border: "1px solid rgba(200,160,80,0.15)", borderRadius: 8, padding: "12px 14px", marginBottom: 12 }}>
                <p style={{ color: "#ddd8cc", marginBottom: 8 }}>
                  ☑ <strong>Soy el titular de los derechos</strong> de esta fotografía, o tengo el consentimiento expreso de la(s) persona(s) que aparecen en ella para usar su imagen en esta plataforma.
                </p>
                <p style={{ color: "#ddd8cc", marginBottom: 8 }}>
                  ☑ <strong>No usaré esta imagen</strong> para suplantar la identidad de ninguna persona, difamar, engañar o causar daño a terceros.
                </p>
                <p style={{ color: "#ddd8cc", marginBottom: 0 }}>
                  ☑ <strong>Asumo toda la responsabilidad</strong> por el uso que haga del contenido generado con esta imagen. IsabelaOS Studio no es responsable del uso inadecuado.
                </p>
              </div>

              <p style={{ fontSize: 11, color: "#555", lineHeight: 1.6 }}>
                Las fotos con contenido inapropiado, desnudos o que violen los derechos de imagen de terceros serán bloqueadas automáticamente. Las violaciones pueden resultar en la suspensión de tu cuenta.
              </p>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button
                onClick={async () => {
                  setShowPhotoConsent(false);
                  if (pendingPhotoFile) {
                    uploadToStorage(pendingPhotoFile, "cineai/faces", setFaceImageUrl, setFacePreview, setUploadingFace);
                    setPendingPhotoFile(null);
                  }
                }}
                style={{
                  flex: 1,
                  background: "#c8a050",
                  border: "none",
                  borderRadius: 10,
                  color: "#060608",
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 16,
                  letterSpacing: 3,
                  padding: "14px",
                  cursor: "pointer",
                }}
              >
                ✓ ACEPTO Y SUBO LA FOTO
              </button>
              <button
                onClick={() => { setShowPhotoConsent(false); setPendingPhotoFile(null); }}
                style={{
                  background: "transparent",
                  border: "1px solid #222",
                  borderRadius: 10,
                  color: "#555",
                  fontFamily: "'Syne', sans-serif",
                  fontSize: 12,
                  padding: "14px 18px",
                  cursor: "pointer",
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal cómo funciona */}
      {showHowItWorks && (
        <div className="modal-overlay" onClick={() => setShowHowItWorks(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowHowItWorks(false)}>✕</button>
            <div className="modal-title">¿CÓMO FUNCIONA?</div>
            {HOW_IT_WORKS.map((item, i) => (
              <div className="modal-item" key={i}>
                <span className="modal-icon">{item.icon}</span>
                <div>
                  <div className="modal-item-title">{item.title}</div>
                  <div className="modal-item-desc">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fullscreen video */}
      {videoFullscreen && videoUrl && (
        <div className="fs-overlay" onClick={() => setVideoFullscreen(false)}>
          <button className="fs-close" onClick={() => setVideoFullscreen(false)}>✕</button>
          <video className="fs-video" src={videoUrl} controls autoPlay loop playsInline
            onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {/* Header */}
      <div className="cp-header">
        <div className="cp-header-row">
          <div>
            <p className="cp-eyebrow">IsabelaOS Studio</p>
            <h1 className="cp-title">CINE<em>AI</em></h1>
            <p className="cp-tagline">Escenas cinematográficas y trends virales · Seedance 2.0</p>
            <div className="cp-mode-pill"><span className="cp-dot" />{modeLabel}</div>
          </div>
          <button className="how-btn" onClick={() => setShowHowItWorks(true)}>¿Cómo funciona? →</button>
        </div>
      </div>

      {/* Banner celebridades bloqueadas */}
      <div className="blocked-banner-top">
        <span>🚫</span>
        <span>
          <strong>Rostros de celebridades y personajes de Hollywood están bloqueados por derechos de autor.</strong>{" "}
          No puedes usar Tom Cruise, Bad Bunny, Messi, Spider-Man, Batman, etc. Describe un personaje original.
        </span>
      </div>

      {/* Banner recordatorio de términos — siempre visible */}
      <div style={{
        background: "rgba(200,160,80,0.04)",
        borderBottom: "1px solid rgba(200,160,80,0.1)",
        padding: "8px 26px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
      }}>
        <p style={{ fontSize: 11, color: "#444", letterSpacing: 1, lineHeight: 1.5 }}>
          ⚖️ Todo el contenido generado es <strong style={{ color: "#666" }}>responsabilidad exclusiva del usuario</strong>. Prohibida la suplantación de identidad y el uso sin consentimiento de imágenes de terceros.
        </p>
        <button
          onClick={() => setShowTermsModal(true)}
          style={{ background: "none", border: "none", color: "#c8a050", fontSize: 11, cursor: "pointer", letterSpacing: 1, whiteSpace: "nowrap", textDecoration: "underline", padding: 0 }}
        >
          Ver términos completos
        </button>
      </div>

      {/* Selector de modo */}
      <div className="mode-selector">
        {MODES.map((m) => (
          <button key={m.id}
            className={`mode-btn ${activeMode === m.id ? "active" : ""}`}
            onClick={() => { setActiveMode(m.id); handleReset(); }}
            disabled={generating}>
            <span className="mode-btn-icon">{m.icon}</span>
            <span className="mode-btn-label">{m.label}</span>
            <span className="mode-btn-desc">{m.desc}</span>
          </button>
        ))}
      </div>

      <div className="cp-grid">

        {/* Resultado */}
        {(generating || videoUrl || (error && currentTaskId)) && (
          <div className="result-cell">
            {generating && !videoUrl && (
              <>
                <div className="spinner" />
                <div className="result-title">
                  {{ pending: "En cola...", processing: "Renderizando..." }[jobStatus] || "Procesando..."}
                </div>
                <p className="result-sub">Seedance 2.0 está creando tu escena · 1–3 minutos</p>
                <div className="dots" style={{ marginTop: 14 }}><span /><span /><span /></div>
              </>
            )}
            {videoUrl && (
              <>
                <video className="result-video" src={videoUrl} controls autoPlay loop playsInline />
                <div className="result-actions">
                  <button className="ra-btn" onClick={() => setVideoFullscreen(true)}>⛶ Ver en grande</button>
                  <a href={videoUrl} download className="ra-btn gold">⬇ Descargar</a>
                  {/* Mensaje de confirmación extracción de frame */}
                  {frameExtracted && (
                    <div style={{
                      background: "rgba(80,180,100,0.12)",
                      border: "1px solid rgba(80,180,100,0.3)",
                      borderRadius: 8,
                      padding: "8px 16px",
                      fontSize: 12,
                      color: "#60c870",
                      letterSpacing: 1,
                      marginTop: 8,
                    }}>
                      ✅ Último frame extraído — preparando continuación...
                    </div>
                  )}
                  <button
                    className="ra-btn green"
                    onClick={handleContinueScene}
                    disabled={extractingFrame || frameExtracted}
                    style={extractingFrame ? { animation: "pulse-b 0.8s infinite", opacity: 0.7 } : {}}
                  >
                    {extractingFrame ? "⏳ Extrayendo último frame..." : frameExtracted ? "✅ Frame extraído" : "▶ Continuar escena →"}
                  </button>
                  <button className="ra-btn" onClick={handleReset}>✦ Nueva escena</button>
                </div>
              </>
            )}
            {error && currentTaskId && !videoUrl && (
              <>
                <div style={{ fontSize: 28, marginBottom: 10 }}>⚠️</div>
                <div className="result-title">Falló</div>
                <p className="result-sub" style={{ color: "#c05050" }}>{error}</p>
                <button className="ra-btn" style={{ marginTop: 14 }} onClick={handleReset}>Reintentar</button>
              </>
            )}
          </div>
        )}

        {/* Presets */}
        <div className="cp-cell">
          <p className="sec-label">{activeMode === "tiktok" ? "Tipo de trend" : "Tipo de escena"}</p>
          <div className="preset-grid">
            {currentPresets.map((p) => (
              <button key={p.id}
                className={`preset-btn ${selectedPreset === p.id ? "active" : ""}`}
                onClick={() => setSelectedPreset(p.id)}
                disabled={generating}>
                <span className="pi">{p.icon}</span>
                <span className="pn">{p.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Foto del usuario */}
        <div className="cp-cell">
          <p className="sec-label">Tu foto (opcional)</p>
          {isContinuation && lastFrameUrl ? (
            <div className="continuation-badge">
              <img src={lastFrameUrl} alt="último frame" />
              <div>
                <div style={{ fontSize: 11, color: "#60c870", letterSpacing: 1 }}>CONTINUANDO</div>
                <div style={{ fontSize: 10, color: "#444", marginTop: 2 }}>Desde el último frame</div>
              </div>
              <button className="continuation-cancel" onClick={() => { setIsContinuation(false); setLastFrameUrl(null); }}>
                × cancelar
              </button>
            </div>
          ) : (
            <>
              <div
                className={`upload-zone ${facePreview ? "has-file" : ""} ${uploadingFace ? "uploading" : ""}`}
                onClick={() => !facePreview && faceInputRef.current?.click()}>
                {facePreview ? (
                  <><div className="uz-badge">✓ foto</div><img src={facePreview} className="uz-thumb" alt="preview" /></>
                ) : uploadingFace ? (
                  <p style={{ fontSize: 11, color: "#c8a050", letterSpacing: 2 }}>Subiendo...</p>
                ) : (
                  <><span style={{ fontSize: 26 }}>👤</span>
                  <p className="uz-label">Sube tu foto para<br />aparecer en la escena</p>
                  <p className="uz-hint">JPG / PNG</p></>
                )}
              </div>
              {facePreview && (
                <button className="remove-btn" onClick={() => { setFacePreview(null); setFaceImageUrl(null); setAnimateExact(false); }}>
                  × quitar foto
                </button>
              )}

              {/* Toggle animar foto exacta */}
              {facePreview && (
                <>
                  <div className={`animate-toggle ${animateExact ? "active" : ""}`}
                    onClick={() => setAnimateExact((v) => !v)}>
                    <input type="checkbox" checked={animateExact} readOnly />
                    <span className="animate-toggle-label">Animar foto exacta</span>
                  </div>
                  {animateExact && (
                    <p className="animate-toggle-desc">
                      El modelo animará tu foto respetando el fondo, escenario y personajes originales. No cambiará nada del contexto de la imagen.
                    </p>
                  )}
                </>
              )}

              {/* Upload audio para lip sync */}
              <div
                className={`audio-zone ${audioUrl ? "has-file" : ""}`}
                onClick={() => !audioUrl && audioInputRef.current?.click()}>
                <span style={{ fontSize: 20 }}>{audioUrl ? "🎵" : "🎵"}</span>
                <div className="audio-zone-text">
                  {audioUrl ? (
                    <>
                      <div className="audio-zone-label">Audio cargado</div>
                      <div className="audio-zone-name">{audioName}</div>
                    </>
                  ) : uploadingAudio ? (
                    <div className="audio-zone-label">Subiendo audio...</div>
                  ) : (
                    <>
                      <div className="audio-zone-label">Audio para Lip Sync (opcional)</div>
                      <div className="audio-zone-hint">MP3 / WAV · cualquier canción</div>
                    </>
                  )}
                </div>
                {audioUrl && (
                  <button className="remove-btn" style={{ marginLeft: "auto" }}
                    onClick={(e) => { e.stopPropagation(); setAudioUrl(null); setAudioName(null); }}>
                    ×
                  </button>
                )}
              </div>

              <input ref={faceInputRef} type="file" accept="image/*" style={{ display: "none" }}
                onChange={async (e) => {
                  const f = e.target.files[0];
                  if (!f) return;
                  // Verificar contenido inapropiado
                  const isSafe = await checkImageSafety(f);
                  if (!isSafe) {
                    setError("La imagen fue bloqueada por contener contenido inapropiado. Solo se permiten fotos de rostros y retratos.");
                    e.target.value = "";
                    return;
                  }
                  // Mostrar modal de consentimiento antes de subir
                  setPendingPhotoFile(f);
                  setShowPhotoConsent(true);
                  e.target.value = "";
                }} />
              <input ref={audioInputRef} type="file" accept="audio/mp3,audio/wav,audio/mpeg,audio/*" style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files[0];
                  if (f) {
                    setAudioName(f.name);
                    uploadToStorage(f, "cineai/audio", setAudioUrl, () => {}, setUploadingAudio, "name");
                  }
                }} />
            </>
          )}
        </div>

        {/* Video de referencia */}
        {!isContinuation && (
          <div className="cp-cell cp-cell-full">
            <p className="sec-label">
              {activeMode === "tiktok"
                ? "Video del trend a copiar — el modelo copia el movimiento exacto (opcional)"
                : "Video de referencia — copia el movimiento o coreografía (opcional)"}
            </p>

            {/* Aviso sobre el fondo */}
            <div className="r2v-notice">
              ℹ️ <strong>Importante:</strong> el modelo copia el <strong>movimiento</strong> del video de referencia, pero el <strong>fondo siempre viene de tu foto o del prompt</strong>. Nunca se copia el fondo del video de referencia. Esto es comportamiento del modelo.
            </div>

            <div style={{ marginTop: 10 }}>
              <div
                className={`upload-zone ${refVideoPreview ? "has-file" : ""} ${uploadingVideo ? "uploading" : ""}`}
                style={{ minHeight: 130, maxHeight: 170 }}
                onClick={() => !refVideoPreview && !showExtUrlInput && videoInputRef.current?.click()}>
                {refVideoPreview ? (
                  <>
                    <div className="uz-badge">✓ referencia</div>
                    <video src={refVideoPreview} className="uz-video-thumb" muted autoPlay loop playsInline />
                    <p style={{ fontSize: 10, color: "#555", marginTop: 6, letterSpacing: 1 }}>
                      {faceImageUrl ? "🔥 Tu cara copiará este movimiento exacto" : "El personaje copiará este movimiento"}
                    </p>
                  </>
                ) : uploadingVideo ? (
                  <p style={{ fontSize: 11, color: "#c8a050", letterSpacing: 2 }}>Subiendo video...</p>
                ) : refVideoExtUrl ? (
                  <>
                    <span style={{ fontSize: 22 }}>🔗</span>
                    <p style={{ fontSize: 11, color: "#c8a050" }}>URL externa configurada</p>
                    <p style={{ fontSize: 10, color: "#555" }}>{refVideoExtUrl.slice(0, 50)}...</p>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 28 }}>🎬</span>
                    <p className="uz-label">
                      {activeMode === "tiktok"
                        ? "Haz click para subir el video del trend"
                        : "Haz click para subir el video de referencia"}
                    </p>
                    <p className="uz-hint">MP4 · máx recomendado 15s · opcional</p>
                  </>
                )}
              </div>

              {refVideoPreview && (
                <button className="remove-btn" onClick={() => { setRefVideoPreview(null); setRefVideoUrl(null); }}>
                  × quitar video
                </button>
              )}

              {/* Opción de pegar URL externa */}
              {!refVideoPreview && (
                <>
                  <span className="ext-url-toggle" onClick={() => setShowExtUrlInput((v) => !v)}>
                    {showExtUrlInput ? "▲ Ocultar URL externa" : "▼ O pega la URL de un video (TikTok, YouTube, etc.)"}
                  </span>
                  {showExtUrlInput && (
                    <input
                      className="ext-url-input"
                      placeholder="https://www.tiktok.com/@usuario/video/... o cualquier URL de video"
                      value={refVideoExtUrl}
                      onChange={(e) => setRefVideoExtUrl(e.target.value)}
                    />
                  )}
                  {refVideoExtUrl && (
                    <button className="remove-btn" onClick={() => { setRefVideoExtUrl(""); setShowExtUrlInput(false); }}>
                      × quitar URL
                    </button>
                  )}
                </>
              )}
            </div>

            <input ref={videoInputRef} type="file" accept="video/mp4,video/mov,video/quicktime,video/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files[0];
                if (f) uploadToStorage(f, "cineai/refs", setRefVideoUrl, setRefVideoPreview, setUploadingVideo);
              }} />
          </div>
        )}

        {/* Describe la escena */}
        <div className="cp-cell cp-cell-full">
          <p className="sec-label">Describe la escena</p>
          {selectedPreset !== "custom" ? (
            <>
              <input
                className={`cp-input ${liveBlocked ? "warn" : ""}`}
                placeholder={activeMode === "tiktok"
                  ? "¿Quién baila? ej: mujer joven con outfit colorido, hombre con sombrero..."
                  : "¿Quién aparece? ej: hombre con saco negro, mujer con vestido rojo..."}
                value={subjectDesc}
                onChange={(e) => { setSubjectDesc(e.target.value); setBlockedWarning(null); }}
                disabled={generating}
              />
              <div className="prompt-preview">{subjectDesc ? `${subjectDesc}. ` : ""}{preset?.prompt}</div>
            </>
          ) : (
            <textarea
              className={`cp-textarea ${liveBlocked ? "warn" : ""}`}
              placeholder={activeMode === "tiktok"
                ? "Describe el trend: personaje, movimiento, iluminación, energía, estética..."
                : "Describe tu escena: personaje, acción, iluminación, cámara, atmósfera, estilo..."}
              value={customPrompt}
              onChange={(e) => { setCustomPrompt(e.target.value); setBlockedWarning(null); }}
              disabled={generating}
            />
          )}
          {liveBlocked && (
            <div className="blocked-banner">
              <span>🚫</span>
              <span><strong>"{liveBlocked}"</strong> está bloqueado por derechos de autor. Describe un personaje original.</span>
            </div>
          )}
          {blockedWarning && !liveBlocked && (
            <div className="blocked-banner"><span>⚠️</span><span>{blockedWarning}</span></div>
          )}
        </div>

        {/* Duración */}
        <div className="cp-cell">
          <p className="sec-label">Duración</p>
          <div className="toggle-row">
            {DURATIONS.map((d) => (
              <button key={d.value}
                className={`toggle-btn ${duration === d.value ? "active" : ""}`}
                onClick={() => setDuration(d.value)} disabled={generating}>
                <span className="tm">{d.label}</span>
                <span className="ts">{d.jades} Jades</span>
              </button>
            ))}
          </div>
        </div>

        {/* Formato */}
        <div className="cp-cell">
          <p className="sec-label">Formato</p>
          <div className="toggle-row">
            {RATIOS.map((r) => (
              <button key={r.value}
                className={`toggle-btn ${ratio === r.value ? "active" : ""}`}
                onClick={() => setRatio(r.value)} disabled={generating}>
                <span className="tm">{r.label}</span>
                <span className="ts">{r.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="cta-cell">
          <div className="jade-row">
            <span className="jade-left">Costo de esta escena</span>
            <div className="jade-right">
              <span className="jade-num">{jadeCost}</span>
              <span className="jade-unit">Jades</span>
            </div>
          </div>
          {error && !currentTaskId && <div className="error-box">{error}</div>}
          <button className="gen-btn" onClick={handleGenerate}
            disabled={generating || uploadingFace || uploadingVideo || uploadingAudio || !!liveBlocked}>
            {generating ? "GENERANDO..." : isContinuation ? "▶ CONTINUAR ESCENA" : "✦ CREAR ESCENA"}
          </button>
        </div>

      </div>
    </div>
  );
}
