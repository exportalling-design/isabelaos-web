// src/components/ComercialPanel.jsx
// ─────────────────────────────────────────────────────────────
// Panel principal de Comercial IA.
// Se conecta DIRECTAMENTE a /api/comercial-generate para todas
// las plantillas. No usa plantillas-generate ni plantillas-status.
//
// Plantillas:
//   transicion_moda   → Gemini genera foto por prenda → Seedance anima
//   producto_estelar  → Gemini genera escena épica → BytePlus anima
//   explosion_sabor   → Gemini genera explosión → BytePlus anima
//   chef_ia           → Gemini genera chef → PiAPI o BytePlus
//   comercial_completo → Storyboard + N escenas
//
// Lógica de rostro humano:
//   hasHumanFace=true  → backend usa PiAPI (preserva identidad)
//   hasHumanFace=false → backend usa BytePlus (más rápido, sin rostros)
// ─────────────────────────────────────────────────────────────
import { useState, useRef } from "react";
import { supabase } from "../lib/supabaseClient";

const COMERCIAL_COST = 120;

const PLANTILLAS = [
  {
    id:          "transicion_moda",
    nombre:      "Transición de Moda",
    emoji:       "👗",
    descripcion: "Sube tus prendas y la IA genera un video fashion con transiciones. Con modelo real o IA, fondo real o inventado.",
    colores:     "from-pink-500/20 via-rose-500/10 to-purple-500/20",
    borde:       "border-pink-500/30",
    acento:      "text-pink-300",
    tieneRostro: true,
  },
  {
    id:          "producto_estelar",
    nombre:      "Producto Estelar",
    emoji:       "✨",
    descripcion: "Tu producto lanzado con efectos épicos — fuego, partículas doradas, splash, cristales. El producto nunca cambia.",
    colores:     "from-cyan-500/20 via-blue-500/10 to-indigo-500/20",
    borde:       "border-cyan-500/30",
    acento:      "text-cyan-300",
    tieneRostro: false,
  },
  {
    id:          "explosion_sabor",
    nombre:      "Explosión de Sabor",
    emoji:       "💥",
    descripcion: "Tu platillo se desintegra en capas mostrando cada ingrediente en slow motion épico.",
    colores:     "from-orange-500/20 via-amber-500/10 to-red-500/20",
    borde:       "border-orange-500/30",
    acento:      "text-orange-300",
    tieneRostro: false,
  },
  {
    id:          "chef_ia",
    nombre:      "Chef IA",
    emoji:       "👨‍🍳",
    descripcion: "Video cinematográfico de un chef preparando tu plato. Usa tu foto o elige un avatar chef.",
    colores:     "from-slate-500/20 via-zinc-500/10 to-neutral-500/20",
    borde:       "border-slate-500/30",
    acento:      "text-slate-300",
    tieneRostro: true,
  },
  {
    id:          "comercial_completo",
    nombre:      "Comercial Completo",
    emoji:       "🎬",
    descripcion: "Storyboard de 4-7 escenas con narración en off. Para cualquier producto, servicio o marca.",
    colores:     "from-violet-500/20 via-purple-500/10 to-fuchsia-500/20",
    borde:       "border-violet-500/30",
    acento:      "text-violet-300",
    tieneRostro: true,
  },
];

const EFECTOS_PRODUCTO = [
  { value: "golden_particles", label: "💎 Partículas doradas — lujo y elegancia" },
  { value: "fire_energy",      label: "🔥 Fuego y energía — potencia y fuerza" },
  { value: "liquid_splash",    label: "💧 Splash de líquido — frescura y pureza" },
  { value: "crystal_smoke",    label: "🌫️ Humo y cristales — misterio sofisticado" },
  { value: "flower_petals",    label: "🌸 Pétalos y flores — naturaleza y suavidad" },
  { value: "electric_storm",   label: "⚡ Tormenta eléctrica — tecnología e innovación" },
];

const AVATARES_CHEF = [
  { value: "chef_hombre_latino",  label: "👨 Chef hombre latino profesional" },
  { value: "chef_mujer_latina",   label: "👩 Chef mujer latina elegante" },
  { value: "chef_barbudo",        label: "🧔 Chef barbudo tatuado urbano" },
  { value: "chef_mujer_moderna",  label: "💁‍♀️ Chef mujer moderna y joven" },
];

const ACCENTS = [
  { value: "neutro",       label: "🌎 Neutro latino" },
  { value: "guatemalteco", label: "🇬🇹 Guatemalteco" },
  { value: "colombiano",   label: "🇨🇴 Colombiano" },
  { value: "mexicano",     label: "🇲🇽 Mexicano" },
  { value: "argentino",    label: "🇦🇷 Argentino" },
  { value: "español",      label: "🇪🇸 Español" },
  { value: "ingles",       label: "🇺🇸 English (US)" },
];

// ── Helpers ───────────────────────────────────────────────────
async function getAuthHeaders() {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
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
        blob => { URL.revokeObjectURL(url); blob ? resolve(blob) : reject(new Error("Error")); },
        "image/jpeg", 0.85
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Error cargando")); };
    img.src = url;
  });
}

async function prepareImage(file) {
  const blob = await compressImage(file);
  const b64  = await fileToBase64(new File([blob], "img.jpg", { type: "image/jpeg" }));
  return { base64: b64, mimeType: "image/jpeg" };
}

// ── Subcomponentes ────────────────────────────────────────────
function HumanFaceCheckbox({ checked, onChange }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      className={`flex items-start gap-3 rounded-2xl border p-3 cursor-pointer transition-all ${
        checked
          ? "border-amber-400/40 bg-amber-500/10"
          : "border-white/10 bg-white/5 hover:border-white/20"
      }`}
    >
      <div className={`mt-0.5 flex-shrink-0 h-5 w-5 rounded-md border-2 flex items-center justify-center transition-all ${
        checked ? "border-amber-400 bg-amber-400" : "border-white/30"
      }`}>
        {checked && <span className="text-black text-xs font-bold">✓</span>}
      </div>
      <div>
        <p className="text-xs font-semibold text-white">👤 Contiene rostro humano real</p>
        <p className="text-[10px] text-neutral-400 mt-0.5">
          Activa esto si estás subiendo una foto con una persona real.
          La IA usará un motor especializado que preserva la identidad facial correctamente.
        </p>
      </div>
    </div>
  );
}

function UploadZone({ label, hint, multiple, max = 1, previews = [], onFiles, onRemove, disabled }) {
  const ref = useRef(null);
  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold text-neutral-300">{label}</label>
      {hint && <p className="text-[10px] text-neutral-500">{hint}</p>}
      <div
        onClick={() => !disabled && ref.current?.click()}
        className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-white/20 bg-white/5 p-5 min-h-[80px] transition-all ${
          disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-white/40 hover:bg-white/10"
        }`}
      >
        <input
          ref={ref} type="file" accept="image/*" multiple={multiple} className="hidden"
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

function SceneResult({ scene, idx }) {
  if (!scene.ok) {
    const isFaceError = scene.error === "FACE_DETECTED";
    return (
      <div className={`rounded-xl border p-3 ${
        isFaceError ? "border-amber-500/30 bg-amber-500/10" : "border-red-500/20 bg-red-500/5"
      }`}>
        {isFaceError ? (
          <div className="space-y-1">
            <p className="text-xs font-semibold text-amber-300">⚠️ Rostro detectado</p>
            <p className="text-[10px] text-amber-200/70">
              Esta escena contiene un rostro real. Activa el checkbox "Contiene rostro humano real" y genera de nuevo.
            </p>
          </div>
        ) : (
          <p className="text-xs text-red-400">Escena {scene.scene_number || idx + 1} — Error: {scene.error}</p>
        )}
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 overflow-hidden">
      <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2">
        <span className="text-[10px] text-neutral-500">Escena {scene.scene_number}</span>
        {scene.narrative_role && (
          <span className="text-[9px] text-neutral-600 uppercase">{scene.narrative_role}</span>
        )}
      </div>
      {scene.video_url && (
        <video src={scene.video_url} controls className="w-full aspect-[9/16] max-h-[320px] object-contain bg-black" />
      )}
      <div className="px-3 py-2 space-y-2">
        {scene.audio_b64 && (
          <audio controls className="w-full h-8" src={`data:audio/mpeg;base64,${scene.audio_b64}`} />
        )}
        {scene.video_url && (
          <a
            href={scene.video_url}
            download={`escena-${scene.scene_number}.mp4`}
            className="block text-center rounded-xl border border-white/15 py-1.5 text-[10px] text-neutral-400 hover:bg-white/10 transition-all"
          >
            ↓ Descargar
          </a>
        )}
      </div>
    </div>
  );
}

// ── Panel principal ───────────────────────────────────────────
export default function ComercialPanel({ userStatus }) {
  const [plantilla,    setPlantilla]    = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [statusText,   setStatusText]   = useState("");
  const [error,        setError]        = useState("");
  const [resultado,    setResultado]    = useState(null);
  const [hasHumanFace, setHasHumanFace] = useState(false);

  // Imágenes y previews
  const [imgModelo,    setImgModelo]    = useState([]);
  const [imgPrendas,   setImgPrendas]   = useState([]);
  const [imgFondo,     setImgFondo]     = useState([]);
  const [imgProducto,  setImgProducto]  = useState([]);
  const [imgPlato,     setImgPlato]     = useState([]);
  const [imgChef,      setImgChef]      = useState([]);
  const [prevModelo,   setPrevModelo]   = useState([]);
  const [prevPrendas,  setPrevPrendas]  = useState([]);
  const [prevFondo,    setPrevFondo]    = useState([]);
  const [prevProducto, setPrevProducto] = useState([]);
  const [prevPlato,    setPrevPlato]    = useState([]);
  const [prevChef,     setPrevChef]     = useState([]);

  // Textos y configuración
  const [descripcion,       setDescripcion]       = useState("");
  const [narracion,         setNarracion]         = useState("");
  const [nombreNegocio,     setNombreNegocio]     = useState("");
  const [efecto,            setEfecto]            = useState("golden_particles");
  const [avatarChef,        setAvatarChef]        = useState("chef_hombre_latino");
  const [duracionComercial, setDuracionComercial] = useState(30);
  const [accent,            setAccent]            = useState("neutro");
  const [gender,            setGender]            = useState("mujer");

  const currentJades = userStatus?.jades ?? 0;

  // ── Helpers de archivos ───────────────────────────────────
  function handleFiles(setter, prevSetter, files, max = 1) {
    const nuevos = files.slice(0, max);
    setter(nuevos);
    prevSetter(nuevos.map(f => URL.createObjectURL(f)));
  }
  function removeFile(setter, prevSetter, idx, current) {
    const nuevos = current.filter((_, i) => i !== idx);
    setter(nuevos);
    prevSetter(nuevos.map(f => URL.createObjectURL(f)));
  }

  function seleccionar(p) {
    setPlantilla(p);
    setError(""); setResultado(null); setHasHumanFace(false);
    setImgModelo([]); setImgPrendas([]); setImgFondo([]);
    setImgProducto([]); setImgPlato([]); setImgChef([]);
    setPrevModelo([]); setPrevPrendas([]); setPrevFondo([]);
    setPrevProducto([]); setPrevPlato([]); setPrevChef([]);
    setDescripcion(""); setNarracion(""); setNombreNegocio("");
  }

  // ── Generar ───────────────────────────────────────────────
  async function handleGenerar() {
    if (!plantilla) return;
    if (currentJades < COMERCIAL_COST) {
      setError(`Necesitas ${COMERCIAL_COST} Jades. Tienes ${currentJades}.`);
      return;
    }
    setError(""); setLoading(true); setResultado(null);

    try {
      const auth = await getAuthHeaders();

      // ── TRANSICIÓN DE MODA ──────────────────────────────
      if (plantilla.id === "transicion_moda") {
        if (!imgPrendas.length) {
          setError("Sube al menos una foto de prenda."); setLoading(false); return;
        }
        setStatusText("Preparando imágenes...");
        const prendasPrep = await Promise.all(imgPrendas.map(prepareImage));
        const modeloPrep  = imgModelo.length ? [await prepareImage(imgModelo[0])] : [];
        const fondoPrep   = imgFondo.length  ? [await prepareImage(imgFondo[0])]  : [];
        setStatusText(`Generando ${prendasPrep.length} video(s) de moda...`);
        const r = await fetch("/api/comercial-generate", {
          method:  "POST",
          headers: { "Content-Type": "application/json", ...auth },
          body: JSON.stringify({
            plantilla_id: "transicion_moda",
            imagenes:     { prendas: prendasPrep, modelo: modeloPrep, fondo: fondoPrep },
            textos:       { narracion },
            hasHumanFace: hasHumanFace && imgModelo.length > 0,
            accent, gender,
          }),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || j.detail || "Error generando");
        setResultado(j);
        return;
      }

      // ── PRODUCTO ESTELAR ────────────────────────────────
      if (plantilla.id === "producto_estelar") {
        if (!imgProducto.length) {
          setError("Sube la foto de tu producto."); setLoading(false); return;
        }
        setStatusText("Generando video del producto...");
        const productoPrep = await prepareImage(imgProducto[0]);
        const r = await fetch("/api/comercial-generate", {
          method:  "POST",
          headers: { "Content-Type": "application/json", ...auth },
          body: JSON.stringify({
            plantilla_id: "producto_estelar",
            imagenes:     { producto: [productoPrep] },
            selectores:   { efecto },
            textos:       { narracion },
            hasHumanFace: false,
            accent, gender,
          }),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || "Error generando");
        setResultado(j);
        return;
      }

      // ── EXPLOSIÓN DE SABOR ──────────────────────────────
      if (plantilla.id === "explosion_sabor") {
        if (!imgPlato.length) {
          setError("Sube la foto de tu platillo."); setLoading(false); return;
        }
        if (!nombreNegocio.trim()) {
          setError("Escribe el nombre de tu negocio."); setLoading(false); return;
        }
        setStatusText("Generando explosión de sabor...");
        const platoPrep = await prepareImage(imgPlato[0]);
        const r = await fetch("/api/comercial-generate", {
          method:  "POST",
          headers: { "Content-Type": "application/json", ...auth },
          body: JSON.stringify({
            plantilla_id: "explosion_sabor",
            imagenes:     { plato: [platoPrep] },
            textos:       { narracion, nombre_negocio: nombreNegocio },
            hasHumanFace: false,
            accent, gender,
          }),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || "Error generando");
        setResultado(j);
        return;
      }

      // ── CHEF IA ─────────────────────────────────────────
      if (plantilla.id === "chef_ia") {
        if (!imgPlato.length) {
          setError("Sube la foto del platillo."); setLoading(false); return;
        }
        if (!nombreNegocio.trim()) {
          setError("Escribe el nombre de tu negocio."); setLoading(false); return;
        }
        setStatusText("Generando video del chef...");
        const platoPrep = await prepareImage(imgPlato[0]);
        const chefPrep  = imgChef.length ? [await prepareImage(imgChef[0])] : [];
        const r = await fetch("/api/comercial-generate", {
          method:  "POST",
          headers: { "Content-Type": "application/json", ...auth },
          body: JSON.stringify({
            plantilla_id: "chef_ia",
            imagenes:     { plato: [platoPrep], chef: chefPrep },
            selectores:   { avatar_tipo: avatarChef },
            textos:       { narracion, nombre_negocio: nombreNegocio },
            hasHumanFace: hasHumanFace && imgChef.length > 0,
            accent, gender,
          }),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || "Error generando");
        setResultado(j);
        return;
      }

      // ── COMERCIAL COMPLETO ──────────────────────────────
      if (plantilla.id === "comercial_completo") {
        if (!descripcion.trim()) {
          setError("Describe tu producto o servicio."); setLoading(false); return;
        }
        const refImgs = [];
        for (const f of [...imgProducto, ...imgPlato].slice(0, 3))
          refImgs.push(await prepareImage(f));

        setStatusText("Creando storyboard con Gemini...");
        const sr = await fetch("/api/comercial-storyboard", {
          method:  "POST",
          headers: { "Content-Type": "application/json", ...auth },
          body: JSON.stringify({
            description:     descripcion,
            duration:        duracionComercial,
            referenceImages: refImgs,
            accent, gender,
          }),
        });
        const sj = await sr.json();
        if (!sr.ok || !sj.ok) throw new Error(sj.error || "Error en storyboard");

        setStatusText(`Generando ${sj.sceneCount} escenas...`);
        const gr = await fetch("/api/comercial-generate", {
          method:  "POST",
          headers: { "Content-Type": "application/json", ...auth },
          body: JSON.stringify({
            storyboard:      sj.storyboard,
            referenceImages: refImgs,
            hasHumanFace,
            accent, gender,
          }),
        });
        const gj = await gr.json();
        if (!gr.ok || !gj.ok) throw new Error(gj.error || "Error generando escenas");
        setResultado(gj);
      }

    } catch (e) {
      setError(e.message || "Error generando. Intenta de nuevo.");
    } finally {
      setLoading(false);
      setStatusText("");
    }
  }

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="space-y-6 max-w-2xl mx-auto">

      {/* Encabezado */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Comercial IA</h2>
          <p className="mt-1 text-sm text-neutral-400">
            Videos publicitarios profesionales con Seedance 2.0
          </p>
        </div>
        <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/5 px-4 py-2 text-right">
          <div className="text-xs text-neutral-400">Costo</div>
          <div className="text-lg font-bold text-cyan-300">{COMERCIAL_COST} Jades</div>
          <div className="text-[10px] text-neutral-500">Tus Jades: {currentJades}</div>
        </div>
      </div>

      {/* Grid de plantillas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PLANTILLAS.map(p => (
          <button
            key={p.id}
            onClick={() => seleccionar(p)}
            className={`relative text-left rounded-2xl border p-4 transition-all bg-gradient-to-br ${p.colores} ${
              plantilla?.id === p.id ? `${p.borde} ring-1 ring-white/20` : "border-white/10 hover:border-white/20"
            }`}
          >
            <div className="text-2xl mb-1">{p.emoji}</div>
            <div className={`text-sm font-semibold mb-1 ${plantilla?.id === p.id ? p.acento : "text-white"}`}>
              {p.nombre}
            </div>
            <div className="text-[10px] text-neutral-400 leading-relaxed">{p.descripcion}</div>
            {plantilla?.id === p.id && (
              <div className={`absolute top-3 right-3 text-[9px] font-bold ${p.acento} bg-black/40 rounded-full px-2 py-0.5`}>
                ✓ Activa
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Formulario de plantilla seleccionada */}
      {plantilla && (
        <div className={`rounded-3xl border bg-gradient-to-br ${plantilla.colores} ${plantilla.borde} p-5 space-y-5`}>
          <div className="flex items-center gap-3">
            <span className="text-3xl">{plantilla.emoji}</span>
            <div>
              <h3 className={`font-bold ${plantilla.acento}`}>{plantilla.nombre}</h3>
              <p className="text-[11px] text-neutral-400">{plantilla.descripcion}</p>
            </div>
          </div>

          {/* ── TRANSICIÓN DE MODA ── */}
          {plantilla.id === "transicion_moda" && (
            <div className="space-y-4">
              {/* Indicador de caso activo */}
              <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                <p className="text-[10px] font-semibold text-neutral-400 mb-1">Modo activo:</p>
                <p className={`text-xs font-bold ${plantilla.acento}`}>
                  {imgModelo.length > 0 && imgFondo.length > 0
                    ? "✦ CASO 4 — Tu modelo + Tu fondo"
                    : imgModelo.length > 0
                    ? "✦ CASO 2 — Tu modelo + Fondo IA"
                    : imgFondo.length > 0
                    ? "✦ CASO 3 — Modelo IA + Tu fondo"
                    : "✦ CASO 1 — La IA inventa modelo y fondo"}
                </p>
                <p className="text-[10px] text-neutral-500 mt-1">
                  La IA genera una foto realista de la modelo vistiendo cada prenda, luego Seedance anima cada foto.
                </p>
              </div>

              <UploadZone
                label="👚 Fotos de prendas (obligatorio, 1-4)"
                hint="Sube cada prenda por separado. La IA generará un video por prenda."
                multiple max={4}
                previews={prevPrendas}
                onFiles={f => handleFiles(setImgPrendas, setPrevPrendas, f, 4)}
                onRemove={i => removeFile(setImgPrendas, setPrevPrendas, i, imgPrendas)}
                disabled={loading}
              />
              <UploadZone
                label="👤 Foto del modelo (opcional)"
                hint="Si no subes, la IA generará una modelo aspiracional."
                multiple={false}
                previews={prevModelo}
                onFiles={f => handleFiles(setImgModelo, setPrevModelo, f, 1)}
                onRemove={i => removeFile(setImgModelo, setPrevModelo, i, imgModelo)}
                disabled={loading}
              />
              <UploadZone
                label="🏖️ Foto del fondo (opcional)"
                hint="Si no subes, la IA inventará un fondo espectacular por escena."
                multiple={false}
                previews={prevFondo}
                onFiles={f => handleFiles(setImgFondo, setPrevFondo, f, 1)}
                onRemove={i => removeFile(setImgFondo, setPrevFondo, i, imgFondo)}
                disabled={loading}
              />
            </div>
          )}

          {/* ── PRODUCTO ESTELAR ── */}
          {plantilla.id === "producto_estelar" && (
            <div className="space-y-4">
              <UploadZone
                label="📦 Foto de tu producto"
                hint="Perfume, crema, ropa, accesorio, electrónico... El producto siempre se preserva exactamente."
                multiple={false}
                previews={prevProducto}
                onFiles={f => handleFiles(setImgProducto, setPrevProducto, f, 1)}
                onRemove={i => removeFile(setImgProducto, setPrevProducto, i, imgProducto)}
                disabled={loading}
              />
              <div className="space-y-2">
                <label className="text-xs font-semibold text-neutral-300">✨ Efecto visual</label>
                <div className="grid grid-cols-1 gap-1.5">
                  {EFECTOS_PRODUCTO.map(op => (
                    <button
                      key={op.value}
                      onClick={() => setEfecto(op.value)}
                      className={`text-left rounded-xl border px-3 py-2 text-[11px] transition-all ${
                        efecto === op.value
                          ? "border-white/40 bg-white/15 text-white"
                          : "border-white/10 bg-white/5 text-neutral-400 hover:border-white/25"
                      }`}
                    >
                      {op.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── EXPLOSIÓN DE SABOR ── */}
          {plantilla.id === "explosion_sabor" && (
            <div className="space-y-4">
              <UploadZone
                label="🍔 Foto de tu platillo"
                hint="Burger, taco, pizza, sushi, comida china, lo que sea."
                multiple={false}
                previews={prevPlato}
                onFiles={f => handleFiles(setImgPlato, setPrevPlato, f, 1)}
                onRemove={i => removeFile(setImgPlato, setPrevPlato, i, imgPlato)}
                disabled={loading}
              />
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-300">🏪 Nombre de tu negocio</label>
                <input
                  type="text" value={nombreNegocio} onChange={e => setNombreNegocio(e.target.value)}
                  placeholder="Ej: Burger Bros, Tacos El Rey, Sushi Palace..."
                  className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white placeholder-neutral-600 focus:border-white/30 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* ── CHEF IA ── */}
          {plantilla.id === "chef_ia" && (
            <div className="space-y-4">
              <UploadZone
                label="🍽️ Foto del platillo terminado"
                hint="El plato que el chef va a preparar en el video."
                multiple={false}
                previews={prevPlato}
                onFiles={f => handleFiles(setImgPlato, setPrevPlato, f, 1)}
                onRemove={i => removeFile(setImgPlato, setPrevPlato, i, imgPlato)}
                disabled={loading}
              />
              <UploadZone
                label="👤 Tu foto como chef (opcional)"
                hint="Si subes tu foto, activa el checkbox de rostro humano abajo."
                multiple={false}
                previews={prevChef}
                onFiles={f => handleFiles(setImgChef, setPrevChef, f, 1)}
                onRemove={i => removeFile(setImgChef, setPrevChef, i, imgChef)}
                disabled={loading}
              />
              {!imgChef.length && (
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-neutral-300">🤖 Avatar chef IA</label>
                  <div className="grid grid-cols-1 gap-1.5">
                    {AVATARES_CHEF.map(av => (
                      <button
                        key={av.value}
                        onClick={() => setAvatarChef(av.value)}
                        className={`text-left rounded-xl border px-3 py-2 text-[11px] transition-all ${
                          avatarChef === av.value
                            ? "border-white/40 bg-white/15 text-white"
                            : "border-white/10 bg-white/5 text-neutral-400 hover:border-white/25"
                        }`}
                      >
                        {av.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-300">🏪 Nombre de tu negocio</label>
                <input
                  type="text" value={nombreNegocio} onChange={e => setNombreNegocio(e.target.value)}
                  placeholder="Ej: La Parrilla de Don Pedro"
                  className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white placeholder-neutral-600 focus:border-white/30 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* ── COMERCIAL COMPLETO ── */}
          {plantilla.id === "comercial_completo" && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-300">📝 Describe tu producto / servicio / marca</label>
                <textarea
                  value={descripcion} onChange={e => setDescripcion(e.target.value)} rows={3}
                  placeholder="Ej: Restaurante de mariscos en Guatemala Ciudad, especialidad en ceviches y mariscos frescos..."
                  className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white placeholder-neutral-600 focus:border-white/30 focus:outline-none resize-none"
                />
              </div>
              <UploadZone
                label="📸 Fotos de referencia (opcional, máx 3)"
                hint="Si subes personas reales, activa el checkbox de rostro humano abajo."
                multiple max={3}
                previews={prevProducto}
                onFiles={f => handleFiles(setImgProducto, setPrevProducto, f, 3)}
                onRemove={i => removeFile(setImgProducto, setPrevProducto, i, imgProducto)}
                disabled={loading}
              />
              <div className="space-y-2">
                <label className="text-xs font-semibold text-neutral-300">⏱️ Duración</label>
                <div className="flex gap-2">
                  {[30, 60].map(d => (
                    <button
                      key={d} onClick={() => setDuracionComercial(d)}
                      className={`flex-1 rounded-xl border py-2 text-xs transition-all ${
                        duracionComercial === d
                          ? "border-white/40 bg-white/15 text-white"
                          : "border-white/10 bg-white/5 text-neutral-400 hover:border-white/25"
                      }`}
                    >
                      {d}s — {d === 30 ? "4 escenas" : "7 escenas"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Narración (todas excepto comercial completo que la maneja por escena) */}
          {plantilla.id !== "comercial_completo" && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-neutral-300">🎙️ Narración en off (opcional)</label>
              <p className="text-[10px] text-neutral-500">
                Texto que quieres que se escuche en el video. Si lo dejas vacío, el video será mudo.
              </p>
              <textarea
                value={narracion} onChange={e => setNarracion(e.target.value)} rows={2}
                placeholder="Ej: Descubre el sabor que te conquistará. Solo en Burger Bros."
                className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white placeholder-neutral-600 focus:border-white/30 focus:outline-none resize-none"
              />
            </div>
          )}

          {/* Configuración de voz */}
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4 space-y-3">
            <p className="text-[11px] font-semibold text-neutral-300">🎙️ Voz de narración</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] text-neutral-400">Acento</label>
                <select
                  value={accent} onChange={e => setAccent(e.target.value)}
                  className="w-full rounded-xl border border-white/15 bg-black/50 px-2 py-1.5 text-xs text-white focus:outline-none"
                >
                  {ACCENTS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-neutral-400">Voz</label>
                <select
                  value={gender} onChange={e => setGender(e.target.value)}
                  className="w-full rounded-xl border border-white/15 bg-black/50 px-2 py-1.5 text-xs text-white focus:outline-none"
                >
                  <option value="mujer">👩 Voz femenina</option>
                  <option value="hombre">👨 Voz masculina</option>
                </select>
              </div>
            </div>
          </div>

          {/* Checkbox rostro humano — solo en plantillas que pueden tenerlo */}
          {plantilla.tieneRostro && (
            <HumanFaceCheckbox checked={hasHumanFace} onChange={setHasHumanFace} />
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
            disabled={loading || currentJades < COMERCIAL_COST}
            className={`w-full rounded-2xl border py-3.5 text-sm font-semibold transition-all ${plantilla.borde} ${
              loading || currentJades < COMERCIAL_COST
                ? "opacity-40 cursor-not-allowed text-neutral-500"
                : "bg-white/10 hover:bg-white/15 text-white cursor-pointer"
            }`}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                {statusText || "Generando..."}
              </span>
            ) : (
              `${plantilla.emoji} Generar — ${COMERCIAL_COST} Jades`
            )}
          </button>
        </div>
      )}

      {/* Resultados */}
      {resultado && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-white/10" />
            <span className="text-xs text-neutral-500">
              {resultado.success_count}/{resultado.total_scenes} escenas generadas
            </span>
            <div className="h-px flex-1 bg-white/10" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(resultado.scenes || []).map((scene, idx) => (
              <SceneResult key={idx} scene={scene} idx={idx} />
            ))}
          </div>
        </div>
      )}

      {/* Estado vacío */}
      {!plantilla && (
        <div className="rounded-2xl border border-white/5 bg-black/20 py-10 text-center">
          <p className="text-neutral-600 text-sm">← Selecciona una plantilla para empezar</p>
        </div>
      )}
    </div>
  );
}
