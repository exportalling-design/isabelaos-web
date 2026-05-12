import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

// ── TEMPLATES CONFIG ───────────────────────────────────────────────────────
// Videos go in public/gallery/:
//   divine-light.mp4, divine-human.mp4, couple-disaster.mp4, victorias-secret.mp4

const TEMPLATES = [
  {
    id: "divineLight",
    emoji: "⚡",
    label: { es: "Confrontación Divina", en: "Divine Confrontation" },
    tag: { es: "ÉPICO", en: "EPIC" },
    description: { es: "Enfrenta a Dios como ser de luz. Tormenta épica. Tsunami. Redención.", en: "Confront God as a being of light. Epic storm. Tsunami. Redemption." },
    video: "/gallery/divine-light.mp4",
    accent: "#4A90E2",
    genderOptions: [
      { value: "male",   icon: "👨", label: { es: "Soy Hombre", en: "I'm a Man" } },
      { value: "female", icon: "👩", label: { es: "Soy Mujer", en: "I'm a Woman" } },
    ],
    uploadConfig: {
      male:   { slots: ["protagonist"] },
      female: { slots: ["protagonist"] },
    },
  },
  {
    id: "divineHuman",
    emoji: "🙏",
    label: { es: "Dios Entre Nosotros", en: "God Among Us" },
    tag: { es: "VIRAL", en: "VIRAL" },
    description: { es: "Dios como ser humano real. Túnica blanca. La misma tormenta.", en: "God as a real human being. White robe. Same storm." },
    video: "/gallery/divine-human.mp4",
    accent: "#E8B84B",
    genderOptions: [
      { value: "male",   icon: "👨", label: { es: "Soy Hombre", en: "I'm a Man" } },
      { value: "female", icon: "👩", label: { es: "Soy Mujer", en: "I'm a Woman" } },
    ],
    uploadConfig: {
      male:   { slots: ["protagonist"] },
      female: { slots: ["protagonist"] },
    },
  },
  {
    id: "coupleDisaster",
    emoji: "💔",
    label: { es: "La Última Pelea", en: "The Last Fight" },
    tag: { es: "DRAMA", en: "DRAMA" },
    description: { es: "Una pareja discute en un acantilado. Un meteorito cae. El tsunami los separa.", en: "A couple argues on a cliff. A meteor falls. The tsunami separates them." },
    video: "/gallery/couple-disaster.mp4",
    accent: "#E05C8A",
    genderOptions: [
      { value: "female", icon: "👩", label: { es: "Soy la Mujer", en: "I'm the Woman" }, sub: { es: "Hombre inventado por IA", en: "AI-generated man" } },
      { value: "male",   icon: "👨", label: { es: "Soy el Hombre", en: "I'm the Man" }, sub: { es: "Mujer inventada por IA", en: "AI-generated woman" } },
      { value: "both",   icon: "👫", label: { es: "Somos los Dos", en: "We're Both" }, sub: { es: "Subimos 2 fotos", en: "We upload 2 photos" } },
    ],
    uploadConfig: {
      female: { slots: ["protagonist"] },
      male:   { slots: ["protagonist"] },
      both:   { slots: ["man", "woman"] },
    },
  },
  {
    id: "victoriasSecret",
    emoji: "👙",
    label: { es: "Victoria's Secret", en: "Victoria's Secret" },
    tag: { es: "LUJO", en: "LUXURY" },
    description: { es: "Campaña de moda de lujo en playa tropical. Solo para mujeres.", en: "Luxury fashion campaign on tropical beach. Women only." },
    video: "/gallery/victorias-secret.mp4",
    accent: "#C8A96E",
    genderOptions: null, // always female
    uploadConfig: { female: { slots: ["protagonist"] } },
  },
];

const SLOT_LABELS = {
  protagonist: { es: "Tu foto de rostro", en: "Your face photo" },
  man:         { es: "Foto del Hombre", en: "Man's face photo" },
  woman:       { es: "Foto de la Mujer", en: "Woman's face photo" },
};

// ── UTILS ──────────────────────────────────────────────────────────────────
function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// ── UPLOAD ZONE ────────────────────────────────────────────────────────────
function UploadZone({ label, hint, onChange, preview, accent, height = 150 }) {
  const ref = useRef();
  const [drag, setDrag] = useState(false);
  const onDrop = useCallback((e) => {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f?.type.startsWith("image/")) onChange(f);
  }, [onChange]);
  return (
    <div onClick={() => ref.current.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)} onDrop={onDrop}
      style={{
        border: `2px dashed ${drag ? accent : "rgba(255,255,255,0.12)"}`,
        borderRadius: 14, cursor: "pointer", overflow: "hidden",
        background: drag ? `${accent}18` : "rgba(255,255,255,0.03)",
        transition: "all 0.2s", minHeight: height,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", position: "relative",
      }}>
      <input ref={ref} type="file" accept="image/*" style={{ display: "none" }}
        onChange={(e) => e.target.files[0] && onChange(e.target.files[0])} />
      {preview ? (
        <>
          <img src={preview} alt="" style={{ width: "100%", height, objectFit: "cover" }} />
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0, padding: "8px 12px",
            background: "linear-gradient(transparent,rgba(0,0,0,0.85))",
            fontSize: 11, color: accent, fontFamily: "'Syne',sans-serif", fontWeight: 700,
          }}>✓ {label}</div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 28, marginBottom: 6, opacity: 0.5 }}>📸</div>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 3 }}>{label}</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", textAlign: "center", maxWidth: 180, lineHeight: 1.5, padding: "0 12px" }}>{hint}</div>
        </>
      )}
    </div>
  );
}

// ── GALLERY CARD ───────────────────────────────────────────────────────────
function GalleryCard({ tmpl, lang, onClick }) {
  const vRef = useRef();
  return (
    <div onClick={onClick}
      onMouseEnter={() => vRef.current?.play()}
      onMouseLeave={() => { if (vRef.current) { vRef.current.pause(); vRef.current.currentTime = 0; } }}
      style={{
        position: "relative", borderRadius: 16, overflow: "hidden",
        cursor: "pointer", aspectRatio: "9/16", background: "#080808",
        border: "1px solid rgba(255,255,255,0.08)", transition: "transform 0.25s, box-shadow 0.25s",
      }}
      onMouseOver={(e) => { e.currentTarget.style.transform = "scale(1.03)"; e.currentTarget.style.boxShadow = `0 20px 60px ${tmpl.accent}44`; }}
      onMouseOut={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "none"; }}>
      <video ref={vRef} src={tmpl.video} muted playsInline loop preload="metadata"
        style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(0deg,rgba(0,0,0,0.92) 0%,rgba(0,0,0,0.25) 50%,transparent 100%)" }} />
      <div style={{
        position: "absolute", top: 12, left: 12, background: tmpl.accent, color: "#000",
        fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 9, letterSpacing: 1.5, padding: "4px 8px", borderRadius: 6,
      }}>{tmpl.tag[lang]}</div>
      {/* Gender badges */}
      <div style={{ position: "absolute", top: 12, right: 12, display: "flex", flexDirection: "column", gap: 4 }}>
        {tmpl.genderOptions
          ? tmpl.genderOptions.map((g) => (
              <div key={g.value} style={{
                background: "rgba(0,0,0,0.65)", backdropFilter: "blur(8px)",
                border: "1px solid rgba(255,255,255,0.12)", fontSize: 10,
                fontFamily: "'Syne',sans-serif", fontWeight: 600, color: "rgba(255,255,255,0.8)",
                padding: "3px 7px", borderRadius: 6, whiteSpace: "nowrap",
              }}>{g.icon} {g.label[lang]}</div>
            ))
          : <div style={{
              background: "rgba(0,0,0,0.65)", backdropFilter: "blur(8px)",
              border: "1px solid rgba(255,255,255,0.12)", fontSize: 10,
              fontFamily: "'Syne',sans-serif", fontWeight: 600, color: "rgba(255,255,255,0.8)",
              padding: "3px 7px", borderRadius: 6,
            }}>👩 {lang === "es" ? "Solo Mujer" : "Women Only"}</div>
        }
      </div>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "16px 14px 14px" }}>
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 15, fontWeight: 800, marginBottom: 5, lineHeight: 1.2 }}>
          {tmpl.emoji} {tmpl.label[lang]}
        </div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.5, marginBottom: 12 }}>
          {tmpl.description[lang]}
        </div>
        <div style={{
          background: tmpl.accent, borderRadius: 8, padding: "8px 12px",
          textAlign: "center", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 12, color: "#000",
        }}>
          {lang === "es" ? "✨ Créalo con tu rostro" : "✨ Create with your face"}
        </div>
      </div>
    </div>
  );
}

// ── GENDER SELECTOR ────────────────────────────────────────────────────────
function GenderSelector({ options, value, onChange, accent, lang }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {options.map((o) => (
        <div key={o.value} onClick={() => onChange(o.value)} style={{
          flex: 1, minWidth: 90, border: `1.5px solid ${value === o.value ? accent : "rgba(255,255,255,0.1)"}`,
          borderRadius: 12, padding: "12px 10px", cursor: "pointer", textAlign: "center",
          background: value === o.value ? `${accent}14` : "rgba(255,255,255,0.03)",
          transition: "all 0.2s",
        }}>
          <div style={{ fontSize: 24, marginBottom: 4 }}>{o.icon}</div>
          <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 12, marginBottom: o.sub ? 3 : 0 }}>
            {o.label[lang]}
          </div>
          {o.sub && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{o.sub[lang]}</div>}
        </div>
      ))}
    </div>
  );
}

// ── QUALITY SELECTOR ───────────────────────────────────────────────────────
function QualitySelector({ value, onChange, lang }) {
  return (
    <div style={{ display: "flex", gap: 10 }}>
      {[
        { q: "480", label: "480p", cost: 30, desc: { es: "Estándar · Rápido", en: "Standard · Fast" } },
        { q: "720", label: "720p HD", cost: 60, desc: { es: "Alta calidad · Lento", en: "High quality · Slow" } },
      ].map((o) => (
        <div key={o.q} onClick={() => onChange(o.q)} style={{
          flex: 1, border: `1.5px solid ${value === o.q ? "#C8A96E" : "rgba(255,255,255,0.1)"}`,
          borderRadius: 12, padding: "12px 14px", cursor: "pointer",
          background: value === o.q ? "rgba(200,169,110,0.1)" : "rgba(255,255,255,0.03)", transition: "all 0.2s",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 13 }}>{o.label}</span>
            <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 13, color: "#C8A96E" }}>{o.cost} 💎</span>
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{o.desc[lang]}</div>
        </div>
      ))}
    </div>
  );
}

// ── MAIN COMPONENT ─────────────────────────────────────────────────────────
export default function TemplatesPanel({ userJades = 0, onJadesUpdate }) {
  const [lang, setLang] = useState("es");
  const [view, setView] = useState("gallery"); // gallery | generate
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);
  const [genderVariant, setGenderVariant] = useState(null);
  const [quality, setQuality] = useState("480");

  // Upload slots: { protagonist, man, woman } each = { file, preview, profileData, profilePreview, generatingProfile }
  const emptySlot = () => ({ file: null, preview: null, profileData: null, profilePreview: null, generatingProfile: false });
  const [slots, setSlots] = useState({ protagonist: emptySlot(), man: emptySlot(), woman: emptySlot() });

  const [bodyFile, setBodyFile] = useState(null);
  const [bodyPreview, setBodyPreview] = useState(null);
  const [step, setStep] = useState("idle");
  const [taskId, setTaskId] = useState(null);
  const [pollCount, setPollCount] = useState(0);
  const [videoUrl, setVideoUrl] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  const tmpl = TEMPLATES.find((t) => t.id === selectedTemplateId);
  const accent = tmpl?.accent || "#C8A96E";
  const jadeCost = quality === "720" ? 60 : 30;

  // Determine active slots based on template + gender
  const activeSlots = () => {
    if (!tmpl || !genderVariant) return [];
    return tmpl.uploadConfig[genderVariant]?.slots || [];
  };

  // All active slots have profileData
  const allProfilesReady = activeSlots().every((s) => slots[s]?.profileData);
  const anyGeneratingProfile = activeSlots().some((s) => slots[s]?.generatingProfile);
  const canGenerate = allProfilesReady && !anyGeneratingProfile && step === "idle" && userJades >= jadeCost;

  const callApi = async (route, body) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/templates/${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || json.detail || "Error desconocido");
    return json;
  };

  const handleFaceUpload = async (slotKey, file) => {
    const preview = URL.createObjectURL(file);
    setSlots((prev) => ({ ...prev, [slotKey]: { ...prev[slotKey], file, preview, profileData: null, profilePreview: null, generatingProfile: true } }));
    setErrorMsg("");
    try {
      const b64 = await fileToBase64(file);
      const json = await callApi("generate-profile", { faceBase64: b64, faceMime: file.type });
      setSlots((prev) => ({
        ...prev,
        [slotKey]: {
          ...prev[slotKey],
          profileData: json.profile,
          profilePreview: `data:${json.profile.mimeType};base64,${json.profile.base64}`,
          generatingProfile: false,
        },
      }));
    } catch (e) {
      setSlots((prev) => ({ ...prev, [slotKey]: { ...prev[slotKey], generatingProfile: false } }));
      setErrorMsg(e.message);
    }
  };

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setStep("submitting"); setErrorMsg(""); setVideoUrl(null);
    try {
      const pSlot = slots.protagonist;
      const mSlot = slots.man;
      const wSlot = slots.woman;
      const bodyB64 = bodyFile ? await fileToBase64(bodyFile) : null;

      // Determine which faces to send based on variant
      let faceBase64, faceMime, profileBase64, profileMime;
      let face2Base64 = null, face2Mime = null, profile2Base64 = null, profile2Mime = null;

      if (genderVariant === "both") {
        // man = image1+2, woman = image3+4
        faceBase64 = await fileToBase64(mSlot.file); faceMime = mSlot.file.type;
        profileBase64 = mSlot.profileData.base64; profileMime = mSlot.profileData.mimeType;
        face2Base64 = await fileToBase64(wSlot.file); face2Mime = wSlot.file.type;
        profile2Base64 = wSlot.profileData.base64; profile2Mime = wSlot.profileData.mimeType;
      } else {
        faceBase64 = await fileToBase64(pSlot.file); faceMime = pSlot.file.type;
        profileBase64 = pSlot.profileData.base64; profileMime = pSlot.profileData.mimeType;
      }

      const json = await callApi("submit-video", {
        templateId: selectedTemplateId, lang, quality, genderVariant,
        faceBase64, faceMime, profileBase64, profileMime,
        face2Base64, face2Mime, profile2Base64, profile2Mime,
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
        const json = await callApi("poll-video", { taskId });
        setPollCount((c) => c + 1);
        if (json.status === "completed" || json.status === "succeed") {
          setVideoUrl(json.videoUrl); setStep("done"); clearInterval(iv);
        } else if (json.status === "failed" || json.status === "error") {
          throw new Error("Video generation failed");
        }
      } catch (e) { setErrorMsg(e.message); setStep("error"); clearInterval(iv); }
    }, 6000);
    return () => clearInterval(iv);
  }, [step, taskId]);

  const resetAll = () => {
    setView("gallery"); setSelectedTemplateId(null); setGenderVariant(null);
    setSlots({ protagonist: emptySlot(), man: emptySlot(), woman: emptySlot() });
    setBodyFile(null); setBodyPreview(null);
    setStep("idle"); setTaskId(null); setVideoUrl(null); setErrorMsg("");
  };

  const STYLES = `@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Inter:wght@300;400;500&display=swap');
  @keyframes spin { to { transform: rotate(360deg); } }`;

  // ── GALLERY ───────────────────────────────────────────────────────────────
  if (view === "gallery") return (
    <div style={{ fontFamily: "'Inter',sans-serif", color: "#fff", paddingBottom: 60 }}>
      <style>{STYLES}</style>
      <div style={{ padding: "28px 20px 0", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 22, fontWeight: 800 }}>🎬 {lang === "es" ? "Plantillas Épicas" : "Epic Templates"}</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 3 }}>
            {lang === "es" ? "Ponté en escenas cinematográficas de IA" : "Place yourself in AI cinematic scenes"}
          </div>
        </div>
        <div style={{ display: "flex", background: "rgba(255,255,255,0.07)", borderRadius: 10, padding: 3, gap: 2 }}>
          {["es", "en"].map((l) => (
            <button key={l} onClick={() => setLang(l)} style={{
              background: lang === l ? "#C8A96E" : "transparent", color: lang === l ? "#000" : "rgba(255,255,255,0.45)",
              border: "none", borderRadius: 7, padding: "5px 12px", fontFamily: "'Syne',sans-serif",
              fontWeight: 700, fontSize: 11, cursor: "pointer",
            }}>{l === "es" ? "🇪🇸 ES" : "🇺🇸 EN"}</button>
          ))}
        </div>
      </div>
      <div style={{
        margin: "16px 20px 0", background: "linear-gradient(135deg,rgba(200,169,110,0.1),rgba(200,169,110,0.03))",
        border: "1px solid rgba(200,169,110,0.18)", borderRadius: 14, padding: "14px 16px",
      }}>
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 700, marginBottom: 3 }}>
          {lang === "es" ? "✨ Elige una escena y ponté en ella" : "✨ Choose a scene and place yourself in it"}
        </div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
          {lang === "es"
            ? "Sube una foto de tu rostro. La IA genera un video cinematográfico de 15 segundos contigo como protagonista."
            : "Upload your photo. AI generates a 15-second cinematic video with you as the protagonist."}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "16px 20px 0" }}>
        {TEMPLATES.map((t) => (
          <GalleryCard key={t.id} tmpl={t} lang={lang} onClick={() => {
            setSelectedTemplateId(t.id);
            // Auto-set gender for Victoria's Secret
            setGenderVariant(t.genderOptions ? null : "female");
            setView("generate");
          }} />
        ))}
      </div>
      <div style={{ padding: "14px 20px 0", fontSize: 10, color: "rgba(255,255,255,0.18)", textAlign: "center" }}>
        {lang === "es" ? "Hover para previsualizar · 15 segundos · Formato 9:16" : "Hover to preview · 15 seconds · 9:16 format"}
      </div>
    </div>
  );

  // ── GENERATE VIEW ─────────────────────────────────────────────────────────
  const currentSlots = activeSlots();

  return (
    <div style={{ fontFamily: "'Inter',sans-serif", color: "#fff", paddingBottom: 80 }}>
      <style>{STYLES}</style>

      {/* Header */}
      <div style={{ padding: "20px 20px 0", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={resetAll} style={{
          background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 10, padding: "8px 14px", color: "#fff", cursor: "pointer",
          fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 12,
        }}>← {lang === "es" ? "Volver" : "Back"}</button>
        <div style={{ flex: 1, fontFamily: "'Syne',sans-serif", fontSize: 15, fontWeight: 800 }}>
          {tmpl?.emoji} {tmpl?.label[lang]}
        </div>
        <div style={{ display: "flex", background: "rgba(255,255,255,0.07)", borderRadius: 8, padding: 2, gap: 2 }}>
          {["es", "en"].map((l) => (
            <button key={l} onClick={() => setLang(l)} style={{
              background: lang === l ? accent : "transparent", color: lang === l ? "#000" : "rgba(255,255,255,0.4)",
              border: "none", borderRadius: 6, padding: "4px 10px",
              fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 10, cursor: "pointer",
            }}>{l.toUpperCase()}</button>
          ))}
        </div>
      </div>

      {/* Jades */}
      <div style={{ padding: "12px 20px 0" }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 10, padding: "10px 14px",
        }}>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>{lang === "es" ? "Tus Jades" : "Your Jades"}</span>
          <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 14, color: accent }}>💎 {userJades}</span>
        </div>
      </div>

      {/* Step 1: Gender selector (skip for Victoria's Secret) */}
      {tmpl?.genderOptions && (
        <div style={{ padding: "20px 20px 0" }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: accent, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>
            {lang === "es" ? "1 · ¿Quién eres en la escena?" : "1 · Who are you in the scene?"}
          </div>
          <GenderSelector options={tmpl.genderOptions} value={genderVariant} onChange={(v) => {
            setGenderVariant(v);
            setSlots({ protagonist: emptySlot(), man: emptySlot(), woman: emptySlot() });
          }} accent={accent} lang={lang} />
        </div>
      )}

      {/* Step 2: Face uploads — only show if gender selected */}
      {genderVariant && (
        <div style={{ padding: "20px 20px 0" }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: accent, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>
            {tmpl?.genderOptions
              ? (lang === "es" ? "2 · Foto(s) de rostro" : "2 · Face photo(s)")
              : (lang === "es" ? "1 · Tu foto de rostro" : "1 · Your face photo")}
          </div>
          <div style={{
            fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.6,
            background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "10px 12px", marginBottom: 12,
          }}>
            📌 {lang === "es"
              ? "Foto frontal · Sin lentes · Sin accesorios · Sin filtros · Buena iluminación"
              : "Front photo · No glasses · No accessories · No filters · Good lighting"}
          </div>

          {currentSlots.map((slotKey) => (
            <div key={slotKey} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 8, fontFamily: "'Syne',sans-serif", fontWeight: 600 }}>
                {SLOT_LABELS[slotKey][lang]}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <UploadZone
                  label={lang === "es" ? "Subir foto" : "Upload photo"}
                  hint={lang === "es" ? "Foto frontal clara" : "Clear front photo"}
                  onChange={(f) => handleFaceUpload(slotKey, f)}
                  preview={slots[slotKey].preview}
                  accent={accent}
                />
                <div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 6 }}>
                    {lang === "es" ? "Perfiles (auto·Gemini)" : "Profile sheet (auto·Gemini)"}
                  </div>
                  {slots[slotKey].generatingProfile ? (
                    <div style={{
                      border: `2px dashed ${accent}55`, borderRadius: 14, height: 150,
                      display: "flex", flexDirection: "column", alignItems: "center",
                      justifyContent: "center", gap: 8, background: `${accent}08`,
                    }}>
                      <div style={{ fontSize: 22, animation: "spin 1.2s linear infinite" }}>⚙️</div>
                      <div style={{ fontSize: 11, color: accent, fontFamily: "'Syne',sans-serif", fontWeight: 700 }}>Gemini AI...</div>
                    </div>
                  ) : slots[slotKey].profilePreview ? (
                    <div style={{ borderRadius: 14, overflow: "hidden", border: `1px solid ${accent}44` }}>
                      <img src={slots[slotKey].profilePreview} alt="" style={{ width: "100%", height: 150, objectFit: "cover" }} />
                      <div style={{ padding: "6px 10px", background: "rgba(0,0,0,0.7)", fontSize: 10, color: accent, fontFamily: "'Syne',sans-serif", fontWeight: 700 }}>
                        ✓ {lang === "es" ? "Lista" : "Ready"}
                      </div>
                    </div>
                  ) : (
                    <div style={{
                      border: "2px dashed rgba(255,255,255,0.07)", borderRadius: 14, height: 150,
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6,
                    }}>
                      <div style={{ fontSize: 24, opacity: 0.15 }}>🎭</div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", textAlign: "center", padding: "0 12px" }}>
                        {lang === "es" ? "Se genera al subir foto" : "Auto-generated on upload"}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Step 3: Body (optional) */}
      {genderVariant && (
        <div style={{ padding: "0 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: accent, textTransform: "uppercase", letterSpacing: 1.5 }}>
              {tmpl?.genderOptions
                ? (lang === "es" ? "3 · Ref. de cuerpo" : "3 · Body reference")
                : (lang === "es" ? "2 · Ref. de cuerpo" : "2 · Body reference")}
            </div>
            <div style={{ fontSize: 9, background: "rgba(255,255,255,0.07)", borderRadius: 5, padding: "2px 7px", color: "rgba(255,255,255,0.3)" }}>
              {lang === "es" ? "Opcional" : "Optional"}
            </div>
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginBottom: 8, lineHeight: 1.5 }}>
            🎽 {lang === "es" ? "Solo proporciones. La IA NO usará la misma ropa." : "Proportions only. AI will NOT copy the clothing."}
          </div>
          <UploadZone
            label={lang === "es" ? "Foto de cuerpo (opcional)" : "Body photo (optional)"}
            hint={lang === "es" ? "Solo proporciones — ropa diferente" : "Proportions only — different clothes"}
            onChange={(f) => { setBodyFile(f); setBodyPreview(URL.createObjectURL(f)); }}
            preview={bodyPreview} accent={accent} height={110}
          />
        </div>
      )}

      {/* Step 4: Quality */}
      {genderVariant && (
        <div style={{ padding: "18px 20px 0" }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: accent, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>
            {tmpl?.genderOptions
              ? (lang === "es" ? "4 · Calidad" : "4 · Quality")
              : (lang === "es" ? "3 · Calidad" : "3 · Quality")}
          </div>
          <QualitySelector value={quality} onChange={setQuality} lang={lang} />
        </div>
      )}

      {/* Error */}
      {step === "error" && (
        <div style={{
          margin: "14px 20px 0", background: "rgba(255,60,60,0.08)",
          border: "1px solid rgba(255,60,60,0.25)", borderRadius: 12,
          padding: "12px 14px", fontSize: 12, color: "#ff8080", lineHeight: 1.5,
        }}>
          ⚠️ {errorMsg}
          <button onClick={() => setStep("idle")} style={{
            marginLeft: 10, background: "none", border: "1px solid rgba(255,80,80,0.4)",
            color: "#ff8080", borderRadius: 6, padding: "2px 8px", fontSize: 11, cursor: "pointer",
          }}>{lang === "es" ? "Reintentar" : "Retry"}</button>
        </div>
      )}

      {/* Polling */}
      {step === "polling" && (
        <div style={{
          margin: "14px 20px 0", background: `${accent}08`, border: `1px solid ${accent}33`,
          borderRadius: 14, padding: "20px", textAlign: "center",
        }}>
          <div style={{ fontSize: 36, marginBottom: 10, animation: "spin 2s linear infinite" }}>🎬</div>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 14, fontWeight: 800, color: accent, marginBottom: 4 }}>
            {lang === "es" ? "Generando tu video..." : "Generating your video..."}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginBottom: 14 }}>
            {lang === "es" ? "Puede tomar 3–6 minutos" : "May take 3–6 minutes"} · {pollCount * 6}s
          </div>
          <div style={{ background: "rgba(255,255,255,0.07)", borderRadius: 8, height: 4, overflow: "hidden" }}>
            <div style={{
              height: "100%", background: accent, borderRadius: 8,
              width: `${Math.min((pollCount / 60) * 100, 90)}%`, transition: "width 0.6s",
            }} />
          </div>
        </div>
      )}

      {/* Done */}
      {step === "done" && videoUrl && (
        <div style={{
          margin: "14px 20px 0", background: "rgba(50,200,100,0.05)",
          border: "1px solid rgba(50,200,100,0.2)", borderRadius: 14, overflow: "hidden",
        }}>
          <video src={videoUrl} controls playsInline style={{ width: "100%", maxHeight: 400, objectFit: "contain", background: "#000" }} />
          <div style={{ padding: "14px 16px", display: "flex", gap: 10 }}>
            <a href={videoUrl} download="isabelaos-video.mp4" style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
              background: accent, color: "#000", padding: "11px", borderRadius: 10,
              textDecoration: "none", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 13,
            }}>⬇️ {lang === "es" ? "Descargar" : "Download"}</a>
            <button onClick={resetAll} style={{
              flex: 1, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)",
              color: "#fff", padding: "11px", borderRadius: 10, cursor: "pointer",
              fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 13,
            }}>{lang === "es" ? "✨ Otra plantilla" : "✨ Another template"}</button>
          </div>
        </div>
      )}

      {/* Generate button */}
      {step !== "done" && genderVariant && (
        <div style={{ padding: "18px 20px 0" }}>
          <button onClick={handleGenerate} disabled={!canGenerate} style={{
            width: "100%",
            background: canGenerate ? `linear-gradient(135deg,${accent},${accent}bb)` : "rgba(255,255,255,0.06)",
            color: canGenerate ? "#000" : "rgba(255,255,255,0.2)",
            border: "none", borderRadius: 14, padding: "18px",
            fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 15,
            cursor: canGenerate ? "pointer" : "not-allowed", transition: "all 0.2s",
          }}>
            {step === "submitting" ? (lang === "es" ? "⏳ Enviando..." : "⏳ Submitting...")
              : anyGeneratingProfile ? (lang === "es" ? "⚙️ Preparando perfiles..." : "⚙️ Preparing profiles...")
              : `✨ ${lang === "es" ? "Generar Mi Video" : "Generate My Video"} · ${jadeCost} 💎`}
          </button>
          {!allProfilesReady && !anyGeneratingProfile && (
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", textAlign: "center", marginTop: 8 }}>
              {lang === "es" ? "↑ Sube las fotos de rostro primero" : "↑ Upload face photos first"}
            </div>
          )}
          {allProfilesReady && userJades < jadeCost && (
            <div style={{ fontSize: 11, color: "#ff8080", textAlign: "center", marginTop: 8 }}>
              {lang === "es" ? `Necesitas ${jadeCost} 💎 · Tienes ${userJades}` : `Need ${jadeCost} 💎 · Have ${userJades}`}
            </div>
          )}
        </div>
      )}

      {/* Prompt user to select gender if not yet */}
      {!genderVariant && tmpl?.genderOptions && (
        <div style={{ padding: "16px 20px 0", fontSize: 12, color: "rgba(255,255,255,0.3)", textAlign: "center" }}>
          {lang === "es" ? "↑ Selecciona quién eres en la escena" : "↑ Select who you are in the scene"}
        </div>
      )}
    </div>
  );
}
