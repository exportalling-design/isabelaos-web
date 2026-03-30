// src/components/ComercialPanel.jsx
import { useState, useRef } from "react";
import { supabase } from "../lib/supabaseClient";

const COMERCIAL_COST = 120;

async function getAuthHeaders() {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  } catch { return {}; }
}

async function fileToBase64(file) {
  const buf = await file.arrayBuffer();
  return btoa(new Uint8Array(buf).reduce((d, b) => d + String.fromCharCode(b), ""));
}

async function compressImage(file, maxWidth = 1024) {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale  = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        blob => { URL.revokeObjectURL(url); blob ? resolve(blob) : reject(new Error("Error comprimiendo")); },
        "image/jpeg", 0.85
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Error cargando imagen")); };
    img.src = url;
  });
}

const ACCENTS = [
  { value: "neutro",       label: "🌎 Neutro latino" },
  { value: "guatemalteco", label: "🇬🇹 Guatemalteco" },
  { value: "colombiano",   label: "🇨🇴 Colombiano"   },
  { value: "mexicano",     label: "🇲🇽 Mexicano"     },
  { value: "argentino",    label: "🇦🇷 Argentino"    },
  { value: "español",      label: "🇪🇸 Español"      },
  { value: "ingles",       label: "🇺🇸 English (US)" },
];

const TRANSITIONS = [
  { value: "fade",     label: "⬛ Fade",     sub: "Fade a negro · emotivo"    },
  { value: "dissolve", label: "🌀 Dissolve", sub: "Mezcla suave · elegante"   },
  { value: "cut",      label: "✂️ Cut",      sub: "Corte directo · energético" },
];

const EXAMPLES = [
  "Comercial de una boutique de ropa femenina elegante. Una mujer entra, se prueba vestidos y sale radiante.",
  "Anuncio de un restaurante de comida típica guatemalteca. Platos humeantes, ambiente familiar, precios accesibles.",
  "Promoción de un spa y salón de belleza. Relajación, tratamientos, transformación personal.",
  "Comercial de joyería artesanal. Primer plano de las piezas, elegancia, regalo perfecto.",
];

function SceneCard({ scene }) {
  const videoRef = useRef(null);
  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 overflow-hidden">
      <div className="bg-black/60 px-4 py-2 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-white">Escena {scene.scene_number}</span>
          {scene.narrative_role && (
            <span className="rounded-full bg-cyan-500/20 px-2 py-0.5 text-[9px] text-cyan-300 capitalize">{scene.narrative_role}</span>
          )}
        </div>
        <span className="text-[10px] text-neutral-400">{scene.camera}</span>
      </div>
      <div className="relative bg-black aspect-[9/16] max-h-[280px] w-full">
        {scene.video_url ? (
          <video ref={videoRef} src={scene.video_url} controls className="w-full h-full object-contain" />
        ) : scene.video_b64 ? (
          <video ref={videoRef} src={`data:video/mp4;base64,${scene.video_b64}`} controls className="w-full h-full object-contain" />
        ) : scene.image_b64 ? (
          <img src={`data:${scene.image_mime};base64,${scene.image_b64}`} alt="" className="w-full h-full object-contain" />
        ) : (
          <div className="flex items-center justify-center h-full text-neutral-500 text-xs p-4 text-center">{scene.error || "Sin contenido"}</div>
        )}
        {!scene.ok && scene.error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-3">
            <span className="text-xs text-red-300 text-center">{scene.error}</span>
          </div>
        )}
      </div>
      {scene.narration_text && (
        <div className="px-4 py-3 border-t border-white/5">
          <p className="text-[11px] text-neutral-300 italic">"{scene.narration_text}"</p>
          {scene.audio_b64 && <audio controls className="mt-2 w-full h-8" src={`data:${scene.audio_mime};base64,${scene.audio_b64}`} />}
        </div>
      )}
      {(scene.video_url || scene.video_b64) && (
        <div className="px-4 pb-3 flex gap-2">
          <a href={scene.video_url || `data:video/mp4;base64,${scene.video_b64}`} download={`escena-${scene.scene_number}.mp4`}
            className="flex-1 block text-center rounded-xl border border-white/20 py-1.5 text-[10px] text-neutral-300 hover:bg-white/10 transition-all">↓ Video</a>
          {scene.audio_b64 && (
            <a href={`data:audio/mpeg;base64,${scene.audio_b64}`} download={`narración-${scene.scene_number}.mp3`}
              className="flex-1 block text-center rounded-xl border border-cyan-400/30 py-1.5 text-[10px] text-cyan-200 hover:bg-cyan-500/10 transition-all">↓ Audio</a>
          )}
        </div>
      )}
    </div>
  );
}

export default function ComercialPanel({ userStatus }) {
  const [refFiles,    setRefFiles]    = useState([]);
  const [refPreviews, setRefPreviews] = useState([]);
  const [description, setDescription] = useState("");
  const [duration,    setDuration]    = useState(30);
  const [accent,      setAccent]      = useState("neutro");
  const [gender,      setGender]      = useState("mujer");
  const [transition,  setTransition]  = useState("fade");
  const [step,        setStep]        = useState("config");
  const [storyboard,  setStoryboard]  = useState(null);
  const [result,      setResult]      = useState(null);
  const [finalVideo,  setFinalVideo]  = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [assembling,  setAssembling]  = useState(false);
  const [statusText,  setStatusText]  = useState("");
  const [error,       setError]       = useState("");

  const currentJades = userStatus?.jades ?? 0;

  async function handleRefFiles(e) {
    const nuevas = Array.from(e.target.files || []);
    if (!nuevas.length) return;
    setRefFiles(prev    => [...prev, ...nuevas].slice(0, 3));
    setRefPreviews(prev => [...prev, ...nuevas.map(f => URL.createObjectURL(f))].slice(0, 3));
    e.target.value = "";
  }

  function removeRef(idx) {
    setRefFiles(prev    => prev.filter((_, i) => i !== idx));
    setRefPreviews(prev => prev.filter((_, i) => i !== idx));
  }

  async function compressAll() {
    const out = [];
    for (const file of refFiles) {
      const blob = await compressImage(file);
      const b64  = await fileToBase64(new File([blob], "ref.jpg", { type: "image/jpeg" }));
      out.push({ base64: b64, mimeType: "image/jpeg" });
    }
    return out;
  }

  async function handleGenerateStoryboard() {
    if (!description.trim()) { setError("Describe tu comercial primero."); return; }
    if (currentJades < COMERCIAL_COST) { setError(`Necesitas ${COMERCIAL_COST} Jades. Tienes ${currentJades}.`); return; }
    setError(""); setLoading(true); setStatusText("Creando el guión de tu comercial...");
    try {
      const refImages = await compressAll();
      const auth = await getAuthHeaders();
      const r = await fetch("/api/comercial-storyboard", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({ description, duration, accent, gender, hasAvatar: false, referenceImages: refImages }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Error generando guión.");
      setStoryboard(j.storyboard);
      setStep("storyboard");
    } catch (e) { setError("No se pudo crear el guión. Intenta de nuevo."); console.error(e); }
    finally { setLoading(false); setStatusText(""); }
  }

  async function handleGenerateComercial() {
    setError(""); setLoading(true); setStep("generating");
    setStatusText(`Produciendo ${storyboard.scenes.length} escenas...`);
    try {
      const refImages = await compressAll();
      const auth = await getAuthHeaders();
      const r = await fetch("/api/comercial-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({ storyboard, referenceImages: refImages, accent, gender, hasAvatar: false }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        if (j?.error === "INSUFFICIENT_JADES") { setError("Jades insuficientes."); setStep("config"); return; }
        throw new Error(j?.error || "Error generando comercial.");
      }
      setResult(j); setStep("done");
    } catch (e) { setError("Ocurrió un problema. Intenta de nuevo."); setStep("storyboard"); console.error(e); }
    finally { setLoading(false); setStatusText(""); }
  }

  async function handleAssemble() {
    if (!result?.scenes?.length) return;
    const validScenes = result.scenes.filter(s => s.video_b64 || s.video_url);
    if (!validScenes.length) { setError("No hay clips para ensamblar."); return; }
    setAssembling(true); setError(""); setStatusText("Ensamblando tu comercial...");
    try {
      const auth = await getAuthHeaders();
      const scenesPayload = validScenes.map(s => ({ scene_number: s.scene_number, video_b64: s.video_b64 || null, audio_b64: s.audio_b64 || null, duration_seconds: 8 }));
      setStatusText("Aplicando transiciones y generando video final... 1-3 minutos ⏳");
      const r = await fetch("/api/comercial-assemble", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({ scenes: scenesPayload, title: result.title, transition }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.detail || j?.error || "Error ensamblando.");
      setFinalVideo(j);
      if (j.saved_to_library) setStatusText("✅ Video guardado en tu biblioteca");
    } catch (e) { setError(`Error: ${e?.message || e}`); console.error(e); }
    finally { setAssembling(false); }
  }

  const selectedAccentLabel = ACCENTS.find(a => a.value === accent)?.label || accent;

  return (
    <div className="space-y-6">

      {/* ══ BANNER EN CONSTRUCCIÓN ══ */}
      <div className="relative overflow-hidden rounded-3xl border border-yellow-400/30 bg-gradient-to-br from-yellow-500/10 via-orange-500/5 to-yellow-500/10 p-8 text-center">
        {/* Fondo animado */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute -top-4 -left-4 h-32 w-32 rounded-full bg-yellow-400 blur-3xl animate-pulse" />
          <div className="absolute -bottom-4 -right-4 h-32 w-32 rounded-full bg-orange-400 blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />
        </div>

        <div className="relative">
          <div className="text-5xl mb-4">🚧</div>
          <h2 className="text-2xl font-bold text-yellow-300">Módulo en construcción</h2>
          <p className="mt-2 text-sm text-yellow-200/70 max-w-md mx-auto">
            Estamos finalizando los últimos detalles de Comercial IA para darte la mejor experiencia posible.
            Muy pronto podrás generar comerciales profesionales completos desde aquí.
          </p>
          <div className="mt-5 flex items-center justify-center gap-2 text-xs text-yellow-300/60">
            <span className="h-1.5 w-1.5 rounded-full bg-yellow-400 animate-bounce" style={{ animationDelay: "0s" }} />
            <span className="h-1.5 w-1.5 rounded-full bg-yellow-400 animate-bounce" style={{ animationDelay: "0.2s" }} />
            <span className="h-1.5 w-1.5 rounded-full bg-yellow-400 animate-bounce" style={{ animationDelay: "0.4s" }} />
            <span className="ml-1">Disponible muy pronto</span>
          </div>
        </div>
      </div>

      {/* ══ RESTO DEL PANEL (deshabilitado visualmente) ══ */}
      <div className="opacity-30 pointer-events-none select-none space-y-6">

        {/* Encabezado */}
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Comercial IA</h2>
            <p className="mt-1 text-sm text-neutral-400">Sube fotos de tu producto, ropa, negocio o persona y genera un comercial profesional completo.</p>
          </div>
          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/5 px-4 py-2 text-right">
            <div className="text-xs text-neutral-400">Precio todo incluido</div>
            <div className="text-lg font-bold text-cyan-300">{COMERCIAL_COST} Jades</div>
            <div className="text-[10px] text-neutral-500">≈ $12 USD</div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
          {[
            { icon: "🎬", label: "4-7 clips de video",  sub: "8 segundos cada uno"       },
            { icon: "🎙️", label: "Narración en off",    sub: "Acento y voz a tu elección" },
            { icon: "✂️", label: "Video final completo", sub: "Con transiciones incluidas" },
            { icon: "📱", label: "Formato vertical",    sub: "Listo para Reels y TikTok"  },
          ].map(({ icon, label, sub }) => (
            <div key={label} className="rounded-2xl border border-white/10 bg-black/30 px-3 py-3 text-center">
              <div className="text-xl mb-1">{icon}</div>
              <div className="font-semibold text-white">{label}</div>
              <div className="text-neutral-500 mt-0.5">{sub}</div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-8 text-center text-neutral-500 text-sm">
          El formulario de configuración estará disponible pronto.
        </div>
      </div>

    </div>
  );
}
