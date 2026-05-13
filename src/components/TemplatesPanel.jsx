import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

const TEMPLATES = [
  { id: "divineLight", emoji: "⚡", label: { es: "Confrontación Divina", en: "Divine Confrontation" }, tag: { es: "ÉPICO", en: "EPIC" }, description: { es: "Enfrenta a Dios como ser de luz. Tormenta. Tsunami. Redención.", en: "Confront God as a being of light. Storm. Tsunami. Redemption." }, video: "/gallery/divine-light.mp4", accent: "#4A90E2", hasDialogLang: true, genderOptions: [{ value: "male", icon: "👨", label: { es: "Soy Hombre", en: "I'm a Man" } }, { value: "female", icon: "👩", label: { es: "Soy Mujer", en: "I'm a Woman" } }], slots: { male: ["protagonist"], female: ["protagonist"] } },
  { id: "divineHuman", emoji: "🙏", label: { es: "Dios Entre Nosotros", en: "God Among Us" }, tag: { es: "VIRAL", en: "VIRAL" }, description: { es: "Dios como ser humano real. Túnica blanca. La misma tormenta.", en: "God as a real human. White robe. Same storm." }, video: "/gallery/divine-human.mp4", accent: "#E8B84B", hasDialogLang: true, genderOptions: [{ value: "male", icon: "👨", label: { es: "Soy Hombre", en: "I'm a Man" } }, { value: "female", icon: "👩", label: { es: "Soy Mujer", en: "I'm a Woman" } }], slots: { male: ["protagonist"], female: ["protagonist"] } },
  { id: "coupleDisaster", emoji: "💔", label: { es: "La Última Pelea", en: "The Last Fight" }, tag: { es: "DRAMA", en: "DRAMA" }, description: { es: "Pareja en acantilado. Meteorito. Tsunami los separa.", en: "Couple on cliff. Meteor. Tsunami separates them." }, video: "/gallery/couple-disaster.mp4", accent: "#E05C8A", hasDialogLang: true, genderOptions: [{ value: "female", icon: "👩", label: { es: "Soy la Mujer", en: "I'm the Woman" }, sub: { es: "Hombre inventado por IA", en: "AI-generated man" } }, { value: "male", icon: "👨", label: { es: "Soy el Hombre", en: "I'm the Man" }, sub: { es: "Mujer inventada por IA", en: "AI-generated woman" } }, { value: "both", icon: "👫", label: { es: "Somos los Dos", en: "We're Both" }, sub: { es: "2 fotos por persona", en: "2 photos per person" } }], slots: { female: ["protagonist"], male: ["protagonist"], both: ["man", "woman"] } },
  { id: "victoriasSecret", emoji: "👙", label: { es: "Victoria's Secret", en: "Victoria's Secret" }, tag: { es: "LUJO", en: "LUXURY" }, description: { es: "Campaña de moda de lujo. Playa tropical. Solo mujer.", en: "Luxury fashion campaign. Tropical beach. Women only." }, video: "/gallery/victorias-secret.mp4", accent: "#C8A96E", hasDialogLang: false, genderOptions: null, slots: { female: ["protagonist"] } },
];

const SLOT_LABELS = { protagonist: { es: "Tu foto", en: "Your photo" }, man: { es: "Foto del Hombre", en: "Man's photo" }, woman: { es: "Foto de la Mujer", en: "Woman's photo" } };

// Comprime imagen a max 800px y calidad 85% antes de convertir a base64
// Reduce el tamaño del payload para no superar límites de PiAPI
function fileToBase64(file, maxSize = 800, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
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

// ── UPLOAD ZONE ────────────────────────────────────────────────────────────
function UploadZone({ label, hint, onChange, preview, accent, height = 140 }) {
  const ref = useRef();
  const [drag, setDrag] = useState(false);
  const onDrop = useCallback((e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f?.type.startsWith("image/")) onChange(f); }, [onChange]);
  return (
    <div onClick={() => ref.current.click()} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
      style={{ border: `2px dashed ${drag ? accent : "rgba(255,255,255,0.15)"}`, borderRadius: 14, cursor: "pointer", overflow: "hidden", background: drag ? `${accent}18` : "rgba(255,255,255,0.03)", transition: "all 0.2s", minHeight: height, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative" }}>
      <input ref={ref} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => e.target.files[0] && onChange(e.target.files[0])} />
      {preview ? (
        <><img src={preview} alt="" style={{ width: "100%", height, objectFit: "cover", display: "block" }} />
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "8px 12px", background: "linear-gradient(transparent,rgba(0,0,0,0.85))", fontSize: 11, color: accent, fontFamily: "'Syne',sans-serif", fontWeight: 700 }}>✓ {label}</div></>
      ) : (
        <><div style={{ fontSize: 24, marginBottom: 6, opacity: 0.5 }}>📸</div>
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 12, fontWeight: 700, color: "#fff", marginBottom: 3, textAlign: "center", padding: "0 8px" }}>{label}</div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textAlign: "center", maxWidth: 160, lineHeight: 1.5, padding: "0 10px" }}>{hint}</div></>
      )}
    </div>
  );
}

// ── GALLERY CARD ───────────────────────────────────────────────────────────
function GalleryCard({ tmpl, lang, onClick }) {
  const vRef = useRef();
  return (
    <div onClick={onClick} onMouseEnter={() => vRef.current?.play()} onMouseLeave={() => { if (vRef.current) { vRef.current.pause(); vRef.current.currentTime = 0; } }}
      style={{ position: "relative", borderRadius: 16, overflow: "hidden", cursor: "pointer", aspectRatio: "9/16", background: "#080808", border: "1px solid rgba(255,255,255,0.08)", transition: "transform 0.25s, box-shadow 0.25s" }}
      onMouseOver={(e) => { e.currentTarget.style.transform = "scale(1.03)"; e.currentTarget.style.boxShadow = `0 20px 60px ${tmpl.accent}55`; }}
      onMouseOut={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "none"; }}>
      <video ref={vRef} src={tmpl.video} muted playsInline loop preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(0deg,rgba(0,0,0,0.92) 0%,rgba(0,0,0,0.2) 50%,transparent 100%)" }} />
      <div style={{ position: "absolute", top: 12, left: 12, background: tmpl.accent, color: "#000", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 9, letterSpacing: 1.5, padding: "4px 8px", borderRadius: 6 }}>{tmpl.tag[lang]}</div>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "16px 14px 14px" }}>
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 15, fontWeight: 800, marginBottom: 5, lineHeight: 1.2 }}>{tmpl.emoji} {tmpl.label[lang]}</div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.5, marginBottom: 12 }}>{tmpl.description[lang]}</div>
        <div style={{ background: tmpl.accent, borderRadius: 8, padding: "8px 12px", textAlign: "center", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 12, color: "#000" }}>{lang === "es" ? "✨ Créalo con tu rostro" : "✨ Create with your face"}</div>
      </div>
    </div>
  );
}

// ── PERSON UPLOAD BLOCK ────────────────────────────────────────────────────
// Cada persona sube 2 fotos: frontal + perfil lateral
function PersonUploadBlock({ slotKey, slotLabel, faceData, profileData, onFaceUpload, onProfileUpload, accent, lang }) {
  return (
    <div style={{ marginBottom: 20 }}>
      {slotLabel && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", marginBottom: 10, fontFamily: "'Syne',sans-serif", fontWeight: 700 }}>{slotLabel}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {/* Foto frontal */}
        <div>
          <div style={{ fontSize: 10, color: accent, marginBottom: 6, fontFamily: "'Syne',sans-serif", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
            {lang === "es" ? "📸 Foto frontal" : "📸 Front photo"}
          </div>
          <UploadZone
            label={lang === "es" ? "Foto de frente" : "Front photo"}
            hint={lang === "es" ? "Mirando directo a la cámara" : "Looking straight at camera"}
            onChange={onFaceUpload}
            preview={faceData?.preview}
            accent={accent}
          />
          {faceData?.preview && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textAlign: "center", marginTop: 4 }}>✓ {lang === "es" ? "Cargada" : "Uploaded"}</div>}
        </div>
        {/* Foto de perfil lateral */}
        <div>
          <div style={{ fontSize: 10, color: accent, marginBottom: 6, fontFamily: "'Syne',sans-serif", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
            {lang === "es" ? "🔄 Foto de perfil" : "🔄 Profile photo"}
          </div>
          <UploadZone
            label={lang === "es" ? "Foto lateral" : "Side photo"}
            hint={lang === "es" ? "Rostro de lado (90° o 45°)" : "Face from the side (90° or 45°)"}
            onChange={onProfileUpload}
            preview={profileData?.preview}
            accent={accent}
          />
          {profileData?.preview && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textAlign: "center", marginTop: 4 }}>✓ {lang === "es" ? "Cargada" : "Uploaded"}</div>}
        </div>
      </div>
      {/* Tip */}
      <div style={{ marginTop: 8, fontSize: 10, color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "8px 10px", lineHeight: 1.6 }}>
        💡 {lang === "es"
          ? "Mejor resultado: ambas fotos con buena luz, sin lentes, sin filtros, fondo simple."
          : "Best result: both photos with good lighting, no glasses, no filters, simple background."}
      </div>
    </div>
  );
}

// ── MAIN ───────────────────────────────────────────────────────────────────
export default function TemplatesPanel({ userJades = 0, onJadesUpdate }) {
  const [lang, setLang] = useState("es");
  const [dialogLang, setDialogLang] = useState("es");
  const [view, setView] = useState("gallery");
  const [selectedId, setSelectedId] = useState(null);
  const [genderVariant, setGenderVariant] = useState(null);
  const [quality, setQuality] = useState("480");

  // Cada slot tiene: face (frontal) y profile (lateral)
  const emptySlot = () => ({ face: null, profile: null });
  const [slots, setSlots] = useState({ protagonist: emptySlot(), man: emptySlot(), woman: emptySlot() });

  const [bodyFile, setBodyFile] = useState(null);
  const [bodyPreview, setBodyPreview] = useState(null);

  const [step, setStep] = useState("idle");
  const [taskId, setTaskId] = useState(null);
  const [pollCount, setPollCount] = useState(0);
  const [videoUrl, setVideoUrl] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  const tmpl = TEMPLATES.find((t) => t.id === selectedId);
  const accent = tmpl?.accent || "#C8A96E";
  const jadeCost = quality === "720" ? 60 : 30;

  const activeSlotKeys = () => { if (!tmpl || !genderVariant) return []; return tmpl.slots[genderVariant] || []; };

  // Puede generar si todos los slots activos tienen al menos la foto frontal
  const allReady = activeSlotKeys().every((k) => slots[k]?.face?.file);
  const canGenerate = allReady && step === "idle" && userJades >= jadeCost;

  const callApi = async (route, body) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/templates/${route}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(body) });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Error");
    return json;
  };

  const setSlotPhoto = (slotKey, photoType, file) => {
    const preview = URL.createObjectURL(file);
    setSlots((prev) => ({ ...prev, [slotKey]: { ...prev[slotKey], [photoType]: { file, preview } } }));
  };

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setStep("submitting"); setErrorMsg(""); setVideoUrl(null);
    try {
      const pSlot = slots.protagonist, mSlot = slots.man, wSlot = slots.woman;

      let faceBase64, faceMime, profileBase64 = null, profileMime = null;
      let face2Base64 = null, face2Mime = null, profile2Base64 = null, profile2Mime = null;
      const bodyB64 = bodyFile ? await fileToBase64(bodyFile) : null;

      if (genderVariant === "both") {
        faceBase64 = await fileToBase64(mSlot.face.file); faceMime = mSlot.face.file.type;
        if (mSlot.profile?.file) { profileBase64 = await fileToBase64(mSlot.profile.file); profileMime = mSlot.profile.file.type; }
        face2Base64 = await fileToBase64(wSlot.face.file); face2Mime = wSlot.face.file.type;
        if (wSlot.profile?.file) { profile2Base64 = await fileToBase64(wSlot.profile.file); profile2Mime = wSlot.profile.file.type; }
      } else {
        faceBase64 = await fileToBase64(pSlot.face.file); faceMime = pSlot.face.file.type;
        if (pSlot.profile?.file) { profileBase64 = await fileToBase64(pSlot.profile.file); profileMime = pSlot.profile.file.type; }
      }

      const json = await callApi("submit-video", {
        templateId: selectedId, lang: dialogLang, quality, genderVariant,
        faceBase64, faceMime,
        profileBase64, profileMime,
        face2Base64, face2Mime,
        profile2Base64, profile2Mime,
        bodyBase64: bodyB64, bodyMime: bodyFile?.type || null,
      });

      setTaskId(json.taskId);
      onJadesUpdate?.(userJades - json.jadeCost);
      setStep("polling"); setPollCount(0);
    } catch (e) { setErrorMsg(e.message); setStep("error"); }
  };

  useEffect(() => {
    if (step !== "polling" || !taskId) return;
    const iv = setInterval(async () => {
      try {
        const json = await callApi("poll-video", { taskId }); setPollCount((c) => c + 1);
        if (json.status === "completed" || json.status === "succeed") { setVideoUrl(json.videoUrl); setStep("done"); clearInterval(iv); }
        else if (json.status === "failed" || json.status === "error") throw new Error(lang === "es" ? "La generación falló" : "Generation failed");
      } catch (e) { setErrorMsg(e.message); setStep("error"); clearInterval(iv); }
    }, 6000);
    return () => clearInterval(iv);
  }, [step, taskId]);

  const resetAll = () => {
    setView("gallery"); setSelectedId(null); setGenderVariant(null);
    setSlots({ protagonist: emptySlot(), man: emptySlot(), woman: emptySlot() });
    setBodyFile(null); setBodyPreview(null);
    setStep("idle"); setTaskId(null); setVideoUrl(null); setErrorMsg("");
  };

  const STYLES = `@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Inter:wght@300;400;500&display=swap'); @keyframes spin { to { transform: rotate(360deg); } }`;

  // ── GALLERY ───────────────────────────────────────────────────────────────
  if (view === "gallery") return (
    <div style={{ fontFamily: "'Inter',sans-serif", color: "#fff", paddingBottom: 60 }}>
      <style>{STYLES}</style>
      <div style={{ padding: "28px 20px 0", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div><div style={{ fontFamily: "'Syne',sans-serif", fontSize: 22, fontWeight: 800 }}>🎬 {lang === "es" ? "Plantillas Épicas" : "Epic Templates"}</div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 3 }}>{lang === "es" ? "Ponté en escenas cinematográficas de IA" : "Place yourself in AI cinematic scenes"}</div></div>
        <div style={{ display: "flex", background: "rgba(255,255,255,0.07)", borderRadius: 10, padding: 3, gap: 2 }}>
          {["es", "en"].map((l) => (<button key={l} onClick={() => setLang(l)} style={{ background: lang === l ? "#C8A96E" : "transparent", color: lang === l ? "#000" : "rgba(255,255,255,0.45)", border: "none", borderRadius: 7, padding: "5px 12px", fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 11, cursor: "pointer" }}>{l === "es" ? "🇪🇸 ES" : "🇺🇸 EN"}</button>))}
        </div>
      </div>

      {/* Aviso referencia */}
      <div style={{ margin: "16px 20px 0", background: "rgba(255,200,0,0.06)", border: "1px solid rgba(255,200,0,0.2)", borderRadius: 14, padding: "14px 16px" }}>
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 12, fontWeight: 700, color: "#ffcc00", marginBottom: 4 }}>⚠️ {lang === "es" ? "Los videos de muestra son referencias visuales" : "Sample videos are visual references"}</div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>{lang === "es" ? "La IA nunca genera dos videos exactamente iguales. Los videos que ves son ejemplos del estilo y escena. Tu rostro será el protagonista y el resultado siempre será único." : "AI never generates two identical videos. The videos shown are style examples. Your face will be the protagonist and the result will always be unique."}</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "16px 20px 0" }}>
        {TEMPLATES.map((t) => (<GalleryCard key={t.id} tmpl={t} lang={lang} onClick={() => { setSelectedId(t.id); setGenderVariant(t.genderOptions ? null : "female"); setSlots({ protagonist: emptySlot(), man: emptySlot(), woman: emptySlot() }); setView("generate"); }} />))}
      </div>
      <div style={{ padding: "14px 20px 0", fontSize: 10, color: "rgba(255,255,255,0.18)", textAlign: "center" }}>{lang === "es" ? "Hover para previsualizar · 15 segundos · 9:16" : "Hover to preview · 15 seconds · 9:16"}</div>
    </div>
  );

  // ── GENERATE VIEW ─────────────────────────────────────────────────────────
  const currentSlots = activeSlotKeys();
  let stepNum = 1;

  return (
    <div style={{ fontFamily: "'Inter',sans-serif", color: "#fff", paddingBottom: 80 }}>
      <style>{STYLES}</style>

      {/* Header */}
      <div style={{ padding: "20px 20px 0", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={resetAll} style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "8px 14px", color: "#fff", cursor: "pointer", fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 12 }}>← {lang === "es" ? "Volver" : "Back"}</button>
        <div style={{ flex: 1, fontFamily: "'Syne',sans-serif", fontSize: 15, fontWeight: 800 }}>{tmpl?.emoji} {tmpl?.label[lang]}</div>
        <div style={{ display: "flex", background: "rgba(255,255,255,0.07)", borderRadius: 8, padding: 2, gap: 2 }}>
          {["es", "en"].map((l) => (<button key={l} onClick={() => setLang(l)} style={{ background: lang === l ? accent : "transparent", color: lang === l ? "#000" : "rgba(255,255,255,0.4)", border: "none", borderRadius: 6, padding: "4px 10px", fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 10, cursor: "pointer" }}>{l.toUpperCase()}</button>))}
        </div>
      </div>

      {/* Jades */}
      <div style={{ padding: "12px 20px 0" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "10px 14px" }}>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>{lang === "es" ? "Tus Jades" : "Your Jades"}</span>
          <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 14, color: accent }}>💎 {userJades}</span>
        </div>
      </div>

      {/* Step: Gender */}
      {tmpl?.genderOptions && (
        <div style={{ padding: "20px 20px 0" }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: accent, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>{stepNum++} · {lang === "es" ? "¿Quién eres en la escena?" : "Who are you in the scene?"}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {tmpl.genderOptions.map((g) => (
              <div key={g.value} onClick={() => { setGenderVariant(g.value); setSlots({ protagonist: emptySlot(), man: emptySlot(), woman: emptySlot() }); }}
                style={{ flex: 1, minWidth: 90, border: `1.5px solid ${genderVariant === g.value ? accent : "rgba(255,255,255,0.1)"}`, borderRadius: 12, padding: "12px 10px", cursor: "pointer", textAlign: "center", background: genderVariant === g.value ? `${accent}18` : "rgba(255,255,255,0.03)", transition: "all 0.2s" }}>
                <div style={{ fontSize: 24, marginBottom: 4 }}>{g.icon}</div>
                <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 12 }}>{g.label[lang]}</div>
                {g.sub && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{g.sub[lang]}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step: Fotos */}
      {genderVariant && (
        <div style={{ padding: "20px 20px 0" }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: accent, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 6 }}>
            {stepNum++} · {lang === "es" ? "Tus fotos de rostro" : "Your face photos"}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.6, background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "10px 12px", marginBottom: 14 }}>
            {lang === "es"
              ? "📌 Sube 2 fotos: una de frente y una de perfil (lado). Esto ayuda a la IA a reconocer mejor tu rostro. Sin lentes · Sin filtros · Buena iluminación"
              : "📌 Upload 2 photos: one front-facing and one profile (side). This helps AI recognize your face better. No glasses · No filters · Good lighting"}
          </div>

          {currentSlots.map((slotKey) => (
            <PersonUploadBlock
              key={slotKey}
              slotKey={slotKey}
              slotLabel={currentSlots.length > 1 ? SLOT_LABELS[slotKey][lang] : null}
              faceData={slots[slotKey].face}
              profileData={slots[slotKey].profile}
              onFaceUpload={(f) => setSlotPhoto(slotKey, "face", f)}
              onProfileUpload={(f) => setSlotPhoto(slotKey, "profile", f)}
              accent={accent}
              lang={lang}
            />
          ))}
        </div>
      )}

      {/* Step: Dialog language */}
      {genderVariant && tmpl?.hasDialogLang && (
        <div style={{ padding: "0 20px" }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: accent, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>{stepNum++} · {lang === "es" ? "¿En qué idioma hablan?" : "What language do they speak?"}</div>
          <div style={{ display: "flex", gap: 10 }}>
            {[{ value: "es", flag: "🇪🇸", label: { es: "Español", en: "Spanish" }, sub: { es: "Diálogo en español", en: "Dialogue in Spanish" } }, { value: "en", flag: "🇺🇸", label: { es: "Inglés", en: "English" }, sub: { es: "Diálogo en inglés", en: "Dialogue in English" } }].map((o) => (
              <div key={o.value} onClick={() => setDialogLang(o.value)} style={{ flex: 1, border: `1.5px solid ${dialogLang === o.value ? accent : "rgba(255,255,255,0.1)"}`, borderRadius: 12, padding: "12px 14px", cursor: "pointer", background: dialogLang === o.value ? `${accent}14` : "rgba(255,255,255,0.03)", transition: "all 0.2s", textAlign: "center" }}>
                <div style={{ fontSize: 22, marginBottom: 4 }}>{o.flag}</div>
                <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 13, marginBottom: 2 }}>{o.label[lang]}</div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{o.sub[lang]}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step: Body optional */}
      {genderVariant && (
        <div style={{ padding: "20px 20px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: accent, textTransform: "uppercase", letterSpacing: 1.5 }}>{stepNum++} · {lang === "es" ? "Ref. de cuerpo" : "Body reference"}</div>
            <div style={{ fontSize: 9, background: "rgba(255,255,255,0.07)", borderRadius: 5, padding: "2px 7px", color: "rgba(255,255,255,0.3)" }}>{lang === "es" ? "Opcional" : "Optional"}</div>
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginBottom: 8 }}>🎽 {lang === "es" ? "Solo proporciones. La IA NO usará la misma ropa." : "Proportions only. AI will NOT copy the clothing."}</div>
          <UploadZone label={lang === "es" ? "Foto de cuerpo" : "Body photo"} hint={lang === "es" ? "Solo proporciones — ropa diferente en el video" : "Proportions only — different clothes in video"} onChange={(f) => { setBodyFile(f); setBodyPreview(URL.createObjectURL(f)); }} preview={bodyPreview} accent={accent} height={110} />
        </div>
      )}

      {/* Step: Quality */}
      {genderVariant && (
        <div style={{ padding: "18px 20px 0" }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: accent, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>{stepNum++} · {lang === "es" ? "Calidad del video" : "Video quality"}</div>
          <div style={{ display: "flex", gap: 10 }}>
            {[{ q: "480", label: "480p", cost: 30, desc: { es: "Estándar · Rápido", en: "Standard · Fast" } }, { q: "720", label: "720p HD", cost: 60, desc: { es: "Alta calidad · Más lento", en: "High quality · Slower" } }].map((o) => (
              <div key={o.q} onClick={() => setQuality(o.q)} style={{ flex: 1, border: `1.5px solid ${quality === o.q ? accent : "rgba(255,255,255,0.1)"}`, borderRadius: 12, padding: "12px 14px", cursor: "pointer", background: quality === o.q ? `${accent}14` : "rgba(255,255,255,0.03)", transition: "all 0.2s" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}><span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 13 }}>{o.label}</span><span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 13, color: accent }}>{o.cost} 💎</span></div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{o.desc[lang]}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {errorMsg && (
        <div style={{ margin: "14px 20px 0", background: "rgba(255,60,60,0.08)", border: "1px solid rgba(255,60,60,0.25)", borderRadius: 12, padding: "12px 14px", fontSize: 12, color: "#ff8080", lineHeight: 1.5 }}>
          ⚠️ {errorMsg}
          <button onClick={() => { setStep("idle"); setErrorMsg(""); }} style={{ marginLeft: 10, background: "none", border: "1px solid rgba(255,80,80,0.4)", color: "#ff8080", borderRadius: 6, padding: "2px 8px", fontSize: 11, cursor: "pointer" }}>{lang === "es" ? "Reintentar" : "Retry"}</button>
        </div>
      )}

      {/* Polling */}
      {step === "polling" && (
        <div style={{ margin: "14px 20px 0", background: `${accent}0a`, border: `1px solid ${accent}33`, borderRadius: 14, padding: "20px", textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 10, animation: "spin 2s linear infinite" }}>🎬</div>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 14, fontWeight: 800, color: accent, marginBottom: 4 }}>{lang === "es" ? "Generando tu video..." : "Generating your video..."}</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginBottom: 14 }}>{lang === "es" ? "Puede tomar 3–8 minutos · 15 segundos" : "May take 3–8 minutes · 15 seconds"} · {pollCount * 6}s</div>
          <div style={{ background: "rgba(255,255,255,0.07)", borderRadius: 8, height: 4, overflow: "hidden" }}><div style={{ height: "100%", background: accent, borderRadius: 8, width: `${Math.min((pollCount / 80) * 100, 90)}%`, transition: "width 0.6s" }} /></div>
        </div>
      )}

      {/* Done */}
      {step === "done" && videoUrl && (
        <div style={{ margin: "14px 20px 0", background: "rgba(50,200,100,0.05)", border: "1px solid rgba(50,200,100,0.2)", borderRadius: 14, overflow: "hidden" }}>
          <video src={videoUrl} controls playsInline style={{ width: "100%", maxHeight: 400, objectFit: "contain", background: "#000", display: "block" }} />
          <div style={{ padding: "10px 14px", background: "rgba(255,200,0,0.05)", borderTop: "1px solid rgba(255,200,0,0.15)", fontSize: 11, color: "rgba(255,200,0,0.7)", lineHeight: 1.5 }}>
            ⚠️ {lang === "es" ? "La IA nunca genera dos videos exactamente iguales. Este es tu resultado único." : "AI never generates two identical videos. This is your unique result."}
          </div>
          <div style={{ padding: "14px 16px", display: "flex", gap: 10 }}>
            <a href={videoUrl} download="isabelaos-video.mp4" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: accent, color: "#000", padding: "11px", borderRadius: 10, textDecoration: "none", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 13 }}>⬇️ {lang === "es" ? "Descargar" : "Download"}</a>
            <button onClick={resetAll} style={{ flex: 1, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", padding: "11px", borderRadius: 10, cursor: "pointer", fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 13 }}>{lang === "es" ? "✨ Otra plantilla" : "✨ Another template"}</button>
          </div>
        </div>
      )}

      {/* Generate button */}
      {step !== "done" && genderVariant && (
        <div style={{ padding: "18px 20px 0" }}>
          <button onClick={handleGenerate} disabled={!canGenerate} style={{ width: "100%", background: canGenerate ? `linear-gradient(135deg,${accent},${accent}cc)` : "rgba(255,255,255,0.06)", color: canGenerate ? "#000" : "rgba(255,255,255,0.2)", border: "none", borderRadius: 14, padding: "18px", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 15, cursor: canGenerate ? "pointer" : "not-allowed", transition: "all 0.2s" }}>
            {step === "submitting" ? (lang === "es" ? "⏳ Enviando..." : "⏳ Submitting...") : `✨ ${lang === "es" ? "Generar Mi Video · 15 seg" : "Generate My Video · 15 sec"} · ${jadeCost} 💎`}
          </button>
          {!allReady && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", textAlign: "center", marginTop: 8 }}>{lang === "es" ? "↑ Sube al menos la foto frontal para continuar" : "↑ Upload at least the front photo to continue"}</div>}
          {allReady && userJades < jadeCost && <div style={{ fontSize: 11, color: "#ff8080", textAlign: "center", marginTop: 8 }}>{lang === "es" ? `Necesitas ${jadeCost} 💎 · Tienes ${userJades}` : `Need ${jadeCost} 💎 · Have ${userJades}`}</div>}
        </div>
      )}
      {!genderVariant && tmpl?.genderOptions && <div style={{ padding: "16px 20px 0", fontSize: 12, color: "rgba(255,255,255,0.3)", textAlign: "center" }}>{lang === "es" ? "↑ Selecciona quién eres en la escena para continuar" : "↑ Select who you are in the scene to continue"}</div>}
    </div>
  );
}
