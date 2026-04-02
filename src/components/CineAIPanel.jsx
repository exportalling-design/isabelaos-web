import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

// ─── Scene presets ────────────────────────────────────────────────────────────
const SCENE_PRESETS = [
  {
    id: "action",
    label: "Acción",
    icon: "⚡",
    prompt: "Person sprinting across rooftops at golden hour, dynamic parkour, cinematic slow motion, film grain, dramatic score",
  },
  {
    id: "fight",
    label: "Pelea",
    icon: "🥊",
    prompt: "Intense rooftop fistfight, bullet-time slow motion punch, neon lights on wet concrete, cinematic thriller, deep shadows",
  },
  {
    id: "drama",
    label: "Drama",
    icon: "🎭",
    prompt: "Cinematic close-up standing in heavy rain at night, emotional expression, city lights bokeh, film noir lighting, slow dolly push-in",
  },
  {
    id: "dance",
    label: "Baile",
    icon: "🕺",
    prompt: "High energy viral dance, professional studio lighting, smooth camera orbit, beat-synced fluid movement",
  },
  {
    id: "cinematic",
    label: "Épico",
    icon: "🎬",
    prompt: "Aerial drone shot descending, person standing at cliff overlooking city at sunset, golden hour, epic orchestral atmosphere",
  },
  {
    id: "custom",
    label: "Custom",
    icon: "✏️",
    prompt: "",
  },
];

const DURATIONS = [
  { value: 5, label: "5s", jades: 40 },
  { value: 10, label: "10s", jades: 75 },
  { value: 15, label: "15s", jades: 110 },
];

const RATIOS = [
  { value: "9:16", label: "9:16", desc: "TikTok" },
  { value: "16:9", label: "16:9", desc: "Cine" },
  { value: "1:1", label: "1:1", desc: "Insta" },
];

// Client-side fast check (backend also validates — this is UX only)
const BLOCKED_PREVIEW = [
  "tom cruise","brad pitt","scarlett johansson","jennifer lopez","bad bunny",
  "taylor swift","beyonce","beyoncé","rihanna","will smith","elon musk",
  "zuckerberg","trump","obama","kim kardashian","kanye","shakira","maluma",
  "messi","ronaldo","neymar","lebron","spiderman","spider-man","batman",
  "superman","iron man","darth vader","mickey mouse","disney","marvel",
];

function hasBlockedName(text) {
  const lower = text.toLowerCase();
  return BLOCKED_PREVIEW.find((n) => lower.includes(n)) || null;
}

export default function CineAIPanel() {
  const [selectedPreset, setSelectedPreset] = useState("dance");
  const [customPrompt, setCustomPrompt] = useState("");
  const [subjectDesc, setSubjectDesc] = useState("");

  // Uploads
  const [faceImage, setFaceImage] = useState(null);       // public URL
  const [facePreview, setFacePreview] = useState(null);
  const [refVideo, setRefVideo] = useState(null);         // public URL
  const [refVideoPreview, setRefVideoPreview] = useState(null);
  const [uploadingFace, setUploadingFace] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);

  const [duration, setDuration] = useState(10);
  const [ratio, setRatio] = useState("9:16");

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [currentTaskId, setCurrentTaskId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [error, setError] = useState(null);
  const [blockedWarning, setBlockedWarning] = useState(null);

  const faceInputRef = useRef();
  const videoInputRef = useRef();
  const pollRef = useRef();

  const preset = SCENE_PRESETS.find((p) => p.id === selectedPreset);
  const jadeCost = DURATIONS.find((d) => d.value === duration)?.jades || 75;

  // Determine active mode label for UI
  const modeLabel = refVideo
    ? faceImage ? "Copiar movimiento + tu cara 🔥" : "Copiar movimiento del video"
    : faceImage ? "Animar tu foto"
    : "Solo texto";

  // Build prompt
  const getFinalPrompt = () => {
    if (selectedPreset === "custom") return customPrompt;
    const base = preset?.prompt || "";
    return subjectDesc ? `${subjectDesc}. ${base}` : base;
  };

  // Live blocked check on prompt
  const promptText = getFinalPrompt();
  const liveBlocked = hasBlockedName(promptText) || hasBlockedName(subjectDesc);

  // Upload helpers
  const uploadFile = async (file, folder, setUrl, setPreview, setUploading, previewType = "image") => {
    setUploading(true);
    setError(null);
    try {
      const ext = file.name.split(".").pop();
      const path = `${folder}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("user-uploads")
        .upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("user-uploads").getPublicUrl(path);
      setUrl(data.publicUrl);
      if (previewType === "image") setPreview(URL.createObjectURL(file));
      else setPreview(URL.createObjectURL(file));
    } catch {
      setError("Error subiendo archivo. Intenta de nuevo.");
    } finally {
      setUploading(false);
    }
  };

  // Poll job
  const startPolling = useCallback((taskId) => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/cineai/status/${taskId}`);
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
      } catch { /* keep polling */ }
    }, 4000);
  }, []);

  useEffect(() => () => clearInterval(pollRef.current), []);

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
    setVideoUrl(null);
    setJobStatus(null);
    setGenerating(true);

    try {
      const res = await fetch("/api/cineai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          imageUrl: faceImage || null,
          refVideoUrl: refVideo || null,
          duration,
          aspectRatio: ratio,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.blocked) setBlockedWarning(data.error);
        throw new Error(data.error || "Error");
      }
      setCurrentTaskId(data.taskId);
      setJobStatus("pending");
      startPolling(data.taskId);
    } catch (e) {
      setError(e.message);
      setGenerating(false);
    }
  };

  const reset = () => {
    setVideoUrl(null);
    setJobStatus(null);
    setCurrentTaskId(null);
    setError(null);
    setBlockedWarning(null);
    setGenerating(false);
    clearInterval(pollRef.current);
  };

  const statusLabel = {
    pending: "En cola...",
    processing: "Renderizando escena...",
    completed: "¡Lista!",
    failed: "Error",
  };

  return (
    <div className="cp">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Syne:wght@400;500;700&display=swap');

        .cp {
          font-family: 'Syne', sans-serif;
          background: #060608;
          min-height: 100vh;
          color: #ddd8cc;
        }

        /* ── Header ── */
        .cp-header {
          padding: 40px 28px 24px;
          position: relative;
          overflow: hidden;
          border-bottom: 1px solid #111;
        }
        .cp-header::after {
          content: '';
          position: absolute;
          bottom: 0; left: 0; right: 0; height: 1px;
          background: linear-gradient(90deg, transparent, rgba(200,169,80,0.3), transparent);
        }
        .cp-eyebrow {
          font-size: 10px;
          letter-spacing: 4px;
          color: #444;
          text-transform: uppercase;
          margin-bottom: 6px;
        }
        .cp-title {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 52px;
          letter-spacing: 8px;
          line-height: 1;
          color: #f0e8d0;
          margin: 0 0 8px;
        }
        .cp-title em { color: #c8a050; font-style: normal; }
        .cp-tagline {
          font-size: 12px;
          color: #555;
          letter-spacing: 1px;
        }
        .cp-mode-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-top: 14px;
          background: rgba(200,160,80,0.08);
          border: 1px solid rgba(200,160,80,0.2);
          border-radius: 20px;
          padding: 5px 14px;
          font-size: 12px;
          color: #c8a050;
          letter-spacing: 1px;
        }
        .cp-mode-dot {
          width: 6px; height: 6px;
          border-radius: 50%;
          background: #c8a050;
          animation: blink 2s infinite;
        }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }

        /* ── Grid ── */
        .cp-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1px;
          background: #111;
        }
        .cp-cell {
          background: #060608;
          padding: 24px 28px;
        }
        .cp-cell-full { grid-column: 1 / -1; }
        .cp-section-label {
          font-size: 9px;
          letter-spacing: 4px;
          text-transform: uppercase;
          color: #333;
          margin-bottom: 16px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .cp-section-label::after {
          content: '';
          flex: 1;
          height: 1px;
          background: #161616;
        }

        /* ── Presets ── */
        .preset-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 6px;
        }
        .preset-btn {
          background: #0a0a0c;
          border: 1px solid #181818;
          border-radius: 8px;
          padding: 14px 6px 10px;
          cursor: pointer;
          text-align: center;
          transition: all 0.15s;
          color: #444;
        }
        .preset-btn:hover { border-color: #2a2820; color: #888; }
        .preset-btn.active {
          border-color: #c8a050;
          background: rgba(200,160,80,0.05);
          color: #c8a050;
        }
        .preset-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .pi { font-size: 22px; display: block; margin-bottom: 5px; }
        .pn { font-size: 9px; letter-spacing: 2px; text-transform: uppercase; }

        /* ── Upload zones ── */
        .upload-zone {
          border: 1px dashed #1e1e1e;
          border-radius: 10px;
          padding: 18px;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s;
          min-height: 100px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 6px;
          position: relative;
        }
        .upload-zone:hover { border-color: #c8a050; background: rgba(200,160,80,0.02); }
        .upload-zone.has-file { border-color: #2a2820; border-style: solid; }
        .upload-zone.uploading { border-color: #c8a050; animation: border-pulse 1s infinite; }
        @keyframes border-pulse { 50% { border-color: rgba(200,160,80,0.3); } }

        .upload-thumb {
          width: 72px; height: 72px;
          object-fit: cover;
          border-radius: 8px;
          border: 2px solid #c8a050;
        }
        .upload-video-thumb {
          width: 100%;
          max-height: 90px;
          border-radius: 8px;
          border: 2px solid #c8a050;
          object-fit: cover;
        }
        .upload-label { font-size: 12px; color: #444; line-height: 1.5; }
        .upload-hint { font-size: 10px; color: #c8a050; letter-spacing: 1px; }
        .upload-loading-text { font-size: 11px; color: #c8a050; letter-spacing: 2px; margin-top: 4px; }
        .upload-badge {
          position: absolute;
          top: 8px; right: 8px;
          background: rgba(200,160,80,0.15);
          border: 1px solid rgba(200,160,80,0.3);
          border-radius: 4px;
          font-size: 9px;
          color: #c8a050;
          padding: 2px 6px;
          letter-spacing: 1px;
          text-transform: uppercase;
        }
        .remove-btn {
          background: none;
          border: none;
          color: #c05050;
          font-size: 10px;
          cursor: pointer;
          letter-spacing: 1px;
          padding: 4px 0;
          text-transform: uppercase;
        }
        .remove-btn:hover { color: #e07070; }

        /* ── Inputs ── */
        .cp-input, .cp-textarea {
          width: 100%;
          background: #0a0a0c;
          border: 1px solid #181818;
          border-radius: 8px;
          color: #ddd8cc;
          font-family: 'Syne', sans-serif;
          font-size: 13px;
          padding: 12px 14px;
          outline: none;
          transition: border-color 0.2s;
          box-sizing: border-box;
        }
        .cp-input:focus, .cp-textarea:focus { border-color: #2a2820; }
        .cp-input::placeholder, .cp-textarea::placeholder { color: #2a2a2a; }
        .cp-textarea { resize: vertical; min-height: 90px; margin-top: 10px; }
        .cp-input.blocked { border-color: rgba(200,60,60,0.4) !important; }

        .prompt-preview {
          margin-top: 10px;
          padding: 10px 14px;
          background: #0a0a0a;
          border: 1px solid #141414;
          border-radius: 8px;
          font-size: 11px;
          color: #2e2e2e;
          line-height: 1.7;
          font-style: italic;
        }

        /* ── Blocked warning ── */
        .blocked-banner {
          background: rgba(200,60,60,0.07);
          border: 1px solid rgba(200,60,60,0.2);
          border-radius: 8px;
          padding: 10px 14px;
          font-size: 12px;
          color: #e07070;
          line-height: 1.5;
          margin-top: 10px;
          display: flex;
          gap: 8px;
          align-items: flex-start;
        }
        .blocked-icon { font-size: 16px; flex-shrink: 0; }

        /* ── Toggle rows ── */
        .toggle-row {
          display: flex;
          gap: 6px;
        }
        .toggle-btn {
          flex: 1;
          background: #0a0a0c;
          border: 1px solid #181818;
          border-radius: 8px;
          padding: 12px 6px;
          cursor: pointer;
          text-align: center;
          transition: all 0.15s;
          color: #333;
        }
        .toggle-btn:hover { border-color: #2a2820; color: #888; }
        .toggle-btn.active {
          border-color: #c8a050;
          background: rgba(200,160,80,0.05);
          color: #c8a050;
        }
        .toggle-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .tm { display: block; font-family: 'Bebas Neue', sans-serif; font-size: 18px; letter-spacing: 2px; }
        .ts { display: block; font-size: 9px; letter-spacing: 1px; opacity: 0.6; margin-top: 2px; }

        /* ── Jade cost + CTA ── */
        .cta-cell {
          background: #060608;
          padding: 20px 28px 28px;
          border-top: 1px solid #111;
          grid-column: 1 / -1;
        }
        .jade-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 18px;
          background: rgba(200,160,80,0.04);
          border: 1px solid rgba(200,160,80,0.12);
          border-radius: 10px;
          margin-bottom: 14px;
        }
        .jade-left { font-size: 11px; color: #444; letter-spacing: 2px; text-transform: uppercase; }
        .jade-right { display: flex; align-items: baseline; gap: 4px; }
        .jade-num { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: #c8a050; letter-spacing: 2px; }
        .jade-unit { font-size: 11px; color: #555; }

        .gen-btn {
          width: 100%;
          background: #c8a050;
          border: none;
          border-radius: 10px;
          color: #060608;
          font-family: 'Bebas Neue', sans-serif;
          font-size: 22px;
          letter-spacing: 5px;
          padding: 18px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .gen-btn:hover:not(:disabled) { background: #d4aa5a; transform: translateY(-1px); }
        .gen-btn:disabled { background: #1a1a1a; color: #333; cursor: not-allowed; transform: none; }

        .error-box {
          background: rgba(200,60,60,0.06);
          border: 1px solid rgba(200,60,60,0.15);
          border-radius: 8px;
          padding: 10px 14px;
          font-size: 12px;
          color: #e07070;
          margin-bottom: 12px;
        }

        /* ── Result ── */
        .result-cell {
          grid-column: 1 / -1;
          background: #060608;
          padding: 28px;
          text-align: center;
          border-bottom: 1px solid #111;
        }
        .spinner {
          width: 36px; height: 36px;
          border: 2px solid #1a1a1a;
          border-top-color: #c8a050;
          border-radius: 50%;
          animation: spin 0.9s linear infinite;
          margin: 0 auto 14px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .result-title {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 26px;
          letter-spacing: 4px;
          color: #f0e8d0;
          margin-bottom: 6px;
        }
        .result-sub { font-size: 12px; color: #333; letter-spacing: 1px; }
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
          max-height: 460px;
          border-radius: 10px;
          background: #000;
          margin-bottom: 16px;
        }
        .result-actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
        .ra-btn {
          background: transparent;
          border: 1px solid #222;
          border-radius: 8px;
          color: #888;
          font-family: 'Syne', sans-serif;
          font-size: 12px;
          padding: 10px 20px;
          cursor: pointer;
          transition: all 0.15s;
          letter-spacing: 1px;
          text-decoration: none;
          display: inline-block;
        }
        .ra-btn:hover { border-color: #c8a050; color: #c8a050; }
        .ra-btn.gold { background: #c8a050; color: #060608; border-color: #c8a050; font-weight: 700; }
        .ra-btn.gold:hover { background: #d4aa5a; }

        @media (max-width: 600px) {
          .cp-grid { grid-template-columns: 1fr; }
          .cp-cell-full, .result-cell, .cta-cell { grid-column: 1; }
          .cp-title { font-size: 38px; }
          .preset-grid { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>

      {/* ── Header ── */}
      <div className="cp-header">
        <p className="cp-eyebrow">IsabelaOS Studio</p>
        <h1 className="cp-title">CINE<em>AI</em></h1>
        <p className="cp-tagline">Escenas cinematográficas con inteligencia artificial · Seedance 2.0</p>
        <div className="cp-mode-pill">
          <span className="cp-mode-dot" />
          {modeLabel}
        </div>
      </div>

      <div className="cp-grid">

        {/* ── Result / Status ── */}
        {(generating || videoUrl || (error && currentTaskId)) && (
          <div className="result-cell">
            {generating && !videoUrl && (
              <>
                <div className="spinner" />
                <div className="result-title">{statusLabel[jobStatus] || "Procesando..."}</div>
                <p className="result-sub">Seedance 2.0 está renderizando · 1–3 minutos</p>
                <div className="dots" style={{ marginTop: 14 }}>
                  <span /><span /><span />
                </div>
              </>
            )}
            {videoUrl && (
              <>
                <video className="result-video" src={videoUrl} controls autoPlay loop playsInline />
                <div className="result-actions">
                  <a href={videoUrl} download className="ra-btn gold">⬇ Descargar</a>
                  <button className="ra-btn" onClick={reset}>✦ Nueva escena</button>
                </div>
              </>
            )}
            {error && currentTaskId && !videoUrl && (
              <>
                <div style={{ fontSize: 32, marginBottom: 10 }}>⚠️</div>
                <div className="result-title">Falló</div>
                <p className="result-sub" style={{ color: "#c05050" }}>{error}</p>
                <button className="ra-btn" style={{ marginTop: 14 }} onClick={reset}>Reintentar</button>
              </>
            )}
          </div>
        )}

        {/* ── Scene presets ── */}
        <div className="cp-cell">
          <p className="cp-section-label">Tipo de escena</p>
          <div className="preset-grid">
            {SCENE_PRESETS.map((p) => (
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

        {/* ── Face photo upload ── */}
        <div className="cp-cell">
          <p className="cp-section-label">Tu foto (opcional)</p>
          <div
            className={`upload-zone ${facePreview ? "has-file" : ""} ${uploadingFace ? "uploading" : ""}`}
            onClick={() => !facePreview && faceInputRef.current?.click()}
          >
            {facePreview ? (
              <>
                <div className="upload-badge">✓ foto</div>
                <img src={facePreview} className="upload-thumb" alt="face" />
              </>
            ) : uploadingFace ? (
              <p className="upload-loading-text">Subiendo...</p>
            ) : (
              <>
                <span style={{ fontSize: 28 }}>👤</span>
                <p className="upload-label">Sube tu foto<br />para aparecer en la escena</p>
                <p className="upload-hint">JPG / PNG recomendado</p>
              </>
            )}
          </div>
          {facePreview && (
            <button className="remove-btn" onClick={() => { setFacePreview(null); setFaceImage(null); }}>
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
              if (f) uploadFile(f, "cineai/faces", setFaceImage, setFacePreview, setUploadingFace, "image");
            }}
          />
        </div>

        {/* ── Reference video upload ── */}
        <div className="cp-cell cp-cell-full">
          <p className="cp-section-label">Video de referencia — copia el movimiento / baile</p>
          <div
            className={`upload-zone ${refVideoPreview ? "has-file" : ""} ${uploadingVideo ? "uploading" : ""}`}
            style={{ minHeight: 120 }}
            onClick={() => !refVideoPreview && videoInputRef.current?.click()}
          >
            {refVideoPreview ? (
              <>
                <div className="upload-badge">✓ referencia</div>
                <video
                  src={refVideoPreview}
                  className="upload-video-thumb"
                  muted
                  autoPlay
                  loop
                  playsInline
                />
                <p style={{ fontSize: 11, color: "#555", marginTop: 6 }}>
                  {faceImage ? "Tu cara copiará este movimiento 🔥" : "El personaje copiará este movimiento"}
                </p>
              </>
            ) : uploadingVideo ? (
              <p className="upload-loading-text">Subiendo video...</p>
            ) : (
              <>
                <span style={{ fontSize: 32 }}>🎬</span>
                <p className="upload-label">Sube un video del baile o movimiento<br />que quieres replicar</p>
                <p className="upload-hint">MP4 · Trend de TikTok, coreografía, escena de acción...</p>
              </>
            )}
          </div>
          {refVideoPreview && (
            <button className="remove-btn" onClick={() => { setRefVideoPreview(null); setRefVideo(null); }}>
              × quitar video
            </button>
          )}
          <input
            ref={videoInputRef}
            type="file"
            accept="video/mp4,video/mov,video/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files[0];
              if (f) uploadFile(f, "cineai/refs", setRefVideo, setRefVideoPreview, setUploadingVideo, "video");
            }}
          />
        </div>

        {/* ── Describe escena / prompt ── */}
        <div className="cp-cell cp-cell-full">
          <p className="cp-section-label">Describe la escena</p>

          {selectedPreset !== "custom" ? (
            <>
              <input
                className={`cp-input ${liveBlocked ? "blocked" : ""}`}
                placeholder="Describe tu personaje: hombre joven con saco negro, mujer con vestido rojo..."
                value={subjectDesc}
                onChange={(e) => { setSubjectDesc(e.target.value); setBlockedWarning(null); }}
                disabled={generating}
              />
              <div className="prompt-preview">
                {subjectDesc ? `${subjectDesc}. ` : ""}{preset?.prompt}
              </div>
            </>
          ) : (
            <textarea
              className={`cp-textarea ${liveBlocked ? "blocked" : ""}`}
              placeholder="Describe tu escena completa: personaje, acción, iluminación, estilo de cámara, atmósfera..."
              value={customPrompt}
              onChange={(e) => { setCustomPrompt(e.target.value); setBlockedWarning(null); }}
              disabled={generating}
            />
          )}

          {/* Live blocked warning */}
          {liveBlocked && (
            <div className="blocked-banner">
              <span className="blocked-icon">🚫</span>
              <span>
                <strong>"{liveBlocked}"</strong> no está permitido — no puedes generar videos con rostros de celebridades o personajes con copyright. Describe un personaje original.
              </span>
            </div>
          )}

          {/* Server blocked warning */}
          {blockedWarning && !liveBlocked && (
            <div className="blocked-banner">
              <span className="blocked-icon">⚠️</span>
              <span>{blockedWarning}</span>
            </div>
          )}
        </div>

        {/* ── Duration ── */}
        <div className="cp-cell">
          <p className="cp-section-label">Duración</p>
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

        {/* ── Aspect ratio ── */}
        <div className="cp-cell">
          <p className="cp-section-label">Formato</p>
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

        {/* ── CTA ── */}
        <div className="cta-cell">
          <div className="jade-row">
            <span className="jade-left">Costo de esta escena</span>
            <div className="jade-right">
              <span className="jade-num">{jadeCost}</span>
              <span className="jade-unit">Jades</span>
            </div>
          </div>

          {error && !currentTaskId && <div className="error-box">{error}</div>}

          <button
            className="gen-btn"
            onClick={handleGenerate}
            disabled={generating || uploadingFace || uploadingVideo || !!liveBlocked}
          >
            {generating ? "GENERANDO..." : "✦ CREAR ESCENA"}
          </button>
        </div>

      </div>
    </div>
  );
}
