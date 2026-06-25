// src/components/CineAIPanel.jsx
import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

function getModes(isEs) {
  return [
    { id: "tiktok", label: "TikTok Trends", icon: "🕺", desc: isEs ? "Copia bailes y trends virales" : "Copy dances and viral trends" },
    { id: "cine",   label: isEs ? "Escena Cine" : "Cinema Scene", icon: "🎬", desc: isEs ? "Calidad cinematográfica Hollywood" : "Hollywood cinematic quality" },
  ];
}

function getPresets(isEs) {
  return {
    tiktok: [
      { id: "trend",      icon: "🔥", label: "Trend",      prompt: "Person doing a viral TikTok dance trend, high energy, professional studio lighting, smooth camera orbit, beat-synced fluid movement, vertical format" },
      { id: "transition", icon: "✨", label: isEs ? "Transición" : "Transition", prompt: "Smooth outfit transition effect, person spins and outfit changes, colorful background, satisfying motion, TikTok style" },
      { id: "lip",        icon: "🎤", label: "Lip Sync",    prompt: "Person confidently lip syncing to music, close-up to wide shot, expressive performance, ring light, TikTok aesthetic" },
      { id: "comedy",     icon: "😂", label: "Comedy",      prompt: "Person doing a funny reaction skit, exaggerated expressions, dynamic camera cuts, bright colors, TikTok humor style" },
      { id: "glow",       icon: "💅", label: "Glow Up",     prompt: "Dramatic glow-up transformation reveal, person steps forward into light, slow motion hair flip, cinematic beauty lighting" },
      { id: "custom",     icon: "✏️", label: isEs ? "Prompt libre" : "Custom prompt", prompt: "" },
    ],
    cine: [
      { id: "action",  icon: "⚡", label: isEs ? "Acción" : "Action",  prompt: "Person sprinting across rooftops at golden hour, dynamic parkour moves, cinematic slow motion impact, film grain, dramatic orchestral score, tracking shot" },
      { id: "fight",   icon: "🥊", label: isEs ? "Pelea" : "Fight",    prompt: "Intense epic fight scene in heavy rain at night, slow motion combat moves, neon lights reflecting on wet concrete, cinematic action thriller, deep dramatic shadows, bullet time camera effect" },
      { id: "drama",   icon: "🎭", label: "Drama",                     prompt: "Cinematic close-up of person standing in heavy rain at night, intense emotional expression, city lights bokeh, film noir lighting, slow dolly push-in" },
      { id: "epic",    icon: "🌅", label: isEs ? "Épico" : "Epic",     prompt: "Medium close-up shot of person standing heroically at cliff edge, city visible behind them at sunset, camera slowly pulls back revealing the epic landscape, golden hour light hitting their face, cinematic epic atmosphere" },
      { id: "noir",    icon: "🕵️", label: "Noir",                     prompt: "Detective walking down rain-soaked alley at night, neon signs reflecting in puddles, steam rising from manholes, slow dolly follow shot, film noir, 1940s meets cyberpunk" },
      { id: "custom",  icon: "✏️", label: isEs ? "Prompt libre" : "Custom prompt", prompt: "" },
    ],
  };
}

// ── PRECIOS — costo real EvoLink Seedance 2.0 Fast × 3 (incluye Vercel, Supabase, Pagadito)
// EvoLink: 480p=$0.074/s · 720p=$0.161/s · 1 Jade=$0.10 USD
const DURATIONS = [
  { value: 5,  label: "5s",  jades480: 11, jades720: 25 },
  { value: 10, label: "10s", jades480: 22, jades720: 49 },
  { value: 15, label: "15s", jades480: 33, jades720: 73 },
];

function getQualities(isEs) {
  return [
    { value: "480p", label: "480p", desc: isEs ? "Más rápido · Menos costo" : "Faster · Lower cost" },
    { value: "720p", label: "720p", desc: isEs ? "Alta calidad · Standard" : "High quality · Standard" },
  ];
}

function getRatios(isEs) {
  return [
    { value: "9:16", label: "9:16", desc: "TikTok / Reels" },
    { value: "16:9", label: "16:9", desc: isEs ? "Cine / YouTube" : "Cinema / YouTube" },
    { value: "1:1",  label: "1:1",  desc: "Instagram" },
    { value: "4:3",  label: "4:3",  desc: isEs ? "Clásico" : "Classic" },
    { value: "21:9", label: "21:9", desc: isEs ? "Ultra ancho" : "Ultra wide" },
  ];
}

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

function extractLastFrame(videoSrc, isEs = true) {
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
        else reject(new Error(isEs ? "No se pudo extraer el frame" : "Couldn't extract the frame"));
      }, "image/png");
    });
    video.addEventListener("error", () => reject(new Error(isEs ? "Error cargando video" : "Error loading video")));
    video.load();
  });
}

function getHowItWorks(isEs) { return [
  { icon: "🕺", title: "TikTok Trends", desc: isEs ? "Selecciona el tipo de trend. Si subes un video de referencia, el modelo copia el movimiento exacto. Si subes tu foto, tu cara aparece en el video." : "Pick the trend type. If you upload a reference video, the model copies the exact movement. If you upload your photo, your face appears in the video." },
  { icon: "🎬", title: isEs ? "Escena Cinematográfica" : "Cinematic Scene", desc: isEs ? "Elige el tipo de escena (acción, pelea, drama, épico, noir). El modelo genera una escena de calidad Hollywood." : "Choose the scene type (action, fight, drama, epic, noir). The model generates a Hollywood-quality scene." },
  { icon: "👤", title: isEs ? "Tu foto (opcional)" : "Your photo (optional)", desc: isEs ? "Sube una foto tuya de frente con buena iluminación. El modelo usará tu cara como personaje principal." : "Upload a front-facing photo with good lighting. The model will use your face as the main character." },
  { icon: "🖼️", title: isEs ? "Animar foto exacta" : "Animate exact photo", desc: isEs ? "Activa esta opción para animar tu foto respetando el fondo y personajes originales." : "Turn this on to animate your photo while keeping the original background and characters." },
  { icon: "🎥", title: isEs ? "Video de referencia" : "Reference video", desc: isEs ? "Sube el video del baile en MP4 o pega la URL. El modelo copia el movimiento exacto. IMPORTANTE: el fondo siempre viene de tu foto o del prompt." : "Upload the dance video as MP4 or paste the URL. The model copies the exact movement. IMPORTANT: the background always comes from your photo or the prompt." },
  { icon: "🎵", title: isEs ? "Audio para Lip Sync" : "Lip Sync audio", desc: isEs ? "Sube un audio MP3 o WAV para que el personaje haga lip sync de esa canción específica." : "Upload an MP3 or WAV audio so the character lip syncs that specific song." },
  { icon: "▶", title: isEs ? "Continuar escena" : "Continue scene", desc: isEs ? "Cuando termina un clip, el botón 'Continuar escena' extrae el último frame Y usa el clip completo como referencia de atmósfera." : "When a clip ends, the 'Continue scene' button extracts the last frame AND uses the full clip as an atmosphere reference." },
  { icon: "🚫", title: isEs ? "Celebridades bloqueadas" : "Blocked celebrities", desc: isEs ? "No puedes generar videos con Tom Cruise, Bad Bunny, Messi, Spider-Man, Batman, etc." : "You can't generate videos with Tom Cruise, Bad Bunny, Messi, Spider-Man, Batman, etc." },
  { icon: "💎", title: isEs ? "Costo en Jades" : "Jade cost", desc: "480p: 5s=11J · 10s=22J · 15s=33J · 720p: 5s=25J · 10s=49J · 15s=73J." },
]; }

export default function CineAIPanel({ lang = "es", onJobSubmitted }) {
  const isEs = lang !== "en";
  const MODES      = getModes(isEs);
  const PRESETS    = getPresets(isEs);
  const QUALITIES  = getQualities(isEs);
  const RATIOS     = getRatios(isEs);
  const HOW_IT_WORKS = getHowItWorks(isEs);
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

  const [captions,        setCaptions]        = useState(null);
  const [captionsLoading, setCaptionsLoading] = useState(false);
  const [captionsError,   setCaptionsError]   = useState(null);
  const [copiedIdx,       setCopiedIdx]       = useState(null);

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
    ? (isEs ? "Continuando escena — continuidad perfecta 🎬" : "Continuing scene — perfect continuity 🎬")
    : animateExact && faceImageUrl
      ? (isEs ? "Animar foto exacta — respeta fondo original 🖼️" : "Animate exact photo — keeps original background 🖼️")
      : audioUrl
        ? (isEs ? "Lip sync con audio 🎵" : "Lip sync with audio 🎵")
        : effectiveRefVideoUrl
          ? faceImageUrl ? (isEs ? "Copiar movimiento + tu cara 🔥" : "Copy movement + your face 🔥") : (isEs ? "Copiar movimiento del video" : "Copy video movement")
          : faceImageUrl ? (isEs ? "Animar tu foto" : "Animate your photo")
          : (isEs ? "Solo texto" : "Text only");

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
      setError((isEs ? "Error subiendo archivo: " : "Error uploading file: ") + (e.message || (isEs ? "verifica el bucket user-uploads en Supabase" : "check the user-uploads bucket in Supabase")));
    } finally {
      setUploading(false);
    }
  };

  const fetchViralCaptions = useCallback(async (prompt) => {
    setCaptionsLoading(true);
    setCaptionsError(null);
    setCaptions(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/cineai/viral-captions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || (isEs ? "Error generando captions" : "Error generating captions"));
      setCaptions(data.captions || []);
    } catch (e) {
      setCaptionsError(e.message || (isEs ? "Error generando captions virales" : "Error generating viral captions"));
    } finally {
      setCaptionsLoading(false);
    }
  }, []);

  const startPolling = useCallback((taskId, promptForCaptions) => {
    clearInterval(pollRef.current);
    let attempts = 0;
    const MAX_ATTEMPTS = 300;

    pollRef.current = setInterval(async () => {
      attempts++;
      if (attempts > MAX_ATTEMPTS) {
        clearInterval(pollRef.current);
        setError(isEs ? "Tu video sigue generándose. Aparecerá en tu Biblioteca cuando esté listo." : "Your video is still being generated. It will appear in your Library when ready.");
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
          if (promptForCaptions) fetchViralCaptions(promptForCaptions);
        } else if (data.status === "failed") {
          const errMsg = data.error || "";
          if (errMsg.toLowerCase().includes("service busy") || errMsg.toLowerCase().includes("allocating")) {
            setError(isEs ? "⚠️ Servidor ocupado — intenta de nuevo en unos minutos." : "⚠️ Server busy — try again in a few minutes.");
          } else {
            setError(errMsg || (isEs ? "La generación falló." : "Generation failed."));
          }
          setGenerating(false);
          clearInterval(pollRef.current);
        }
      } catch (e) {
        console.error("[CineAI] poll error:", e.message);
      }
    }, 4000);
  }, [fetchViralCaptions, isEs]);

  const handleGenerate = async () => {
    const prompt = getFinalPrompt();
    if (!prompt.trim() || prompt.length < 5) {
      setError(isEs ? "Escribe una descripción de la escena" : "Write a scene description"); return;
    }
    if (liveBlocked) {
      setError(isEs ? `"${liveBlocked}" está bloqueado por derechos de autor` : `"${liveBlocked}" is blocked by copyright`); return;
    }

    setError(null);
    setBlockedWarning(null);
    setVideoUrl(null);
    setJobStatus(null);
    setLastFrameUrl(null);
    setCaptions(null);
    setCaptionsError(null);
    setGenerating(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      let bodyPayload;
      if (isContinuation) {
        bodyPayload = {
          prompt,
          imageUrl:       lastFrameUrl,
          // image 1 = último frame (continuidad) · image 2, 3... = refs originales (rostro/cuerpo)
          refImages:      refImages.filter(i => i.url).map(i => i.url),
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
        throw new Error(data.error || data.detail || (isEs ? "Error del servidor" : "Server error"));
      }

      const pollId = data.taskId || data.jobId;
      setCurrentTaskId(pollId);
      setJobStatus("pending");

      if (data.videoUrl) {
        setVideoUrl(data.videoUrl);
        setGenerating(false);
        fetchViralCaptions(prompt);
        return;
      }

      startPolling(pollId, prompt);
      onJobSubmitted?.(pollId, "cineai");
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
      const frameBlob = await extractLastFrame(currentVideoUrl, isEs);
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
      setError((isEs ? "No se pudo extraer el último frame: " : "Couldn't extract the last frame: ") + e.message);
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
    setCaptions(null);
    setCaptionsError(null);
    clearInterval(pollRef.current);
  };

  const ISABELA_QUESTIONS = [
    { key: "scene_type",   q: isEs ? "¿Qué tipo de escena quieres crear?" : "What type of scene do you want to create?", opts: isEs ? ["Escena cinematográfica (Hollywood)", "TikTok / Trend viral", "Video musical / Lip sync", "Comercial / Producto", "Otra — la describo yo"] : ["Cinematic scene (Hollywood)", "TikTok / Viral trend", "Music video / Lip sync", "Commercial / Product", "Other — I'll describe it"] },
    { key: "face",         q: isEs ? "¿Vas a usar tu rostro o el de alguien específico?" : "Will you use your own face or someone else's?", opts: isEs ? ["Sí, mi propio rostro", "El rostro de otra persona (con permiso)", "No, sin cara específica"] : ["Yes, my own face", "Someone else's face (with permission)", "No, no specific face"] },
    { key: "consent",      q: isEs ? "¿Tienes permiso para usar ese rostro en contenido generado con IA?" : "Do you have permission to use that face in AI-generated content?", opts: isEs ? ["Sí, tengo consentimiento", "Soy yo mismo/a"] : ["Yes, I have consent", "It's me"], condition: (a) => a.face === (isEs ? "El rostro de otra persona (con permiso)" : "Someone else's face (with permission)") },
    { key: "background",   q: isEs ? "¿Quieres usar una imagen de fondo o escenario específico?" : "Do you want to use a specific background or setting?", opts: isEs ? ["Sí, subiré una foto del lugar", "No, que la IA decida el fondo"] : ["Yes, I'll upload a photo of the place", "No, let the AI decide the background"] },
    { key: "mood",         q: isEs ? "¿Cuál es el ambiente o emoción de la escena?" : "What's the mood or emotion of the scene?", opts: isEs ? ["Épico / Grandioso", "Dramático / Intenso", "Romántico / Sensual", "Oscuro / Misterioso", "Alegre / Energético", "Realista / Documental"] : ["Epic / Grand", "Dramatic / Intense", "Romantic / Sensual", "Dark / Mysterious", "Joyful / Energetic", "Realistic / Documentary"] },
    { key: "camera",       q: isEs ? "¿Qué tipo de cámara o movimiento prefieres?" : "What kind of camera or movement do you prefer?", opts: isEs ? ["Plano fijo cinematográfico", "Travelling / Cámara en movimiento", "Drone / Vista aérea", "Cámara en mano (TikTok style)", "Close-up / Primer plano"] : ["Fixed cinematic shot", "Travelling / Moving camera", "Drone / Aerial view", "Handheld (TikTok style)", "Close-up"] },
    { key: "extra",        q: isEs ? "¿Hay algo más específico que quieras en tu escena?" : "Anything else specific you want in your scene?", opts: isEs ? ["Lluvia / Clima dramático", "Luces de neón / Ciudad de noche", "Luz dorada (atardecer)", "Cámara lenta (slow motion)", "Nada más, está bien así"] : ["Rain / Dramatic weather", "Neon lights / City at night", "Golden light (sunset)", "Slow motion", "Nothing else, this is fine"] },
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
      if (!res.ok || !data.ok) throw new Error(data.error || (isEs ? "Error del servidor" : "Server error"));
      setIsabelaResult(data.text || "");
    } catch (e) {
      setIsabelaError((isEs ? "Error generando prompt: " : "Error generating prompt: ") + e.message);
    } finally {
      setIsabelaLoading(false);
    }
  };

  const handleMagicPrompt = async () => {
    if (!magicIdea.trim() || magicIdea.trim().length < 3) {
      setMagicError(isEs ? "Escribe tu idea primero" : "Write your idea first");
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
        body: JSON.stringify({
          idea: magicIdea.trim(),
          hasReferenceImages: refImages.length > 0,
          duration,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || (isEs ? "Error generando prompts" : "Error generating prompts"));
      setMagicPrompts(data.prompts || []);
    } catch (e) {
      setMagicError(e.message || (isEs ? "Error generando prompts mágicos" : "Error generating magic prompts"));
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
        .mode-selector{display:grid;grid-template-columns:1fr 1fr;border-bottom:2px solid #1a1a1a;}
        .mode-btn{padding:24px 24px;background:transparent;border:none;cursor:pointer;text-align:left;transition:all 0.15s;border-bottom:5px solid #1a1a1a;color:#888;}
        .mode-btn:hover{background:rgba(200,160,80,0.05);color:#ccc;border-bottom-color:#3a3020;}
        .mode-btn.active{color:#f8f0d8;border-bottom-color:#c8a050;background:rgba(200,160,80,0.1);}
        .mode-btn:disabled{opacity:0.4;cursor:not-allowed;}
        .mode-btn-icon{font-size:30px;display:block;margin-bottom:6px;}
        .mode-btn-label{font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:3px;display:block;}
        .mode-btn-desc{font-size:11px;letter-spacing:1px;opacity:0.65;margin-top:3px;}
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
        .publish-section{margin-top:20px;padding-top:18px;border-top:1px solid #0e0e0e;text-align:left;}
        .publish-header{display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:14px;}
        .publish-icon{font-size:16px;}
        .publish-title{font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:3px;color:#c8a050;}
        .publish-loading{text-align:center;padding:6px 0 14px;}
        .publish-error{background:rgba(200,60,60,0.06);border:1px solid rgba(200,60,60,0.15);border-radius:8px;padding:10px 14px;font-size:12px;color:#e07070;text-align:center;margin-bottom:12px;}
        .caption-grid{display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:14px;}
        .caption-card{background:#0a0a0c;border:1px solid #1e1e1e;border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:8px;}
        .caption-label{font-family:'Bebas Neue',sans-serif;font-size:12px;letter-spacing:2px;color:#c8a050;text-transform:uppercase;}
        .caption-text{font-size:13px;color:#ddd8cc;line-height:1.6;white-space:pre-wrap;}
        .caption-text-en{font-size:12px;color:#777;line-height:1.5;white-space:pre-wrap;font-style:italic;}
        .caption-hashtags{font-size:11px;color:#7aa8c8;line-height:1.6;word-break:break-word;}
        .caption-copy-btn{align-self:flex-start;}
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
          .cp-header-row{flex-direction:column;align-items:stretch;}
          .cp-header-row > div:last-child{align-items:stretch;}
          .preset-grid{grid-template-columns:repeat(2,1fr);gap:8px;}
          .preset-btn{padding:14px 6px 12px;min-height:64px;}
          .pi{font-size:24px;}
          .pn{font-size:10px;}
          .modal-box{padding:18px;max-width:calc(100vw - 24px);}
          .mode-selector{grid-template-columns:1fr 1fr;}
          .mode-btn{padding:18px 14px;}
          .mode-btn-icon{font-size:26px;}
          .mode-btn-label{font-size:16px;letter-spacing:2px;}
          .mode-btn-desc{font-size:10px;}
          .jade-num{font-size:24px;}
          .gen-btn{font-size:18px;padding:16px;letter-spacing:3px;}
          .cp-header{padding:20px 16px 16px;}
          .cp-cell{padding:16px 16px;}
          .cp-input,.cp-textarea{font-size:14px;padding:12px 14px;}
          .toggle-btn{padding:12px 4px;min-height:48px;}
          .toggle-row{flex-wrap:wrap;}
          .how-btn{font-size:12px;padding:10px 16px;min-height:40px;}
          .ra-btn{font-size:13px;padding:11px 16px;min-height:40px;}
          .upload-zone{min-height:84px;padding:12px;}
          .audio-zone{padding:12px;}
          .result-video,.fs-video{max-height:300px;}
          .caption-text,.caption-text-en{font-size:13px;}
          .blocked-banner-top{padding:10px 16px;font-size:11px;}
        }
      `}</style>

      {/* MODAL TÉRMINOS */}
      {showTermsModal && (
        <div className="modal-overlay" style={{ zIndex: 3000, alignItems: "center", justifyContent: "center" }}>
          <div className="modal-box" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-title" style={{ fontSize: 22, marginBottom: 6 }}>⚖️ {isEs ? "TÉRMINOS DE USO — CINEAI" : "TERMS OF USE — CINEAI"}</div>
            <p style={{ fontSize: 11, color: "#555", marginBottom: 20, letterSpacing: 1 }}>{isEs ? "Lee y acepta antes de continuar" : "Read and accept before continuing"}</p>
            <div style={{ fontSize: 12, color: "#888", lineHeight: 1.8, maxHeight: 340, overflowY: "auto", paddingRight: 8 }}>
              <p style={{ color: "#c8a050", fontWeight: 700, marginBottom: 6 }}>{isEs ? "1. USO RESPONSABLE" : "1. RESPONSIBLE USE"}</p>
              <p style={{ marginBottom: 14 }}>{isEs ? "CineAI es una herramienta de generación de video con inteligencia artificial. El usuario es el único y exclusivo responsable del contenido que genera, solicita o publica usando esta plataforma." : "CineAI is an AI video generation tool. The user is solely and exclusively responsible for the content they generate, request or publish using this platform."}</p>
              <p style={{ color: "#c8a050", fontWeight: 700, marginBottom: 6 }}>{isEs ? "2. PROHIBICIÓN DE SUPLANTACIÓN DE IDENTIDAD" : "2. PROHIBITION OF IMPERSONATION"}</p>
              <p style={{ marginBottom: 14 }}>{isEs ? "Queda estrictamente prohibido usar CineAI para suplantar la identidad de cualquier persona, ya sea pública o privada, con fines de engaño, fraude, difamación, acoso o cualquier actividad que cause daño." : "It is strictly forbidden to use CineAI to impersonate any person, public or private, for deception, fraud, defamation, harassment, or any harmful activity."}</p>
              <p style={{ color: "#c8a050", fontWeight: 700, marginBottom: 6 }}>{isEs ? "3. DERECHOS DE IMAGEN Y COPYRIGHT" : "3. IMAGE RIGHTS AND COPYRIGHT"}</p>
              <p style={{ marginBottom: 14 }}>{isEs ? "Al subir fotografías, el usuario declara que posee los derechos sobre dichas imágenes o cuenta con el consentimiento expreso de las personas que aparecen en ellas." : "By uploading photos, the user declares they own the rights to those images or have express consent from the people appearing in them."}</p>
              <p style={{ color: "#c8a050", fontWeight: 700, marginBottom: 6 }}>{isEs ? "4. CONTENIDO PROHIBIDO" : "4. PROHIBITED CONTENT"}</p>
              <p style={{ marginBottom: 14 }}>{isEs ? "Está terminantemente prohibido generar contenido de carácter sexual explícito, violencia real contra personas identificables, material que involucre menores de edad, propaganda de odio, o cualquier contenido ilegal." : "It is strictly forbidden to generate explicit sexual content, real violence against identifiable people, material involving minors, hate propaganda, or any illegal content."}</p>
              <p style={{ color: "#c8a050", fontWeight: 700, marginBottom: 6 }}>{isEs ? "5. EXENCIÓN DE RESPONSABILIDAD" : "5. DISCLAIMER OF LIABILITY"}</p>
              <p style={{ marginBottom: 14 }}>{isEs ? "IsabelaOS Studio proporciona esta tecnología como herramienta creativa. La plataforma se reserva el derecho de suspender cuentas que violen estos términos sin previo aviso." : "IsabelaOS Studio provides this technology as a creative tool. The platform reserves the right to suspend accounts that violate these terms without prior notice."}</p>
              <p style={{ color: "#c8a050", fontWeight: 700, marginBottom: 6 }}>{isEs ? "6. COOPERACIÓN LEGAL" : "6. LEGAL COOPERATION"}</p>
              <p>{isEs ? "IsabelaOS Studio cooperará con las autoridades competentes ante cualquier reporte de uso ilegal o dañino de la plataforma." : "IsabelaOS Studio will cooperate with relevant authorities on any report of illegal or harmful use of the platform."}</p>
            </div>
            <div style={{ marginTop: 20, padding: "12px 14px", background: "rgba(200,160,80,0.06)", border: "1px solid rgba(200,160,80,0.15)", borderRadius: 8, fontSize: 11, color: "#666", lineHeight: 1.6 }}>
              {isEs ? <>Al hacer click en <strong style={{ color: "#c8a050" }}>"Acepto los términos"</strong> confirmas que has leído, entendido y aceptas estos términos de uso.</> : <>By clicking <strong style={{ color: "#c8a050" }}>"I accept the terms"</strong> you confirm you have read, understood and accept these terms of use.</>}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={() => { try { localStorage.setItem(TERMS_ACCEPTED_KEY, "1"); } catch {} setTermsAccepted(true); setShowTermsModal(false); }}
                style={{ flex: 1, background: "#c8a050", border: "none", borderRadius: 10, color: "#060608", fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: 3, padding: "14px", cursor: "pointer" }}>
                ✓ {isEs ? "ACEPTO LOS TÉRMINOS" : "I ACCEPT THE TERMS"}
              </button>
              <button onClick={() => setShowTermsModal(false)}
                style={{ background: "transparent", border: "1px solid #222", borderRadius: 10, color: "#555", fontFamily: "'Syne', sans-serif", fontSize: 12, padding: "14px 18px", cursor: "pointer" }}>
                {isEs ? "Cerrar" : "Close"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CONSENTIMIENTO FOTO */}
      {showPhotoConsent && (
        <div className="modal-overlay" style={{ zIndex: 3000, alignItems: "center", justifyContent: "center" }}>
          <div className="modal-box" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-title" style={{ fontSize: 20, marginBottom: 6 }}>📸 {isEs ? "CONSENTIMIENTO DE IMAGEN" : "IMAGE CONSENT"}</div>
            <div style={{ fontSize: 13, color: "#888", lineHeight: 1.8 }}>
              <p style={{ marginBottom: 12 }}>{isEs ? "Antes de subir esta fotografía, confirma lo siguiente:" : "Before uploading this photo, please confirm the following:"}</p>
              <div style={{ background: "rgba(200,160,80,0.05)", border: "1px solid rgba(200,160,80,0.15)", borderRadius: 8, padding: "12px 14px", marginBottom: 12 }}>
                <p style={{ color: "#ddd8cc", marginBottom: 8 }}>☑ {isEs ? <><strong>Soy el titular de los derechos</strong> de esta fotografía, o tengo el consentimiento expreso de las personas que aparecen en ella.</> : <><strong>I hold the rights</strong> to this photo, or I have express consent from the people appearing in it.</>}</p>
                <p style={{ color: "#ddd8cc", marginBottom: 8 }}>☑ {isEs ? <><strong>No usaré esta imagen</strong> para suplantar la identidad de ninguna persona.</> : <><strong>I will not use this image</strong> to impersonate any person.</>}</p>
                <p style={{ color: "#ddd8cc", marginBottom: 0 }}>☑ {isEs ? <><strong>Asumo toda la responsabilidad</strong> por el uso que haga del contenido generado.</> : <><strong>I take full responsibility</strong> for the use of the generated content.</>}</p>
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
                ✓ {isEs ? "ACEPTO Y SUBO LA FOTO" : "I ACCEPT AND UPLOAD PHOTO"}
              </button>
              <button onClick={() => { setShowPhotoConsent(false); setPendingPhotoFile(null); }}
                style={{ background: "transparent", border: "1px solid #222", borderRadius: 10, color: "#555", fontFamily: "'Syne', sans-serif", fontSize: 12, padding: "14px 18px", cursor: "pointer" }}>
                {isEs ? "Cancelar" : "Cancel"}
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
            <div className="modal-title">{isEs ? "¿CÓMO FUNCIONA?" : "HOW DOES IT WORK?"}</div>
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
                <div style={{ fontSize: 11, color: "#555", letterSpacing: 1 }}>{isEs ? "Asistente de prompts · Seedance 2.0 · IsabelaOS" : "Prompt assistant · Seedance 2.0 · IsabelaOS"}</div>
              </div>
            </div>
            {!isabelaResult && !isabelaLoading && (
              <>
                {isabelaStep === 0 && (
                  <div style={{ background: "rgba(200,160,80,0.06)", border: "1px solid rgba(200,160,80,0.15)", borderRadius: 12, padding: "14px 16px", marginBottom: 18, fontSize: 13, color: "#888", lineHeight: 1.7 }}>
                    {isEs ? <>¡Hola! Soy <strong style={{ color: "#c8a050" }}>Isabela</strong>, tu asistente de IA en IsabelaOS Studio. Voy a ayudarte a crear el prompt perfecto para Seedance 2.0. 🎬</> : <>Hi! I'm <strong style={{ color: "#c8a050" }}>Isabela</strong>, your AI assistant at IsabelaOS Studio. I'll help you craft the perfect prompt for Seedance 2.0. 🎬</>}
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
                          ← {isEs ? "Atrás" : "Back"}
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
                <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 18, letterSpacing: 4, color: "#c8a050" }}>{isEs ? "GENERANDO TU PROMPT..." : "GENERATING YOUR PROMPT..."}</div>
              </div>
            )}
            {isabelaResult && !isabelaLoading && (
              <div>
                <div style={{ background: "rgba(80,180,100,0.06)", border: "1px solid rgba(80,180,100,0.2)", borderRadius: 12, padding: "16px", marginBottom: 16 }}>
                  <div style={{ fontSize: 10, letterSpacing: 3, color: "#60c870", textTransform: "uppercase", marginBottom: 10 }}>✓ {isEs ? "Prompt generado por Isabela" : "Prompt generated by Isabela"}</div>
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
                    ✓ {isEs ? "USAR ESTE PROMPT" : "USE THIS PROMPT"}
                  </button>
                  <button onClick={() => navigator.clipboard?.writeText(isabelaResult)}
                    style={{ background: "rgba(200,160,80,0.08)", border: "1px solid rgba(200,160,80,0.2)", borderRadius: 10, color: "#c8a050", fontFamily: "'Syne',sans-serif", fontSize: 12, padding: "13px 18px", cursor: "pointer", letterSpacing: 1 }}>
                    📋 {isEs ? "Copiar" : "Copy"}
                  </button>
                  <button onClick={resetIsabela}
                    style={{ background: "transparent", border: "1px solid #222", borderRadius: 10, color: "#555", fontFamily: "'Syne',sans-serif", fontSize: 12, padding: "13px 16px", cursor: "pointer" }}>
                    ↺ {isEs ? "Nuevo" : "New"}
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
            <p className="cp-tagline">{isEs ? "Escenas cinematográficas y trends virales · Seedance 2.0" : "Cinematic scenes and viral trends · Seedance 2.0"}</p>
            <div className="cp-mode-pill"><span className="cp-dot" />{modeLabel}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
            <button className="how-btn" onClick={() => { resetIsabela(); setShowIsabela(true); }}
              style={{ background: "linear-gradient(135deg,rgba(200,160,80,0.15),rgba(200,160,80,0.08))", border: "1px solid rgba(200,160,80,0.35)", color: "#f0d080", fontWeight: 700 }}>
              🤖 {isEs ? "Isabela — Generar Prompt →" : "Isabela — Generate Prompt →"}
            </button>
            <button className="how-btn" onClick={() => setShowHowItWorks(true)}>{isEs ? "¿Cómo funciona? →" : "How does it work? →"}</button>
          </div>
        </div>
      </div>

      <div className="blocked-banner-top">
        <span>🚫</span>
        <span>{isEs ? <><strong>Rostros de celebridades y personajes de Hollywood están bloqueados.</strong> No puedes usar Tom Cruise, Bad Bunny, Messi, Spider-Man, Batman, etc.</> : <><strong>Celebrity faces and Hollywood characters are blocked.</strong> You can't use Tom Cruise, Bad Bunny, Messi, Spider-Man, Batman, etc.</>}</span>
      </div>

      <div style={{ background: "rgba(200,160,80,0.04)", borderBottom: "1px solid rgba(200,160,80,0.1)", padding: "8px 26px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <p style={{ fontSize: 11, color: "#444", letterSpacing: 1, lineHeight: 1.5 }}>
          ⚖️ {isEs ? <>Todo el contenido generado es <strong style={{ color: "#666" }}>responsabilidad exclusiva del usuario</strong>.</> : <>All generated content is the <strong style={{ color: "#666" }}>user's sole responsibility</strong>.</>}
        </p>
        <button onClick={() => setShowTermsModal(true)} style={{ background: "none", border: "none", color: "#c8a050", fontSize: 11, cursor: "pointer", letterSpacing: 1, whiteSpace: "nowrap", textDecoration: "underline", padding: 0 }}>
          {isEs ? "Ver términos completos" : "See full terms"}
        </button>
      </div>

      {/* Precio info banner */}
      <div style={{ background: "rgba(200,160,80,0.03)", borderBottom: "1px solid #111", padding: "8px 26px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, color: "#555", letterSpacing: 2, textTransform: "uppercase" }}>💎 {isEs ? "Precios" : "Pricing"}</span>
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
                  {jobStatus === "pending" ? (isEs ? "En cola..." : "Queued...") : jobStatus === "processing" ? (isEs ? "Renderizando..." : "Rendering...") : (isEs ? "Procesando..." : "Processing...")}
                </div>
                <p className="result-sub">{isEs ? "Seedance 2.0 está creando tu escena · 1–3 minutos" : "Seedance 2.0 is creating your scene · 1–3 minutes"}</p>
                <div className="dots" style={{ marginTop: 14 }}><span /><span /><span /></div>
              </>
            )}
            {videoUrl && (
              <>
                <video className="result-video" src={videoUrl} controls autoPlay loop playsInline />
                <div className="result-actions">
                  <button className="ra-btn" onClick={() => setVideoFullscreen(true)}>⛶ {isEs ? "Ver en grande" : "View fullscreen"}</button>
                  <a href={videoUrl} download className="ra-btn gold">⬇ {isEs ? "Descargar" : "Download"}</a>
                  {frameExtracted && (
                    <div style={{ background: "rgba(80,180,100,0.12)", border: "1px solid rgba(80,180,100,0.3)", borderRadius: 8, padding: "8px 16px", fontSize: 12, color: "#60c870", letterSpacing: 1, width: "100%", marginTop: 4 }}>
                      ✅ {isEs ? "Frame extraído — preparando continuación perfecta..." : "Frame extracted — preparing perfect continuation..."}
                    </div>
                  )}
                  <button className="ra-btn green" onClick={handleContinueScene} disabled={extractingFrame || frameExtracted}>
                    {extractingFrame ? (isEs ? "⏳ Extrayendo frame..." : "⏳ Extracting frame...") : frameExtracted ? (isEs ? "✅ Listo" : "✅ Done") : (isEs ? "▶ Continuar escena →" : "▶ Continue scene →")}
                  </button>
                  <button className="ra-btn" onClick={handleReset}>✦ {isEs ? "Nueva escena" : "New scene"}</button>
                </div>

                <div className="publish-section">
                  <div className="publish-header">
                    <span className="publish-icon">📲</span>
                    <span className="publish-title">{isEs ? "Publicar" : "Publish"}</span>
                  </div>

                  {captionsLoading && (
                    <div className="publish-loading">
                      <div className="dots"><span /><span /><span /></div>
                      <p className="result-sub" style={{ marginTop: 8 }}>{isEs ? "Generando captions virales..." : "Generating viral captions..."}</p>
                    </div>
                  )}

                  {captionsError && <div className="publish-error">{captionsError}</div>}

                  {captions && captions.length > 0 && (
                    <div className="caption-grid">
                      {captions.map((c, idx) => {
                        const hashtags = Array.isArray(c.hashtags)
                          ? c.hashtags.map(h => (h.startsWith("#") ? h : `#${h}`)).join(" ")
                          : "";
                        const fullText = [c.caption_es || c.caption, c.caption_en, hashtags].filter(Boolean).join("\n\n");
                        return (
                          <div key={c.style || idx} className="caption-card">
                            <span className="caption-label">{c.label || c.style}</span>
                            {(c.caption_es || c.caption) && <p className="caption-text">{c.caption_es || c.caption}</p>}
                            {c.caption_en && <p className="caption-text-en">{c.caption_en}</p>}
                            {hashtags && <p className="caption-hashtags">{hashtags}</p>}
                            <button
                              className="ra-btn caption-copy-btn"
                              onClick={() => {
                                navigator.clipboard?.writeText(fullText);
                                setCopiedIdx(idx);
                                setTimeout(() => setCopiedIdx(c => (c === idx ? null : c)), 2000);
                              }}
                            >
                              {copiedIdx === idx ? (isEs ? "✅ Copiado" : "✅ Copied") : (isEs ? "📋 Copiar" : "📋 Copy")}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="result-actions">
                    <button
                      className="ra-btn gold"
                      onClick={() => window.open("https://instagram.com", "_blank", "noopener,noreferrer")}
                    >
                      📸 {isEs ? "Abrir Instagram" : "Open Instagram"}
                    </button>
                  </div>
                </div>
              </>
            )}
            {error && currentTaskId && !videoUrl && (
              <>
                <div style={{ fontSize: 28, marginBottom: 10 }}>⚠️</div>
                <div className="result-title" style={{ fontSize: 16, color: "#e07070" }}>{error}</div>
                <button className="ra-btn" style={{ marginTop: 14 }} onClick={handleReset}>{isEs ? "Reintentar" : "Retry"}</button>
              </>
            )}
          </div>
        )}

        <div className="cp-cell cp-cell-full">
          <p className="sec-label">✨ Magic Prompt Generator</p>
          <p style={{ fontSize: 11, color: "#666", marginTop: -6, marginBottom: 10 }}>
            {isEs ? "Escribe tu idea y te genero 3 prompts cinematográficos listos para Seedance 2.0." : "Write your idea and I'll generate 3 cinematic prompts ready for Seedance 2.0."}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              className="cp-input"
              style={{ flex: 1, minWidth: 200 }}
              placeholder={isEs ? "ej: un guerrero vikingo en una tormenta de nieve..." : "e.g: a viking warrior in a snowstorm..."}
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
              {magicLoading ? (isEs ? "⏳ Generando..." : "⏳ Generating...") : (isEs ? "✨ Generar prompts mágicos" : "✨ Generate magic prompts")}
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
                  <span style={{ fontSize: 10, color: "#666", marginTop: 2 }}>👆 {isEs ? "Usar este prompt" : "Use this prompt"}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="cp-cell">
          <p className="sec-label">{activeMode === "tiktok" ? (isEs ? "Tipo de trend" : "Trend type") : (isEs ? "Tipo de escena" : "Scene type")}</p>
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
          <p className="sec-label">{isEs ? `Imágenes de referencia — hasta 6 (${refImages.length}/6)` : `Reference images — up to 6 (${refImages.length}/6)`}</p>
          {isContinuation && lastFrameUrl ? (
            <div className="continuation-badge">
              <img src={lastFrameUrl} alt={isEs ? "último frame" : "last frame"} />
              {previousVideoUrl && <video src={previousVideoUrl} muted autoPlay loop playsInline />}
              <div className="continuation-info">
                <div className="continuation-info-title">{isEs ? "CONTINUIDAD PERFECTA" : "PERFECT CONTINUITY"}</div>
                <div className="continuation-info-desc">{isEs ? "Último frame + clip completo como referencia." : "Last frame + full clip as reference."}</div>
              </div>
              <button className="continuation-cancel"
                onClick={() => { setIsContinuation(false); setLastFrameUrl(null); setPreviousVideoUrl(null); }}>
                × {isEs ? "cancelar" : "cancel"}
              </button>
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 10 }}>
                {refImages.map((img, idx) => (
                  <div key={idx} style={{ position: "relative", borderRadius: 8, overflow: "hidden", border: "1px solid rgba(200,160,80,0.3)", aspectRatio: "1/1", background: "#0a0a0c" }}>
                    <img src={img.preview} alt={`ref-${idx}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    <div style={{ position: "absolute", top: 4, left: 6, fontSize: 9, letterSpacing: 1, color: "#c8a050", background: "rgba(6,6,8,0.8)", padding: "2px 6px", borderRadius: 4 }}>
                      {idx === 0 ? (isEs ? "PRINCIPAL" : "MAIN") : `REF ${idx + 1}`}
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
                      <p style={{ fontSize: 10, color: "#c8a050", letterSpacing: 1 }}>{isEs ? "Subiendo..." : "Uploading..."}</p>
                    ) : (
                      <>
                        <span style={{ fontSize: 22 }}>+</span>
                        <p style={{ fontSize: 10, color: "#555", letterSpacing: 1, textAlign: "center" }}>
                          {refImages.length === 0 ? (isEs ? "Agregar foto principal" : "Add main photo") : (isEs ? "Agregar referencia" : "Add reference")}
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>
              <p style={{ fontSize: 10, color: "#444", letterSpacing: 0.5, lineHeight: 1.5, marginBottom: 8 }}>
                {isEs ? <>📌 <strong style={{ color: "#666" }}>1ª foto</strong> = cara/sujeto principal · Las demás = referencias adicionales</> : <>📌 <strong style={{ color: "#666" }}>1st photo</strong> = main face/subject · The rest = additional references</>}
              </p>
              {refImages.length > 0 && (
                <>
                  <div className={`animate-toggle ${animateExact ? "active" : ""}`} onClick={() => setAnimateExact((v) => !v)}>
                    <input type="checkbox" checked={animateExact} readOnly />
                    <span className="animate-toggle-label">{isEs ? "Animar foto exacta (respeta fondo original)" : "Animate exact photo (keeps original background)"}</span>
                  </div>
                  {animateExact && <p className="animate-toggle-desc">{isEs ? "El modelo animará la 1ª foto respetando el fondo y escenario originales." : "The model will animate the 1st photo while keeping the original background and setting."}</p>}
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
                    if (!isSafe) { setError(isEs ? "Imagen bloqueada por contenido inapropiado." : "Image blocked due to inappropriate content."); e.target.value = ""; return; }
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
            <p className="sec-label" style={{ marginTop: 14 }}>{isEs ? "Audio para Lip Sync (opcional)" : "Lip Sync audio (optional)"}</p>
            <div className={`audio-zone ${audioUrl ? "has-file" : ""} ${uploadingAudio ? "uploading" : ""}`}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>🎵</span>
              <div className="audio-zone-text">
                {audioUrl ? (
                  <>
                    <div className="audio-zone-label">{isEs ? "Audio cargado ✓" : "Audio loaded ✓"}</div>
                    <div className="audio-zone-name">{audioName}</div>
                  </>
                ) : uploadingAudio ? (
                  <div className="audio-zone-label">{isEs ? "Subiendo audio..." : "Uploading audio..."}</div>
                ) : (
                  <>
                    <div className="audio-zone-label">{isEs ? "Subir audio" : "Upload audio"}</div>
                    <div className="audio-zone-hint">{isEs ? "MP3 / WAV · cualquier canción" : "MP3 / WAV · any song"}</div>
                    <button type="button" onClick={() => audioInputRef.current?.click()}
                      style={{ marginTop: 6, background: "rgba(200,160,80,0.12)", border: "1px solid rgba(200,160,80,0.35)", borderRadius: 8, color: "#c8a050", fontFamily: "'Syne', sans-serif", fontSize: 11, letterSpacing: 1, padding: "6px 16px", cursor: "pointer" }}>
                      📁 {isEs ? "Seleccionar audio" : "Select audio"}
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
            <p className="sec-label">{isEs ? "Video de referencia — MP4 o URL (opcional)" : "Reference video — MP4 or URL (optional)"}</p>
            <div className="r2v-notice">
              {isEs ? <>ℹ️ El modelo copia el <strong>movimiento</strong> del video, pero el <strong>fondo siempre viene de tu foto o del prompt</strong>.</> : <>ℹ️ The model copies the <strong>movement</strong> from the video, but the <strong>background always comes from your photo or the prompt</strong>.</>}
            </div>
            <div style={{ marginTop: 10 }}>
              <div className={`upload-zone ${refVideoPreview ? "has-file" : ""} ${uploadingVideo ? "uploading" : ""}`} style={{ minHeight: 130, maxHeight: 170 }}>
                {refVideoPreview ? (
                  <>
                    <div className="uz-badge">✓ {isEs ? "referencia" : "reference"}</div>
                    <video src={refVideoPreview} className="uz-video-thumb" muted autoPlay loop playsInline />
                    <p style={{ fontSize: 10, color: "#555", marginTop: 6, letterSpacing: 1 }}>
                      {faceImageUrl ? (isEs ? "🔥 Tu cara copiará este movimiento exacto" : "🔥 Your face will copy this exact movement") : (isEs ? "El personaje copiará este movimiento" : "The character will copy this movement")}
                    </p>
                  </>
                ) : uploadingVideo ? (
                  <p style={{ fontSize: 11, color: "#c8a050", letterSpacing: 2 }}>{isEs ? "Subiendo video..." : "Uploading video..."}</p>
                ) : refVideoExtUrl ? (
                  <>
                    <span style={{ fontSize: 22 }}>🔗</span>
                    <p style={{ fontSize: 11, color: "#c8a050" }}>{isEs ? "URL externa configurada" : "External URL configured"}</p>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 28 }}>🎬</span>
                    <p className="uz-label">{isEs ? "Video de referencia MP4" : "Reference video MP4"}</p>
                    <button type="button" onClick={() => videoInputRef.current?.click()}
                      style={{ marginTop: 8, background: "rgba(200,160,80,0.12)", border: "1px solid rgba(200,160,80,0.35)", borderRadius: 8, color: "#c8a050", fontFamily: "'Syne', sans-serif", fontSize: 12, letterSpacing: 1, padding: "8px 20px", cursor: "pointer" }}>
                      📁 {isEs ? "Seleccionar MP4" : "Select MP4"}
                    </button>
                    <p className="uz-hint" style={{ marginTop: 6 }}>{isEs ? "máx recomendado 15s" : "max recommended 15s"}</p>
                  </>
                )}
              </div>
              {refVideoPreview && <button className="remove-btn" onClick={() => { setRefVideoPreview(null); setRefVideoUrl(null); }}>× {isEs ? "quitar video" : "remove video"}</button>}
              {!refVideoPreview && (
                <>
                  <span className="ext-url-toggle" onClick={() => setShowExtUrlInput((v) => !v)}>
                    {showExtUrlInput ? (isEs ? "▲ Ocultar URL externa" : "▲ Hide external URL") : (isEs ? "▼ O pega la URL de un video" : "▼ Or paste a video URL")}
                  </span>
                  {showExtUrlInput && (
                    <input className="ext-url-input" placeholder="https://..." value={refVideoExtUrl} onChange={(e) => setRefVideoExtUrl(e.target.value)} />
                  )}
                  {refVideoExtUrl && <button className="remove-btn" onClick={() => { setRefVideoExtUrl(""); setShowExtUrlInput(false); }}>× {isEs ? "quitar URL" : "remove URL"}</button>}
                </>
              )}
            </div>
            <input ref={videoInputRef} type="file" accept="video/mp4,video/mov,video/quicktime,video/*" style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files[0]; if (f) uploadToStorage(f, "cineai/refs", setRefVideoUrl, setRefVideoPreview, setUploadingVideo); }} />
          </div>
        )}

        <div className="cp-cell cp-cell-full">
          <p className="sec-label">{isEs ? "Describe la escena" : "Describe the scene"}</p>
          {selectedPreset !== "custom" ? (
            <>
              <input className={`cp-input ${liveBlocked ? "warn" : ""}`}
                placeholder={activeMode === "tiktok" ? (isEs ? "¿Quién baila? ej: mujer joven con outfit colorido..." : "Who's dancing? e.g: young woman with colorful outfit...") : (isEs ? "¿Quién aparece? ej: hombre con saco negro..." : "Who appears? e.g: man in a black jacket...")}
                value={subjectDesc} onChange={(e) => { setSubjectDesc(e.target.value); setBlockedWarning(null); }} disabled={generating} />
              <div className="prompt-preview">{subjectDesc ? `${subjectDesc}. ` : ""}{preset?.prompt}</div>
            </>
          ) : (
            <textarea className={`cp-textarea ${liveBlocked ? "warn" : ""}`}
              placeholder={isEs ? "Describe tu escena completa..." : "Describe your full scene..."}
              value={customPrompt} onChange={(e) => { setCustomPrompt(e.target.value); setBlockedWarning(null); }} disabled={generating} />
          )}
          {liveBlocked && <div className="blocked-banner"><span>🚫</span><span>{isEs ? <><strong>"{liveBlocked}"</strong> está bloqueado. Describe un personaje original.</> : <><strong>"{liveBlocked}"</strong> is blocked. Describe an original character.</>}</span></div>}
          {blockedWarning && !liveBlocked && <div className="blocked-banner"><span>⚠️</span><span>{blockedWarning}</span></div>}
        </div>

        <div className="cp-cell">
          <p className="sec-label">{isEs ? "Duración" : "Duration"}</p>
          <div className="toggle-row">
            {DURATIONS.map((d) => (
              <button key={d.value} className={`toggle-btn ${duration === d.value ? "active" : ""}`}
                onClick={() => setDuration(d.value)} disabled={generating}>
                <span className="tm">{d.label}</span>
                <span className="ts">{quality === "480p" ? d.jades480 : d.jades720}J · {quality}</span>
              </button>
            ))}
          </div>
          <p className="sec-label" style={{ marginTop: 14 }}>{isEs ? "Calidad de video" : "Video quality"}</p>
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
          <p className="sec-label">{isEs ? "Formato de video" : "Video format"}</p>
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
              <span className="jade-left">{isEs ? "Costo de esta escena" : "Cost of this scene"}</span>
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
            {generating ? (isEs ? "GENERANDO..." : "GENERATING...") : isContinuation ? (isEs ? "▶ CONTINUAR ESCENA" : "▶ CONTINUE SCENE") : (isEs ? "✦ CREAR ESCENA" : "✦ CREATE SCENE")}
          </button>
        </div>

      </div>
    </div>
  );
}
