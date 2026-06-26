// src/components/LiveAvatarPanel.jsx — IsabelaOS TikTok Live Avatar (3-step wizard)
import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";

const LANGUAGES = [
  { code: "mx", flag: "🇲🇽", label: "Español México",    voice_id: "21m00Tcm4TlvDq8ikWAM" },
  { code: "co", flag: "🇨🇴", label: "Español Colombia",  voice_id: "AZnzlk1XvdvUeBnXmlld" },
  { code: "ar", flag: "🇦🇷", label: "Español Argentina", voice_id: "EXAVITQu4vr4xnSDxMaL" },
  { code: "gt", flag: "🇬🇹", label: "Español Guatemala", voice_id: "21m00Tcm4TlvDq8ikWAM" },
  { code: "us", flag: "🇺🇸", label: "Inglés US",         voice_id: "pNInz6obpgDQGcFmaJgB" },
  { code: "br", flag: "🇧🇷", label: "Portugués Brasil",  voice_id: "onwK4e9ZLuTAKqWW03F9" },
];

const BEHAVIORS = [
  { key: "chat",    label: "💬 Platicar y responder chat" },
  { key: "dance",   label: "💃 Bailar cuando recibe gifts" },
  { key: "lipsync", label: "🎵 Lip-sync de música" },
  { key: "follows", label: "❤️ Pedir follows y compartir" },
  { key: "promo",   label: "📣 Promocionar mi producto/marca" },
];

const VIDEO_TYPES = [
  { key: "idle",    icon: "😌", label: "IDLE" },
  { key: "talking", icon: "💬", label: "HABLANDO" },
  { key: "dancing", icon: "💃", label: "BAILANDO" },
  { key: "lipsync", icon: "🎵", label: "LIP-SYNC" },
];

async function getToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}

export default function LiveAvatarPanel({ lang = "es" }) {
  const isEs = lang !== "en";

  // Wizard step
  const [step, setStep] = useState(1);

  // Step 1 fields
  const [faceUrl,    setFaceUrl]    = useState("");
  const [bodyUrl,    setBodyUrl]    = useState("");
  const [tiktokUser, setTiktokUser] = useState("");
  const [language,   setLanguage]   = useState("mx");
  const [uploading,  setUploading]  = useState({ face: false, body: false });

  // Step 2 fields
  const [description,  setDescription]  = useState("");
  const [behaviors,    setBehaviors]     = useState(["chat", "dance", "lipsync", "follows"]);
  const [productLink,  setProductLink]   = useState("");
  const [youtubeUrl,   setYoutubeUrl]    = useState("");

  // Step 3 — generation state
  const [genStatus,  setGenStatus]  = useState("idle"); // idle | generating | ready
  const [sessionId,  setSessionId]  = useState(null);
  const [taskIds,    setTaskIds]    = useState(null);   // {idle, talking, dancing, lipsync}
  const [videoUrls,  setVideoUrls]  = useState({});     // filled as each video completes
  const [genError,   setGenError]   = useState(null);

  // Live session
  const [liveSession,  setLiveSession]  = useState(null);
  const [liveLoading,  setLiveLoading]  = useState(true);
  const [starting,     setStarting]     = useState(false);
  const [stopping,     setStopping]     = useState(false);
  const [copied,       setCopied]       = useState(false);
  const [liveError,    setLiveError]    = useState(null);
  const [copiedSetup,  setCopiedSetup]  = useState(false);
  const [openSteps,    setOpenSteps]    = useState(new Set([1, 2, 3, 4]));
  const [tutorialOpen, setTutorialOpen] = useState(false);

  const faceRef = useRef();
  const bodyRef = useRef();
  const pollRef = useRef(null);

  // ── Load active session on mount ───────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setLiveLoading(true);
      try {
        const token = await getToken();
        if (!token) { setLiveLoading(false); return; }
        const res  = await fetch("/api/tiktok-live/status", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (json.ok && json.session?.status === "active") setLiveSession(json.session);
      } catch {}
      setLiveLoading(false);
    })();
  }, []);

  // ── Poll live status every 10s while live ──────────────────────────────────
  useEffect(() => {
    if (!liveSession?.id || liveSession.status !== "active") return;
    pollRef.current = setInterval(async () => {
      try {
        const token = await getToken();
        const res   = await fetch(`/api/tiktok-live/status?session_id=${liveSession.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (json.ok) setLiveSession(json.session);
      } catch {}
    }, 10_000);
    return () => clearInterval(pollRef.current);
  }, [liveSession?.id, liveSession?.status]);

  // ── Photo upload ───────────────────────────────────────────────────────────
  const uploadPhoto = useCallback(async (file, slot) => {
    setUploading(u => ({ ...u, [slot]: true }));
    try {
      const ext  = file.name.split(".").pop();
      const path = `live-uploads/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from("user-uploads").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("user-uploads").getPublicUrl(path);
      if (slot === "face") setFaceUrl(data.publicUrl);
      else setBodyUrl(data.publicUrl);
    } catch (e) {
      setGenError((isEs ? "Error subiendo foto: " : "Upload error: ") + e.message);
    } finally {
      setUploading(u => ({ ...u, [slot]: false }));
    }
  }, [isEs]);

  // ── Behavior toggle ────────────────────────────────────────────────────────
  const toggleBehavior = (key) => {
    setBehaviors(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  // ── Generate avatar (calls generate-avatar + starts polling) ───────────────
  const handleGenerate = async () => {
    if (!faceUrl) { setGenError(isEs ? "Sube la foto de tu rostro" : "Upload your face photo"); return; }
    if (!bodyUrl) { setGenError(isEs ? "Sube la foto de cuerpo completo" : "Upload your full body photo"); return; }
    if (!tiktokUser.trim()) { setGenError(isEs ? "Ingresa tu @username de TikTok" : "Enter your TikTok @username"); return; }
    if (!description.trim()) { setGenError(isEs ? "Describe qué quieres que haga tu avatar" : "Describe what your avatar should do"); return; }

    const lang_obj = LANGUAGES.find(l => l.code === language) || LANGUAGES[0];

    setGenError(null);
    setGenStatus("generating");
    setVideoUrls({});

    try {
      const token = await getToken();
      const res = await fetch("/api/tiktok-live/generate-avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          face_image_url:   faceUrl,
          body_image_url:   bodyUrl,
          user_description: description,
          behaviors,
          language,
          voice_id:         lang_obj.voice_id,
          tiktok_username:  tiktokUser.trim(),
          product_link:     productLink.trim(),
          youtube_url:      youtubeUrl.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Error generando avatar");
      setSessionId(json.session_id);
      setTaskIds(json.task_ids);
    } catch (e) {
      setGenError(e.message);
      setGenStatus("idle");
    }
  };

  // ── Poll 4 video jobs ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!taskIds || genStatus !== "generating") return;
    let active = true;

    const poll = async () => {
      if (!active) return;
      try {
        const token = await getToken();
        const types = ["idle", "talking", "dancing", "lipsync"];
        const results = await Promise.all(
          types.map(type =>
            fetch("/api/tiktok-live/poll-avatar", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({ session_id: sessionId, task_id: taskIds[type], video_type: type }),
            }).then(r => r.json()).catch(() => ({ status: "processing" }))
          )
        );

        if (!active) return;

        const newUrls = {};
        let allDone = true;
        types.forEach((type, i) => {
          if (results[i]?.status === "completed" && results[i].video_url) {
            newUrls[type] = results[i].video_url;
          } else {
            allDone = false;
          }
        });

        setVideoUrls(prev => ({ ...prev, ...newUrls }));

        if (allDone) {
          setGenStatus("ready");
        } else if (active) {
          setTimeout(poll, 6000);
        }
      } catch {
        if (active) setTimeout(poll, 8000);
      }
    };

    setTimeout(poll, 4000);
    return () => { active = false; };
  }, [taskIds, genStatus, sessionId]);

  // ── Start live ─────────────────────────────────────────────────────────────
  const handleStart = async () => {
    setStarting(true);
    setLiveError(null);
    try {
      const token = await getToken();
      const res = await fetch("/api/tiktok-live/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Error iniciando live");
      setLiveSession({
        id:               json.session_id,
        status:           "active",
        tiktok_username:  tiktokUser.replace(/^@/, ""),
        overlay_url:      json.overlay_url,
      });
    } catch (e) {
      setLiveError(e.message);
    } finally {
      setStarting(false);
    }
  };

  // ── Stop live ──────────────────────────────────────────────────────────────
  const handleStop = async () => {
    if (!liveSession?.id) return;
    setStopping(true);
    try {
      const token = await getToken();
      await fetch("/api/tiktok-live/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ session_id: liveSession.id }),
      });
      setLiveSession(null);
      setSessionId(null);
      setTaskIds(null);
      setVideoUrls({});
      setGenStatus("idle");
      setStep(1);
    } catch (e) {
      setLiveError(e.message);
    } finally {
      setStopping(false);
    }
  };

  const overlayUrl = liveSession
    ? `${window.location.origin}/api/tiktok-live/overlay/${liveSession.id}`
    : "";

  const copyOverlay = () => {
    navigator.clipboard?.writeText(overlayUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const completedCount = VIDEO_TYPES.filter(v => videoUrls[v.key]).length;

  const pendingOverlayUrl = sessionId
    ? `${window.location.origin}/api/tiktok-live/overlay/${sessionId}`
    : "";

  const toggleStep = (n) => setOpenSteps(prev => {
    const next = new Set(prev);
    next.has(n) ? next.delete(n) : next.add(n);
    return next;
  });

  const copySetupUrl = () => {
    navigator.clipboard?.writeText(pendingOverlayUrl);
    setCopiedSetup(true);
    setTimeout(() => setCopiedSetup(false), 2000);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (liveLoading) {
    return (
      <div style={S.panel}>
        <div style={S.spinner} />
      </div>
    );
  }

  if (liveSession?.status === "active") {
    return (
      <div style={S.panel}>
        <style>{css}</style>
        <div style={S.header}>
          <div>
            <p style={S.eyebrow}>IsabelaOS Studio</p>
            <h1 style={S.title}>LIVE <span style={{ color: "#ef4444" }}>AVATAR</span></h1>
          </div>
          <div style={S.liveBadge}><span style={S.liveDot} /> {isEs ? "EN VIVO" : "LIVE"}</div>
        </div>
        <div style={S.body}>
          <div style={{ ...S.card, borderColor: "rgba(80,200,100,0.25)" }}>
            <p style={{ fontSize: 13, color: "#60c870", letterSpacing: 1, marginBottom: 10 }}>
              🟢 {isEs ? "Conectado a" : "Connected to"} @{liveSession.tiktok_username}
            </p>
            <p style={S.fieldLabel}>{isEs ? "URL del Overlay para OBS" : "OBS Overlay URL"}</p>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input readOnly value={overlayUrl} style={S.urlInput} />
              <button onClick={copyOverlay} style={S.copyBtn}>
                {copied ? "✅" : "📋"} {copied ? (isEs ? "Copiado" : "Copied") : (isEs ? "Copiar" : "Copy")}
              </button>
            </div>
            <p style={{ fontSize: 11, color: "#666", lineHeight: 1.6, background: "#0a0a0c", borderRadius: 8, padding: "10px 12px" }}>
              💡 {isEs
                ? "OBS → Fuentes → Browser Source → pega la URL. Ancho: 1920 × Alto: 1080. CSS: body { background: rgba(0,0,0,0); }"
                : "OBS → Sources → Browser Source → paste URL. Width: 1920 × Height: 1080. CSS: body { background: rgba(0,0,0,0); }"}
            </p>
          </div>

          {liveError && <div style={S.errorBox}>{liveError}</div>}

          <button onClick={handleStop} disabled={stopping} style={{ ...S.stopBtn, opacity: stopping ? 0.6 : 1 }}>
            {stopping ? "⏳" : "⏹"} {isEs ? "DETENER LIVE" : "STOP LIVE"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={S.panel}>
      <style>{css}</style>

      {/* Header */}
      <div style={S.header}>
        <div>
          <p style={S.eyebrow}>IsabelaOS Studio</p>
          <h1 style={S.title}>LIVE <span style={{ color: "#c8a050" }}>AVATAR</span></h1>
          <p style={S.tagline}>
            {isEs ? "Avatar IA que responde tu chat de TikTok en vivo" : "AI avatar that responds to your TikTok live chat"}
          </p>
        </div>
      </div>

      {/* Step tabs */}
      <div style={S.tabs}>
        {[
          { n: 1, label: isEs ? "Tu Avatar" : "Your Avatar" },
          { n: 2, label: isEs ? "Qué hace" : "What it does" },
          { n: 3, label: isEs ? "Generar" : "Generate" },
        ].map(({ n, label }) => (
          <button
            key={n}
            onClick={() => { if (n < step || genStatus === "idle") setStep(n); }}
            style={{
              ...S.tab,
              ...(step === n ? S.tabActive : {}),
              opacity: n > step && genStatus === "idle" && n !== 1 ? 0.45 : 1,
            }}
          >
            <span style={{ ...S.tabNum, ...(step === n ? S.tabNumActive : {}) }}>{n}</span>
            {label}
          </button>
        ))}
      </div>

      <div style={S.body}>

        {/* ── STEP 1: Photos + TikTok + Language ── */}
        {step === 1 && (
          <>
            <div style={S.stepTitle}>{isEs ? "📸 Sube tus 2 fotos" : "📸 Upload your 2 photos"}</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 22 }}>
              {[
                { slot: "face", ref: faceRef, url: faceUrl, label: isEs ? "Foto de ROSTRO" : "FACE photo", hint: isEs ? "Primer plano de tu cara" : "Close-up of your face" },
                { slot: "body", ref: bodyRef, url: bodyUrl, label: isEs ? "Foto CUERPO COMPLETO" : "FULL BODY photo", hint: isEs ? "Con tu ropa y fondo del live" : "With your outfit & live background" },
              ].map(({ slot, ref, url, label, hint }) => (
                <div key={slot}>
                  <p style={S.fieldLabel}>{label}</p>
                  <div
                    style={{ ...S.uploadZone, ...(url ? { borderColor: "rgba(200,160,80,0.5)" } : {}) }}
                    onClick={() => ref.current?.click()}
                  >
                    {uploading[slot] ? (
                      <span style={{ fontSize: 11, color: "#c8a050" }}>{isEs ? "Subiendo..." : "Uploading..."}</span>
                    ) : url ? (
                      <>
                        <img src={url} style={{ width: "100%", maxHeight: 110, objectFit: "cover", borderRadius: 6 }} alt={label} />
                        <span style={{ fontSize: 9, color: "#60c870", marginTop: 4, letterSpacing: 1 }}>✓ {isEs ? "subida" : "uploaded"}</span>
                      </>
                    ) : (
                      <>
                        <span style={{ fontSize: 28, marginBottom: 6 }}>+</span>
                        <span style={{ fontSize: 10, color: "#888", textAlign: "center" }}>{hint}</span>
                      </>
                    )}
                    <input ref={ref} type="file" accept="image/*" style={{ display: "none" }}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f, slot); }} />
                  </div>
                </div>
              ))}
            </div>

            <div style={S.field}>
              <p style={S.fieldLabel}>@Username de TikTok</p>
              <input
                style={S.input}
                placeholder="@tu_usuario"
                value={tiktokUser}
                onChange={e => setTiktokUser(e.target.value)}
              />
            </div>

            <div style={S.field}>
              <p style={S.fieldLabel}>{isEs ? "Idioma / Acento" : "Language / Accent"}</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {LANGUAGES.map(l => (
                  <button
                    key={l.code}
                    onClick={() => setLanguage(l.code)}
                    style={{ ...S.langBtn, ...(language === l.code ? S.langBtnActive : {}) }}
                  >
                    {l.flag} {l.label}
                  </button>
                ))}
              </div>
            </div>

            {genError && <div style={S.errorBox}>{genError}</div>}

            <button
              onClick={() => {
                if (!faceUrl) { setGenError(isEs ? "Sube la foto de tu rostro" : "Upload your face photo"); return; }
                if (!bodyUrl) { setGenError(isEs ? "Sube la foto de cuerpo completo" : "Upload your full body photo"); return; }
                if (!tiktokUser.trim()) { setGenError(isEs ? "Ingresa tu @username de TikTok" : "Enter your TikTok @username"); return; }
                setGenError(null);
                setStep(2);
              }}
              style={S.nextBtn}
            >
              {isEs ? "SIGUIENTE →" : "NEXT →"}
            </button>
          </>
        )}

        {/* ── STEP 2: Description + Behaviors + Product ── */}
        {step === 2 && (
          <>
            <div style={S.stepTitle}>{isEs ? "🎭 Qué hace tu avatar" : "🎭 What your avatar does"}</div>

            <div style={S.field}>
              <p style={S.fieldLabel}>{isEs ? "¿Qué quieres que diga y haga tu avatar en el live?" : "What should your avatar say and do in the live?"}</p>
              <textarea
                style={{ ...S.input, minHeight: 120, resize: "vertical" }}
                placeholder={isEs
                  ? "Ej: Hola soy IsabelaOS, soy una creadora de contenido IA. Quiero que invite a la gente a seguirme, que pida gifts, que hable sobre IsabelaOS.com, que baile cuando alguien manda un gift, y que haga lip-sync de música reggaeton..."
                  : "E.g.: Hi I'm IsabelaOS, I'm an AI content creator. I want it to invite people to follow, ask for gifts, talk about IsabelaOS.com, dance when gifts come in, and do reggaeton lip-sync..."}
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>

            <div style={S.field}>
              <p style={S.fieldLabel}>{isEs ? "Comportamientos (selecciona todos los que quieres)" : "Behaviors (select all you want)"}</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {BEHAVIORS.map(b => (
                  <label key={b.key} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "10px 13px", background: behaviors.includes(b.key) ? "rgba(200,160,80,0.08)" : "#0a0a0c", border: `2px solid ${behaviors.includes(b.key) ? "rgba(200,160,80,0.45)" : "rgba(255,255,255,0.06)"}`, borderRadius: 8, transition: "all 0.15s" }}>
                    <input type="checkbox" checked={behaviors.includes(b.key)} onChange={() => toggleBehavior(b.key)} style={{ accentColor: "#c8a050", width: 16, height: 16 }} />
                    <span style={{ fontSize: 13, color: behaviors.includes(b.key) ? "#ddd8cc" : "#888" }}>{b.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div style={S.field}>
              <p style={S.fieldLabel}>{isEs ? "Link o producto a promocionar (opcional)" : "Link or product to promote (optional)"}</p>
              <input
                style={S.input}
                placeholder="https://isabelaos.com"
                value={productLink}
                onChange={e => setProductLink(e.target.value)}
              />
            </div>

            <div style={S.field}>
              <p style={S.fieldLabel}>🎵 {isEs ? "Música de fondo (opcional)" : "Background music (optional)"}</p>
              <input
                style={S.input}
                placeholder={isEs ? "https://youtube.com/watch?v=... — déjalo vacío si no quieres música" : "https://youtube.com/watch?v=... — leave empty for no music"}
                value={youtubeUrl}
                onChange={e => setYoutubeUrl(e.target.value)}
              />
              <p style={{ fontSize: 11, color: "#555", marginTop: 6, lineHeight: 1.5 }}>
                {isEs
                  ? "La música sonará de fondo en tu live mientras tu avatar baila o hace lip-sync"
                  : "Music will play in the background of your live while your avatar dances or lip-syncs"}
              </p>
            </div>

            {genError && <div style={S.errorBox}>{genError}</div>}

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setStep(1)} style={{ ...S.nextBtn, flex: "0 0 auto", background: "transparent", border: "2px solid rgba(200,160,80,0.2)", color: "#888" }}>
                ←
              </button>
              <button
                onClick={() => {
                  if (!description.trim()) { setGenError(isEs ? "Describe qué quieres que haga tu avatar" : "Describe what your avatar should do"); return; }
                  setGenError(null);
                  setStep(3);
                }}
                style={{ ...S.nextBtn, flex: 1 }}
              >
                {isEs ? "SIGUIENTE →" : "NEXT →"}
              </button>
            </div>
          </>
        )}

        {/* ── STEP 3: Generate + Progress + Preview + Start ── */}
        {step === 3 && (
          <>
            <div style={S.stepTitle}>{isEs ? "✨ Genera tu Avatar Live" : "✨ Generate your Live Avatar"}</div>

            {genStatus === "idle" && (
              <>
                <div style={{ ...S.card, marginBottom: 20 }}>
                  <p style={{ fontSize: 12, color: "#888", lineHeight: 1.7, marginBottom: 0 }}>
                    {isEs
                      ? "Al hacer clic, Gemini creará 4 videos automáticamente basados en tus fotos y descripción: Idle, Hablando, Bailando y Lip-Sync. El proceso toma 2-5 minutos."
                      : "On click, Gemini will automatically create 4 videos based on your photos and description: Idle, Talking, Dancing, and Lip-Sync. Process takes 2-5 minutes."}
                  </p>
                </div>
                <button onClick={handleGenerate} style={S.generateBtn}>
                  ✨ {isEs ? "GENERAR AVATAR (4 videos automáticos)" : "GENERATE AVATAR (4 automatic videos)"}
                </button>
              </>
            )}

            {genStatus === "generating" && (
              <>
                <div style={S.progressCard}>
                  <p style={{ fontSize: 12, color: "#c8a050", letterSpacing: 2, textTransform: "uppercase", marginBottom: 14, fontWeight: 700 }}>
                    {isEs ? "Generando tus videos..." : "Generating your videos..."} {completedCount}/4
                  </p>
                  <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 4, height: 4, marginBottom: 18 }}>
                    <div style={{ height: "100%", borderRadius: 4, background: "linear-gradient(90deg,#c8a050,#ff9800)", width: `${completedCount * 25}%`, transition: "width 0.5s ease" }} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {VIDEO_TYPES.map(v => (
                      <div key={v.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: videoUrls[v.key] ? "rgba(80,200,100,0.06)" : "rgba(255,255,255,0.03)", border: `1px solid ${videoUrls[v.key] ? "rgba(80,200,100,0.2)" : "rgba(255,255,255,0.06)"}`, borderRadius: 8 }}>
                        <span style={{ fontSize: 18 }}>{videoUrls[v.key] ? "✅" : "⏳"}</span>
                        <span style={{ fontSize: 13, color: videoUrls[v.key] ? "#60c870" : "#888", letterSpacing: 1 }}>
                          {v.icon} {v.label}
                          {!videoUrls[v.key] && <span style={{ fontSize: 10, color: "#555", marginLeft: 8 }}>{isEs ? "generando..." : "generating..."}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {genStatus === "ready" && (
              <>
                <p style={{ fontSize: 11, color: "#60c870", letterSpacing: 2, textTransform: "uppercase", marginBottom: 14 }}>
                  ✅ {isEs ? "4 videos listos — preview:" : "4 videos ready — preview:"}
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 22 }}>
                  {VIDEO_TYPES.map(v => (
                    <div key={v.key} style={{ ...S.card, padding: 10 }}>
                      <p style={{ fontSize: 9, letterSpacing: 2, color: "#888", textTransform: "uppercase", marginBottom: 6 }}>
                        {v.icon} {v.label}
                      </p>
                      {videoUrls[v.key] ? (
                        <video
                          src={videoUrls[v.key]}
                          style={{ width: "100%", borderRadius: 6, aspectRatio: "9/16", objectFit: "cover", background: "#000" }}
                          autoPlay loop muted playsInline
                        />
                      ) : (
                        <div style={{ aspectRatio: "9/16", background: "#0a0a0c", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <span style={{ color: "#333", fontSize: 11 }}>—</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* ── CÓMO TRANSMITIR TU AVATAR ── */}
                <div style={{ margin: "24px 0 6px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
                    <p style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: "#c8a050", fontWeight: 700, margin: 0 }}>
                      📡 {isEs ? "Cómo transmitir tu avatar" : "How to stream your avatar"}
                    </p>
                    <button
                      onClick={() => setTutorialOpen(true)}
                      style={{ background: "rgba(200,160,80,0.08)", border: "1px solid rgba(200,160,80,0.25)", borderRadius: 6, color: "#c8a050", fontSize: 11, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit" }}
                    >
                      ▶ {isEs ? "Ver tutorial en video" : "Watch video tutorial"}
                    </button>
                  </div>

                  {/* PASO 1 — URL del Overlay */}
                  {[
                    {
                      n: 1, icon: "🔗",
                      title: isEs ? "Copia tu URL de Overlay" : "Copy your Overlay URL",
                      content: (
                        <>
                          <p style={S.guideText}>{isEs ? "Esta es la pantalla de tu avatar para OBS. Cópiala y guárdala." : "This is your avatar screen for OBS. Copy and save it."}</p>
                          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                            <input readOnly value={pendingOverlayUrl} style={{ ...S.urlInput, fontSize: 11 }} />
                            <button onClick={copySetupUrl} style={S.copyBtn}>
                              {copiedSetup ? "✅" : "📋"} {copiedSetup ? (isEs ? "Copiado" : "Copied") : (isEs ? "Copiar" : "Copy")}
                            </button>
                          </div>
                        </>
                      ),
                    },
                    {
                      n: 2, icon: "🎬",
                      title: isEs ? "Configura OBS" : "Set up OBS",
                      content: (
                        <ol style={{ margin: "8px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 7 }}>
                          {[
                            isEs ? <>Descarga OBS gratis en <a href="https://obsproject.com" target="_blank" rel="noreferrer" style={{ color: "#c8a050" }}>obsproject.com</a></> : <>Download OBS free at <a href="https://obsproject.com" target="_blank" rel="noreferrer" style={{ color: "#c8a050" }}>obsproject.com</a></>,
                            isEs ? 'Abre OBS → clic en "+" en Sources (Fuentes)' : 'Open OBS → click "+" in Sources',
                            isEs ? 'Selecciona "Browser" (Navegador)' : 'Select "Browser"',
                            isEs ? "Pega tu URL de overlay en el campo URL" : "Paste your overlay URL in the URL field",
                            isEs ? "Ancho: 1080 / Alto: 1920 (vertical para TikTok)" : "Width: 1080 / Height: 1920 (vertical for TikTok)",
                            isEs ? 'Clic en "OK" y listo' : 'Click "OK" and done',
                          ].map((step, i) => (
                            <li key={i} style={S.guideText}>{step}</li>
                          ))}
                        </ol>
                      ),
                    },
                    {
                      n: 3, icon: "📱",
                      title: isEs ? "Configura TikTok Live Studio" : "Set up TikTok Live Studio",
                      content: (
                        <ol style={{ margin: "8px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 7 }}>
                          {[
                            isEs ? <>Descarga TikTok Live Studio en <a href="https://www.tiktok.com/live-studio" target="_blank" rel="noreferrer" style={{ color: "#c8a050" }}>tiktok.com/live-studio</a></> : <>Download TikTok Live Studio at <a href="https://www.tiktok.com/live-studio" target="_blank" rel="noreferrer" style={{ color: "#c8a050" }}>tiktok.com/live-studio</a></>,
                            isEs ? "Inicia sesión con tu cuenta TikTok" : "Sign in with your TikTok account",
                            isEs ? 'En "Source" selecciona OBS Virtual Camera' : 'In "Source" select OBS Virtual Camera',
                            isEs ? 'Presiona "GO LIVE" en TikTok' : 'Press "GO LIVE" in TikTok',
                          ].map((step, i) => (
                            <li key={i} style={S.guideText}>{step}</li>
                          ))}
                        </ol>
                      ),
                    },
                    {
                      n: 4, icon: "🤖",
                      title: isEs ? "Activa tu avatar" : "Activate your avatar",
                      content: (
                        <>
                          <p style={{ ...S.guideText, marginTop: 8 }}>
                            {isEs
                              ? "Vuelve a IsabelaOS y presiona el botón 🔴 INICIAR LIVE aquí abajo. Tu avatar comenzará a responder el chat de TikTok automáticamente."
                              : "Come back to IsabelaOS and press the 🔴 START LIVE button below. Your avatar will start responding to TikTok chat automatically."}
                          </p>
                        </>
                      ),
                    },
                  ].map(({ n, icon, title, content }) => {
                    const isOpen = openSteps.has(n);
                    return (
                      <div key={n} style={{ marginBottom: 8, border: "1px solid rgba(200,160,80,0.14)", borderRadius: 10, overflow: "hidden" }}>
                        <button
                          onClick={() => toggleStep(n)}
                          style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: isOpen ? "rgba(200,160,80,0.05)" : "#0a0a0c", border: "none", cursor: "pointer", textAlign: "left" }}
                        >
                          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: "50%", background: "rgba(200,160,80,0.15)", border: "1px solid rgba(200,160,80,0.35)", fontSize: 11, fontWeight: 700, color: "#c8a050", flexShrink: 0 }}>
                            {n}
                          </span>
                          <span style={{ fontSize: 16, flexShrink: 0 }}>{icon}</span>
                          <span style={{ fontSize: 13, color: "#ddd8cc", fontFamily: "inherit", fontWeight: 600, flex: 1 }}>{title}</span>
                          <span style={{ fontSize: 11, color: "#555", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
                        </button>
                        {isOpen && (
                          <div style={{ padding: "4px 14px 14px 54px", background: "#080808" }}>
                            {content}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Tutorial modal */}
                {tutorialOpen && (
                  <div
                    onClick={() => setTutorialOpen(false)}
                    style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
                  >
                    <div
                      onClick={e => e.stopPropagation()}
                      style={{ background: "#0e0e10", border: "2px solid rgba(200,160,80,0.25)", borderRadius: 16, padding: "32px 28px", maxWidth: 420, width: "100%", textAlign: "center" }}
                    >
                      <div style={{ fontSize: 48, marginBottom: 16 }}>🎬</div>
                      <h2 style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 28, letterSpacing: 4, color: "#f0e8d0", margin: "0 0 10px" }}>
                        {isEs ? "TUTORIAL EN VIDEO" : "VIDEO TUTORIAL"}
                      </h2>
                      <p style={{ fontSize: 13, color: "#888", lineHeight: 1.7, marginBottom: 24 }}>
                        {isEs ? "Tutorial disponible próximamente. Por ahora sigue los pasos de la guía visual arriba." : "Tutorial coming soon. For now follow the visual guide steps above."}
                      </p>
                      <button
                        onClick={() => setTutorialOpen(false)}
                        style={{ background: "rgba(200,160,80,0.12)", border: "2px solid rgba(200,160,80,0.3)", borderRadius: 8, color: "#c8a050", fontSize: 13, padding: "10px 28px", cursor: "pointer", fontFamily: "inherit" }}
                      >
                        {isEs ? "Cerrar" : "Close"}
                      </button>
                    </div>
                  </div>
                )}

                {liveError && <div style={S.errorBox}>{liveError}</div>}

                <button onClick={handleStart} disabled={starting} style={{ ...S.startLiveBtn, opacity: starting ? 0.6 : 1 }}>
                  {starting ? "⏳ " + (isEs ? "Iniciando..." : "Starting...") : "🔴 " + (isEs ? "INICIAR LIVE" : "START LIVE")}
                </button>
              </>
            )}

            {genError && <div style={{ ...S.errorBox, marginTop: 14 }}>{genError}</div>}

            {genStatus === "idle" && (
              <button onClick={() => setStep(2)} style={{ ...S.nextBtn, background: "transparent", border: "2px solid rgba(200,160,80,0.2)", color: "#888", marginTop: 10 }}>
                ← {isEs ? "Volver" : "Back"}
              </button>
            )}
          </>
        )}

      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const V = {
  gold: "#c8a050",
  ff: "'Syne','Segoe UI',sans-serif",
  ffB: "'Bebas Neue',sans-serif",
};

const S = {
  panel: {
    fontFamily: V.ff,
    background: "#060608",
    minHeight: "100vh",
    color: "#ddd8cc",
    maxWidth: 680,
    margin: "0 auto",
  },
  header: {
    padding: "28px 24px 16px",
    borderBottom: "1px solid #111",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 10,
  },
  eyebrow: { fontSize: 10, letterSpacing: 4, color: "#555", textTransform: "uppercase", marginBottom: 3 },
  title:   { fontFamily: V.ffB, fontSize: 42, letterSpacing: 6, lineHeight: 1, color: "#f0e8d0", margin: 0 },
  tagline: { fontSize: 11, color: "#777", letterSpacing: 1, marginTop: 5 },
  liveBadge: {
    display: "inline-flex", alignItems: "center", gap: 8,
    background: "rgba(200,60,60,0.1)", border: "2px solid rgba(200,60,60,0.35)",
    borderRadius: 20, padding: "6px 16px",
    fontSize: 12, fontWeight: 700, letterSpacing: 2, color: "#f07070",
  },
  liveDot: {
    width: 8, height: 8, borderRadius: "50%", background: "#f07070",
    display: "inline-block", animation: "blink 1s infinite",
  },

  tabs: {
    display: "flex",
    borderBottom: "1px solid #111",
    padding: "0 24px",
  },
  tab: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    padding: "13px 6px",
    background: "none",
    border: "none",
    borderBottom: "2px solid transparent",
    color: "#555",
    fontFamily: V.ff,
    fontSize: 11,
    letterSpacing: 1,
    cursor: "pointer",
    transition: "all 0.15s",
    textTransform: "uppercase",
  },
  tabActive: {
    color: V.gold,
    borderBottomColor: V.gold,
  },
  tabNum: {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 20, height: 20, borderRadius: "50%",
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
    fontSize: 10, fontWeight: 700, color: "#555",
  },
  tabNumActive: {
    background: "rgba(200,160,80,0.15)", border: "1px solid rgba(200,160,80,0.4)", color: V.gold,
  },

  body: { padding: "22px 24px 48px" },

  stepTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: "#ddd8cc",
    letterSpacing: 1,
    marginBottom: 18,
  },
  field:      { marginBottom: 18 },
  fieldLabel: { fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: "#777", marginBottom: 7, display: "block" },
  input: {
    width: "100%", background: "#0a0a0c",
    border: "2px solid rgba(200,160,80,0.18)",
    borderRadius: 8, color: "#ddd8cc", fontFamily: V.ff, fontSize: 13,
    padding: "11px 13px", outline: "none",
  },
  uploadZone: {
    border: "2px dashed rgba(200,160,80,0.22)",
    borderRadius: 10, padding: "14px 10px", minHeight: 100,
    display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    cursor: "pointer", transition: "border-color 0.15s",
    background: "#080808",
  },
  langBtn: {
    background: "#0a0a0c", border: "2px solid rgba(255,255,255,0.07)",
    borderRadius: 8, color: "#888", fontFamily: V.ff, fontSize: 12,
    padding: "10px 8px", cursor: "pointer", textAlign: "left",
    transition: "all 0.15s",
  },
  langBtnActive: { borderColor: "rgba(200,160,80,0.45)", background: "rgba(200,160,80,0.07)", color: "#ddd8cc" },

  nextBtn: {
    width: "100%", background: `linear-gradient(135deg,${V.gold},#e8b060)`,
    border: "none", borderRadius: 10, color: "#060608",
    fontFamily: V.ffB, fontSize: 18, letterSpacing: 4,
    padding: "14px", cursor: "pointer", marginTop: 4,
  },
  generateBtn: {
    width: "100%", background: `linear-gradient(135deg,${V.gold},#e8b060)`,
    border: "none", borderRadius: 10, color: "#060608",
    fontFamily: V.ffB, fontSize: 17, letterSpacing: 3,
    padding: "18px", cursor: "pointer",
  },
  startLiveBtn: {
    width: "100%", background: "linear-gradient(135deg,#ef4444,#dc2626)",
    border: "none", borderRadius: 10, color: "#fff",
    fontFamily: V.ffB, fontSize: 22, letterSpacing: 5,
    padding: "18px", cursor: "pointer",
  },
  stopBtn: {
    width: "100%", background: "rgba(200,60,60,0.1)", border: "2px solid rgba(200,60,60,0.35)",
    borderRadius: 10, color: "#f07070",
    fontFamily: V.ffB, fontSize: 20, letterSpacing: 4,
    padding: "14px", cursor: "pointer", marginTop: 16,
  },

  card: {
    background: "#0a0a0c", border: "2px solid rgba(200,160,80,0.14)",
    borderRadius: 12, padding: "16px", marginBottom: 12,
  },
  progressCard: {
    background: "#0a0a0c", border: "2px solid rgba(200,160,80,0.2)",
    borderRadius: 12, padding: "20px", marginBottom: 8,
  },
  urlInput: {
    flex: 1, background: "#0a0a0c", border: "2px solid rgba(200,160,80,0.18)",
    borderRadius: 8, color: V.gold, fontFamily: "monospace", fontSize: 11,
    padding: "10px 12px", outline: "none",
  },
  copyBtn: {
    background: "rgba(200,160,80,0.1)", border: "2px solid rgba(200,160,80,0.25)",
    borderRadius: 8, color: V.gold, fontFamily: V.ff, fontSize: 12,
    padding: "10px 14px", cursor: "pointer", whiteSpace: "nowrap",
  },
  guideText: {
    fontSize: 12, color: "#888", lineHeight: 1.65, margin: 0,
  },
  errorBox: {
    background: "rgba(200,60,60,0.06)", border: "2px solid rgba(200,60,60,0.2)",
    borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#e07070",
  },
  spinner: {
    width: 32, height: 32, border: "2px solid #161616", borderTopColor: V.gold,
    borderRadius: "50%", animation: "spin 0.9s linear infinite",
    margin: "80px auto",
  },
};

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Syne:wght@400;500;700&display=swap');
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }
  @keyframes spin  { to{transform:rotate(360deg)} }
`;
