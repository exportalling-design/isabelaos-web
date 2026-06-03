// src/components/FreeTemplatePanel.jsx
// Plantilla gratuita con Seedance 1.5 Pro — 5 segundos — marca de agua
// Un solo video gratis por usuario (chequeado en Supabase)

import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

// ── Tres plantillas gratis ────────────────────────────────────────────────
const FREE_TEMPLATES = [
  {
    id: "free-1",
    emoji: "🌟",
    label:       { es: "Plantilla Gratis 1", en: "Free Template 1" },
    tag:         { es: "GRATIS", en: "FREE" },
    description: { es: "Pon tu rostro en esta escena cinematográfica de IA.", en: "Put your face in this cinematic AI scene." },
    video:       "/gallery/free-template-1.mp4",
    accent:      "#ff5a00",
    promptEs:    "Cinematic close-up of a person walking confidently through golden hour light, slow motion, film grain, epic music swell, 5 seconds",
    promptEn:    "Cinematic close-up of a person walking confidently through golden hour light, slow motion, film grain, epic music swell, 5 seconds",
  },
  {
    id: "free-2",
    emoji: "✨",
    label:       { es: "Plantilla Gratis 2", en: "Free Template 2" },
    tag:         { es: "GRATIS", en: "FREE" },
    description: { es: "Escena dramática con efectos de luz y ambiente cinematográfico.", en: "Dramatic scene with light effects and cinematic atmosphere." },
    video:       "/gallery/free-template-2.mp4",
    accent:      "#ffb300",
    promptEs:    "Dramatic portrait of a person with volumetric light rays, smoke, cinematic color grade, emotional expression, 5 seconds",
    promptEn:    "Dramatic portrait of a person with volumetric light rays, smoke, cinematic color grade, emotional expression, 5 seconds",
  },
  {
    id: "free-3",
    emoji: "🎬",
    label:       { es: "Plantilla Gratis 3", en: "Free Template 3" },
    tag:         { es: "GRATIS", en: "FREE" },
    description: { es: "Video de estilo fashion editorial con tu propio rostro.", en: "Fashion editorial style video with your own face." },
    video:       "/gallery/free-template-3.mp4",
    accent:      "#4A90E2",
    promptEs:    "Fashion editorial video of a person, luxury aesthetic, soft bokeh, elegance, cinematic lighting, 5 seconds",
    promptEn:    "Fashion editorial video of a person, luxury aesthetic, soft bokeh, elegance, cinematic lighting, 5 seconds",
  },
];

// ── Compresión de imagen ──────────────────────────────────────────────────
function fileToBase64(file, maxSize = 800, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        URL.revokeObjectURL(url);
        resolve(dataUrl.split(",")[1]);
      } catch (err) { URL.revokeObjectURL(url); reject(err); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load image")); };
    img.src = url;
  });
}

// ── Upload Zone ───────────────────────────────────────────────────────────
function UploadZone({ label, hint, onChange, preview, accent }) {
  const ref = useRef();
  const [drag, setDrag] = useState(false);
  const onDrop = useCallback((e) => {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f?.type.startsWith("image/")) onChange(f);
  }, [onChange]);

  return (
    <div
      onClick={() => ref.current.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
      style={{
        border: `2px dashed ${drag ? accent : "rgba(255,255,255,0.15)"}`,
        borderRadius: 16, cursor: "pointer", overflow: "hidden",
        background: drag ? `${accent}18` : "rgba(255,255,255,0.03)",
        transition: "all 0.2s", minHeight: 180,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", position: "relative",
      }}
    >
      <input ref={ref} type="file" accept="image/*" style={{ display: "none" }}
        onChange={(e) => e.target.files[0] && onChange(e.target.files[0])} />
      {preview ? (
        <>
          <img src={preview} alt="" style={{ width: "100%", height: 180, objectFit: "cover", display: "block" }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "8px 12px", background: "linear-gradient(transparent,rgba(0,0,0,0.85))", fontSize: 11, color: accent, fontFamily: "'Syne',sans-serif", fontWeight: 700 }}>
            ✓ {label}
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.4 }}>📸</div>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 4, textAlign: "center" }}>{label}</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", textAlign: "center", maxWidth: 200, lineHeight: 1.5, padding: "0 16px" }}>{hint}</div>
        </>
      )}
    </div>
  );
}

// ── Gallery Card ──────────────────────────────────────────────────────────
function FreeCard({ tmpl, lang, onClick, used }) {
  const vRef = useRef();
  return (
    <div
      onClick={!used ? onClick : undefined}
      onMouseEnter={() => vRef.current?.play()}
      onMouseLeave={() => { if (vRef.current) { vRef.current.pause(); vRef.current.currentTime = 0; } }}
      onTouchStart={() => vRef.current?.play()}
      onTouchEnd={() => { if (vRef.current) { vRef.current.pause(); vRef.current.currentTime = 0; } }}
      style={{
        position: "relative", borderRadius: 18, overflow: "hidden",
        cursor: used ? "not-allowed" : "pointer", aspectRatio: "9/16",
        background: "#080808", border: `1px solid ${tmpl.accent}33`,
        transition: "transform 0.25s, box-shadow 0.25s",
        opacity: used ? 0.5 : 1,
      }}
      onMouseOver={(e) => { if (!used) { e.currentTarget.style.transform = "scale(1.04)"; e.currentTarget.style.boxShadow = `0 24px 60px ${tmpl.accent}55`; } }}
      onMouseOut={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "none"; }}
    >
      <video ref={vRef} src={tmpl.video} muted playsInline loop preload="auto"
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(0deg,rgba(0,0,0,0.93) 0%,rgba(0,0,0,0.1) 55%,transparent 100%)" }} />
      <div style={{ position: "absolute", top: 10, left: 10, background: tmpl.accent, color: "#000", fontFamily: "'Syne',sans-serif", fontWeight: 900, fontSize: 9, letterSpacing: 2, padding: "4px 10px", borderRadius: 6 }}>
        {used ? "✓ USADO" : tmpl.tag[lang]}
      </div>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "14px 12px" }}>
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 14, fontWeight: 800, marginBottom: 4 }}>{tmpl.emoji} {tmpl.label[lang]}</div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", lineHeight: 1.5, marginBottom: 10 }}>{tmpl.description[lang]}</div>
        {!used && (
          <div style={{ background: tmpl.accent, borderRadius: 8, padding: "8px", textAlign: "center", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 11, color: "#000" }}>
            🎁 {lang === "es" ? "Crear GRATIS" : "Create FREE"}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────
export default function FreeTemplatePanel({ lang = "es", onUpgrade }) {
  const [view,         setView]         = useState("gallery");
  const [selectedId,   setSelectedId]   = useState(null);
  const [gender,       setGender]       = useState(null);   // "male" | "female"
  const [dialogLang,   setDialogLang]   = useState("es");
  const [faceFile,     setFaceFile]     = useState(null);
  const [facePreview,  setFacePreview]  = useState(null);
  const [step,         setStep]         = useState("idle"); // idle|checking|submitting|polling|done|error
  const [taskId,       setTaskId]       = useState(null);
  const [pollCount,    setPollCount]    = useState(0);
  const [videoUrl,     setVideoUrl]     = useState(null);
  const [watermarked,  setWatermarked]  = useState(null);   // blob URL del video watermarked
  const [errorMsg,     setErrorMsg]     = useState("");
  const [usedFreeId,   setUsedFreeId]   = useState(null);   // templateId ya usado
  const [checkingUsed, setCheckingUsed] = useState(true);

  const tmpl   = FREE_TEMPLATES.find((t) => t.id === selectedId);
  const accent = tmpl?.accent || "#ff5a00";

  // ── Verificar si el usuario ya usó su video gratis ───────────────────────
  useEffect(() => {
    (async () => {
      setCheckingUsed(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setCheckingUsed(false); return; }
      const { data } = await supabase
        .from("free_video_uses")
        .select("template_id")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (data) setUsedFreeId(data.template_id);
      setCheckingUsed(false);
    })();
  }, []);

  const getToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token;
  };

  // ── Aplicar marca de agua al video (canvas overlay) ──────────────────────
  // Descarga el video, dibuja overlay en canvas frame por frame
  // NOTA: Por limitaciones del browser, retornamos la URL directa con
  // un overlay visual en el player — el watermark real se aplica en el backend.
  // Aquí solo mostramos el video con overlay CSS visible.
  const applyWatermarkOverlay = (url) => {
    // La marca de agua real la aplica el backend.
    // En el frontend mostramos el video con overlay CSS encima.
    setWatermarked(url);
  };

  // ── Generar video ────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!faceFile || !gender || step !== "idle") return;
    setStep("submitting"); setErrorMsg(""); setVideoUrl(null); setWatermarked(null);
    try {
      const token   = await getToken();
      const faceB64 = await fileToBase64(faceFile);
      const prompt  = dialogLang === "es" ? tmpl.promptEs : tmpl.promptEn;
      const genderedPrompt = gender === "female"
        ? prompt.replace(/\b(a person|person)\b/g, "a woman")
        : prompt.replace(/\b(a person|person)\b/g, "a man");

      const res = await fetch("/api/free-template/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ templateId: selectedId, faceBase64: faceB64, gender }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Error al enviar");
      setTaskId(json.taskId);
      setStep("polling");
      setPollCount(0);
    } catch (e) {
      setErrorMsg(e.message);
      setStep("error");
    }
  };

  // ── Polling ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (step !== "polling" || !taskId) return;
    const iv = setInterval(async () => {
      try {
        const token = await getToken();
        const res   = await fetch("/api/free-template/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ taskId, templateId: selectedId }),
        });
        const json = await res.json();
        setPollCount((c) => c + 1);
        if ((json.status === "completed" || json.status === "succeed") && json.videoUrl) {
          setVideoUrl(json.videoUrl);
          applyWatermarkOverlay(json.videoUrl);
          setUsedFreeId(selectedId);
          setStep("done");
          clearInterval(iv);
        } else if (json.status === "failed" || json.status === "error") {
          throw new Error(json.error || "La generación falló");
        }
      } catch (e) {
        setErrorMsg(e.message);
        setStep("error");
        clearInterval(iv);
      }
    }, 6000);
    return () => clearInterval(iv);
  }, [step, taskId]);

  const resetToGallery = () => {
    setView("gallery"); setSelectedId(null); setGender(null);
    setFaceFile(null); setFacePreview(null);
    setStep("idle"); setTaskId(null); setVideoUrl(null);
    setWatermarked(null); setErrorMsg("");
  };

  const STYLES = `
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800;900&family=DM+Sans:wght@300;400;500&display=swap');
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
  `;

  const hasUsedFree = !!usedFreeId;

  // ── GALLERY ───────────────────────────────────────────────────────────────
  if (view === "gallery") return (
    <div style={{ fontFamily: "'DM Sans',sans-serif", color: "#fff", paddingBottom: 60 }}>
      <style>{STYLES}</style>

      {/* Header */}
      <div style={{ padding: "24px 20px 0" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,90,0,0.12)", border: "1px solid rgba(255,90,0,0.25)", borderRadius: 100, padding: "6px 16px", marginBottom: 14 }}>
          <span style={{ fontSize: 14 }}>🎁</span>
          <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 12, color: "#ff5a00", letterSpacing: 0.5 }}>
            {lang === "es" ? "1 VIDEO GRATIS · SIN TARJETA" : "1 FREE VIDEO · NO CARD NEEDED"}
          </span>
        </div>
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 22, fontWeight: 900, lineHeight: 1.2, marginBottom: 6 }}>
          {lang === "es" ? "Ponté en una escena de IA" : "Put yourself in an AI scene"}
        </div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
          {lang === "es"
            ? "Sube tu foto · elige tu plantilla · genera 5 segundos gratis"
            : "Upload your photo · choose your template · generate 5 free seconds"}
        </div>
      </div>

      {/* Aviso si ya usó gratis */}
      {hasUsedFree && !checkingUsed && (
        <div style={{ margin: "16px 20px 0", background: "rgba(255,179,0,0.08)", border: "1px solid rgba(255,179,0,0.25)", borderRadius: 14, padding: "14px 16px" }}>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 800, color: "#ffb300", marginBottom: 4 }}>
            ✅ {lang === "es" ? "Ya generaste tu video gratis" : "You already generated your free video"}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.6, marginBottom: 12 }}>
            {lang === "es"
              ? "¿Te gustó? Desbloquea videos sin marca de agua con las plantillas épicas."
              : "Did you like it? Unlock watermark-free videos with epic templates."}
          </div>
          <button onClick={onUpgrade} style={{ background: "linear-gradient(135deg,#ff5a00,#ffb300)", border: "none", borderRadius: 10, color: "#000", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 12, padding: "10px 20px", cursor: "pointer" }}>
            🚀 {lang === "es" ? "Ver plantillas épicas" : "See epic templates"}
          </button>
        </div>
      )}

      {/* Grid de plantillas */}
      {checkingUsed ? (
        <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.3)", fontSize: 13 }}>...</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, padding: "16px 20px 0" }}>
          {FREE_TEMPLATES.map((t) => (
            <FreeCard
              key={t.id}
              tmpl={t}
              lang={lang}
              used={hasUsedFree}
              onClick={() => { setSelectedId(t.id); setView("generate"); }}
            />
          ))}
        </div>
      )}

      <div style={{ padding: "12px 20px 0", fontSize: 10, color: "rgba(255,255,255,0.2)", textAlign: "center", lineHeight: 1.6 }}>
        {lang === "es"
          ? "5 segundos · Marca de agua isabelaos.com · Solo 1 video gratis por usuario"
          : "5 seconds · isabelaos.com watermark · Only 1 free video per user"}
      </div>
    </div>
  );

  // ── GENERATE VIEW ─────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif", color: "#fff", paddingBottom: 80 }}>
      <style>{STYLES}</style>

      {/* Header */}
      <div style={{ padding: "20px 20px 0", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={resetToGallery} style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "8px 14px", color: "#fff", cursor: "pointer", fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 12 }}>
          ← {lang === "es" ? "Volver" : "Back"}
        </button>
        <div style={{ flex: 1, fontFamily: "'Syne',sans-serif", fontSize: 15, fontWeight: 800 }}>
          {tmpl?.emoji} {tmpl?.label[lang]}
        </div>
        <div style={{ background: "rgba(255,90,0,0.15)", border: "1px solid rgba(255,90,0,0.3)", borderRadius: 8, padding: "4px 10px", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 10, color: "#ff5a00" }}>
          🎁 FREE
        </div>
      </div>

      {/* Info marca de agua */}
      <div style={{ margin: "14px 20px 0", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "12px 14px" }}>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>
          🎬 {lang === "es"
            ? "Video de 5 segundos gratis · Incluye marca de agua · Regístrate para videos sin marca"
            : "Free 5-second video · Includes watermark · Register for watermark-free videos"}
        </div>
      </div>

      {/* Step 1: Género */}
      <div style={{ padding: "20px 20px 0" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>
          1 · {lang === "es" ? "¿Eres hombre o mujer?" : "Are you a man or a woman?"}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {[
            { value: "female", icon: "👩", label: { es: "Mujer", en: "Woman" } },
            { value: "male",   icon: "👨", label: { es: "Hombre", en: "Man" } },
          ].map((g) => (
            <div key={g.value} onClick={() => setGender(g.value)} style={{
              flex: 1, border: `1.5px solid ${gender === g.value ? accent : "rgba(255,255,255,0.1)"}`,
              borderRadius: 14, padding: "14px 10px", cursor: "pointer", textAlign: "center",
              background: gender === g.value ? `${accent}18` : "rgba(255,255,255,0.03)", transition: "all 0.2s",
            }}>
              <div style={{ fontSize: 28, marginBottom: 4 }}>{g.icon}</div>
              <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 13 }}>{g.label[lang]}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Step 2: Foto */}
      {gender && (
        <div style={{ padding: "20px 20px 0" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>
            2 · {lang === "es" ? "Sube tu foto de rostro" : "Upload your face photo"}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "10px 12px", marginBottom: 12, lineHeight: 1.6 }}>
            📌 {lang === "es"
              ? "1 foto clara de frente · Sin lentes · Sin filtros · Buena luz · Fondo simple"
              : "1 clear front photo · No glasses · No filters · Good lighting · Simple background"}
          </div>
          <UploadZone
            label={lang === "es" ? "Tu foto de rostro" : "Your face photo"}
            hint={lang === "es" ? "Mirando a la cámara · Buena iluminación" : "Looking at camera · Good lighting"}
            onChange={(f) => { setFaceFile(f); setFacePreview(URL.createObjectURL(f)); }}
            preview={facePreview}
            accent={accent}
          />
        </div>
      )}

      {/* Step 3: Idioma del diálogo */}
      {gender && faceFile && (
        <div style={{ padding: "20px 20px 0" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>
            3 · {lang === "es" ? "Idioma del video" : "Video language"}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {[
              { value: "es", flag: "🇪🇸", label: { es: "Español", en: "Spanish" } },
              { value: "en", flag: "🇺🇸", label: { es: "Inglés",  en: "English" } },
            ].map((o) => (
              <div key={o.value} onClick={() => setDialogLang(o.value)} style={{
                flex: 1, border: `1.5px solid ${dialogLang === o.value ? accent : "rgba(255,255,255,0.1)"}`,
                borderRadius: 12, padding: "12px", cursor: "pointer", textAlign: "center",
                background: dialogLang === o.value ? `${accent}14` : "rgba(255,255,255,0.03)", transition: "all 0.2s",
              }}>
                <div style={{ fontSize: 22, marginBottom: 4 }}>{o.flag}</div>
                <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 12 }}>{o.label[lang]}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {errorMsg && (
        <div style={{ margin: "14px 20px 0", background: "rgba(255,60,60,0.08)", border: "1px solid rgba(255,60,60,0.25)", borderRadius: 12, padding: "12px 14px", fontSize: 12, color: "#ff8080", lineHeight: 1.5 }}>
          ⚠️ {errorMsg}
          <button onClick={() => { setStep("idle"); setErrorMsg(""); }} style={{ marginLeft: 10, background: "none", border: "1px solid rgba(255,80,80,0.4)", color: "#ff8080", borderRadius: 6, padding: "2px 8px", fontSize: 11, cursor: "pointer" }}>
            {lang === "es" ? "Reintentar" : "Retry"}
          </button>
        </div>
      )}

      {/* Polling */}
      {step === "polling" && (
        <div style={{ margin: "14px 20px 0", background: `${accent}0a`, border: `1px solid ${accent}33`, borderRadius: 14, padding: "24px", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 10, display: "inline-block", animation: "spin 2s linear infinite" }}>🎬</div>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 15, fontWeight: 800, color: accent, marginBottom: 6 }}>
            {lang === "es" ? "Generando tu video gratis..." : "Generating your free video..."}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginBottom: 16 }}>
            {lang === "es" ? "Puede tomar 2–4 minutos · 5 segundos" : "May take 2–4 minutes · 5 seconds"} · {pollCount * 6}s
          </div>
          <div style={{ background: "rgba(255,255,255,0.07)", borderRadius: 8, height: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", background: accent, borderRadius: 8, width: `${Math.min((pollCount / 40) * 100, 90)}%`, transition: "width 0.6s" }} />
          </div>
        </div>
      )}

      {/* Done — video con watermark overlay */}
      {step === "done" && watermarked && (
        <div style={{ margin: "14px 20px 0", borderRadius: 14, overflow: "hidden", border: `1px solid ${accent}33` }}>
          {/* Video player con overlay de marca de agua */}
          <div style={{ position: "relative" }}>
            <video src={watermarked} controls playsInline style={{ width: "100%", maxHeight: 380, objectFit: "contain", background: "#000", display: "block" }} />
            {/* Overlay marca de agua visual */}
            <div style={{
              position: "absolute", bottom: 48, left: 0, right: 0,
              display: "flex", justifyContent: "center", pointerEvents: "none",
            }}>
              <div style={{
                background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
                border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8,
                padding: "6px 16px", fontFamily: "'Syne',sans-serif",
                fontWeight: 800, fontSize: 12, color: "rgba(255,255,255,0.85)",
                letterSpacing: 0.5,
              }}>
                isabelaos.com · Register Now
              </div>
            </div>
          </div>

          {/* CTA quitar marca de agua */}
          <div style={{ padding: "16px", background: "rgba(255,179,0,0.06)", borderTop: `1px solid rgba(255,179,0,0.15)` }}>
            <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 800, color: "#ffb300", marginBottom: 4 }}>
              🌟 {lang === "es" ? "¿Te gustó? Quita la marca de agua" : "Did you like it? Remove the watermark"}
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.6, marginBottom: 12 }}>
              {lang === "es"
                ? "Obtén videos de 15 segundos sin marca, en Cinemascope 21:9, con las plantillas épicas."
                : "Get 15-second watermark-free videos in 21:9 Cinemascope with epic templates."}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={onUpgrade} style={{ flex: 2, background: "linear-gradient(135deg,#ff5a00,#ffb300)", border: "none", borderRadius: 10, color: "#000", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 13, padding: "12px", cursor: "pointer" }}>
                🚀 {lang === "es" ? "Ver plantillas épicas" : "See epic templates"}
              </button>
              <a href={watermarked} download="isabelaos-free.mp4" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, color: "#fff", textDecoration: "none", fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 12 }}>
                ⬇️ {lang === "es" ? "Descargar" : "Download"}
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Botón generar */}
      {step !== "done" && step !== "polling" && gender && faceFile && (
        <div style={{ padding: "20px 20px 0" }}>
          <button
            onClick={handleGenerate}
            disabled={step === "submitting"}
            style={{
              width: "100%", background: step === "submitting" ? "rgba(255,255,255,0.06)" : `linear-gradient(135deg,${accent},${accent}cc)`,
              color: step === "submitting" ? "rgba(255,255,255,0.2)" : "#000",
              border: "none", borderRadius: 14, padding: "18px",
              fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 15,
              cursor: step === "submitting" ? "not-allowed" : "pointer", transition: "all 0.2s",
            }}
          >
            {step === "submitting"
              ? (lang === "es" ? "⏳ Enviando..." : "⏳ Submitting...")
              : `🎁 ${lang === "es" ? "Generar Mi Video Gratis · 5 seg" : "Generate My Free Video · 5 sec"}`}
          </button>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", textAlign: "center", marginTop: 8 }}>
            {lang === "es" ? "Solo 1 video gratis · Incluye marca de agua" : "Only 1 free video · Includes watermark"}
          </div>
        </div>
      )}
    </div>
  );
}
