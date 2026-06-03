// src/components/UnifiedTemplatesPanel.jsx
// Panel unificado: plantillas gratis (Seedance 1.5 Pro) + plantillas épicas (Seedance 2.0)
// Las 3 gratis → badge FREE, 5 segundos, marca de agua
// Las 4 épicas → precio $5 USD, botón de pago directo (BuyJadesModal)

import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { BuyJadesModal } from "./BuyJadesModal";

// ── Plantillas GRATIS ─────────────────────────────────────────────────────────
const FREE_TEMPLATES = [
  {
    id: "free-1",
    free: true,
    emoji: "✝️",
    label:       { es: "The Day I Saw Him", en: "The Day I Saw Him" },
    tag:         { es: "GRATIS", en: "FREE" },
    tagColor:    "#ff5a00",
    description: { es: "Aparece en Jerusalén bíblica mientras presencias la flagelación de Jesús. Cinematic. 5 segundos.", en: "Appear in biblical Jerusalem witnessing the flagellation of Jesus. Cinematic. 5 seconds." },
    video:       "/gallery/free-template-1.mp4",
    accent:      "#ff5a00",
    duration:    "5s",
    model:       "Seedance 1.5 Pro",
  },
  {
    id: "free-2",
    free: true,
    emoji: "✨",
    label:       { es: "Plantilla Gratis 2", en: "Free Template 2" },
    tag:         { es: "GRATIS", en: "FREE" },
    tagColor:    "#ff5a00",
    description: { es: "Escena dramática con efectos de luz y ambiente cinematográfico. 5 segundos.", en: "Dramatic scene with light effects and cinematic atmosphere. 5 seconds." },
    video:       "/gallery/free-template-2.mp4",
    accent:      "#ff5a00",
    duration:    "5s",
    model:       "Seedance 1.5 Pro",
  },
  {
    id: "free-3",
    free: true,
    emoji: "🎬",
    label:       { es: "Plantilla Gratis 3", en: "Free Template 3" },
    tag:         { es: "GRATIS", en: "FREE" },
    tagColor:    "#ff5a00",
    description: { es: "Video de estilo fashion editorial con tu propio rostro. 5 segundos.", en: "Fashion editorial style video with your own face. 5 seconds." },
    video:       "/gallery/free-template-3.mp4",
    accent:      "#ff5a00",
    duration:    "5s",
    model:       "Seedance 1.5 Pro",
  },
];

// ── Plantillas ÉPICAS ─────────────────────────────────────────────────────────
const EPIC_TEMPLATES = [
  {
    id: "divineLight",
    free: false,
    emoji: "⚡",
    label:       { es: "Confrontación Divina", en: "Divine Confrontation" },
    tag:         { es: "ÉPICO", en: "EPIC" },
    tagColor:    "#4A90E2",
    description: { es: "Enfrenta a Dios como ser de luz. Tormenta. Tsunami. Redención. 15 segundos.", en: "Confront God as a being of light. Storm. Tsunami. Redemption. 15 seconds." },
    video:       "/gallery/divine-light.mp4",
    accent:      "#4A90E2",
    price:       5,
    duration:    "15s",
    model:       "Seedance 2.0",
    hasDialogLang: true,
  },
  {
    id: "divineHuman",
    free: false,
    emoji: "🙏",
    label:       { es: "Dios Entre Nosotros", en: "God Among Us" },
    tag:         { es: "VIRAL", en: "VIRAL" },
    tagColor:    "#E8B84B",
    description: { es: "Dios como ser humano real. Túnica blanca. La misma tormenta. 15 segundos.", en: "God as a real human. White robe. Same storm. 15 seconds." },
    video:       "/gallery/divine-human.mp4",
    accent:      "#E8B84B",
    price:       5,
    duration:    "15s",
    model:       "Seedance 2.0",
    hasDialogLang: true,
  },
  {
    id: "coupleDisaster",
    free: false,
    emoji: "💔",
    label:       { es: "La Última Pelea", en: "The Last Fight" },
    tag:         { es: "DRAMA", en: "DRAMA" },
    tagColor:    "#E05C8A",
    description: { es: "Pareja en acantilado. Meteorito. Tsunami los separa. 15 segundos.", en: "Couple on cliff. Meteor. Tsunami separates them. 15 seconds." },
    video:       "/gallery/couple-disaster.mp4",
    accent:      "#E05C8A",
    price:       5,
    duration:    "15s",
    model:       "Seedance 2.0",
    hasDialogLang: true,
  },
  {
    id: "victoriasSecret",
    free: false,
    emoji: "👙",
    label:       { es: "Victoria's Secret", en: "Victoria's Secret" },
    tag:         { es: "LUJO", en: "LUXURY" },
    tagColor:    "#C8A96E",
    description: { es: "Campaña de moda de lujo. Playa tropical. Solo mujer. 15 segundos.", en: "Luxury fashion campaign. Tropical beach. Women only. 15 seconds." },
    video:       "/gallery/victorias-secret.mp4",
    accent:      "#C8A96E",
    price:       5,
    duration:    "15s",
    model:       "Seedance 2.0",
    hasDialogLang: false,
  },
];

const ALL_TEMPLATES = [...FREE_TEMPLATES, ...EPIC_TEMPLATES];

// ── Compresión imagen ─────────────────────────────────────────────────────────
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

// ── Upload Zone ───────────────────────────────────────────────────────────────
function UploadZone({ label, hint, onChange, preview, accent, height = 180 }) {
  const ref  = useRef();
  const [drag, setDrag] = useState(false);
  const onDrop = useCallback((e) => {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f?.type.startsWith("image/")) onChange(f);
  }, [onChange]);
  return (
    <div onClick={() => ref.current.click()}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
      style={{ border: `2px dashed ${drag ? accent : "rgba(255,255,255,0.15)"}`, borderRadius: 16, cursor: "pointer", overflow: "hidden", background: drag ? `${accent}18` : "rgba(255,255,255,0.03)", transition: "all 0.2s", minHeight: height, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative" }}>
      <input ref={ref} type="file" accept="image/*" style={{ display: "none" }} onChange={e => e.target.files[0] && onChange(e.target.files[0])} />
      {preview ? (
        <>
          <img src={preview} alt="" style={{ width: "100%", height, objectFit: "cover", display: "block" }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "8px 12px", background: "linear-gradient(transparent,rgba(0,0,0,0.85))", fontSize: 11, color: accent, fontFamily: "'Syne',sans-serif", fontWeight: 700 }}>✓ {label}</div>
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

// ── Template Card — grande como en imagen de referencia ───────────────────────
function TemplateCard({ tmpl, lang, onClick, usedFree, hasJades }) {
  const vRef = useRef();
  const isEs = lang === "es";
  const locked = tmpl.free && usedFree;

  return (
    <div
      onClick={() => !locked && onClick()}
      onMouseEnter={() => vRef.current?.play()}
      onMouseLeave={() => { if (vRef.current) { vRef.current.pause(); vRef.current.currentTime = 0; } }}
      onTouchStart={() => vRef.current?.play()}
      onTouchEnd={() => { if (vRef.current) { vRef.current.pause(); vRef.current.currentTime = 0; } }}
      style={{
        position: "relative", borderRadius: 20, overflow: "hidden",
        cursor: locked ? "not-allowed" : "pointer",
        aspectRatio: "9/16",
        background: "#080808",
        border: `1px solid ${tmpl.accent}44`,
        transition: "transform 0.25s, box-shadow 0.25s",
        opacity: locked ? 0.55 : 1,
      }}
      onMouseOver={e => { if (!locked) { e.currentTarget.style.transform = "scale(1.03)"; e.currentTarget.style.boxShadow = `0 24px 60px ${tmpl.accent}55`; } }}
      onMouseOut={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "none"; }}
    >
      <video ref={vRef} src={tmpl.video} muted playsInline loop preload="auto"
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />

      {/* Gradient overlay */}
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(0deg,rgba(0,0,0,0.95) 0%,rgba(0,0,0,0.15) 55%,transparent 100%)" }} />

      {/* Badge tipo */}
      <div style={{ position: "absolute", top: 12, left: 12, background: tmpl.tagColor, color: "#000", fontFamily: "'Syne',sans-serif", fontWeight: 900, fontSize: 10, letterSpacing: 2, padding: "4px 10px", borderRadius: 6 }}>
        {locked ? "✓ USADO" : tmpl.tag[lang]}
      </div>

      {/* Badge modelo */}
      <div style={{ position: "absolute", top: 12, right: 12, background: "rgba(0,0,0,0.7)", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.6)", fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 9, letterSpacing: 1, padding: "3px 8px", borderRadius: 5 }}>
        {tmpl.model}
      </div>

      {/* Play icon cuando no está reproduciendo */}
      <div style={{ position: "absolute", top: "40%", left: "50%", transform: "translate(-50%,-50%)", pointerEvents: "none" }}>
        <div style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>▶</div>
      </div>

      {/* Contenido inferior */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "16px 14px 14px" }}>
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 16, fontWeight: 800, marginBottom: 4, lineHeight: 1.2, color: "#fff" }}>
          {tmpl.emoji} {tmpl.label[lang]}
        </div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", lineHeight: 1.5, marginBottom: 10 }}>
          {tmpl.description[lang]}
        </div>

        {/* Duración */}
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginBottom: 10 }}>
          ⏱ {tmpl.duration} · {tmpl.free ? (isEs ? "Marca de agua" : "Watermark") : (isEs ? "Sin marca de agua" : "No watermark")}
        </div>

        {/* CTA */}
        {tmpl.free ? (
          !locked ? (
            <div style={{ background: tmpl.accent, borderRadius: 10, padding: "10px", textAlign: "center", fontFamily: "'Syne',sans-serif", fontWeight: 900, fontSize: 12, color: "#000" }}>
              🎁 {isEs ? "Crear GRATIS" : "Create FREE"}
            </div>
          ) : (
            <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 10, padding: "10px", textAlign: "center", fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
              ✓ {isEs ? "Ya generaste este video" : "Already generated"}
            </div>
          )
        ) : (
          <div style={{ background: `linear-gradient(135deg,${tmpl.accent},${tmpl.accent}cc)`, borderRadius: 10, padding: "10px", textAlign: "center", fontFamily: "'Syne',sans-serif", fontWeight: 900, fontSize: 13, color: "#000" }}>
            💳 $5 USD · {isEs ? "Crear ahora" : "Create now"}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Generate View — reutilizable para free y épicas ───────────────────────────
function GenerateView({ tmpl, lang, userJades, onJadesUpdate, onBack, usedFreeId, setUsedFreeId, onOpenBuy }) {
  const isEs = lang === "es";
  const isFree = tmpl.free;
  const accent = tmpl.accent;

  const [gender,      setGender]      = useState(null);
  const [dialogLang,  setDialogLang]  = useState("es");
  const [faceFile,    setFaceFile]    = useState(null);
  const [facePreview, setFacePreview] = useState(null);
  const [profileFile,    setProfileFile]    = useState(null);
  const [profilePreview, setProfilePreview] = useState(null);
  const [genderVariant,  setGenderVariant]  = useState(null); // solo épicas con couple
  const [step,        setStep]        = useState("idle");
  const [taskId,      setTaskId]      = useState(null);
  const [pollCount,   setPollCount]   = useState(0);
  const [videoUrl,    setVideoUrl]    = useState(null);
  const [errorMsg,    setErrorMsg]    = useState("");

  const jadeCost = 30; // épicas 480p

  const getToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token;
  };

  // Para épicas: verificar jades
  const canGenerate = isFree
    ? (faceFile && gender && step === "idle")
    : (faceFile && gender && step === "idle" && userJades >= jadeCost);

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setStep("submitting"); setErrorMsg(""); setVideoUrl(null);
    try {
      const token   = await getToken();
      const faceB64 = await fileToBase64(faceFile);
      const endpoint = isFree ? "/api/free-template/submit" : "/api/templates/submit-video";

      let body;
      if (isFree) {
        body = { templateId: tmpl.id, faceBase64: faceB64, gender };
      } else {
        // Subir imagen primero
        const uploadRes = await fetch("/api/templates/upload-image", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ imageBase64: faceB64, mimeType: faceFile.type, label: "face1" }),
        });
        const uploadJson = await uploadRes.json();
        if (!uploadJson.ok) throw new Error(uploadJson.error || "Error subiendo imagen");
        body = {
          templateId: tmpl.id,
          lang: dialogLang,
          quality: "480",
          genderVariant: gender,
          faceUrl: uploadJson.url,
        };
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Error al enviar");

      setTaskId(json.taskId);
      if (!isFree && json.jadeCost) onJadesUpdate?.(userJades - json.jadeCost);
      setStep("polling");
      setPollCount(0);
    } catch (e) {
      setErrorMsg(e.message);
      setStep("error");
    }
  };

  useEffect(() => {
    if (step !== "polling" || !taskId) return;
    const pollEndpoint = isFree ? "/api/free-template/poll" : "/api/templates/poll-video";
    const iv = setInterval(async () => {
      try {
        const token = await getToken();
        const res   = await fetch(pollEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ taskId, templateId: tmpl.id }),
        });
        const json = await res.json();
        setPollCount(c => c + 1);
        if ((json.status === "completed" || json.status === "succeed") && json.videoUrl) {
          setVideoUrl(json.videoUrl);
          if (isFree) setUsedFreeId(tmpl.id);
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

  const STYLES = `@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800;900&family=DM+Sans:wght@300;400;500&display=swap'); @keyframes spin { to { transform: rotate(360deg); } }`;

  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif", color: "#fff", paddingBottom: 80 }}>
      <style>{STYLES}</style>

      {/* Header */}
      <div style={{ padding: "20px 20px 0", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "8px 14px", color: "#fff", cursor: "pointer", fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 12 }}>
          ← {isEs ? "Volver" : "Back"}
        </button>
        <div style={{ flex: 1, fontFamily: "'Syne',sans-serif", fontSize: 15, fontWeight: 800 }}>{tmpl.emoji} {tmpl.label[lang]}</div>
        <div style={{ background: isFree ? "rgba(255,90,0,0.15)" : `${accent}22`, border: `1px solid ${isFree ? "rgba(255,90,0,0.3)" : accent + "44"}`, borderRadius: 8, padding: "4px 10px", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 10, color: isFree ? "#ff5a00" : accent }}>
          {isFree ? "🎁 FREE" : `💳 $5 USD`}
        </div>
      </div>

      {/* Info */}
      <div style={{ margin: "14px 20px 0", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "12px 14px" }}>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>
          🎬 {isFree
            ? (isEs ? "Video de 5 segundos · Incluye marca de agua · Solo 1 gratis por usuario" : "5-second video · Includes watermark · Only 1 free per user")
            : (isEs ? `Video de 15 segundos · Sin marca de agua · ${jadeCost} Jades` : `15-second video · No watermark · ${jadeCost} Jades`)}
        </div>
      </div>

      {/* Si no tiene jades para épica */}
      {!isFree && userJades < jadeCost && (
        <div style={{ margin: "14px 20px 0", background: "rgba(255,90,0,0.08)", border: "1px solid rgba(255,90,0,0.25)", borderRadius: 12, padding: "14px 16px" }}>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 800, color: "#ff5a00", marginBottom: 6 }}>
            💎 {isEs ? `Necesitas ${jadeCost} Jades · Tienes ${userJades}` : `Need ${jadeCost} Jades · You have ${userJades}`}
          </div>
          <button onClick={onOpenBuy} style={{ background: "linear-gradient(135deg,#ff5a00,#ffb300)", border: "none", borderRadius: 10, color: "#000", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 12, padding: "10px 20px", cursor: "pointer" }}>
            💳 {isEs ? "Comprar Jades" : "Buy Jades"}
          </button>
        </div>
      )}

      {/* Género */}
      <div style={{ padding: "20px 20px 0" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>
          1 · {isEs ? "¿Eres hombre o mujer?" : "Are you a man or a woman?"}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {[{ value: "female", icon: "👩", label: { es: "Mujer", en: "Woman" } }, { value: "male", icon: "👨", label: { es: "Hombre", en: "Man" } }].map(g => (
            <div key={g.value} onClick={() => setGender(g.value)} style={{ flex: 1, border: `1.5px solid ${gender === g.value ? accent : "rgba(255,255,255,0.1)"}`, borderRadius: 14, padding: "14px 10px", cursor: "pointer", textAlign: "center", background: gender === g.value ? `${accent}18` : "rgba(255,255,255,0.03)", transition: "all 0.2s" }}>
              <div style={{ fontSize: 28, marginBottom: 4 }}>{g.icon}</div>
              <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 13 }}>{g.label[lang]}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Foto */}
      {gender && (
        <div style={{ padding: "20px 20px 0" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>
            2 · {isEs ? "Sube tu foto de rostro" : "Upload your face photo"}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "10px 12px", marginBottom: 12, lineHeight: 1.6 }}>
            📌 {isEs ? "1 foto clara de frente · Sin lentes · Sin filtros · Buena luz" : "1 clear front photo · No glasses · No filters · Good lighting"}
          </div>
          <UploadZone
            label={isEs ? "Tu foto de rostro" : "Your face photo"}
            hint={isEs ? "Mirando a la cámara · Buena iluminación" : "Looking at camera · Good lighting"}
            onChange={f => { setFaceFile(f); setFacePreview(URL.createObjectURL(f)); }}
            preview={facePreview}
            accent={accent}
          />
        </div>
      )}

      {/* Idioma diálogo */}
      {gender && faceFile && tmpl.hasDialogLang && (
        <div style={{ padding: "20px 20px 0" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>
            3 · {isEs ? "Idioma del video" : "Video language"}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {[{ value: "es", flag: "🇪🇸", label: { es: "Español", en: "Spanish" } }, { value: "en", flag: "🇺🇸", label: { es: "Inglés", en: "English" } }].map(o => (
              <div key={o.value} onClick={() => setDialogLang(o.value)} style={{ flex: 1, border: `1.5px solid ${dialogLang === o.value ? accent : "rgba(255,255,255,0.1)"}`, borderRadius: 12, padding: "12px", cursor: "pointer", textAlign: "center", background: dialogLang === o.value ? `${accent}14` : "rgba(255,255,255,0.03)", transition: "all 0.2s" }}>
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
            {isEs ? "Reintentar" : "Retry"}
          </button>
        </div>
      )}

      {/* Polling */}
      {step === "polling" && (
        <div style={{ margin: "14px 20px 0", background: `${accent}0a`, border: `1px solid ${accent}33`, borderRadius: 14, padding: "24px", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 10, display: "inline-block", animation: "spin 2s linear infinite" }}>🎬</div>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 15, fontWeight: 800, color: accent, marginBottom: 6 }}>
            {isEs ? "Generando tu video..." : "Generating your video..."}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginBottom: 16 }}>
            {isEs ? (isFree ? "2–4 minutos · 5 segundos" : "3–8 minutos · 15 segundos") : (isFree ? "2–4 minutes · 5 seconds" : "3–8 minutes · 15 seconds")} · {pollCount * 6}s
          </div>
          <div style={{ background: "rgba(255,255,255,0.07)", borderRadius: 8, height: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", background: accent, borderRadius: 8, width: `${Math.min((pollCount / (isFree ? 40 : 80)) * 100, 90)}%`, transition: "width 0.6s" }} />
          </div>
        </div>
      )}

      {/* Done */}
      {step === "done" && videoUrl && (
        <div style={{ margin: "14px 20px 0", borderRadius: 14, overflow: "hidden", border: `1px solid ${accent}33` }}>
          <div style={{ position: "relative" }}>
            <video src={videoUrl} controls playsInline style={{ width: "100%", maxHeight: 400, objectFit: "contain", background: "#000", display: "block" }} />
            {/* Watermark overlay para free */}
            {isFree && (
              <div style={{ position: "absolute", bottom: 52, left: 0, right: 0, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
                <div style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "6px 16px", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 12, color: "rgba(255,255,255,0.9)", letterSpacing: 0.5 }}>
                  isabelaos.com · Register Now
                </div>
              </div>
            )}
          </div>

          {isFree && (
            <div style={{ padding: "16px", background: "rgba(255,179,0,0.06)", borderTop: "1px solid rgba(255,179,0,0.15)" }}>
              <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 800, color: "#ffb300", marginBottom: 4 }}>
                🌟 {isEs ? "¿Te gustó? Quita la marca de agua" : "Did you like it? Remove the watermark"}
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.6, marginBottom: 12 }}>
                {isEs ? "Obtén videos de 15 segundos sin marca con las plantillas épicas por $5 USD." : "Get 15-second watermark-free videos with epic templates for $5 USD."}
              </div>
              <button onClick={onBack} style={{ background: "linear-gradient(135deg,#ff5a00,#ffb300)", border: "none", borderRadius: 10, color: "#000", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 12, padding: "10px 20px", cursor: "pointer" }}>
                ⚡ {isEs ? "Ver plantillas épicas ($5)" : "See epic templates ($5)"}
              </button>
            </div>
          )}

          <div style={{ padding: "14px 16px", display: "flex", gap: 10 }}>
            <a href={videoUrl} download="isabelaos-video.mp4" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: accent, color: "#000", padding: "11px", borderRadius: 10, textDecoration: "none", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 13 }}>
              ⬇️ {isEs ? "Descargar" : "Download"}
            </a>
            <button onClick={onBack} style={{ flex: 1, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", padding: "11px", borderRadius: 10, cursor: "pointer", fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 13 }}>
              {isEs ? "✨ Otra plantilla" : "✨ Another template"}
            </button>
          </div>
        </div>
      )}

      {/* Botón generar */}
      {step !== "done" && step !== "polling" && gender && faceFile && (
        <div style={{ padding: "20px 20px 0" }}>
          <button onClick={handleGenerate} disabled={!canGenerate}
            style={{ width: "100%", background: canGenerate ? `linear-gradient(135deg,${accent},${accent}cc)` : "rgba(255,255,255,0.06)", color: canGenerate ? "#000" : "rgba(255,255,255,0.2)", border: "none", borderRadius: 14, padding: "18px", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 15, cursor: canGenerate ? "pointer" : "not-allowed", transition: "all 0.2s" }}>
            {step === "submitting"
              ? (isEs ? "⏳ Enviando..." : "⏳ Submitting...")
              : isFree
                ? `🎁 ${isEs ? "Generar Video Gratis · 5 seg" : "Generate Free Video · 5 sec"}`
                : `⚡ ${isEs ? `Generar Video · 15 seg · ${jadeCost} 💎` : `Generate Video · 15 sec · ${jadeCost} 💎`}`}
          </button>
          {!isFree && userJades < jadeCost && (
            <button onClick={onOpenBuy} style={{ width: "100%", marginTop: 8, background: "linear-gradient(135deg,#ff5a00,#ffb300)", border: "none", borderRadius: 12, color: "#000", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 14, padding: "14px", cursor: "pointer" }}>
              💳 {isEs ? `Comprar Jades — $5 USD` : `Buy Jades — $5 USD`}
            </button>
          )}
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", textAlign: "center", marginTop: 8 }}>
            {isFree
              ? (isEs ? "Solo 1 video gratis · Incluye marca de agua" : "Only 1 free video · Includes watermark")
              : (isEs ? `${jadeCost} Jades · Sin marca de agua · 21:9 Cinemascope` : `${jadeCost} Jades · No watermark · 21:9 Cinemascope`)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── MAIN PANEL ────────────────────────────────────────────────────────────────
export default function UnifiedTemplatesPanel({ lang = "es", userJades = 0, onJadesUpdate }) {
  const isEs = lang === "es";
  const [view,        setView]        = useState("gallery");
  const [selectedId,  setSelectedId]  = useState(null);
  const [usedFreeId,  setUsedFreeId]  = useState(null);
  const [checkingUsed, setCheckingUsed] = useState(true);
  const [buyOpen,     setBuyOpen]     = useState(false);

  const STYLES = `@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800;900&family=DM+Sans:wght@300;400;500&display=swap');`;

  // Verificar uso de gratis
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

  const tmpl = ALL_TEMPLATES.find(t => t.id === selectedId);

  const handleSelect = (id) => {
    const t = ALL_TEMPLATES.find(x => x.id === id);
    // Si es épica y no tiene jades → abrir BuyJadesModal
    if (!t.free && userJades < 30) {
      setBuyOpen(true);
      return;
    }
    setSelectedId(id);
    setView("generate");
  };

  if (view === "generate" && tmpl) {
    return (
      <>
        <style>{STYLES}</style>
        <BuyJadesModal open={buyOpen} onClose={() => setBuyOpen(false)} userId={null} onSuccess={() => { setBuyOpen(false); onJadesUpdate?.(); }} lang={lang} />
        <GenerateView
          tmpl={tmpl}
          lang={lang}
          userJades={userJades}
          onJadesUpdate={onJadesUpdate}
          onBack={() => setView("gallery")}
          usedFreeId={usedFreeId}
          setUsedFreeId={setUsedFreeId}
          onOpenBuy={() => setBuyOpen(true)}
        />
      </>
    );
  }

  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif", color: "#fff", paddingBottom: 60 }}>
      <style>{STYLES}</style>
      <BuyJadesModal open={buyOpen} onClose={() => setBuyOpen(false)} userId={null} onSuccess={() => { setBuyOpen(false); onJadesUpdate?.(); }} lang={lang} />

      {/* Header */}
      <div style={{ padding: "24px 20px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 22, fontWeight: 900 }}>
            🎬 {isEs ? "Plantillas de Video" : "Video Templates"}
          </div>
        </div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", lineHeight: 1.6, marginBottom: 16 }}>
          {isEs ? "Sube tu foto y aparecer en una escena cinematográfica" : "Upload your photo and appear in a cinematic scene"}
        </div>

        {/* Aviso referencia */}
        <div style={{ background: "rgba(255,200,0,0.06)", border: "1px solid rgba(255,200,0,0.2)", borderRadius: 12, padding: "12px 14px", marginBottom: 20 }}>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 11, fontWeight: 700, color: "#ffcc00", marginBottom: 3 }}>⚠️ {isEs ? "Los videos de muestra son referencias" : "Sample videos are references"}</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
            {isEs ? "La IA nunca genera dos videos exactamente iguales. Tu rostro será el protagonista." : "AI never generates two identical videos. Your face will be the protagonist."}
          </div>
        </div>

        {/* Badge gratis usados */}
        {usedFreeId && !checkingUsed && (
          <div style={{ background: "rgba(255,90,0,0.08)", border: "1px solid rgba(255,90,0,0.2)", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
            ✅ {isEs ? "Ya generaste tu video gratis. Las plantillas épicas están disponibles por $5 USD." : "You already generated your free video. Epic templates available for $5 USD."}
          </div>
        )}
      </div>

      {checkingUsed ? (
        <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.3)", fontSize: 13 }}>...</div>
      ) : (
        <>
          {/* Sección GRATIS */}
          <div style={{ padding: "0 20px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 800, color: "#ff5a00", letterSpacing: 1, textTransform: "uppercase" }}>🎁 {isEs ? "Gratis" : "Free"}</div>
              <div style={{ flex: 1, height: 1, background: "rgba(255,90,0,0.2)" }} />
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{isEs ? "5 seg · Marca de agua · 1 por usuario" : "5 sec · Watermark · 1 per user"}</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {FREE_TEMPLATES.map(t => (
                <TemplateCard key={t.id} tmpl={t} lang={lang} usedFree={!!usedFreeId} hasJades={true} onClick={() => handleSelect(t.id)} />
              ))}
            </div>
          </div>

          {/* Sección ÉPICAS */}
          <div style={{ padding: "0 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 800, color: "#C8A96E", letterSpacing: 1, textTransform: "uppercase" }}>⚡ {isEs ? "Épicas — $5 USD" : "Epic — $5 USD"}</div>
              <div style={{ flex: 1, height: 1, background: "rgba(200,169,110,0.2)" }} />
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{isEs ? "15 seg · Sin marca · Seedance 2.0" : "15 sec · No watermark · Seedance 2.0"}</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
              {EPIC_TEMPLATES.map(t => (
                <TemplateCard key={t.id} tmpl={t} lang={lang} usedFree={false} hasJades={userJades >= 30} onClick={() => handleSelect(t.id)} />
              ))}
            </div>
          </div>

          <div style={{ padding: "14px 20px 0", fontSize: 10, color: "rgba(255,255,255,0.18)", textAlign: "center" }}>
            {isEs ? "Hover para previsualizar" : "Hover to preview"}
          </div>
        </>
      )}
    </div>
  );
}
