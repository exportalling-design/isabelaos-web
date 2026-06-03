// src/components/UnifiedTemplatesPanel.jsx — v2
// Grid 3 columnas para TODOS · Todo naranja · Advertencia calidad · CTA $13

import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { BuyJadesModal } from "./BuyJadesModal";

const ACCENT = "#ff5a00";
const GOLD   = "#ffb300";

const RESPONSIVE_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800;900&family=DM+Sans:wght@300;400;500&display=swap');
  @keyframes spin{to{transform:rotate(360deg)}}

  /* Desktop — 3 columnas */
  .tmpl-grid-3   { display: grid; grid-template-columns: repeat(3,1fr); gap: 14px; }
  .tmpl-grid-epic{ display: grid; grid-template-columns: repeat(3,1fr); gap: 14px; }
  .tmpl-card     { aspect-ratio: 9/16; }

  /* Tablet — 2 columnas */
  @media(max-width:1024px){
    .tmpl-grid-3   { grid-template-columns: repeat(2,1fr) !important; gap: 12px !important; }
    .tmpl-grid-epic{ grid-template-columns: repeat(2,1fr) !important; gap: 12px !important; }
  }

  /* Mobile — 1 columna, videos grandes */
  @media(max-width:600px){
    .tmpl-grid-3   { grid-template-columns: 1fr !important; gap: 20px !important; }
    .tmpl-grid-epic{ grid-template-columns: 1fr !important; gap: 20px !important; }
    .tmpl-card     { aspect-ratio: 4/5 !important; min-height: 400px !important; }
    .tmpl-section  { padding: 0 14px 24px !important; }
    .tmpl-header   { padding: 18px 14px 12px !important; }
    .tmpl-generate { padding: 0 14px 80px !important; }
  }
`;

const FREE_TEMPLATES = [
  {
    id: "free-1", free: true,
    emoji: "✝️",
    label:       { es: "The Day I Saw Him",   en: "The Day I Saw Him" },
    tag:         { es: "GRATIS",              en: "FREE" },
    description: { es: "Aparece en Jerusalén bíblica presenciando la flagelación de Jesús. 5 segundos.", en: "Appear in biblical Jerusalem witnessing the flagellation of Jesus. 5 seconds." },
    video: "/gallery/free-template-1.mp4",
    duration: "5s", model: "Seedance 1.5 Pro",
  },
  {
    id: "free-2", free: true,
    emoji: "⚡",
    label:       { es: "Ultimate Awakening",  en: "Ultimate Awakening" },
    tag:         { es: "GRATIS",              en: "FREE" },
    description: { es: "Despiertas con un poder épico. Aura dorada. Efectos cinematográficos. 5 segundos.", en: "Awaken with epic power. Golden aura. Cinematic effects. 5 seconds." },
    video: "/gallery/free-template-2.mp4",
    duration: "5s", model: "Seedance 1.5 Pro",
  },
  {
    id: "free-3", free: true,
    emoji: "🌌",
    label:       { es: "The Chosen One",      en: "The Chosen One" },
    tag:         { es: "GRATIS",              en: "FREE" },
    description: { es: "Eres el elegido. Una metrópolis futurista se detiene ante ti. Luz divina desde el cielo. 5 segundos.", en: "You are the chosen one. A futuristic metropolis stops for you. Divine light from the sky. 5 seconds." },
    video: "/gallery/free-template-3.mp4",
    duration: "5s", model: "Seedance 1.5 Pro",
  },
];

const EPIC_TEMPLATES = [
  {
    id: "divineLight", free: false,
    emoji: "⚡",
    label:       { es: "Confrontación Divina", en: "Divine Confrontation" },
    tag:         { es: "ÉPICO",                en: "EPIC" },
    description: { es: "Enfrenta a Dios como ser de luz. Tormenta. Tsunami. Redención. 15 segundos.", en: "Confront God as a being of light. Storm. Tsunami. Redemption. 15 seconds." },
    video: "/gallery/divine-light.mp4",
    price: 5, jadeCost: 30, duration: "15s", model: "Seedance 2.0", hasDialogLang: true,
  },
  {
    id: "divineHuman", free: false,
    emoji: "🙏",
    label:       { es: "Dios Entre Nosotros", en: "God Among Us" },
    tag:         { es: "VIRAL",               en: "VIRAL" },
    description: { es: "Dios como ser humano real. Túnica blanca. La misma tormenta. 15 segundos.", en: "God as a real human. White robe. Same storm. 15 seconds." },
    video: "/gallery/divine-human.mp4",
    price: 5, jadeCost: 30, duration: "15s", model: "Seedance 2.0", hasDialogLang: true,
  },
  {
    id: "coupleDisaster", free: false,
    emoji: "💔",
    label:       { es: "La Última Pelea",     en: "The Last Fight" },
    tag:         { es: "DRAMA",               en: "DRAMA" },
    description: { es: "Pareja en acantilado. Meteorito. Tsunami los separa. 15 segundos.", en: "Couple on cliff. Meteor. Tsunami separates them. 15 seconds." },
    video: "/gallery/couple-disaster.mp4",
    price: 5, jadeCost: 30, duration: "15s", model: "Seedance 2.0", hasDialogLang: true,
  },
  {
    id: "victoriasSecret", free: false,
    emoji: "👙",
    label:       { es: "Victoria's Secret",   en: "Victoria's Secret" },
    tag:         { es: "LUJO",                en: "LUXURY" },
    description: { es: "Campaña de moda de lujo. Playa tropical. Solo mujer. 15 segundos.", en: "Luxury fashion campaign. Tropical beach. Women only. 15 seconds." },
    video: "/gallery/victorias-secret.mp4",
    price: 5, jadeCost: 30, duration: "15s", model: "Seedance 2.0", hasDialogLang: false,
  },
];

const ALL_TEMPLATES = [...FREE_TEMPLATES, ...EPIC_TEMPLATES];

function fileToBase64(file, maxSize = 800, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width  = Math.round(img.width  * scale);
        c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", quality).split(",")[1]);
      } catch (e) { URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image load failed")); };
    img.src = url;
  });
}

function UploadZone({ label, hint, onChange, preview, height = 180 }) {
  const ref  = useRef();
  const [drag, setDrag] = useState(false);
  const onDrop = useCallback(e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f?.type.startsWith("image/")) onChange(f); }, [onChange]);
  return (
    <div onClick={() => ref.current.click()} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
      style={{ border: `2px dashed ${drag ? ACCENT : "rgba(255,255,255,0.15)"}`, borderRadius: 16, cursor: "pointer", overflow: "hidden", background: drag ? "rgba(255,90,0,0.1)" : "rgba(255,255,255,0.03)", transition: "all 0.2s", minHeight: height, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative" }}>
      <input ref={ref} type="file" accept="image/*" style={{ display: "none" }} onChange={e => e.target.files[0] && onChange(e.target.files[0])} />
      {preview ? (
        <>
          <img src={preview} alt="" style={{ width: "100%", height, objectFit: "cover", display: "block" }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "8px 12px", background: "linear-gradient(transparent,rgba(0,0,0,0.85))", fontSize: 11, color: ACCENT, fontFamily: "'Syne',sans-serif", fontWeight: 700 }}>✓ {label}</div>
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

// ── Card — igual para todos, todo naranja ─────────────────────────────────────
function TemplateCard({ tmpl, lang, onClick, usedFree }) {
  const vRef = useRef();
  const isEs = lang === "es";
  const locked = tmpl.free && usedFree;

  // Autoplay siempre — mobile y desktop
  useEffect(() => {
    const v = vRef.current;
    if (!v) return;
    v.play().catch(() => {});
  }, []);

  return (
    <div
      onClick={() => !locked && onClick()}
      className="tmpl-card"
      style={{ position: "relative", borderRadius: 20, overflow: "hidden", cursor: locked ? "not-allowed" : "pointer", aspectRatio: "9/16", background: "#080808", border: "1px solid rgba(255,90,0,0.3)", transition: "transform 0.25s, box-shadow 0.25s", opacity: locked ? 0.55 : 1 }}
      onMouseOver={e => { if (!locked) { e.currentTarget.style.transform = "scale(1.02)"; e.currentTarget.style.boxShadow = "0 24px 60px rgba(255,90,0,0.4)"; } }}
      onMouseOut={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "none"; }}
    >
      <video ref={vRef} src={tmpl.video} muted playsInline loop autoPlay preload="auto" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(0deg,rgba(0,0,0,0.95) 0%,rgba(0,0,0,0.1) 55%,transparent 100%)" }} />

      {/* Badge FREE / EPIC / etc */}
      <div style={{ position: "absolute", top: 12, left: 12, background: ACCENT, color: "#000", fontFamily: "'Syne',sans-serif", fontWeight: 900, fontSize: 10, letterSpacing: 2, padding: "4px 10px", borderRadius: 6 }}>
        {locked ? "✓ USED" : tmpl.tag[lang]}
      </div>

      {/* Badge modelo */}
      <div style={{ position: "absolute", top: 12, right: 12, background: "rgba(0,0,0,0.7)", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.6)", fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 9, letterSpacing: 1, padding: "3px 8px", borderRadius: 5 }}>
        {tmpl.model}
      </div>

      {/* Play */}
      <div style={{ position: "absolute", top: "38%", left: "50%", transform: "translate(-50%,-50%)", pointerEvents: "none" }}>
        <div style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>▶</div>
      </div>

      {/* Info inferior */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "14px 12px 12px" }}>
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 15, fontWeight: 800, marginBottom: 3, lineHeight: 1.2, color: "#fff" }}>{tmpl.emoji} {tmpl.label[lang]}</div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", lineHeight: 1.5, marginBottom: 8 }}>{tmpl.description[lang]}</div>
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginBottom: 10 }}>
          ⏱ {tmpl.duration} · {tmpl.free ? (isEs ? "Marca de agua" : "Watermark") : (isEs ? "Sin marca de agua" : "No watermark")}
        </div>

        {/* CTA — todo naranja */}
        {locked ? (
          <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 10, padding: "9px", textAlign: "center", fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
            ✓ {isEs ? "Ya generado" : "Already generated"}
          </div>
        ) : tmpl.free ? (
          <div style={{ background: `linear-gradient(135deg,${ACCENT},${GOLD})`, borderRadius: 10, padding: "10px", textAlign: "center", fontFamily: "'Syne',sans-serif", fontWeight: 900, fontSize: 12, color: "#000" }}>
            🎁 {isEs ? "Crear GRATIS" : "Create FREE"}
          </div>
        ) : (
          <div style={{ background: `linear-gradient(135deg,${ACCENT},${GOLD})`, borderRadius: 10, padding: "10px", textAlign: "center", fontFamily: "'Syne',sans-serif", fontWeight: 900, fontSize: 12, color: "#000" }}>
            💳 $5 USD · {isEs ? "Crear ahora" : "Create now"}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Generate View ─────────────────────────────────────────────────────────────
function GenerateView({ tmpl, lang, userJades, onJadesUpdate, onBack, setUsedFreeId, onOpenBuy }) {
  const isEs    = lang === "es";
  const isFree  = tmpl.free;
  const jadeCost = tmpl.jadeCost || 30;

  const [gender,      setGender]      = useState(null);
  const [dialogLang,  setDialogLang]  = useState("es");
  const [faceFile,    setFaceFile]    = useState(null);
  const [facePreview, setFacePreview] = useState(null);
  const [step,        setStep]        = useState("idle");
  const [taskId,      setTaskId]      = useState(null);
  const [pollCount,   setPollCount]   = useState(0);
  const [videoUrl,    setVideoUrl]    = useState(null);
  const [errorMsg,    setErrorMsg]    = useState("");

  const canGenerate = faceFile && gender && step === "idle" && (isFree || userJades >= jadeCost);

  const getToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token;
  };

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setStep("submitting"); setErrorMsg(""); setVideoUrl(null);
    try {
      const token   = await getToken();
      const faceB64 = await fileToBase64(faceFile);

      if (isFree) {
        const res  = await fetch("/api/free-template/submit", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ templateId: tmpl.id, faceBase64: faceB64, gender }) });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "Error al enviar");
        setTaskId(json.taskId);
      } else {
        // Subir imagen primero
        const upRes  = await fetch("/api/templates/upload-image", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ imageBase64: faceB64, mimeType: faceFile.type, label: "face1" }) });
        const upJson = await upRes.json();
        if (!upJson.ok) throw new Error(upJson.error || "Error subiendo imagen");
        const res  = await fetch("/api/templates/submit-video", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ templateId: tmpl.id, lang: dialogLang, quality: "480", genderVariant: gender, faceUrl: upJson.url }) });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "Error al enviar");
        setTaskId(json.taskId);
        if (json.jadeCost) onJadesUpdate?.(userJades - json.jadeCost);
      }
      setStep("polling"); setPollCount(0);
    } catch (e) { setErrorMsg(e.message); setStep("error"); }
  };

  useEffect(() => {
    if (step !== "polling" || !taskId) return;
    const endpoint = isFree ? "/api/free-template/poll" : "/api/templates/poll-video";
    const iv = setInterval(async () => {
      try {
        const token = await getToken();
        const res   = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ taskId, templateId: tmpl.id }) });
        const json  = await res.json();
        setPollCount(c => c + 1);
        if ((json.status === "completed" || json.status === "succeed") && json.videoUrl) {
          setVideoUrl(json.videoUrl);
          if (isFree) setUsedFreeId(tmpl.id);
          setStep("done"); clearInterval(iv);
        } else if (json.status === "failed" || json.status === "error") {
          throw new Error(json.error || "Generation failed");
        }
      } catch (e) { setErrorMsg(e.message); setStep("error"); clearInterval(iv); }
    }, 6000);
    return () => clearInterval(iv);
  }, [step, taskId]);

  

  return (
    <div className="tmpl-generate" style={{ fontFamily: "'DM Sans',sans-serif", color: "#fff", paddingBottom: 80 }}>
      <style>{RESPONSIVE_CSS}</style>

      {/* Header */}
      <div style={{ padding: "20px 20px 0", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "8px 14px", color: "#fff", cursor: "pointer", fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 12 }}>
          ← {isEs ? "Volver" : "Back"}
        </button>
        <div style={{ flex: 1, fontFamily: "'Syne',sans-serif", fontSize: 15, fontWeight: 800 }}>{tmpl.emoji} {tmpl.label[lang]}</div>
        <div style={{ background: "rgba(255,90,0,0.15)", border: "1px solid rgba(255,90,0,0.3)", borderRadius: 8, padding: "4px 10px", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 10, color: ACCENT }}>
          {isFree ? "🎁 FREE" : "💳 $5 USD"}
        </div>
      </div>

      {/* Advertencia de calidad — SOLO para gratis */}
      {isFree && (
        <div style={{ margin: "14px 20px 0", background: "rgba(255,179,0,0.07)", border: "1px solid rgba(255,179,0,0.25)", borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 11, fontWeight: 800, color: GOLD, marginBottom: 4 }}>
            ⚠️ {isEs ? "Versión gratuita — calidad limitada" : "Free version — limited quality"}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>
            {isEs
              ? "La calidad visual de la versión gratuita es inferior a las plantillas épicas de pago. El reconocimiento facial puede no ser 100% preciso con Seedance 1.5 Pro. Para mayor calidad, videos de 15 segundos ultra HD sin marca de agua, elige una plantilla épica ($5) o suscríbete por $13/mes."
              : "Free version visual quality is lower than paid epic templates. Facial recognition may not be 100% accurate with Seedance 1.5 Pro. For higher quality, 15-second ultra HD watermark-free videos, choose an epic template ($5) or subscribe for $13/month."}
          </div>
        </div>
      )}

      {/* Info del video */}
      <div style={{ margin: "10px 20px 0", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "10px 14px" }}>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>
          🎬 {isFree
            ? (isEs ? "5 segundos · Marca de agua · 1 gratis por usuario" : "5 seconds · Watermark · 1 free per user")
            : (isEs ? `15 segundos · Sin marca de agua · ${jadeCost} Jades` : `15 seconds · No watermark · ${jadeCost} Jades`)}
        </div>
      </div>

      {/* Sin jades para épica */}
      {!isFree && userJades < jadeCost && (
        <div style={{ margin: "12px 20px 0", background: "rgba(255,90,0,0.08)", border: "1px solid rgba(255,90,0,0.25)", borderRadius: 12, padding: "14px 16px" }}>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 800, color: ACCENT, marginBottom: 8 }}>
            💎 {isEs ? `Necesitas ${jadeCost} Jades · Tienes ${userJades}` : `Need ${jadeCost} Jades · You have ${userJades}`}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginBottom: 12, lineHeight: 1.5 }}>
            {isEs ? "Compra los Jades para este video ($5) o suscríbete por $13/mes y explora todas las plantillas con soporte incluido." : "Buy Jades for this video ($5) or subscribe for $13/month and explore all templates with support included."}
          </div>
          <button onClick={onOpenBuy} style={{ background: `linear-gradient(135deg,${ACCENT},${GOLD})`, border: "none", borderRadius: 10, color: "#000", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 13, padding: "12px 24px", cursor: "pointer" }}>
            💳 {isEs ? "Comprar Jades — $5 USD" : "Buy Jades — $5 USD"}
          </button>
        </div>
      )}

      {/* Género */}
      <div style={{ padding: "18px 20px 0" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: ACCENT, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>
          1 · {isEs ? "¿Eres hombre o mujer?" : "Are you a man or a woman?"}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {[{ value: "female", icon: "👩", label: { es: "Mujer", en: "Woman" } }, { value: "male", icon: "👨", label: { es: "Hombre", en: "Man" } }].map(g => (
            <div key={g.value} onClick={() => setGender(g.value)} style={{ flex: 1, border: `1.5px solid ${gender === g.value ? ACCENT : "rgba(255,255,255,0.1)"}`, borderRadius: 14, padding: "14px 10px", cursor: "pointer", textAlign: "center", background: gender === g.value ? "rgba(255,90,0,0.12)" : "rgba(255,255,255,0.03)", transition: "all 0.2s" }}>
              <div style={{ fontSize: 28, marginBottom: 4 }}>{g.icon}</div>
              <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 13 }}>{g.label[lang]}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Foto */}
      {gender && (
        <div style={{ padding: "18px 20px 0" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: ACCENT, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>
            2 · {isEs ? "Sube tu foto de rostro" : "Upload your face photo"}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "10px 12px", marginBottom: 12, lineHeight: 1.6 }}>
            📌 {isEs ? "Foto clara de frente · Sin lentes · Sin filtros · Buena luz · Fondo simple" : "Clear front photo · No glasses · No filters · Good lighting · Simple background"}
          </div>
          <UploadZone
            label={isEs ? "Tu foto de rostro" : "Your face photo"}
            hint={isEs ? "Mirando a la cámara · Buena iluminación" : "Looking at camera · Good lighting"}
            onChange={f => { setFaceFile(f); setFacePreview(URL.createObjectURL(f)); }}
            preview={facePreview}
          />
        </div>
      )}

      {/* Idioma diálogo — solo épicas con dialog */}
      {gender && faceFile && !isFree && tmpl.hasDialogLang && (
        <div style={{ padding: "18px 20px 0" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: ACCENT, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>
            3 · {isEs ? "Idioma del video" : "Video language"}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {[{ value: "es", flag: "🇪🇸", label: { es: "Español", en: "Spanish" } }, { value: "en", flag: "🇺🇸", label: { es: "Inglés", en: "English" } }].map(o => (
              <div key={o.value} onClick={() => setDialogLang(o.value)} style={{ flex: 1, border: `1.5px solid ${dialogLang === o.value ? ACCENT : "rgba(255,255,255,0.1)"}`, borderRadius: 12, padding: "12px", cursor: "pointer", textAlign: "center", background: dialogLang === o.value ? "rgba(255,90,0,0.1)" : "rgba(255,255,255,0.03)", transition: "all 0.2s" }}>
                <div style={{ fontSize: 22, marginBottom: 4 }}>{o.flag}</div>
                <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 12 }}>{o.label[lang]}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {errorMsg && (
        <div style={{ margin: "14px 20px 0", background: "rgba(255,60,60,0.08)", border: "1px solid rgba(255,60,60,0.25)", borderRadius: 12, padding: "12px 14px", fontSize: 12, color: "#ff8080" }}>
          ⚠️ {errorMsg}
          <button onClick={() => { setStep("idle"); setErrorMsg(""); }} style={{ marginLeft: 10, background: "none", border: "1px solid rgba(255,80,80,0.4)", color: "#ff8080", borderRadius: 6, padding: "2px 8px", fontSize: 11, cursor: "pointer" }}>
            {isEs ? "Reintentar" : "Retry"}
          </button>
        </div>
      )}

      {/* Polling */}
      {step === "polling" && (
        <div style={{ margin: "14px 20px 0", background: "rgba(255,90,0,0.06)", border: "1px solid rgba(255,90,0,0.2)", borderRadius: 14, padding: "24px", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 10, display: "inline-block", animation: "spin 2s linear infinite" }}>🎬</div>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 15, fontWeight: 800, color: ACCENT, marginBottom: 6 }}>
            {isEs ? "Generando tu video..." : "Generating your video..."}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginBottom: 16 }}>
            {isEs ? (isFree ? "2–4 minutos · 5 seg" : "3–8 minutos · 15 seg") : (isFree ? "2–4 minutes · 5 sec" : "3–8 minutes · 15 sec")} · {pollCount * 6}s
          </div>
          <div style={{ background: "rgba(255,255,255,0.07)", borderRadius: 8, height: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", background: ACCENT, borderRadius: 8, width: `${Math.min((pollCount / (isFree ? 40 : 80)) * 100, 90)}%`, transition: "width 0.6s" }} />
          </div>
        </div>
      )}

      {/* Done */}
      {step === "done" && videoUrl && (
        <div style={{ margin: "14px 20px 0", borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,90,0,0.3)" }}>
          <div style={{ position: "relative" }}>
            <video src={videoUrl} controls playsInline style={{ width: "100%", maxHeight: 400, objectFit: "contain", background: "#000", display: "block" }} />
            {isFree && (
              <div style={{ position: "absolute", bottom: 52, left: 0, right: 0, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
                <div style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "6px 16px", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 12, color: "rgba(255,255,255,0.9)", letterSpacing: 0.5 }}>
                  isabelaos.com · Register Now
                </div>
              </div>
            )}
          </div>

          {/* CTA post video gratis */}
          {isFree && (
            <div style={{ padding: "16px", background: "rgba(255,90,0,0.06)", borderTop: "1px solid rgba(255,90,0,0.15)" }}>
              <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 800, color: GOLD, marginBottom: 4 }}>
                🌟 {isEs ? "¿Te gustó? Quita la marca de agua" : "Did you like it? Remove the watermark"}
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.6, marginBottom: 12 }}>
                {isEs
                  ? "Obtén videos de 15 segundos sin marca con las plantillas épicas ($5 cada una) o suscríbete por $13/mes e incluye soporte personalizado para crear todo lo que necesites."
                  : "Get 15-second watermark-free videos with epic templates ($5 each) or subscribe for $13/month with personalized support to create everything you need."}
              </div>
              <button onClick={onBack} style={{ width: "100%", background: `linear-gradient(135deg,${ACCENT},${GOLD})`, border: "none", borderRadius: 10, color: "#000", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 13, padding: "12px", cursor: "pointer" }}>
                ⚡ {isEs ? "Ver plantillas épicas — $5 USD" : "See epic templates — $5 USD"}
              </button>
            </div>
          )}

          <div style={{ padding: "12px 16px", display: "flex", gap: 10 }}>
            <a href={videoUrl} download="isabelaos-video.mp4" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: ACCENT, color: "#000", padding: "11px", borderRadius: 10, textDecoration: "none", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 13 }}>
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
        <div style={{ padding: "18px 20px 0" }}>
          <button onClick={handleGenerate} disabled={!canGenerate}
            style={{ width: "100%", background: canGenerate ? `linear-gradient(135deg,${ACCENT},${GOLD})` : "rgba(255,255,255,0.06)", color: canGenerate ? "#000" : "rgba(255,255,255,0.2)", border: "none", borderRadius: 14, padding: "18px", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 15, cursor: canGenerate ? "pointer" : "not-allowed", transition: "all 0.2s" }}>
            {step === "submitting"
              ? (isEs ? "⏳ Enviando..." : "⏳ Submitting...")
              : isFree
                ? `🎁 ${isEs ? "Generar Video Gratis · 5 seg" : "Generate Free Video · 5 sec"}`
                : `⚡ ${isEs ? `Generar · 15 seg · ${jadeCost} 💎` : `Generate · 15 sec · ${jadeCost} 💎`}`}
          </button>

          {/* Mensaje suscripción siempre visible */}
          <div style={{ marginTop: 12, background: "rgba(255,179,0,0.06)", border: "1px solid rgba(255,179,0,0.2)", borderRadius: 10, padding: "10px 14px", fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.6, textAlign: "center" }}>
            💎 {isEs
              ? "Suscríbete por $13/mes — explora todas las plantillas + soporte personalizado para crear todo lo que necesites."
              : "Subscribe for $13/month — explore all templates + personalized support to create everything you need."}
          </div>
        </div>
      )}
    </div>
  );
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
export default function UnifiedTemplatesPanel({ lang = "es", userJades = 0, onJadesUpdate }) {
  const isEs = lang === "es";
  const [view,         setView]         = useState("gallery");
  const [selectedId,   setSelectedId]   = useState(null);
  const [usedFreeId,   setUsedFreeId]   = useState(null);
  const [checkingUsed, setCheckingUsed] = useState(true);
  const [buyOpen,      setBuyOpen]      = useState(false);

  const STYLES = `@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800;900&family=DM+Sans:wght@300;400;500&display=swap');`;

  useEffect(() => {
    (async () => {
      setCheckingUsed(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setCheckingUsed(false); return; }
      const { data } = await supabase.from("free_video_uses").select("template_id").eq("user_id", session.user.id).maybeSingle();
      if (data) setUsedFreeId(data.template_id);
      setCheckingUsed(false);
    })();
  }, []);

  const tmpl = ALL_TEMPLATES.find(t => t.id === selectedId);

  const handleSelect = (id) => {
    const t = ALL_TEMPLATES.find(x => x.id === id);
    if (!t.free && userJades < (t.jadeCost || 30)) { setBuyOpen(true); return; }
    setSelectedId(id); setView("generate");
  };

  if (view === "generate" && tmpl) return (
    <>
      <style>{RESPONSIVE_CSS}</style>
      <BuyJadesModal open={buyOpen} onClose={() => setBuyOpen(false)} userId={null} onSuccess={() => { setBuyOpen(false); onJadesUpdate?.(); }} lang={lang} />
      <GenerateView tmpl={tmpl} lang={lang} userJades={userJades} onJadesUpdate={onJadesUpdate} onBack={() => setView("gallery")} setUsedFreeId={setUsedFreeId} onOpenBuy={() => setBuyOpen(true)} />
    </>
  );

  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif", color: "#fff", paddingBottom: 60 }}>
      <style>{RESPONSIVE_CSS}</style>
      <BuyJadesModal open={buyOpen} onClose={() => setBuyOpen(false)} userId={null} onSuccess={() => { setBuyOpen(false); onJadesUpdate?.(); }} lang={lang} />

      {/* Header */}
      <div className="tmpl-header" style={{ padding: "24px 20px 16px" }}>
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 22, fontWeight: 900, marginBottom: 4 }}>
          🎬 {isEs ? "Plantillas de Video" : "Video Templates"}
        </div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", lineHeight: 1.6, marginBottom: 16 }}>
          {isEs ? "Sube tu foto y aparece en una escena cinematográfica" : "Upload your photo and appear in a cinematic scene"}
        </div>

        {/* Advertencia referencias */}
        <div style={{ background: "rgba(255,200,0,0.06)", border: "1px solid rgba(255,200,0,0.2)", borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 11, fontWeight: 700, color: "#ffcc00", marginBottom: 3 }}>
            ⚠️ {isEs ? "Los videos de muestra son referencias" : "Sample videos are visual references"}
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
            {isEs ? "La IA nunca genera dos videos exactamente iguales. Tu rostro será el protagonista." : "AI never generates two identical videos. Your face will be the protagonist."}
          </div>
        </div>

        {/* Banner suscripción $13 */}
        <div style={{ background: "rgba(255,90,0,0.08)", border: "1px solid rgba(255,90,0,0.25)", borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 12, fontWeight: 800, color: ACCENT, marginBottom: 3 }}>
            💎 {isEs ? "Suscripción $13/mes — Acceso completo" : "Subscription $13/month — Full access"}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>
            {isEs
              ? "Explora todas las plantillas, mayor calidad, videos más largos y soporte personalizado para que crees todo lo que necesitas."
              : "Explore all templates, higher quality, longer videos and personalized support to create everything you need."}
          </div>
        </div>

        {/* Aviso si ya usó gratis */}
        {usedFreeId && !checkingUsed && (
          <div style={{ marginTop: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "10px 14px", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
            ✅ {isEs ? "Video gratis ya generado. Las plantillas épicas están disponibles por $5 USD cada una." : "Free video already generated. Epic templates available for $5 USD each."}
          </div>
        )}
      </div>

      {checkingUsed ? (
        <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.3)" }}>...</div>
      ) : (
        <>
          {/* Sección GRATIS */}
          <div className="tmpl-section" style={{ padding: "0 20px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 12, fontWeight: 800, color: ACCENT, letterSpacing: 1.5, textTransform: "uppercase" }}>
                🎁 {isEs ? "Gratis · 5 seg · Marca de agua" : "Free · 5 sec · Watermark"}
              </div>
              <div style={{ flex: 1, height: 1, background: "rgba(255,90,0,0.2)" }} />
            </div>
            <div className="tmpl-grid-3">
              {FREE_TEMPLATES.map(t => (
                <TemplateCard key={t.id} tmpl={t} lang={lang} usedFree={!!usedFreeId} onClick={() => handleSelect(t.id)} />
              ))}
            </div>
          </div>

          {/* Sección ÉPICAS — también 3 columnas */}
          <div style={{ padding: "0 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 12, fontWeight: 800, color: ACCENT, letterSpacing: 1.5, textTransform: "uppercase" }}>
                ⚡ {isEs ? "Épicas · $5 USD · 15 seg · Sin marca" : "Epic · $5 USD · 15 sec · No watermark"}
              </div>
              <div style={{ flex: 1, height: 1, background: "rgba(255,90,0,0.2)" }} />
            </div>
            <div className="tmpl-grid-epic">
              {EPIC_TEMPLATES.map(t => (
                <TemplateCard key={t.id} tmpl={t} lang={lang} usedFree={false} onClick={() => handleSelect(t.id)} />
              ))}
            </div>
          </div>

          <div style={{ padding: "14px 20px 0", fontSize: 10, color: "rgba(255,255,255,0.18)", textAlign: "center" }}>
            {isEs ? "Hover para previsualizar · Seedance 2.0" : "Hover to preview · Seedance 2.0"}
          </div>
        </>
      )}
    </div>
  );
}
