// src/components/CineAIPanel.jsx
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

// ── PRECIOS — costo real EvoLink Seedance 2.0 Fast × 3 (incluye Vercel, Supabase, Pagadito)
// EvoLink: 480p=$0.074/s · 720p=$0.161/s · 1 Jade=$0.10 USD
const DURATIONS = [
  { value: 5,  label: "5s",  jades480: 11, jades720: 25 },
  { value: 10, label: "10s", jades480: 22, jades720: 49 },
  { value: 15, label: "15s", jades480: 33, jades720: 73 },
];

const QUALITIES = [
  { value: "480p", label: "480p", desc: "Más rápido · Menos costo" },
  { value: "720p", label: "720p", desc: "Alta calidad · Standard"  },
];

const RATIOS = [
  { value: "9:16", label: "9:16", desc: "TikTok / Reels"  },
  { value: "16:9", label: "16:9", desc: "Cine / YouTube"   },
  { value: "1:1",  label: "1:1",  desc: "Instagram"        },
  { value: "4:3",  label: "4:3",  desc: "Clásico"          },
  { value: "21:9", label: "21:9", desc: "Ultra ancho"       },
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

const TERMS_ACCEPTED_KEY = "isabelaos_cineai_terms_v1";

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
  { icon: "🎬", title: "Escena Cinematográfica", desc: "Elige el tipo de escena (acción, pelea, drama, épico, noir). El modelo genera una escena de calidad Hollywood." },
  { icon: "👤", title: "Tu foto (opcional)", desc: "Sube una foto tuya de frente con buena iluminación. El modelo usará tu cara como personaje principal." },
  { icon: "🖼️", title: "Animar foto exacta", desc: "Activa esta opción para animar tu foto respetando el fondo y personajes originales." },
  { icon: "🎥", title: "Video de referencia", desc: "Sube el video del baile en MP4 o pega la URL. El modelo copia el movimiento exacto. IMPORTANTE: el fondo siempre viene de tu foto o del prompt." },
  { icon: "🎵", title: "Audio para Lip Sync", desc: "Sube un audio MP3 o WAV para que el personaje haga lip sync de esa canción específica." },
  { icon: "▶", title: "Continuar escena", desc: "Cuando termina un clip, el botón 'Continuar escena' extrae el último frame Y usa el clip completo como referencia de atmósfera." },
  { icon: "🚫", title: "Celebridades bloqueadas", desc: "No puedes generar videos con Tom Cruise, Bad Bunny, Messi, Spider-Man, Batman, etc." },
  { icon: "💎", title: "Costo en Jades", desc: "480p: 5s=11J · 10s=22J · 15s=33J · 720p: 5s=25J · 10s=49J · 15s=73J." },
];

export default function CineAIPanel() {
  const [activeMode,     setActiveMode]     = useState("tiktok");
  const [selectedPreset, setSelectedPreset] = useState("trend");
  const [subjectDesc,    setSubjectDesc]    = useState("");
  const [customPrompt,   setCustomPrompt]   = useState("");

  const [magicIdea,    setMagicIdea]    = useState("");
  const [magicLoading, setMagicLoading] = useState(false);
  const [magicPrompts, setMagicPrompts] = useState(null);
  const [magicError,   setMagicError]   = useState(null);

  const [refImages,       setRefImages]       = useState([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const faceImageUrl = refImages[0]?.url || null;
  const [refVideoUrl,     setRefVideoUrl]     = useState(null);
  const [refVideoPreview, setRefVideoPreview] = useState(null);
  const [refVideoExtUrl,  setRefVideoExtUrl]  = useState("");
  const [audioUrl,        setAudioUrl]        = useState(null);
  const [audioName,       setAudioName]       = useState(null);
  const [uploadingFace,   setUploadingFace]   = useState(false);
  const [uploadingVideo,  setUploadingVideo]  = useState(false);
  const [uploadingAudio,  setUploadingAudio]  = useState(false);

  const [animateExact, setAnimateExact] = useState(false);
  const [duration,     setDuration]     = useState(10);
  const [ratio,        setRatio]        = useState("9:16");
  const [quality,      setQuality]      = useState("480p");

  const [generating,     setGenerating]     = useState(false);
  const [currentTaskId,  setCurrentTaskId]  = useState(null);
  const [jobStatus,      setJobStatus]      = useState(null);
  const [videoUrl,       setVideoUrl]       = useState(null);
  const [error,          setError]          = useState(null);
  const [blockedWarning, setBlockedWarning] = useState(null);

  const [extractingFrame,  setExtractingFrame]  = useState(false);
  const [lastFrameUrl,     setLastFrameUrl]     = useState(null);
  const [previousVideoUrl, setPreviousVideoUrl] = useState(null);
  const [isContinuation,   setIsContinuation]   = useState(false);
  const [frameExtracted,   setFrameExtracted]   = useState(false);

  const [showHowItWorks,  setShowHowItWorks]  = useState(false);
  const [videoFullscreen, setVideoFullscreen] = useState(false);
  const [showExtUrlInput, setShowExtUrlInput] = useState(false);

  const [showIsabela,     setShowIsabela]     = useState(false);
  const [isabelaStep,     setIsabelaStep]     = useState(0);
  const [isabelaAnswers,  setIsabelaAnswers]  = useState({});
  const [isabelaLoading,  setIsabelaLoading]  = useState(false);
  const [isabelaResult,   setIsabelaResult]   = useState(null);
  const [isabelaError,    setIsabelaError]    = useState(null);

  const [showTermsModal,   setShowTermsModal]   = useState(false);
  const [termsAccepted,    setTermsAccepted]    = useState(() => {
    try { return !!localStorage.getItem(TERMS_ACCEPTED_KEY); } catch { return false; }
  });
  const [showPhotoConsent, setShowPhotoConsent] = useState(false);
  const [pendingPhotoFile, setPendingPhotoFile] = useState(null);

  const faceInputRef  = useRef();
  const videoInputRef = useRef();
  const audioInputRef = useRef();
  const pollRef       = useRef();

  const currentPresets = PRESETS[activeMode];
  const preset   = currentPresets.find((p) => p.id === selectedPreset) || currentPresets[0];
  const durObj   = DURATIONS.find((d) => d.value === duration);
  const jadeCost = quality === "480p" ? (durObj?.jades480 || 3) : (durObj?.jades720 || 9);

  const getFinalPrompt = () => {
    if (selectedPreset === "custom") return customPrompt;
    const base = preset?.prompt || "";
    return subjectDesc ? `${subjectDesc}. ${base}` : base;
  };

  const promptText  = getFinalPrompt();
  const liveBlocked = hasBlockedName(promptText) || hasBlockedName(subjectDesc);
  const effectiveRefVideoUrl = refVideoUrl || (refVideoExtUrl.trim() ? refVideoExtUrl.trim() : null);

  const modeLabel = isContinuation
    ? "Continuando escena — continuidad perfecta 🎬"
    : animateExact && faceImageUrl
      ? "Animar foto exacta — respeta fondo original 🖼️"
      : audioUrl
        ? "Lip sync con audio 🎵"
        : effectiveRefVideoUrl
          ? faceImageUrl ? "Copiar movimiento + tu cara 🔥" : "Copiar movimiento del video"
          : faceImageUrl ? "Animar tu foto"
          : "Solo texto";

  useEffect(() => { setSelectedPreset(PRESETS[activeMode][0].id); }, [activeMode]);
  useEffect(() => () => clearInterval(pollRef.current), []);

  useEffect(() => {
    try {
      if (!localStorage.getItem(TERMS_ACCEPTED_KEY)) setShowTermsModal(true);
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
    let attempts = 0;
    const MAX_ATTEMPTS = 150;

    pollRef.current = setInterval(async () => {
      attempts++;
      if (attempts > MAX_ATTEMPTS) {
        clearInterval(pollRef.current);
        setError("⏳ El video tardó más de 10 minutos. Ve a tu Biblioteca — puede que ya esté listo.");
        setGenerating(false);
        return;
      }
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const res = await fetch("/api/cineai/poll-status", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ taskId }),
        });
        const data = await res.json();
        setJobStatus(data.status);
        if (data.status === "completed" && data.videoUrl) {
          setVideoUrl(data.videoUrl);
          setGenerating(false);
          clearInterval(pollRef.current);
        } else if (data.status === "failed") {
          const errMsg = data.error || "";
          if (errMsg.toLowerCase().includes("service busy") || errMsg.toLowerCase().includes("allocating")) {
            setError("⚠️ Servidor ocupado — intenta de nuevo en unos minutos.");
          } else {
            setError(errMsg || "La generación falló.");
          }
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

      let bodyPayload;
      if (isContinuation) {
        bodyPayload = {
          prompt,
          imageUrl:       lastFrameUrl,
          refVideoUrl:    previousVideoUrl,
          isContinuation: true,
          duration,
          aspectRatio:    ratio,
          quality,
          sceneMode:      activeMode,
        };
      } else {
        bodyPayload = {
          prompt,
          imageUrl:     faceImageUrl          || null,
          refImages:    refImages.filter(i => i.url).map(i => i.url),
          refVideoUrl:  effectiveRefVideoUrl  || null,
          audioUrl:     audioUrl              || null,
          animateExact: !!(animateExact && faceImageUrl),
          isContinuation: false,
          duration,
          aspectRatio:  ratio,
          quality,
          sceneMode:    activeMode,
        };
      }

      const res = await fetch("/api/cineai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(bodyPayload),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.blocked) setBlockedWarning(data.error);
        throw new Error(data.error || data.detail || "Error del servidor");
      }

      const pollId = data.taskId || data.jobId;
      setCurrentTaskId(pollId);
      setJobStatus("pending");

      if (data.videoUrl) {
        setVideoUrl(data.videoUrl);
        setGenerating(false);
        return;
      }

      startPolling(pollId);
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
      const currentVideoUrl = videoUrl;
      const frameBlob = await extractLastFrame(currentVideoUrl);
      const path = `cineai/frames/${Date.now()}_lastframe.png`;
      const { error: upErr } = await supabase.storage
        .from("user-uploads")
        .upload(path, frameBlob, { contentType: "image/png", upsert: true });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("user-uploads").getPublicUrl(path);
      setLastFrameUrl(data.publicUrl);
      setPreviousVideoUrl(currentVideoUrl);
      setFrameExtracted(true);
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
    setPreviousVideoUrl(null);
    setFrameExtracted(false);
    clearInterval(pollRef.current);
  };

  const ISABELA_QUESTIONS = [
    { key: "scene_type",   q: "¿Qué tipo de escena quieres crear?", opts: ["Escena cinematográfica (Hollywood)", "TikTok / Trend viral", "Video musical / Lip sync", "Comercial / Producto", "Otra — la describo yo"] },
    { key: "face",         q: "¿Vas a usar tu rostro o el de alguien específico?", opts: ["Sí, mi propio rostro", "El rostro de otra persona (con permiso)", "No, sin cara específica"] },
    { key: "consent",      q: "¿Tienes permiso para usar ese rostro en contenido generado con IA?", opts: ["Sí, tengo consentimiento", "Soy yo mismo/a"], condition: (a) => a.face === "El rostro de otra persona (con permiso)" },
    { key: "background",   q: "¿Quieres usar una imagen de fondo o escenario específico?", opts: ["Sí, subiré una foto del lugar", "No, que la IA decida el fondo"] },
    { key: "mood",         q: "¿Cuál es el ambiente o emoción de la escena?", opts: ["Épico / Grandioso", "Dramático / Intenso", "Romántico / Sensual", "Oscuro / Misterioso", "Alegre / Energético", "Realista / Documental"] },
    { key: "camera",       q: "¿Qué tipo de cámara o movimiento prefieres?", opts: ["Plano fijo cinematográfico", "Travelling / Cámara en movimiento", "Drone / Vista aérea", "Cámara en mano (TikTok style)", "Close-up / Primer plano"] },
    { key: "extra",        q: "¿Hay algo más específico que quieras en tu escena?", opts: ["Lluvia / Clima dramático", "Luces de neón / Ciudad de noche", "Luz dorada (atardecer)", "Cámara lenta (slow motion)", "Nada más, está bien así"] },
  ];

  const activeQuestions = ISABELA_QUESTIONS.filter(q => !q.condition || q.condition(isabelaAnswers));

  const handleIsabelaAnswer = (key, value) => {
    const newAnswers = { ...isabelaAnswers, [key]: value };
    setIsabelaAnswers(newAnswers);
    if (isabelaStep < activeQuestions.length - 1) {
      setIsabelaStep(s => s + 1);
    } else {
      generateIsabelaPrompt(newAnswers);
    }
  };

  const generateIsabelaPrompt = async (answers) => {
    setIsabelaLoading(true);
    setIsabelaError(null);
    try {
      const durationSec = duration;
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/cineai/isabela-prompt", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          answers,
          duration: durationSec,
          refImagesCount: refImages.length,
          hasVideo: !!effectiveRefVideoUrl,
          hasAudio: !!audioUrl,
          ratio,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Error del servidor");
      setIsabelaResult(data.text || "");
    } catch (e) {
      setIsabelaError("Error generando prompt: " + e.message);
    } finally {
      setIsabelaLoading(false);
    }
  };

  const handleMagicPrompt = async () => {
    if (!magicIdea.trim() || magicIdea.trim().length < 3) {
      setMagicError("Escribe tu idea primero");
      return;
    }
    setMagicLoading(true);
    setMagicError(null);
    setMagicPrompts(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/cineai/magic-prompt", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ idea: magicIdea.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Error generando prompts");
      setMagicPrompts(data.prompts || []);
    } catch (e) {
      setMagicError(e.message || "Error generando prompts mágicos");
    } finally {
      setMagicLoading(false);
    }
  };

  const useMagicPrompt = (promptText) => {
    setCustomPrompt(promptText);
    setSelectedPreset("custom");
  };

  const resetIsabela = () => {
    setIsabelaStep(0);
    setIsabelaAnswers({});
    setIsabelaResult(null);
    setIsabelaError(null);
    setIsabelaLoading(false);
  };

  return (
    <div className="cp">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Syne:wght@400;500;700&display=swap');
        .cp*,.cp *::before,.cp *::after{box-sizing:border-box;margin:0;padding:0;}
        .cp{font-family:'Syne',sans-serif;background:#060608;min-height:100vh;color:#ddd8cc;}
        .cp-header{padding:32px 26px 20px;border-bottom:1px solid #111;position:relative;overflow:hidden;}
        .cp-header::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(200,160,80,0.3),transparent);}
        .cp-eyebrow{font-size:10px;letter-spacing:4px;color:#666;text-transform:uppercase;margin-bottom:4px;}
        .cp-title{font-family:'Bebas Neue',sans-serif;font-size:48px;letter-spacing:8px;line-height:1;color:#f0e8d0;}
        .cp-title em{color:#c8a050;font-style:normal;}
        .cp-tagline{font-size:11px;color:#888;letter-spacing:1px;margin-top:6px;}
        .cp-header-row{display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;}
        .cp-mode-pill{display:inline-flex;align-items:center;gap:6px;margin-top:12px;background:rgba(200,160,80,0.07);border:1px solid rgba(200,160,80,0.18);border-radius:20px;padding:5px 14px;font-size:11px;color:#c8a050;letter-spacing:1px;}
        .cp-dot{width:6px;height:6px;border-radius:50%;background:#c8a050;animation:blink 2s infinite;}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0.2}}
        .how-btn{background:rgba(200,160,80,0.08);border:1px solid rgba(200,160,80,0.2);border-radius:8px;color:#c8a050;font-family:'Syne',sans-serif;font-size:12px;padding:8px 16px;cursor:pointer;letter-spacing:1px;white-space:nowrap;transition:all 0.15s;margin-top:12px;}
        .how-btn:hover{background:rgba(200,160,80,0.15);}
        .blocked-banner-top{background:rgba(200,60,60,0.07);border-bottom:1px solid rgba(200,60,60,0.15);padding:10px 26px;font-size:12px;color:#f08080;display:flex;align-items:center;gap:10px;line-height:1.5;}
        .blocked-banner-top strong{color:#f09090;}
        .mode-selector{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #111;}
        .mode-btn{padding:16px 22px;background:transparent;border:none;cursor:pointer;text-align:left;transition:all 0.15s;border-bottom:3px solid transparent;color:#666;}
        .mode-btn:hover{background:rgba(255,255,255,0.02);color:#aaa;}
        .mode-btn.active{color:#f0e8d0;border-bottom-color:#c8a050;background:rgba(200,160,80,0.03);}
        .mode-btn:disabled{opacity:0.4;cursor:not-allowed;}
        .mode-btn-icon{font-size:22px;display:block;margin-bottom:3px;}
        .mode-btn-label{font-family:'Bebas Neue',sans-serif;font-size:17px;letter-spacing:3px;display:block;}
        .mode-btn-desc{font-size:10px;letter-spacing:1px;opacity:0.5;margin-top:1px;}
        .cp-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#0e0e0e;}
        .cp-cell{background:#060608;padding:20px 24px;}
        .cp-cell-full{grid-column:1/-1;}
        .sec-label{font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#555;margin-bottom:14px;display:flex;align-items:center;gap:10px;}
        .sec-label::after{content:'';flex:1;height:1px;background:#111;}
        .preset-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;}
        .preset-btn{background:#0a0a0c;border:1px solid #222;border-radius:8px;padding:12px 4px 10px;cursor:pointer;text-align:center;transition:all 0.15s;color:#666;}
        .preset-btn:hover{border-color:#3a3020;color:#aaa;}
        .preset-btn.active{border-color:#c8a050;background:rgba(200,160,80,0.05);color:#c8a050;}
        .preset-btn:disabled{opacity:0.4;cursor:not-allowed;}
        .pi{font-size:20px;display:block;margin-bottom:4px;}
        .pn{font-size:9px;letter-spacing:2px;text-transform:uppercase;}
        .upload-zone{border:1px dashed #1a1a1a;border-radius:10px;padding:16px;text-align:center;cursor:pointer;transition:all 0.2s;min-height:96px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;position:relative;}
        .upload-zone:hover{border-color:#c8a050;background:rgba(200,160,80,0.03);}
        .upload-zone.has-file{border-style:solid;border-color:#2a2820;}
        .upload-zone.uploading{border-color:rgba(200,160,80,0.4);animation:pb 1s infinite;}
        @keyframes pb{50%{border-color:rgba(200,160,80,0.1);}}
        .uz-video-thumb{width:auto;max-width:100%;max-height:110px;border-radius:6px;border:2px solid #c8a050;object-fit:contain;background:#000;display:block;margin:0 auto;}
        .uz-label{font-size:11px;color:#888;line-height:1.5;}
        .uz-hint{font-size:10px;color:#c8a050;letter-spacing:1px;}
        .uz-badge{position:absolute;top:6px;right:6px;background:rgba(200,160,80,0.12);border:1px solid rgba(200,160,80,0.25);border-radius:4px;font-size:8px;color:#c8a050;padding:2px 6px;letter-spacing:1px;text-transform:uppercase;}
        .remove-btn{background:none;border:none;color:#803030;font-size:10px;cursor:pointer;letter-spacing:1px;text-transform:uppercase;padding:4px 0;font-family:'Syne',sans-serif;}
        .remove-btn:hover{color:#e07070;}
        .audio-section{margin-top:14px;}
        .audio-zone{border:1px dashed #1a1a1a;border-radius:10px;padding:12px 16px;display:flex;align-items:center;gap:12px;cursor:pointer;transition:all 0.2s;}
        .audio-zone:hover{border-color:#c8a050;background:rgba(200,160,80,0.02);}
        .audio-zone.has-file{border-style:solid;border-color:#2a2820;}
        .audio-zone.uploading{border-color:rgba(200,160,80,0.4);animation:pb 1s infinite;}
        .audio-zone-text{flex:1;text-align:left;}
        .audio-zone-label{font-size:11px;color:#c8a050;letter-spacing:1px;}
        .audio-zone-name{font-size:12px;color:#ddd8cc;margin-top:2px;word-break:break-all;}
        .audio-zone-hint{font-size:10px;color:#333;letter-spacing:1px;}
        .animate-toggle{display:flex;align-items:center;gap:10px;margin-top:10px;padding:10px 12px;background:rgba(200,160,80,0.04);border:1px solid rgba(200,160,80,0.1);border-radius:8px;cursor:pointer;transition:all 0.15s;}
        .animate-toggle:hover{border-color:rgba(200,160,80,0.2);}
        .animate-toggle.active{border-color:rgba(200,160,80,0.35);background:rgba(200,160,80,0.08);}
        .animate-toggle input{accent-color:#c8a050;width:16px;height:16px;cursor:pointer;}
        .animate-toggle-label{font-size:12px;color:#888;letter-spacing:1px;cursor:pointer;}
        .animate-toggle.active .animate-toggle-label{color:#c8a050;}
        .animate-toggle-desc{font-size:10px;color:#444;margin-left:26px;margin-top:4px;letter-spacing:0.5px;line-height:1.4;}
        .r2v-notice{background:rgba(100,150,255,0.07);border:1px solid rgba(100,150,255,0.2);border-radius:8px;padding:8px 12px;font-size:11px;color:#90aaff;margin-top:8px;line-height:1.5;}
        .ext-url-toggle{font-size:11px;color:#c8a050;cursor:pointer;letter-spacing:1px;margin-top:8px;display:inline-block;text-decoration:underline;}
        .ext-url-input{width:100%;background:#0a0a0c;border:1px solid #1e1e1e;border-radius:8px;color:#ddd8cc;font-family:'Syne',sans-serif;font-size:12px;padding:10px 13px;outline:none;margin-top:8px;transition:border-color 0.2s;}
        .ext-url-input:focus{border-color:#c8a050;}
        .ext-url-input::placeholder{color:#2a2a2a;}
        .continuation-badge{background:rgba(80,180,100,0.08);border:1px solid rgba(80,180,100,0.2);border-radius:8px;padding:10px 14px;font-size:12px;color:#60c870;display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
        .continuation-badge img{width:40px;height:40px;border-radius:4px;border:1px solid rgba(80,180,100,0.3);object-fit:cover;}
        .continuation-badge video{width:60px;height:40px;border-radius:4px;border:1px solid rgba(80,180,100,0.3);object-fit:cover;}
        .continuation-cancel{margin-left:auto;background:none;border:none;color:#803030;font-size:11px;cursor:pointer;letter-spacing:1px;font-family:'Syne',sans-serif;}
        .continuation-info{flex:1;min-width:120px;}
        .continuation-info-title{font-size:11px;color:#60c870;letter-spacing:1px;}
        .continuation-info-desc{font-size:10px;color:#444;margin-top:2px;line-height:1.4;}
        .cp-input,.cp-textarea{width:100%;background:#0a0a0c;border:1px solid #161616;border-radius:8px;color:#ddd8cc;font-family:'Syne',sans-serif;font-size:13px;padding:11px 13px;outline:none;transition:border-color 0.2s;}
        .cp-input:focus,.cp-textarea:focus{border-color:#2a2820;}
        .cp-input::placeholder,.cp-textarea::placeholder{color:#222;}
        .cp-input.warn,.cp-textarea.warn{border-color:rgba(200,60,60,0.4);}
        .cp-textarea{resize:vertical;min-height:86px;margin-top:10px;display:block;}
        .prompt-preview{margin-top:10px;padding:10px 13px;background:#080808;border:1px solid #111;border-radius:8px;font-size:11px;color:#252525;line-height:1.7;font-style:italic;}
        .blocked-banner{background:rgba(200,60,60,0.06);border:1px solid rgba(200,60,60,0.18);border-radius:8px;padding:10px 14px;font-size:12px;color:#e07070;line-height:1.5;margin-top:10px;display:flex;gap:8px;}
        .toggle-row{display:flex;gap:6px;}
        .toggle-btn{flex:1;background:#0a0a0c;border:1px solid #222;border-radius:8px;padding:12px 6px;cursor:pointer;text-align:center;transition:all 0.15s;color:#777;}
        .toggle-btn:hover{border-color:#3a3020;color:#bbb;}
        .toggle-btn.active{border-color:#c8a050;background:rgba(200,160,80,0.05);color:#c8a050;}
        .toggle-btn:disabled{opacity:0.4;cursor:not-allowed;}
        .tm{display:block;font-family:'Bebas Neue',sans-serif;font-size:17px;letter-spacing:2px;}
        .ts{display:block;font-size:9px;letter-spacing:1px;opacity:0.5;margin-top:2px;}
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
        .ra-btn{background:transparent;border:1px solid #2e2e2e;border-radius:8px;color:#999;font-family:'Syne',sans-serif;font-size:12px;padding:10px 18px;cursor:pointer;transition:all 0.15s;letter-spacing:1px;text-decoration:none;display:inline-block;}
        .ra-btn:hover{border-color:#c8a050;color:#c8a050;}
        .ra-btn.gold{background:#c8a050;color:#060608;border-color:#c8a050;font-weight:700;}
        .ra-btn.gold:hover{background:#d4aa5a;}
        .ra-btn.green{background:rgba(80,180,100,0.1);border-color:rgba(80,180,100,0.3);color:#60c870;}
        .ra-btn.green:hover{background:rgba(80,180,100,0.18);}
        .ra-btn:disabled{opacity:0.4;cursor:not-allowed;}
        .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:1000;display:flex;align-items:flex-start;justify-content:flex-end;padding:16px;overflow-y:auto;}
        .modal-box{background:#0a0a0c;border:1px solid #1e1e1e;border-radius:16px;width:100%;max-width:480px;padding:24px;position:relative;max-height:90vh;overflow-y:auto;}
        .modal-title{font-family:'Bebas Neue',sans-serif;font-size:28px;letter-spacing:4px;color:#f0e8d0;margin-bottom:20px;}
        .modal-close{position:absolute;top:16px;right:16px;background:none;border:1px solid #2a2a2a;border-radius:6px;color:#666;font-size:14px;padding:4px 10px;cursor:pointer;}
        .modal-close:hover{color:#c8a050;border-color:#c8a050;}
        .modal-item{display:flex;gap:12px;margin-bottom:18px;}
        .modal-icon{font-size:22px;flex-shrink:0;margin-top:2px;}
        .modal-item-title{font-size:13px;font-weight:700;color:#f0e8d0;margin-bottom:4px;letter-spacing:1px;}
        .modal-item-desc{font-size:12px;color:#888;line-height:1.6;}
        .fs-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px;}
        .fs-close{position:absolute;top:20px;right:20px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:50%;color:#fff;font-size:20px;width:44px;height:44px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s;}
        .fs-close:hover{background:rgba(200,160,80,0.3);border-color:#c8a050;}
        .fs-video{max-width:100%;max-height:90vh;border-radius:12px;}
        @media(max-width:600px){
          .cp-grid{grid-template-columns:1fr;}
          .cp-cell-full,.result-cell,.cta-cell{grid-column:1;}
          .cp-title{font-size:32px;letter-spacing:5px;}
          .preset-grid{grid-template-columns:repeat(2,1fr);}
          .modal-box{padding:18px;}
          .mode-btn-label{font-size:14px;}
          .jade-num{font-size:22px;}
          .gen-btn{font-size:18px;padding:14px;}
          .cp-header{padding:20px 16px 16px;}
          .cp-cell{padding:16px 16px;}
        }
      `}</style>

      {/* MODAL TÉRMINOS */}
      {showTermsModal && (
        <div className="modal-overlay" style={{ zIndex: 3000, alignItems: "center", justifyContent: "center" }}>
          <div className="modal-box" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-title" style={{ fontSize: 22, marginBottom: 6 }}>⚖️ TÉRMINOS DE USO — CINEAI</div>
            <p style={{ fontSize: 11, color: "#555", marginBottom: 20, letterSpacing: 1 }}>Lee y acepta antes de continuar</p>
            <div style={{ fontSize: 12, color: "#888", lineHeight: 1.8, maxHeight: 340, overflowY: "auto", paddingRight: 8 }}>
              <p style={{ color: "#c8a050", fontWeight: 700, marginBottom: 6 }}>1. USO RESPONSABLE</p>
              <p style={{ marginBottom: 14 }}>CineAI es una herramienta de generación de video con inteligencia artificial. El usuario es el único y exclusivo responsable del contenido que genera, solicita o publica usando esta plataforma.</p>
              <p style={{ color: "#c8a050", fontWeight: 700, marginBottom: 6 }}>2. PROHIBICIÓN DE SUPLANTACIÓN DE IDENTIDAD</p>
              <p style={{ marginBottom: 14 }}>Queda estrictamente prohibido usar CineAI para suplantar la identidad de cualquier persona, ya sea pública o privada, con fines de engaño, fraude, difamación, acoso o cualquier actividad que cause daño.</p>
              <p style={{ color: "#c8a050", fontWeight: 700, marginBottom: 6 }}>3. DERECHOS DE IMAGEN Y COPYRIGHT</p>
              <p style={{ marginBottom: 14 }}>Al subir fotografías, el usuario declara que posee los derechos sobre dichas imágenes o cuenta con el consentimiento expreso de las personas que aparecen en ellas.</p>
              <p style={{ color: "#c8a050", fontWeight: 700, marginBottom: 6 }}>4. CONTENIDO PROHIBIDO</p>
              <p style={{ marginBottom: 14 }}>Está terminantemente prohibido generar contenido de carácter sexual explícito, violencia real contra personas identificables, material que involucre menores de edad, propaganda de odio, o cualquier contenido ilegal.</p>
              <p style={{ color: "#c8a050", fontWeight: 700, marginBottom: 6 }}>5. EXENCIÓN DE RESPONSABILIDAD</p>
              <p style={{ marginBottom: 14 }}>IsabelaOS Studio proporciona esta tecnología como herramienta creativa. La plataforma se reserva el derecho de suspender cuentas que violen estos términos sin previo aviso.</p>
              <p style={{ color: "#c8a050", fontWeight: 700, marginBottom: 6 }}>6. COOPERACIÓN LEGAL</p>
              <p>IsabelaOS Studio cooperará con las autoridades competentes ante cualquier reporte de uso ilegal o dañino de la plataforma.</p>
            </div>
            <div style={{ marginTop: 20, padding: "12px 14px", background: "rgba(200,160,80,0.06)", border: "1px solid rgba(200,160,80,0.15)", borderRadius: 8, fontSize: 11, color: "#666", lineHeight: 1.6 }}>
              Al hacer click en <strong style={{ color: "#c8a050" }}>"Acepto los términos"</strong> confirmas que has leído, entendido y aceptas estos términos de uso.
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={() => { try { localStorage.setItem(TERMS_ACCEPTED_KEY, "1"); } catch {} setTermsAccepted(true); setShowTermsModal(false); }}
                style={{ flex: 1, background: "#c8a050", border: "none", borderRadius: 10, color: "#060608", fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: 3, padding: "14px", cursor: "pointer" }}>
                ✓ ACEPTO LOS TÉRMINOS
              </button>
              <button onClick={() => setShowTermsModal(false)}
                style={{ background: "transparent", border: "1px solid #222", borderRadius: 10, color: "#555", fontFamily: "'Syne', sans-serif", fontSize: 12, padding: "14px 18px", cursor: "pointer" }}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CONSENTIMIENTO FOTO */}
      {showPhotoConsent && (
        <div className="modal-overlay" style={{ zIndex: 3000, alignItems: "center", justifyContent: "center" }}>
          <div className="modal-box" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-title" style={{ fontSize: 20, marginBottom: 6 }}>📸 CONSENTIMIENTO DE IMAGEN</div>
            <div style={{ fontSize: 13, color: "#888", lineHeight: 1.8 }}>
              <p style={{ marginBottom: 12 }}>Antes de subir esta fotografía, confirma lo siguiente:</p>
              <div style={{ background: "rgba(200,160,80,0.05)", border: "1px solid rgba(200,160,80,0.15)", borderRadius: 8, padding: "12px 14px", marginBottom: 12 }}>
                <p style={{ color: "#ddd8cc", marginBottom: 8 }}>☑ <strong>Soy el titular de los derechos</strong> de esta fotografía, o tengo el consentimiento expreso de las personas que aparecen en ella.</p>
                <p style={{ color: "#ddd8cc", marginBottom: 8 }}>☑ <strong>No usaré esta imagen</strong> para suplantar la identidad de ninguna persona.</p>
                <p style={{ color: "#ddd8cc", marginBottom: 0 }}>☑ <strong>Asumo toda la responsabilidad</strong> por el uso que haga del contenido generado.</p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button onClick={async () => {
                  setShowPhotoConsent(false);
                  if (pendingPhotoFile) {
                    setUploadingImages(true);
                    const file = pendingPhotoFile;
                    const ext = file.name.split(".").pop();
                    const path = `cineai/faces/${Date.now()}.${ext}`;
                    const { error: upErr } = await supabase.storage.from("user-uploads").upload(path, file, { upsert: true });
                    if (!upErr) {
                      const { data } = supabase.storage.from("user-uploads").getPublicUrl(path);
                      const preview = URL.createObjectURL(file);
                      setRefImages(prev => [{ url: data.publicUrl, preview }, ...prev.slice(0, 5)]);
                    }
                    setUploadingImages(false);
                    setPendingPhotoFile(null);
                  }
                }}
                style={{ flex: 1, background: "#c8a050", border: "none", borderRadius: 10, color: "#060608", fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, letterSpacing: 3, padding: "14px", cursor: "pointer" }}>
                ✓ ACEPTO Y SUBO LA FOTO
              </button>
              <button onClick={() => { setShowPhotoConsent(false); setPendingPhotoFile(null); }}
                style={{ background: "transparent", border: "1px solid #222", borderRadius: 10, color: "#555", fontFamily: "'Syne', sans-serif", fontSize: 12, padding: "14px 18px", cursor: "pointer" }}>
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
          <video className="fs-video" src={videoUrl} controls autoPlay loop playsInline onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {/* MODAL ASISTENTE ISABELA */}
      {showIsabela && (
        <div className="modal-overlay" style={{ zIndex: 3000, alignItems: "center", justifyContent: "center" }} onClick={e => e.target === e.currentTarget && setShowIsabela(false)}>
          <div className="modal-box" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowIsabela(false)}>✕</button>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
              <div style={{ width: 52, height: 52, borderRadius: "50%", background: "linear-gradient(135deg,#c8a050,#f0d080)", display: "grid", placeItems: "center", fontSize: 26, flexShrink: 0 }}>🤖</div>
              <div>
                <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 22, letterSpacing: 4, color: "#f0e8d0" }}>ISABELA</div>
                <div style={{ fontSize: 11, color: "#555", letterSpacing: 1 }}>Asistente de prompts · Seedance 2.0 · IsabelaOS</div>
              </div>
            </div>
            {!isabelaResult && !isabelaLoading && (
              <>
                {isabelaStep === 0 && (
                  <div style={{ background: "rgba(200,160,80,0.06)", border: "1px solid rgba(200,160,80,0.15)", borderRadius: 12, padding: "14px 16px", marginBottom: 18, fontSize: 13, color: "#888", lineHeight: 1.7 }}>
                    ¡Hola! Soy <strong style={{ color: "#c8a050" }}>Isabela</strong>, tu asistente de IA en IsabelaOS Studio. Voy a ayudarte a crear el prompt perfecto para Seedance 2.0. 🎬
                  </div>
                )}
                {(() => {
                  const q = activeQuestions[isabelaStep];
                  if (!q) return null;
                  return (
                    <div>
                      <div style={{ fontSize: 14, color: "#ddd8cc", fontWeight: 700, marginBottom: 14, letterSpacing: 0.5 }}>
                        {isabelaStep + 1}/{activeQuestions.length} · {q.q}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {q.opts.map(opt => (
                          <button key={opt} onClick={() => handleIsabelaAnswer(q.key, opt)}
                            style={{ background: "rgba(200,160,80,0.05)", border: "1px solid rgba(200,160,80,0.15)", borderRadius: 10, color: "#c8a050", fontFamily: "'Syne',sans-serif", fontSize: 13, padding: "12px 16px", cursor: "pointer", textAlign: "left", transition: "all .15s", letterSpacing: 0.5 }}
                            onMouseEnter={e => { e.currentTarget.style.background = "rgba(200,160,80,0.12)"; e.currentTarget.style.borderColor = "rgba(200,160,80,0.4)"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "rgba(200,160,80,0.05)"; e.currentTarget.style.borderColor = "rgba(200,160,80,0.15)"; }}>
                            {opt}
                          </button>
                        ))}
                      </div>
                      {isabelaStep > 0 && (
                        <button onClick={() => setIsabelaStep(s => s - 1)}
                          style={{ marginTop: 12, background: "none", border: "none", color: "#555", fontSize: 12, cursor: "pointer", letterSpacing: 1 }}>
                          ← Atrás
                        </button>
                      )}
                    </div>
                  );
                })()}
              </>
            )}
            {isabelaLoading && (
              <div style={{ textAlign: "center", padding: "30px 0" }}>
                <div style={{ width: 32, height: 32, border: "2px solid #161616", borderTopColor: "#c8a050", borderRadius: "50%", animation: "spin 0.9s linear infinite", margin: "0 auto 16px" }} />
                <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 18, letterSpacing: 4, color: "#c8a050" }}>GENERANDO TU PROMPT...</div>
              </div>
            )}
            {isabelaResult && !isabelaLoading && (
              <div>
                <div style={{ background: "rgba(80,180,100,0.06)", border: "1px solid rgba(80,180,100,0.2)", borderRadius: 12, padding: "16px", marginBottom: 16 }}>
                  <div style={{ fontSize: 10, letterSpacing: 3, color: "#60c870", textTransform: "uppercase", marginBottom: 10 }}>✓ Prompt generado por Isabela</div>
                  <pre style={{ fontFamily: "'Syne',sans-serif", fontSize: 12, color: "#ddd8cc", lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{isabelaResult}</pre>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => {
                    const text = isabelaResult;
                    const promptMatch = text.match(/PROMPT:\n([\s\S]*?)(?:\n\nGUÍA DE RECURSOS:|\nGUÍA DE RECURSOS:|$)/);
                    const extracted = promptMatch ? promptMatch[1].trim() : text.split("GUÍA DE RECURSOS:")[0].replace("PROMPT:","").trim();
                    setSelectedPreset("custom");
                    setCustomPrompt(extracted);
                    setShowIsabela(false);
                    resetIsabela();
                  }} style={{ flex: 1, background: "#c8a050", border: "none", borderRadius: 10, color: "#060608", fontFamily: "'Bebas Neue',sans-serif", fontSize: 17, letterSpacing: 3, padding: "13px", cursor: "pointer" }}>
                    ✓ USAR ESTE PROMPT
                  </button>
                  <button onClick={() => navigator.clipboard?.writeText(isabelaResult)}
                    style={{ background: "rgba(200,160,80,0.08)", border: "1px solid rgba(200,160,80,0.2)", borderRadius: 10, color: "#c8a050", fontFamily: "'Syne',sans-serif", fontSize: 12, padding: "13px 18px", cursor: "pointer", letterSpacing: 1 }}>
                    📋 Copiar
                  </button>
                  <button onClick={resetIsabela}
                    style={{ background: "transparent", border: "1px solid #222", borderRadius: 10, color: "#555", fontFamily: "'Syne',sans-serif", fontSize: 12, padding: "13px 16px", cursor: "pointer" }}>
                    ↺ Nuevo
                  </button>
                </div>
              </div>
            )}
            {isabelaError && (
              <div style={{ background: "rgba(200,60,60,0.06)", border: "1px solid rgba(200,60,60,0.2)", borderRadius: 8, padding: "12px", fontSize: 12, color: "#e07070" }}>{isabelaError}</div>
            )}
          </div>
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
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
            <button className="how-btn" onClick={() => { resetIsabela(); setShowIsabela(true); }}
              style={{ background: "linear-gradient(135deg,rgba(200,160,80,0.15),rgba(200,160,80,0.08))", border: "1px solid rgba(200,160,80,0.35)", color: "#f0d080", fontWeight: 700 }}>
              🤖 Isabela — Generar Prompt →
            </button>
            <button className="how-btn" onClick={() => setShowHowItWorks(true)}>¿Cómo funciona? →</button>
          </div>
        </div>
      </div>

      <div className="blocked-banner-top">
        <span>🚫</span>
        <span><strong>Rostros de celebridades y personajes de Hollywood están bloqueados.</strong> No puedes usar Tom Cruise, Bad Bunny, Messi, Spider-Man, Batman, etc.</span>
      </div>

      <div style={{ background: "rgba(200,160,80,0.04)", borderBottom: "1px solid rgba(200,160,80,0.1)", padding: "8px 26px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <p style={{ fontSize: 11, color: "#444", letterSpacing: 1, lineHeight: 1.5 }}>
          ⚖️ Todo el contenido generado es <strong style={{ color: "#666" }}>responsabilidad exclusiva del usuario</strong>.
        </p>
        <button onClick={() => setShowTermsModal(true)} style={{ background: "none", border: "none", color: "#c8a050", fontSize: 11, cursor: "pointer", letterSpacing: 1, whiteSpace: "nowrap", textDecoration: "underline", padding: 0 }}>
          Ver términos completos
        </button>
      </div>

      {/* Precio info banner */}
      <div style={{ background: "rgba(200,160,80,0.03)", borderBottom: "1px solid #111", padding: "8px 26px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, color: "#555", letterSpacing: 2, textTransform: "uppercase" }}>💎 Precios</span>
        <span style={{ fontSize: 11, color: "#444" }}>480p: 5s=<strong style={{color:"#c8a050"}}>11J</strong> · 10s=<strong style={{color:"#c8a050"}}>22J</strong> · 15s=<strong style={{color:"#c8a050"}}>33J</strong></span>
        <span style={{ fontSize: 11, color: "#444" }}>720p: 5s=<strong style={{color:"#c8a050"}}>25J</strong> · 10s=<strong style={{color:"#c8a050"}}>49J</strong> · 15s=<strong style={{color:"#c8a050"}}>73J</strong></span>
      </div>

      <div className="mode-selector">
        {MODES.map((m) => (
          <button key={m.id} className={`mode-btn ${activeMode === m.id ? "active" : ""}`}
            onClick={() => { setActiveMode(m.id); handleReset(); }} disabled={generating}>
            <span className="mode-btn-icon">{m.icon}</span>
            <span className="mode-btn-label">{m.label}</span>
            <span className="mode-btn-desc">{m.desc}</span>
          </button>
        ))}
      </div>

      <div className="cp-grid">

        {(generating || videoUrl || (error && currentTaskId)) && (
          <div className="result-cell">
            {generating && !videoUrl && (
              <>
                <div className="spinner" />
                <div className="result-title">
                  {jobStatus === "pending" ? "En cola..." : jobStatus === "processing" ? "Renderizando..." : "Procesando..."}
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
                  {frameExtracted && (
                    <div style={{ background: "rgba(80,180,100,0.12)", border: "1px solid rgba(80,180,100,0.3)", borderRadius: 8, padding: "8px 16px", fontSize: 12, color: "#60c870", letterSpacing: 1, width: "100%", marginTop: 4 }}>
                      ✅ Frame extraído — preparando continuación perfecta...
                    </div>
                  )}
                  <button className="ra-btn green" onClick={handleContinueScene} disabled={extractingFrame || frameExtracted}>
                    {extractingFrame ? "⏳ Extrayendo frame..." : frameExtracted ? "✅ Listo" : "▶ Continuar escena →"}
                  </button>
                  <button className="ra-btn" onClick={handleReset}>✦ Nueva escena</button>
                </div>
              </>
            )}
            {error && currentTaskId && !videoUrl && (
              <>
                <div style={{ fontSize: 28, marginBottom: 10 }}>⚠️</div>
                <div className="result-title" style={{ fontSize: 16, color: "#e07070" }}>{error}</div>
                <button className="ra-btn" style={{ marginTop: 14 }} onClick={handleReset}>Reintentar</button>
              </>
            )}
          </div>
        )}

        <div className="cp-cell cp-cell-full">
          <p className="sec-label">✨ Magic Prompt Generator</p>
          <p style={{ fontSize: 11, color: "#666", marginTop: -6, marginBottom: 10 }}>
            Escribe tu idea en español y te genero 3 prompts cinematográficos listos para Seedance 2.0.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              className="cp-input"
              style={{ flex: 1, minWidth: 200 }}
              placeholder="ej: un guerrero vikingo en una tormenta de nieve..."
              value={magicIdea}
              onChange={(e) => { setMagicIdea(e.target.value); setMagicError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter" && !magicLoading) handleMagicPrompt(); }}
              disabled={magicLoading || generating}
            />
            <button
              className="how-btn"
              onClick={handleMagicPrompt}
              disabled={magicLoading || generating}
              style={{ whiteSpace: "nowrap", opacity: magicLoading ? 0.6 : 1 }}
            >
              {magicLoading ? "⏳ Generando..." : "✨ Generar prompts mágicos"}
            </button>
          </div>
          {magicError && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#e07070" }}>{magicError}</div>
          )}
          {magicPrompts && magicPrompts.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginTop: 12 }}>
              {magicPrompts.map((p, idx) => (
                <button
                  key={p.style || idx}
                  onClick={() => useMagicPrompt(p.prompt)}
                  style={{
                    textAlign: "left", cursor: "pointer", background: "rgba(200,160,80,0.06)",
                    border: "1px solid rgba(200,160,80,0.25)", borderRadius: 12, padding: "12px 14px",
                    display: "flex", flexDirection: "column", gap: 6, transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#c8a050"; e.currentTarget.style.background = "rgba(200,160,80,0.12)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(200,160,80,0.25)"; e.currentTarget.style.background = "rgba(200,160,80,0.06)"; }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "#c8a050", textTransform: "uppercase" }}>
                    {p.label || p.style}
                  </span>
                  <span style={{ fontSize: 12, color: "#bbb", lineHeight: 1.5 }}>
                    {p.prompt}
                  </span>
                  <span style={{ fontSize: 10, color: "#666", marginTop: 2 }}>👆 Usar este prompt</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="cp-cell">
          <p className="sec-label">{activeMode === "tiktok" ? "Tipo de trend" : "Tipo de escena"}</p>
          <div className="preset-grid">
            {currentPresets.map((p) => (
              <button key={p.id} className={`preset-btn ${selectedPreset === p.id ? "active" : ""}`}
                onClick={() => setSelectedPreset(p.id)} disabled={generating}>
                <span className="pi">{p.icon}</span>
                <span className="pn">{p.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="cp-cell">
          <p className="sec-label">Imágenes de referencia — hasta 6 ({refImages.length}/6)</p>
          {isContinuation && lastFrameUrl ? (
            <div className="continuation-badge">
              <img src={lastFrameUrl} alt="último frame" />
              {previousVideoUrl && <video src={previousVideoUrl} muted autoPlay loop playsInline />}
              <div className="continuation-info">
                <div className="continuation-info-title">CONTINUIDAD PERFECTA</div>
                <div className="continuation-info-desc">Último frame + clip completo como referencia.</div>
              </div>
              <button className="continuation-cancel"
                onClick={() => { setIsContinuation(false); setLastFrameUrl(null); setPreviousVideoUrl(null); }}>
                × cancelar
              </button>
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 10 }}>
                {refImages.map((img, idx) => (
                  <div key={idx} style={{ position: "relative", borderRadius: 8, overflow: "hidden", border: "1px solid rgba(200,160,80,0.3)", aspectRatio: "1/1", background: "#0a0a0c" }}>
                    <img src={img.preview} alt={`ref-${idx}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    <div style={{ position: "absolute", top: 4, left: 6, fontSize: 9, letterSpacing: 1, color: "#c8a050", background: "rgba(6,6,8,0.8)", padding: "2px 6px", borderRadius: 4 }}>
                      {idx === 0 ? "PRINCIPAL" : `REF ${idx + 1}`}
                    </div>
                    <button onClick={() => setRefImages(prev => prev.filter((_, i) => i !== idx))}
                      style={{ position: "absolute", top: 4, right: 4, background: "rgba(200,60,60,0.8)", border: "none", borderRadius: "50%", color: "#fff", width: 20, height: 20, fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      ×
                    </button>
                  </div>
                ))}
                {refImages.length < 6 && (
                  <div className={`upload-zone ${uploadingImages ? "uploading" : ""}`}
                    style={{ aspectRatio: "1/1", minHeight: "auto", cursor: "pointer" }}
                    onClick={() => faceInputRef.current?.click()}>
                    {uploadingImages ? (
                      <p style={{ fontSize: 10, color: "#c8a050", letterSpacing: 1 }}>Subiendo...</p>
                    ) : (
                      <>
                        <span style={{ fontSize: 22 }}>+</span>
                        <p style={{ fontSize: 10, color: "#555", letterSpacing: 1, textAlign: "center" }}>
                          {refImages.length === 0 ? "Agregar foto principal" : "Agregar referencia"}
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>
              <p style={{ fontSize: 10, color: "#444", letterSpacing: 0.5, lineHeight: 1.5, marginBottom: 8 }}>
                📌 <strong style={{ color: "#666" }}>1ª foto</strong> = cara/sujeto principal · Las demás = referencias adicionales
              </p>
              {refImages.length > 0 && (
                <>
                  <div className={`animate-toggle ${animateExact ? "active" : ""}`} onClick={() => setAnimateExact((v) => !v)}>
                    <input type="checkbox" checked={animateExact} readOnly />
                    <span className="animate-toggle-label">Animar foto exacta (respeta fondo original)</span>
                  </div>
                  {animateExact && <p className="animate-toggle-desc">El modelo animará la 1ª foto respetando el fondo y escenario originales.</p>}
                </>
              )}
              <input ref={faceInputRef} type="file" accept="image/*" multiple style={{ display: "none" }}
                onChange={async (e) => {
                  const files = Array.from(e.target.files || []);
                  if (!files.length) return;
                  const remaining = 6 - refImages.length;
                  const toProcess = files.slice(0, remaining);
                  if (refImages.length === 0 && toProcess[0]) {
                    const isSafe = await checkImageSafety(toProcess[0]);
                    if (!isSafe) { setError("Imagen bloqueada por contenido inapropiado."); e.target.value = ""; return; }
                    setPendingPhotoFile(toProcess[0]);
                    setShowPhotoConsent(true);
                    e.target.value = "";
                    return;
                  }
                  setUploadingImages(true);
                  for (const file of toProcess) {
                    const ext = file.name.split(".").pop();
                    const path = `cineai/faces/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
                    const { error: upErr } = await supabase.storage.from("user-uploads").upload(path, file, { upsert: true });
                    if (!upErr) {
                      const { data } = supabase.storage.from("user-uploads").getPublicUrl(path);
                      const preview = URL.createObjectURL(file);
                      setRefImages(prev => prev.length < 6 ? [...prev, { url: data.publicUrl, preview }] : prev);
                    }
                  }
                  setUploadingImages(false);
                  e.target.value = "";
                }} />
            </>
          )}

          <div className="audio-section">
            <p className="sec-label" style={{ marginTop: 14 }}>Audio para Lip Sync (opcional)</p>
            <div className={`audio-zone ${audioUrl ? "has-file" : ""} ${uploadingAudio ? "uploading" : ""}`}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>🎵</span>
              <div className="audio-zone-text">
                {audioUrl ? (
                  <>
                    <div className="audio-zone-label">Audio cargado ✓</div>
                    <div className="audio-zone-name">{audioName}</div>
                  </>
                ) : uploadingAudio ? (
                  <div className="audio-zone-label">Subiendo audio...</div>
                ) : (
                  <>
                    <div className="audio-zone-label">Subir audio</div>
                    <div className="audio-zone-hint">MP3 / WAV · cualquier canción</div>
                    <button type="button" onClick={() => audioInputRef.current?.click()}
                      style={{ marginTop: 6, background: "rgba(200,160,80,0.12)", border: "1px solid rgba(200,160,80,0.35)", borderRadius: 8, color: "#c8a050", fontFamily: "'Syne', sans-serif", fontSize: 11, letterSpacing: 1, padding: "6px 16px", cursor: "pointer" }}>
                      📁 Seleccionar audio
                    </button>
                  </>
                )}
              </div>
              {audioUrl && (
                <button className="remove-btn" style={{ marginLeft: "auto", flexShrink: 0 }}
                  onClick={(e) => { e.stopPropagation(); setAudioUrl(null); setAudioName(null); }}>×</button>
              )}
            </div>
            <input ref={audioInputRef} type="file" accept="audio/mp3,audio/wav,audio/mpeg,audio/*" style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files[0];
                if (f) { setAudioName(f.name); uploadToStorage(f, "cineai/audio", setAudioUrl, () => {}, setUploadingAudio, "name"); }
              }} />
          </div>
        </div>

        {!isContinuation && (
          <div className="cp-cell cp-cell-full">
            <p className="sec-label">Video de referencia — MP4 o URL (opcional)</p>
            <div className="r2v-notice">
              ℹ️ El modelo copia el <strong>movimiento</strong> del video, pero el <strong>fondo siempre viene de tu foto o del prompt</strong>.
            </div>
            <div style={{ marginTop: 10 }}>
              <div className={`upload-zone ${refVideoPreview ? "has-file" : ""} ${uploadingVideo ? "uploading" : ""}`} style={{ minHeight: 130, maxHeight: 170 }}>
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
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 28 }}>🎬</span>
                    <p className="uz-label">Video de referencia MP4</p>
                    <button type="button" onClick={() => videoInputRef.current?.click()}
                      style={{ marginTop: 8, background: "rgba(200,160,80,0.12)", border: "1px solid rgba(200,160,80,0.35)", borderRadius: 8, color: "#c8a050", fontFamily: "'Syne', sans-serif", fontSize: 12, letterSpacing: 1, padding: "8px 20px", cursor: "pointer" }}>
                      📁 Seleccionar MP4
                    </button>
                    <p className="uz-hint" style={{ marginTop: 6 }}>máx recomendado 15s</p>
                  </>
                )}
              </div>
              {refVideoPreview && <button className="remove-btn" onClick={() => { setRefVideoPreview(null); setRefVideoUrl(null); }}>× quitar video</button>}
              {!refVideoPreview && (
                <>
                  <span className="ext-url-toggle" onClick={() => setShowExtUrlInput((v) => !v)}>
                    {showExtUrlInput ? "▲ Ocultar URL externa" : "▼ O pega la URL de un video"}
                  </span>
                  {showExtUrlInput && (
                    <input className="ext-url-input" placeholder="https://..." value={refVideoExtUrl} onChange={(e) => setRefVideoExtUrl(e.target.value)} />
                  )}
                  {refVideoExtUrl && <button className="remove-btn" onClick={() => { setRefVideoExtUrl(""); setShowExtUrlInput(false); }}>× quitar URL</button>}
                </>
              )}
            </div>
            <input ref={videoInputRef} type="file" accept="video/mp4,video/mov,video/quicktime,video/*" style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files[0]; if (f) uploadToStorage(f, "cineai/refs", setRefVideoUrl, setRefVideoPreview, setUploadingVideo); }} />
          </div>
        )}

        <div className="cp-cell cp-cell-full">
          <p className="sec-label">Describe la escena</p>
          {selectedPreset !== "custom" ? (
            <>
              <input className={`cp-input ${liveBlocked ? "warn" : ""}`}
                placeholder={activeMode === "tiktok" ? "¿Quién baila? ej: mujer joven con outfit colorido..." : "¿Quién aparece? ej: hombre con saco negro..."}
                value={subjectDesc} onChange={(e) => { setSubjectDesc(e.target.value); setBlockedWarning(null); }} disabled={generating} />
              <div className="prompt-preview">{subjectDesc ? `${subjectDesc}. ` : ""}{preset?.prompt}</div>
            </>
          ) : (
            <textarea className={`cp-textarea ${liveBlocked ? "warn" : ""}`}
              placeholder="Describe tu escena completa..."
              value={customPrompt} onChange={(e) => { setCustomPrompt(e.target.value); setBlockedWarning(null); }} disabled={generating} />
          )}
          {liveBlocked && <div className="blocked-banner"><span>🚫</span><span><strong>"{liveBlocked}"</strong> está bloqueado. Describe un personaje original.</span></div>}
          {blockedWarning && !liveBlocked && <div className="blocked-banner"><span>⚠️</span><span>{blockedWarning}</span></div>}
        </div>

        <div className="cp-cell">
          <p className="sec-label">Duración</p>
          <div className="toggle-row">
            {DURATIONS.map((d) => (
              <button key={d.value} className={`toggle-btn ${duration === d.value ? "active" : ""}`}
                onClick={() => setDuration(d.value)} disabled={generating}>
                <span className="tm">{d.label}</span>
                <span className="ts">{quality === "480p" ? d.jades480 : d.jades720}J · {quality}</span>
              </button>
            ))}
          </div>
          <p className="sec-label" style={{ marginTop: 14 }}>Calidad de video</p>
          <div className="toggle-row">
            {QUALITIES.map((q) => (
              <button key={q.value} className={`toggle-btn ${quality === q.value ? "active" : ""}`}
                onClick={() => setQuality(q.value)} disabled={generating}>
                <span className="tm">{q.label}</span>
                <span className="ts">{q.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="cp-cell">
          <p className="sec-label">Formato de video</p>
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
            {RATIOS.map((r) => (
              <button key={r.value} className={`toggle-btn ${ratio === r.value ? "active" : ""}`}
                onClick={() => setRatio(r.value)} disabled={generating} style={{ flexShrink: 0, minWidth: 72 }}>
                <span className="tm">{r.label}</span>
                <span className="ts">{r.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="cta-cell">
          <div className="jade-row">
            <div>
              <span className="jade-left">Costo de esta escena</span>
              <div style={{ fontSize: 10, color: "#333", marginTop: 3, letterSpacing: 1 }}>
                480p: {durObj?.jades480}J · 720p: {durObj?.jades720}J
              </div>
            </div>
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
