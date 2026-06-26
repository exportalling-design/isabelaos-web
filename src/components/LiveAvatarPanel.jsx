// src/components/LiveAvatarPanel.jsx — IsabelaOS TikTok Live Avatar
import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";

// Popular ElevenLabs voice IDs (user can override with their own)
const PRESET_VOICES = [
  { id: "EXAVITQu4vr4xnSDxMaL", label: "Sarah (Female, EN)" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", label: "Liam (Male, EN)" },
  { id: "XB0fDUnXU5powFXDhCwa", label: "Charlotte (Female, EN)" },
  { id: "pFZP5JQG7iQjIQuC4Bku", label: "Lily (Female, EN)" },
];

const DEFAULT_PERSONA = `Eres Isabela, una creadora de contenido energética y cariñosa que hace TikTok Live sobre IA y creatividad. Hablas en español con entusiasmo, usas emojis ocasionalmente, eres positiva y divertida. Respondes siempre en máximo 2 oraciones cortas.`;

export default function LiveAvatarPanel({ lang = "es" }) {
  const isEs = lang !== "en";

  // Session state
  const [session, setSession]     = useState(null);
  const [loading, setLoading]     = useState(true);
  const [starting, setStarting]   = useState(false);
  const [stopping, setStopping]   = useState(false);
  const [error, setError]         = useState(null);
  const [copied, setCopied]       = useState(false);

  // Form state
  const [tiktokUser,      setTiktokUser]      = useState("");
  const [voiceId,         setVoiceId]         = useState(PRESET_VOICES[0].id);
  const [customVoiceId,   setCustomVoiceId]   = useState("");
  const [personaPrompt,   setPersonaPrompt]   = useState(DEFAULT_PERSONA);
  const [avatarType,      setAvatarType]      = useState("video");
  const [idleUrl,         setIdleUrl]         = useState("");
  const [talkingUrl,      setTalkingUrl]      = useState("");
  const [reactionUrl,     setReactionUrl]     = useState("");

  // Uploaders
  const [uploadingIdle,     setUploadingIdle]     = useState(false);
  const [uploadingTalking,  setUploadingTalking]  = useState(false);
  const [uploadingReaction, setUploadingReaction] = useState(false);

  const idleRef     = useRef();
  const talkingRef  = useRef();
  const reactionRef = useRef();

  const pollRef = useRef();

  // Load existing active session on mount
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data: { session: authSession } } = await supabase.auth.getSession();
        const token = authSession?.access_token;
        if (!token) { setLoading(false); return; }

        const res = await fetch("/api/tiktok-live/status", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (json.ok && json.session?.status === "active") {
          setSession(json.session);
        }
      } catch {}
      setLoading(false);
    })();
  }, []);

  // Poll status every 10s while live
  useEffect(() => {
    if (!session || session.status !== "active") {
      clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const { data: { session: authSession } } = await supabase.auth.getSession();
        const token = authSession?.access_token;
        const res = await fetch(`/api/tiktok-live/status?session_id=${session.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (json.ok) setSession(json.session);
      } catch {}
    }, 10_000);
    return () => clearInterval(pollRef.current);
  }, [session?.id, session?.status]);

  // ── File upload helper ──────────────────────────────────────────────────────
  const uploadAvatar = useCallback(async (file, setUrl, setUploading) => {
    setUploading(true);
    setError(null);
    try {
      const ext  = file.name.split(".").pop();
      const path = `live-avatars/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("user-uploads")
        .upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("user-uploads").getPublicUrl(path);
      setUrl(data.publicUrl);
    } catch (e) {
      setError((isEs ? "Error subiendo archivo: " : "Error uploading file: ") + e.message);
    } finally {
      setUploading(false);
    }
  }, [isEs]);

  // ── Start / Stop ────────────────────────────────────────────────────────────
  const handleStart = async () => {
    const finalVoiceId = customVoiceId.trim() || voiceId;
    if (!tiktokUser.trim()) {
      setError(isEs ? "Ingresa tu @username de TikTok" : "Enter your TikTok @username"); return;
    }
    if (!personaPrompt.trim()) {
      setError(isEs ? "Define el personaje de tu avatar" : "Define your avatar persona"); return;
    }

    setStarting(true);
    setError(null);
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const token = authSession?.access_token;
      const res = await fetch("/api/tiktok-live/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          tiktok_username:     tiktokUser.trim().replace(/^@/, ""),
          avatar_type:         avatarType,
          avatar_idle_url:     idleUrl     || null,
          avatar_talking_url:  talkingUrl  || null,
          avatar_reaction_url: reactionUrl || null,
          voice_id:            finalVoiceId,
          persona_prompt:      personaPrompt.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Error iniciando live");
      setSession({ id: json.session_id, status: "active", tiktok_username: tiktokUser.replace(/^@/,""), overlay_url: json.overlay_url });
    } catch (e) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    if (!session?.id) return;
    setStopping(true);
    setError(null);
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const token = authSession?.access_token;
      await fetch("/api/tiktok-live/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ session_id: session.id }),
      });
      setSession(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setStopping(false);
    }
  };

  const overlayUrl = session
    ? `${window.location.origin}/api/tiktok-live/overlay/${session.id}`
    : "";

  const copyOverlayUrl = () => {
    navigator.clipboard?.writeText(overlayUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={S.panel}>
        <div style={{ ...S.spinner }} />
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
            {isEs ? "Avatar de IA que responde tu chat de TikTok en vivo" : "AI avatar that responds to your TikTok live chat"}
          </p>
        </div>
        {session?.status === "active" && (
          <div style={S.liveBadge}>
            <span style={S.liveDot} />
            {isEs ? "EN VIVO" : "LIVE"}
          </div>
        )}
      </div>

      {/* Live status panel */}
      {session?.status === "active" ? (
        <div style={S.livePanel}>
          <div style={S.liveInfo}>
            <div style={{ fontSize: 13, color: "#60c870", letterSpacing: 1, marginBottom: 6 }}>
              🟢 {isEs ? "Conectado a" : "Connected to"} @{session.tiktok_username}
            </div>

            {/* Overlay URL */}
            <p style={{ fontSize: 10, color: "#888", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>
              {isEs ? "URL del Overlay para OBS" : "Overlay URL for OBS"}
            </p>
            <div style={S.urlRow}>
              <input readOnly value={overlayUrl} style={S.urlInput} />
              <button onClick={copyOverlayUrl} style={S.copyBtn}>
                {copied ? "✅" : "📋"} {copied ? (isEs ? "Copiado" : "Copied") : (isEs ? "Copiar" : "Copy")}
              </button>
            </div>

            <div style={S.obsNote}>
              💡 {isEs
                ? "En OBS → Fuentes → Browser Source → pega la URL. Ancho: 1920 × Alto: 1080. CSS personalizado: body { background-color: rgba(0,0,0,0); }"
                : "In OBS → Sources → Browser Source → paste URL. Width: 1920 × Height: 1080. Custom CSS: body { background-color: rgba(0,0,0,0); }"}
            </div>
          </div>

          <button
            onClick={handleStop}
            disabled={stopping}
            style={{ ...S.stopBtn, opacity: stopping ? 0.6 : 1 }}
          >
            {stopping ? "⏳" : "⏹"} {isEs ? "DETENER LIVE" : "STOP LIVE"}
          </button>

          {error && <div style={S.errorBox}>{error}</div>}
        </div>
      ) : (
        /* Setup form */
        <div style={S.form}>

          {/* TikTok username */}
          <div style={S.field}>
            <label style={S.label}>{isEs ? "@Username de TikTok" : "TikTok @Username"}</label>
            <input
              style={S.input}
              placeholder="@tu_usuario"
              value={tiktokUser}
              onChange={(e) => setTiktokUser(e.target.value)}
            />
          </div>

          {/* Avatar type */}
          <div style={S.field}>
            <label style={S.label}>{isEs ? "Tipo de avatar" : "Avatar type"}</label>
            <div style={{ display: "flex", gap: 8 }}>
              {["video", "png"].map((t) => (
                <button
                  key={t}
                  onClick={() => setAvatarType(t)}
                  style={{ ...S.typeBtn, ...(avatarType === t ? S.typeBtnActive : {}) }}
                >
                  {t === "video" ? "🎥 Video MP4" : "🖼️ Imagen PNG"}
                </button>
              ))}
            </div>
          </div>

          {/* Avatar uploads */}
          <div style={S.field}>
            <label style={S.label}>{isEs ? "Videos / imágenes del avatar" : "Avatar videos / images"}</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {[
                { label: isEs ? "Idle (en reposo)" : "Idle (resting)", url: idleUrl, setUrl: setIdleUrl, ref: idleRef, uploading: uploadingIdle, setUploading: setUploadingIdle },
                { label: isEs ? "Hablando" : "Talking", url: talkingUrl, setUrl: setTalkingUrl, ref: talkingRef, uploading: uploadingTalking, setUploading: setUploadingTalking },
                { label: isEs ? "Reacción (regalo)" : "Reaction (gift)", url: reactionUrl, setUrl: setReactionUrl, ref: reactionRef, uploading: uploadingReaction, setUploading: setUploadingReaction },
              ].map(({ label, url, setUrl, ref, uploading, setUploading }) => (
                <div key={label} style={S.uploadZone} onClick={() => ref.current?.click()}>
                  {uploading ? (
                    <span style={{ fontSize: 11, color: "#c8a050" }}>{isEs ? "Subiendo..." : "Uploading..."}</span>
                  ) : url ? (
                    <>
                      {avatarType === "video"
                        ? <video src={url} style={{ width: "100%", maxHeight: 60, objectFit: "cover", borderRadius: 4 }} muted autoPlay loop playsInline />
                        : <img src={url} style={{ width: "100%", maxHeight: 60, objectFit: "cover", borderRadius: 4 }} alt={label} />
                      }
                      <span style={{ fontSize: 9, color: "#60c870", letterSpacing: 1, marginTop: 4 }}>✓ {isEs ? "subido" : "uploaded"}</span>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 20 }}>+</span>
                      <span style={{ fontSize: 10, color: "#666", textAlign: "center", marginTop: 4 }}>{label}</span>
                    </>
                  )}
                  <input
                    ref={ref}
                    type="file"
                    accept={avatarType === "video" ? "video/mp4,video/*" : "image/png,image/jpeg,image/gif,image/webp"}
                    style={{ display: "none" }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAvatar(f, setUrl, setUploading); }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Voice */}
          <div style={S.field}>
            <label style={S.label}>{isEs ? "Voz del avatar (ElevenLabs)" : "Avatar voice (ElevenLabs)"}</label>
            <select style={S.select} value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
              {PRESET_VOICES.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
              <option value="custom">{isEs ? "ID personalizado..." : "Custom ID..."}</option>
            </select>
            {voiceId === "custom" && (
              <input
                style={{ ...S.input, marginTop: 6 }}
                placeholder={isEs ? "Pega tu Voice ID de ElevenLabs" : "Paste your ElevenLabs Voice ID"}
                value={customVoiceId}
                onChange={(e) => setCustomVoiceId(e.target.value)}
              />
            )}
          </div>

          {/* Persona prompt */}
          <div style={S.field}>
            <label style={S.label}>{isEs ? "Personaje del avatar" : "Avatar persona"}</label>
            <textarea
              style={S.textarea}
              placeholder={isEs ? "Describe cómo habla y se comporta tu avatar en vivo..." : "Describe how your avatar speaks and behaves live..."}
              value={personaPrompt}
              onChange={(e) => setPersonaPrompt(e.target.value)}
              rows={5}
            />
          </div>

          {error && <div style={S.errorBox}>{error}</div>}

          <button
            onClick={handleStart}
            disabled={starting}
            style={{ ...S.startBtn, opacity: starting ? 0.6 : 1 }}
          >
            {starting ? "⏳ " + (isEs ? "Iniciando..." : "Starting...") : "🔴 " + (isEs ? "INICIAR LIVE" : "START LIVE")}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const S = {
  panel: {
    fontFamily: "'Syne', 'Segoe UI', sans-serif",
    background: "#060608",
    minHeight: "100vh",
    color: "#ddd8cc",
    maxWidth: 700,
    margin: "0 auto",
  },
  header: {
    padding: "32px 26px 20px",
    borderBottom: "1px solid #111",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 12,
  },
  eyebrow: { fontSize: 10, letterSpacing: 4, color: "#666", textTransform: "uppercase", marginBottom: 4 },
  title: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 44, letterSpacing: 6, lineHeight: 1, color: "#f0e8d0", margin: 0 },
  tagline: { fontSize: 11, color: "#888", letterSpacing: 1, marginTop: 6 },
  liveBadge: {
    display: "inline-flex", alignItems: "center", gap: 8,
    background: "rgba(200,60,60,0.12)", border: "2px solid rgba(200,60,60,0.4)",
    borderRadius: 20, padding: "6px 16px",
    fontSize: 13, fontWeight: 700, letterSpacing: 2, color: "#f07070",
    alignSelf: "center",
  },
  liveDot: {
    width: 8, height: 8, borderRadius: "50%", background: "#f07070",
    display: "inline-block", animation: "blink 1s infinite",
  },
  form: { padding: "24px 26px 40px" },
  field: { marginBottom: 20 },
  label: { display: "block", fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: "#888", marginBottom: 8 },
  input: {
    width: "100%", background: "#0a0a0c", border: "2px solid rgba(200,160,80,0.2)",
    borderRadius: 8, color: "#ddd8cc", fontFamily: "inherit", fontSize: 14,
    padding: "11px 13px", outline: "none",
  },
  select: {
    width: "100%", background: "#0a0a0c", border: "2px solid rgba(200,160,80,0.2)",
    borderRadius: 8, color: "#ddd8cc", fontFamily: "inherit", fontSize: 13,
    padding: "11px 13px", outline: "none",
  },
  textarea: {
    width: "100%", background: "#0a0a0c", border: "2px solid rgba(200,160,80,0.2)",
    borderRadius: 8, color: "#ddd8cc", fontFamily: "inherit", fontSize: 13,
    padding: "11px 13px", outline: "none", resize: "vertical",
  },
  typeBtn: {
    flex: 1, background: "#0a0a0c", border: "2px solid rgba(200,160,80,0.22)",
    borderRadius: 8, color: "#888", fontFamily: "inherit", fontSize: 13,
    padding: "10px 14px", cursor: "pointer",
  },
  typeBtnActive: { borderColor: "#c8a050", background: "rgba(200,160,80,0.08)", color: "#c8a050" },
  uploadZone: {
    border: "2px dashed rgba(200,160,80,0.25)", borderRadius: 10,
    padding: "12px 8px", minHeight: 80, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", cursor: "pointer",
    transition: "border-color 0.15s",
  },
  startBtn: {
    width: "100%", background: "#c8a050", border: "none", borderRadius: 10,
    color: "#060608", fontFamily: "'Bebas Neue', sans-serif", fontSize: 22,
    letterSpacing: 5, padding: "16px", cursor: "pointer", marginTop: 8,
  },
  stopBtn: {
    width: "100%", background: "rgba(200,60,60,0.12)", border: "2px solid rgba(200,60,60,0.4)",
    borderRadius: 10, color: "#f07070", fontFamily: "'Bebas Neue', sans-serif", fontSize: 20,
    letterSpacing: 4, padding: "14px", cursor: "pointer", marginTop: 16,
  },
  livePanel: { padding: "24px 26px 40px" },
  liveInfo: {
    background: "rgba(80,180,100,0.06)", border: "2px solid rgba(80,180,100,0.22)",
    borderRadius: 12, padding: "18px", marginBottom: 16,
  },
  urlRow: { display: "flex", gap: 8, marginBottom: 12 },
  urlInput: {
    flex: 1, background: "#0a0a0c", border: "2px solid rgba(200,160,80,0.2)",
    borderRadius: 8, color: "#c8a050", fontFamily: "monospace", fontSize: 12,
    padding: "10px 12px", outline: "none",
  },
  copyBtn: {
    background: "rgba(200,160,80,0.12)", border: "2px solid rgba(200,160,80,0.3)",
    borderRadius: 8, color: "#c8a050", fontFamily: "inherit", fontSize: 12,
    padding: "10px 14px", cursor: "pointer", whiteSpace: "nowrap",
  },
  obsNote: {
    fontSize: 11, color: "#666", lineHeight: 1.6,
    background: "#080808", borderRadius: 8, padding: "10px 12px",
  },
  errorBox: {
    background: "rgba(200,60,60,0.06)", border: "2px solid rgba(200,60,60,0.2)",
    borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#e07070",
    marginTop: 10,
  },
  spinner: {
    width: 32, height: 32, border: "2px solid #161616", borderTopColor: "#c8a050",
    borderRadius: "50%", animation: "spin 0.9s linear infinite",
    margin: "80px auto",
  },
};

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Syne:wght@400;500;700&display=swap');
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }
  @keyframes spin  { to{transform:rotate(360deg)} }
`;
