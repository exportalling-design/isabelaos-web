// src/components/ComercialPanel.jsx
// ─────────────────────────────────────────────────────────────
// Panel principal de Comercial IA con 5 plantillas:
//   1. Transición de Moda   → Seedance Omni (ropa que cambia, modelo fijo)
//   2. Producto Estelar      → Seedance I2V  (producto lanzado + efectos)
//   3. Desfile Mágico        → Seedance I2V  (prendas + efecto elegido + modelo)
//   4. Explosión de Sabor    → Seedance I2V  (comida desintegrada en capas)
//   5. Chef IA               → Seedance I2V  (chef avatar prepara el plato)
//
// Costo: 30 Jades por generación
// Guardado: bucket "videos" en Supabase Storage (misma biblioteca)
// ─────────────────────────────────────────────────────────────
import { useState, useRef } from "react";
import { supabase } from "../lib/supabaseClient";

const PLANTILLA_COST = 30;

// ── Definición de plantillas ──────────────────────────────────
const PLANTILLAS = [
  {
    id: "transicion_moda",
    nombre: "Transición de Moda",
    emoji: "👗",
    descripcion: "Sube fotos de tu modelo y prendas. El modelo permanece igual y solo cambia la ropa en transición suave.",
    colores: "from-pink-500/20 via-rose-500/10 to-purple-500/20",
    borde: "border-pink-500/30",
    acento: "text-pink-300",
    boton: "bg-pink-500/20 hover:bg-pink-500/30 border-pink-400/40",
    campos: {
      modelo: { label: "📸 Foto del modelo (1 foto)", tipo: "imagen_unica", requerido: true, hint: "Foto completa del modelo de frente" },
      prendas: { label: "👚 Fotos de prendas (2-4 prendas)", tipo: "imagen_multiple", max: 4, requerido: true, hint: "Cada prenda en fondo blanco o claro" },
      fondo: { label: "🏖️ Fondo / escena (opcional)", tipo: "imagen_unica", requerido: false, hint: "Playa, piscina, ciudad — o déjalo en blanco para fondo IA" },
      narracion: { label: "🎙️ Narración (opcional)", tipo: "texto", requerido: false, hint: "Texto que quieres que se escuche en el video" },
    }
  },
  {
    id: "producto_estelar",
    nombre: "Producto Estelar",
    emoji: "✨",
    descripcion: "Sube la foto de tu producto. Una mano lo lanza al aire y se transforma con efectos espectaculares.",
    colores: "from-cyan-500/20 via-blue-500/10 to-indigo-500/20",
    borde: "border-cyan-500/30",
    acento: "text-cyan-300",
    boton: "bg-cyan-500/20 hover:bg-cyan-500/30 border-cyan-400/40",
    campos: {
      producto: { label: "📦 Foto de tu producto", tipo: "imagen_unica", requerido: true, hint: "Cualquier producto: perfume, crema, ropa, accesorio..." },
      efecto: { label: "✨ Efecto de transformación", tipo: "selector", opciones: [
        { value: "splash", label: "💧 Splash — líquido y foam" },
        { value: "petals", label: "🌸 Pétalos y flores" },
        { value: "fire",   label: "🔥 Fuego y energía" },
        { value: "luxury", label: "💎 Partículas doradas" },
        { value: "smoke",  label: "🌫️ Humo y cristales" },
      ], requerido: true },
      narracion: { label: "🎙️ Narración (opcional)", tipo: "texto", requerido: false, hint: "Ej: Descubre el producto que transformará tu rutina" },
    }
  },
  {
    id: "desfile_magico",
    nombre: "Desfile Mágico",
    emoji: "🪄",
    descripcion: "Sube prendas sueltas. La IA las une con un efecto mágico y hace aparecer el outfit completo en una modelo.",
    colores: "from-violet-500/20 via-purple-500/10 to-fuchsia-500/20",
    borde: "border-violet-500/30",
    acento: "text-violet-300",
    boton: "bg-violet-500/20 hover:bg-violet-500/30 border-violet-400/40",
    campos: {
      prendas: { label: "👔 Fotos de prendas del outfit (2-5)", tipo: "imagen_multiple", max: 5, requerido: true, hint: "Blusa, pantalón, zapatos, accesorios — lo que tengas" },
      efecto: { label: "🎨 Estilo de efecto mágico", tipo: "selector", opciones: [
        { value: "aurora",   label: "🌌 Aurora — partículas de luz + humo" },
        { value: "bloom",    label: "🌺 Bloom — flores + líquido" },
        { value: "galaxia",  label: "🌠 Galaxia — destellos + morphing" },
        { value: "natura",   label: "🦋 Natura — mariposas + niebla" },
        { value: "fuego_frio", label: "❄️🔥 Fuego Frío — humo + cristales dorados" },
      ], requerido: true },
      fondo: { label: "🏖️ Fondo / escena (opcional)", tipo: "imagen_unica", requerido: false, hint: "Playa, resort, ciudad — o déjalo en blanco" },
      narracion: { label: "🎙️ Narración (opcional)", tipo: "texto", requerido: false, hint: "Ej: Luce increíble con nuestra nueva colección" },
    }
  },
  {
    id: "explosion_sabor",
    nombre: "Explosión de Sabor",
    emoji: "💥",
    descripcion: "Sube la foto de tu platillo. La IA lo desintegra en capas mostrando cada ingrediente flotando con efectos épicos.",
    colores: "from-orange-500/20 via-amber-500/10 to-red-500/20",
    borde: "border-orange-500/30",
    acento: "text-orange-300",
    boton: "bg-orange-500/20 hover:bg-orange-500/30 border-orange-400/40",
    campos: {
      plato: { label: "🍔 Foto de tu platillo", tipo: "imagen_unica", requerido: true, hint: "Burger, taco, pizza, comida china, lo que sea" },
      nombre_negocio: { label: "🏪 Nombre de tu negocio", tipo: "texto_corto", requerido: true, hint: "Ej: Burger Bros, Tacos El Rey, Sushi Palace" },
      slogan: { label: "💬 Slogan o texto del video", tipo: "texto_corto", requerido: false, hint: "Ej: ¡Sabor que te conquista!" },
      narracion: { label: "🎙️ Texto para narración ElevenLabs", tipo: "texto", requerido: false, hint: "Lo que quieres que se escuche mientras explota el plato" },
    }
  },
  {
    id: "chef_ia",
    nombre: "Chef IA",
    emoji: "👨‍🍳",
    descripcion: "Sube tu foto o elige un avatar chef. La IA genera un video cinematográfico mostrando cómo preparas tu plato.",
    colores: "from-slate-500/20 via-zinc-500/10 to-neutral-500/20",
    borde: "border-slate-500/30",
    acento: "text-slate-300",
    boton: "bg-slate-500/20 hover:bg-slate-500/30 border-slate-400/40",
    campos: {
      plato: { label: "🍽️ Foto de tu platillo terminado", tipo: "imagen_unica", requerido: true, hint: "La foto del plato que vas a preparar en el video" },
      chef: { label: "👤 Tu foto (rostro) o avatar IA", tipo: "imagen_unica_o_avatar", requerido: false, hint: "Sube tu foto para que aparezcas tú, o elige un chef IA" },
      avatar_tipo: { label: "🤖 Avatar chef (si no subes foto)", tipo: "selector", opciones: [
        { value: "chef_hombre_latino",  label: "👨 Chef hombre latino" },
        { value: "chef_mujer_latina",   label: "👩 Chef mujer latina" },
        { value: "chef_hombre_barbudo", label: "🧔 Chef hombre barbudo tatuado" },
        { value: "chef_mujer_moderna",  label: "💁‍♀️ Chef mujer moderna" },
      ], requerido: false },
      nombre_negocio: { label: "🏪 Nombre de tu negocio", tipo: "texto_corto", requerido: true, hint: "Ej: La Parrilla de Don Pedro" },
      narracion: { label: "🎙️ Texto para narración", tipo: "texto", requerido: false, hint: "Ej: En La Parrilla usamos solo los mejores ingredientes" },
    }
  },
];

const ACCENTS = [
  { value: "neutro",       label: "🌎 Neutro latino" },
  { value: "guatemalteco", label: "🇬🇹 Guatemalteco" },
  { value: "colombiano",   label: "🇨🇴 Colombiano"   },
  { value: "mexicano",     label: "🇲🇽 Mexicano"     },
  { value: "argentino",    label: "🇦🇷 Argentino"    },
  { value: "español",      label: "🇪🇸 Español"      },
  { value: "ingles",       label: "🇺🇸 English (US)" },
];

// ── Helpers ───────────────────────────────────────────────────
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

async function prepareImage(file) {
  const blob = await compressImage(file);
  const b64  = await fileToBase64(new File([blob], "img.jpg", { type: "image/jpeg" }));
  return { base64: b64, mimeType: "image/jpeg" };
}

// ── Subcomponente: Selector de imagen ─────────────────────────
function ImageUploadZone({ label, hint, multiple, max = 1, onFiles, previews = [], onRemove }) {
  const ref = useRef(null);
  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold text-neutral-300">{label}</label>
      {hint && <p className="text-[10px] text-neutral-500">{hint}</p>}
      <div
        onClick={() => ref.current?.click()}
        className="relative flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-white/20 bg-white/5 p-5 cursor-pointer hover:border-white/40 hover:bg-white/10 transition-all min-h-[80px]"
      >
        <input
          ref={ref}
          type="file"
          accept="image/*"
          multiple={multiple}
          className="hidden"
          onChange={e => {
            const files = Array.from(e.target.files || []);
            if (files.length) onFiles(files);
            e.target.value = "";
          }}
        />
        <span className="text-2xl">📷</span>
        <span className="text-[11px] text-neutral-400">
          {multiple ? `Subir imágenes (máx ${max})` : "Subir imagen"}
        </span>
      </div>
      {previews.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-1">
          {previews.map((src, i) => (
            <div key={i} className="relative group">
              <img src={src} alt="" className="h-16 w-16 rounded-xl object-cover border border-white/10" />
              <button
                onClick={() => onRemove(i)}
                className="absolute -top-1.5 -right-1.5 hidden group-hover:flex items-center justify-center h-5 w-5 rounded-full bg-red-500 text-white text-[10px] font-bold"
              >×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Subcomponente: Selector de opción ─────────────────────────
function OptionSelector({ label, opciones, value, onChange }) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold text-neutral-300">{label}</label>
      <div className="grid grid-cols-1 gap-1.5">
        {opciones.map(op => (
          <button
            key={op.value}
            onClick={() => onChange(op.value)}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] text-left transition-all ${
              value === op.value
                ? "border-white/40 bg-white/15 text-white"
                : "border-white/10 bg-white/5 text-neutral-400 hover:border-white/25 hover:bg-white/10"
            }`}
          >
            <span>{op.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Subcomponente: Card de resultado de video ─────────────────
function VideoResultCard({ jobId, status, videoUrl, error }) {
  if (status === "generating") {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/40 p-6 text-center space-y-3">
        <div className="flex justify-center gap-1.5">
          {[0,1,2].map(i => (
            <span key={i} className="h-2 w-2 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: `${i * 0.2}s` }} />
          ))}
        </div>
        <p className="text-sm text-neutral-400">Generando tu video...</p>
        <p className="text-[10px] text-neutral-600">Esto puede tomar 1-3 minutos</p>
        {jobId && <p className="text-[9px] text-neutral-700 font-mono">Job: {jobId}</p>}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-center">
        <p className="text-xs text-red-300">{error}</p>
      </div>
    );
  }

  if (videoUrl) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/40 overflow-hidden">
        <video src={videoUrl} controls className="w-full aspect-[9/16] max-h-[400px] object-contain bg-black" />
        <div className="px-4 py-3 flex gap-2">
          <a
            href={videoUrl}
            download="plantilla-video.mp4"
            className="flex-1 block text-center rounded-xl border border-white/20 py-2 text-[11px] text-neutral-300 hover:bg-white/10 transition-all"
          >
            ↓ Descargar video
          </a>
        </div>
      </div>
    );
  }

  return null;
}

// ── Componente principal ──────────────────────────────────────
export default function ComercialPanel({ userStatus }) {
  const [plantillaActiva, setPlantillaActiva] = useState(null);

  // Estado de campos por plantilla
  const [imagenes, setImagenes]     = useState({}); // { campo: [File] }
  const [previews, setPreviews]     = useState({}); // { campo: [string] }
  const [textos, setTextos]         = useState({}); // { campo: string }
  const [selectores, setSelectores] = useState({}); // { campo: string }

  // Narración ElevenLabs
  const [accent, setAccent]   = useState("neutro");
  const [gender, setGender]   = useState("mujer");

  // Estado de generación
  const [loading,    setLoading]    = useState(false);
  const [statusText, setStatusText] = useState("");
  const [error,      setError]      = useState("");
  const [resultado,  setResultado]  = useState(null); // { jobId, videoUrl, status }

  const currentJades = userStatus?.jades ?? 0;

  // ── Seleccionar plantilla ─────────────────────────────────
  function seleccionarPlantilla(p) {
    setPlantillaActiva(p);
    setImagenes({});
    setPreviews({});
    setTextos({});
    setSelectores({});
    setError("");
    setResultado(null);
    // Preseleccionar primera opción de selectores
    const presel = {};
    Object.entries(p.campos).forEach(([key, campo]) => {
      if (campo.tipo === "selector" && campo.opciones?.length) {
        presel[key] = campo.opciones[0].value;
      }
    });
    setSelectores(presel);
  }

  // ── Manejar subida de imágenes ────────────────────────────
  function handleImages(campo, files, max = 1) {
    const current = imagenes[campo] || [];
    const nuevos  = [...current, ...files].slice(0, max);
    setImagenes(prev => ({ ...prev, [campo]: nuevos }));
    const urls = nuevos.map(f => URL.createObjectURL(f));
    setPreviews(prev => ({ ...prev, [campo]: urls }));
  }

  function removeImage(campo, idx) {
    const nuevos = (imagenes[campo] || []).filter((_, i) => i !== idx);
    setImagenes(prev => ({ ...prev, [campo]: nuevos }));
    setPreviews(prev => ({ ...prev, [campo]: nuevos.map(f => URL.createObjectURL(f)) }));
  }

  // ── Validar campos requeridos ─────────────────────────────
  function validar() {
    if (!plantillaActiva) return "Selecciona una plantilla.";
    for (const [key, campo] of Object.entries(plantillaActiva.campos)) {
      if (!campo.requerido) continue;
      if (campo.tipo === "imagen_unica" || campo.tipo === "imagen_multiple" || campo.tipo === "imagen_unica_o_avatar") {
        if (!(imagenes[key]?.length)) return `Falta: ${campo.label}`;
      }
      if (campo.tipo === "texto_corto") {
        if (!textos[key]?.trim()) return `Falta: ${campo.label}`;
      }
    }
    return null;
  }

  // ── Preparar payload y llamar al backend ──────────────────
  async function handleGenerar() {
    const err = validar();
    if (err) { setError(err); return; }
    if (currentJades < PLANTILLA_COST) {
      setError(`Necesitas ${PLANTILLA_COST} Jades. Tienes ${currentJades}.`);
      return;
    }

    setError("");
    setLoading(true);
    setResultado({ status: "generating" });
    setStatusText("Preparando imágenes...");

    try {
      // Comprimir y convertir imágenes
      const imagenesB64 = {};
      for (const [campo, files] of Object.entries(imagenes)) {
        if (!files?.length) continue;
        imagenesB64[campo] = [];
        for (const file of files) {
          const prep = await prepareImage(file);
          imagenesB64[campo].push(prep);
        }
      }

      setStatusText("Enviando a generación...");

      const auth = await getAuthHeaders();
      const payload = {
        plantilla_id:  plantillaActiva.id,
        imagenes:      imagenesB64,
        textos,
        selectores,
        accent,
        gender,
      };

      const r = await fetch("/api/plantillas-generate", {
        method:  "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body:    JSON.stringify(payload),
      });

      const j = await r.json().catch(() => null);

      if (!r.ok || !j?.ok) {
        if (j?.error === "INSUFFICIENT_JADES") {
          setError(`Jades insuficientes. Necesitas ${PLANTILLA_COST}.`);
          setResultado(null);
          return;
        }
        throw new Error(j?.error || "Error generando video.");
      }

      setStatusText("Video en progreso — polling...");

      // Si el backend devuelve jobId (async), hacemos polling
      if (j.jobId) {
        setResultado({ status: "generating", jobId: j.jobId });
        await pollJob(j.jobId, j.taskId);
      } else if (j.videoUrl) {
        // Respuesta sincrónica con URL directa
        setResultado({ status: "done", videoUrl: j.videoUrl });
      }

    } catch (e) {
      setError(e?.message || "Ocurrió un error. Intenta de nuevo.");
      setResultado(null);
    } finally {
      setLoading(false);
      setStatusText("");
    }
  }

  // ── Polling de job Seedance vía PiAPI ─────────────────────
  async function pollJob(jobId, taskId) {
    const TIMEOUT = 5 * 60 * 1000;
    const start   = Date.now();
    const auth    = await getAuthHeaders();

    while (Date.now() - start < TIMEOUT) {
      await new Promise(r => setTimeout(r, 8000));
      try {
        const r = await fetch(`/api/plantillas-status?jobId=${jobId}`, {
          headers: auth,
        });
        const j = await r.json().catch(() => null);

        if (j?.status === "COMPLETED" && j?.videoUrl) {
          setResultado({ status: "done", videoUrl: j.videoUrl });
          return;
        }
        if (j?.status === "FAILED") {
          setResultado({ status: "error", error: j?.error || "El video falló." });
          return;
        }
      } catch {}
    }
    setResultado({ status: "error", error: "Tiempo de espera agotado. Revisa tu biblioteca." });
  }

  const p = plantillaActiva;

  return (
    <div className="space-y-6">

      {/* ══ ENCABEZADO ══ */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Comercial IA</h2>
          <p className="mt-1 text-sm text-neutral-400">
            Elige una plantilla, sube tus imágenes y genera un video profesional en segundos.
          </p>
        </div>
        <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/5 px-4 py-2 text-right">
          <div className="text-xs text-neutral-400">Por plantilla</div>
          <div className="text-lg font-bold text-cyan-300">{PLANTILLA_COST} Jades</div>
          <div className="text-[10px] text-neutral-500">Tus Jades: {currentJades}</div>
        </div>
      </div>

      {/* ══ GRID DE PLANTILLAS ══ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {PLANTILLAS.map(pl => (
          <button
            key={pl.id}
            onClick={() => seleccionarPlantilla(pl)}
            className={`relative overflow-hidden rounded-2xl border p-4 text-left transition-all group ${
              plantillaActiva?.id === pl.id
                ? `${pl.borde} bg-gradient-to-br ${pl.colores} ring-1 ring-white/20`
                : "border-white/10 bg-black/30 hover:border-white/20 hover:bg-black/50"
            }`}
          >
            {/* Preview animado al hover */}
            <div className={`absolute inset-0 bg-gradient-to-br ${pl.colores} opacity-0 group-hover:opacity-100 transition-opacity`} />

            <div className="relative">
              <div className="text-3xl mb-2">{pl.emoji}</div>
              <div className={`text-sm font-semibold mb-1 ${plantillaActiva?.id === pl.id ? pl.acento : "text-white"}`}>
                {pl.nombre}
              </div>
              <div className="text-[10px] text-neutral-400 leading-relaxed">{pl.descripcion}</div>
            </div>

            {plantillaActiva?.id === pl.id && (
              <div className={`absolute top-3 right-3 text-[9px] font-bold ${pl.acento} bg-black/40 rounded-full px-2 py-0.5`}>
                ✓ Seleccionada
              </div>
            )}
          </button>
        ))}
      </div>

      {/* ══ FORMULARIO DE PLANTILLA SELECCIONADA ══ */}
      {p && (
        <div className={`rounded-3xl border bg-gradient-to-br ${p.colores} ${p.borde} p-5 space-y-5`}>

          {/* Cabecera */}
          <div className="flex items-center gap-3">
            <span className="text-3xl">{p.emoji}</span>
            <div>
              <h3 className={`font-bold ${p.acento}`}>{p.nombre}</h3>
              <p className="text-[11px] text-neutral-400">{p.descripcion}</p>
            </div>
          </div>

          {/* Campos dinámicos */}
          <div className="grid grid-cols-1 gap-4">
            {Object.entries(p.campos).map(([key, campo]) => {

              // Imagen única
              if (campo.tipo === "imagen_unica" || campo.tipo === "imagen_unica_o_avatar") {
                return (
                  <ImageUploadZone
                    key={key}
                    label={campo.label}
                    hint={campo.hint}
                    multiple={false}
                    max={1}
                    previews={previews[key] || []}
                    onFiles={files => handleImages(key, files, 1)}
                    onRemove={idx => removeImage(key, idx)}
                  />
                );
              }

              // Imagen múltiple
              if (campo.tipo === "imagen_multiple") {
                return (
                  <ImageUploadZone
                    key={key}
                    label={campo.label}
                    hint={campo.hint}
                    multiple={true}
                    max={campo.max || 4}
                    previews={previews[key] || []}
                    onFiles={files => handleImages(key, files, campo.max || 4)}
                    onRemove={idx => removeImage(key, idx)}
                  />
                );
              }

              // Selector de opciones
              if (campo.tipo === "selector") {
                return (
                  <OptionSelector
                    key={key}
                    label={campo.label}
                    opciones={campo.opciones}
                    value={selectores[key] || campo.opciones[0]?.value}
                    onChange={val => setSelectores(prev => ({ ...prev, [key]: val }))}
                  />
                );
              }

              // Texto corto
              if (campo.tipo === "texto_corto") {
                return (
                  <div key={key} className="space-y-1.5">
                    <label className="text-xs font-semibold text-neutral-300">{campo.label}</label>
                    {campo.hint && <p className="text-[10px] text-neutral-500">{campo.hint}</p>}
                    <input
                      type="text"
                      placeholder={campo.hint || ""}
                      value={textos[key] || ""}
                      onChange={e => setTextos(prev => ({ ...prev, [key]: e.target.value }))}
                      className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white placeholder-neutral-600 focus:border-white/30 focus:outline-none"
                    />
                  </div>
                );
              }

              // Texto largo (narración)
              if (campo.tipo === "texto") {
                return (
                  <div key={key} className="space-y-1.5">
                    <label className="text-xs font-semibold text-neutral-300">{campo.label}</label>
                    {campo.hint && <p className="text-[10px] text-neutral-500">{campo.hint}</p>}
                    <textarea
                      placeholder={campo.hint || ""}
                      value={textos[key] || ""}
                      onChange={e => setTextos(prev => ({ ...prev, [key]: e.target.value }))}
                      rows={2}
                      className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white placeholder-neutral-600 focus:border-white/30 focus:outline-none resize-none"
                    />
                  </div>
                );
              }

              return null;
            })}
          </div>

          {/* Narración — Acento y voz (si hay campo narracion) */}
          {Object.values(p.campos).some(c => c.tipo === "texto" && c.label.includes("Narración")) && (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4 space-y-3">
              <p className="text-[11px] font-semibold text-neutral-300">🎙️ Configuración de voz</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-neutral-400">Acento</label>
                  <select
                    value={accent}
                    onChange={e => setAccent(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-black/50 px-2 py-1.5 text-xs text-white focus:outline-none"
                  >
                    {ACCENTS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-neutral-400">Voz</label>
                  <select
                    value={gender}
                    onChange={e => setGender(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-black/50 px-2 py-1.5 text-xs text-white focus:outline-none"
                  >
                    <option value="mujer">👩 Voz femenina</option>
                    <option value="hombre">👨 Voz masculina</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}

          {/* Botón generar */}
          <button
            onClick={handleGenerar}
            disabled={loading || currentJades < PLANTILLA_COST}
            className={`w-full rounded-2xl border py-3.5 text-sm font-semibold transition-all ${p.boton} ${
              loading || currentJades < PLANTILLA_COST
                ? "opacity-40 cursor-not-allowed"
                : "text-white cursor-pointer"
            }`}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                {statusText || "Generando..."}
              </span>
            ) : (
              `${p.emoji} Generar — ${PLANTILLA_COST} Jades`
            )}
          </button>
        </div>
      )}

      {/* ══ RESULTADO ══ */}
      {resultado && (
        <VideoResultCard
          jobId={resultado.jobId}
          status={resultado.status}
          videoUrl={resultado.videoUrl}
          error={resultado.error}
        />
      )}

      {/* ══ ESTADO VACÍO ══ */}
      {!p && (
        <div className="rounded-2xl border border-white/5 bg-black/20 py-10 text-center">
          <p className="text-neutral-600 text-sm">← Selecciona una plantilla para empezar</p>
        </div>
      )}

    </div>
  );
}