// src/components/ComercialPanel.jsx
// Precios dinámicos por plantilla (solo EvoLink):
//   producto_estelar  → 15 Jades (5s)
//   explosion_sabor   → 15 Jades (5s)
//   chef_ia           → 45 Jades (15s)
//   transicion_moda   → EN CONSTRUCCIÓN
//   comercial_completo→ EN CONSTRUCCIÓN
import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

// Costo por plantilla
const PLANTILLA_COST = {
  producto_estelar: 15,
  explosion_sabor:  15,
  chef_ia:          45,
};

function getPlantillas(isEs) { return [
  {
    id:          "producto_estelar",
    nombre:      isEs ? "Producto Estelar" : "Star Product",
    emoji:       "✨",
    descripcion: isEs ? "Tu producto lanzado con efectos épicos — fuego, partículas doradas, splash, cristales. El producto nunca cambia." : "Your product launched with epic effects — fire, golden particles, splash, crystals. The product never changes.",
    colores:     "from-cyan-500/20 via-blue-500/10 to-indigo-500/20",
    borde:       "border-cyan-500/30",
    acento:      "text-cyan-300",
    tieneRostro: false,
    costo:       15,
    duracion:    "5s",
  },
  {
    id:          "explosion_sabor",
    nombre:      isEs ? "Explosión de Sabor" : "Flavor Explosion",
    emoji:       "💥",
    descripcion: isEs ? "Tu platillo se desintegra en capas mostrando cada ingrediente en slow motion épico." : "Your dish disintegrates in layers showing every ingredient in epic slow motion.",
    colores:     "from-orange-500/20 via-amber-500/10 to-red-500/20",
    borde:       "border-orange-500/30",
    acento:      "text-orange-300",
    tieneRostro: false,
    costo:       15,
    duracion:    "5s",
  },
  {
    id:          "chef_ia",
    nombre:      isEs ? "Chef IA" : "AI Chef",
    emoji:       "👨‍🍳",
    descripcion: isEs ? "Video cinematográfico de 15s de un chef preparando tu plato. Usa tu foto o elige un avatar chef." : "15s cinematic video of a chef preparing your dish. Use your photo or pick a chef avatar.",
    colores:     "from-slate-500/20 via-zinc-500/10 to-neutral-500/20",
    borde:       "border-slate-500/30",
    acento:      "text-slate-300",
    tieneRostro: true,
    costo:       45,
    duracion:    "15s",
  },
  {
    id:          "transicion_moda",
    nombre:      isEs ? "Transición de Moda" : "Fashion Transition",
    emoji:       "👗",
    descripcion: isEs ? "Sube tus prendas y la IA genera un video fashion con transiciones." : "Upload your garments and AI generates a fashion video with transitions.",
    colores:     "from-pink-500/20 via-rose-500/10 to-purple-500/20",
    borde:       "border-pink-500/30",
    acento:      "text-pink-300",
    tieneRostro: true,
    enConstruccion: true,
  },
  {
    id:          "comercial_completo",
    nombre:      isEs ? "Comercial Completo" : "Full Commercial",
    emoji:       "🎬",
    descripcion: isEs ? "Storyboard de varias escenas con narración en off." : "Multi-scene storyboard with voiceover narration.",
    colores:     "from-violet-500/20 via-purple-500/10 to-fuchsia-500/20",
    borde:       "border-violet-500/30",
    acento:      "text-violet-300",
    tieneRostro: true,
    enConstruccion: true,
  },
]; }

function getEfectosProducto(isEs) { return [
  { value: "golden_particles", label: isEs ? "💎 Partículas doradas — lujo y elegancia" : "💎 Golden particles — luxury and elegance" },
  { value: "fire_energy",      label: isEs ? "🔥 Fuego y energía — potencia y fuerza" : "🔥 Fire and energy — power and force" },
  { value: "liquid_splash",    label: isEs ? "💧 Splash de líquido — frescura y pureza" : "💧 Liquid splash — freshness and purity" },
  { value: "crystal_smoke",    label: isEs ? "🌫️ Humo y cristales — misterio sofisticado" : "🌫️ Smoke and crystals — sophisticated mystery" },
  { value: "flower_petals",    label: isEs ? "🌸 Pétalos y flores — naturaleza y suavidad" : "🌸 Petals and flowers — nature and softness" },
  { value: "electric_storm",   label: isEs ? "⚡ Tormenta eléctrica — tecnología e innovación" : "⚡ Electric storm — technology and innovation" },
]; }

function getAvataresChef(isEs) { return [
  { value: "chef_hombre_latino",  label: isEs ? "👨 Chef hombre latino profesional" : "👨 Professional Latin male chef" },
  { value: "chef_mujer_latina",   label: isEs ? "👩 Chef mujer latina elegante" : "👩 Elegant Latin female chef" },
  { value: "chef_barbudo",        label: isEs ? "🧔 Chef barbudo tatuado urbano" : "🧔 Tattooed bearded urban chef" },
  { value: "chef_mujer_moderna",  label: isEs ? "💁‍♀️ Chef mujer moderna y joven" : "💁‍♀️ Young modern female chef" },
]; }

function getAccents(isEs) { return [
  { value: "neutro",       label: isEs ? "🌎 Neutro latino" : "🌎 Neutral Latin" },
  { value: "guatemalteco", label: isEs ? "🇬🇹 Guatemalteco" : "🇬🇹 Guatemalan" },
  { value: "colombiano",   label: isEs ? "🇨🇴 Colombiano" : "🇨🇴 Colombian" },
  { value: "mexicano",     label: isEs ? "🇲🇽 Mexicano" : "🇲🇽 Mexican" },
  { value: "argentino",    label: isEs ? "🇦🇷 Argentino" : "🇦🇷 Argentinian" },
  { value: "español",      label: isEs ? "🇪🇸 Español" : "🇪🇸 Spanish" },
  { value: "ingles",       label: "🇺🇸 English (US)" },
]; }

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

function HumanFaceCheckbox({ checked, onChange, isEs }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      className={`flex items-start gap-3 rounded-2xl border p-3 cursor-pointer transition-all ${
        checked ? "border-amber-400/40 bg-amber-500/10" : "border-white/10 bg-white/5 hover:border-white/20"
      }`}
    >
      <div className={`mt-0.5 flex-shrink-0 h-5 w-5 rounded-md border-2 flex items-center justify-center transition-all ${
        checked ? "border-amber-400 bg-amber-400" : "border-white/30"
      }`}>
        {checked && <span className="text-black text-xs font-bold">✓</span>}
      </div>
      <div>
        <p className="text-xs font-semibold text-white">👤 {isEs ? "Contiene rostro humano real" : "Contains a real human face"}</p>
        <p className="text-[10px] text-neutral-400 mt-0.5">
          {isEs ? "Activa esto si estás subiendo una foto con una persona real." : "Turn this on if you're uploading a photo with a real person."}
        </p>
      </div>
    </div>
  );
}

function UploadZone({ label, hint, multiple, max = 1, previews = [], onFiles, onRemove, disabled, isEs }) {
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
          {multiple ? (isEs ? `Subir imágenes (máx ${max})` : `Upload images (max ${max})`) : (isEs ? "Subir imagen" : "Upload image")}
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

function SceneResult({ scene, idx, isEs }) {
  if (!scene.ok) {
    return (
      <div className="rounded-xl border p-3 border-red-500/20 bg-red-500/5">
        <p className="text-xs text-red-400">{isEs ? "Escena" : "Scene"} {scene.scene_number || idx + 1} — Error: {scene.error}</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 overflow-hidden">
      <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2">
        <span className="text-[10px] text-neutral-500">{isEs ? "Escena" : "Scene"} {scene.scene_number}</span>
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
            ↓ {isEs ? "Descargar" : "Download"}
          </a>
        )}
      </div>
    </div>
  );
}

export default function ComercialPanel({ userStatus, lang = "es" }) {
  const isEs = lang !== "en";
  const PLANTILLAS = getPlantillas(isEs);
  const EFECTOS_PRODUCTO = getEfectosProducto(isEs);
  const AVATARES_CHEF = getAvataresChef(isEs);
  const ACCENTS = getAccents(isEs);
  const [plantilla,    setPlantilla]    = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [statusText,   setStatusText]   = useState("");
  const [error,        setError]        = useState("");
  const [resultado,    setResultado]    = useState(null);
  const [hasHumanFace, setHasHumanFace] = useState(false);

  const [imgProducto,  setImgProducto]  = useState([]);
  const [imgPlato,     setImgPlato]     = useState([]);
  const [imgChef,      setImgChef]      = useState([]);
  const [prevProducto, setPrevProducto] = useState([]);
  const [prevPlato,    setPrevPlato]    = useState([]);
  const [prevChef,     setPrevChef]     = useState([]);

  const [narracion,     setNarracion]     = useState("");
  const [nombreNegocio, setNombreNegocio] = useState("");
  const [efecto,        setEfecto]        = useState("golden_particles");
  const [avatarChef,    setAvatarChef]    = useState("chef_hombre_latino");
  const [accent,        setAccent]        = useState("neutro");
  const [gender,        setGender]        = useState("mujer");

  const pollRef = useRef(null);

  useEffect(() => () => clearInterval(pollRef.current), []);

  const currentJades = userStatus?.jades ?? 0;
  const costoActual  = plantilla ? (PLANTILLA_COST[plantilla.id] || 0) : 0;

  const startPolling = useCallback((taskId, plantilla_id, audioB64, ref, jadeCost) => {
    clearInterval(pollRef.current);
    let attempts = 0;
    const MAX_ATTEMPTS = 150; // ~10 min @ 4s

    pollRef.current = setInterval(async () => {
      attempts++;
      if (attempts > MAX_ATTEMPTS) {
        clearInterval(pollRef.current);
        setError(isEs ? "⏳ El video tardó más de 10 minutos. Ve a tu Biblioteca — puede que ya esté listo." : "⏳ The video took more than 10 minutes. Check your Library — it might already be ready.");
        setLoading(false);
        setStatusText("");
        return;
      }
      try {
        const auth = await getAuthHeaders();
        const r = await fetch("/api/comercial-poll-status", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...auth },
          body: JSON.stringify({ taskId }),
        });
        const data = await r.json();
        if (data.status === "completed" && data.videoUrl) {
          clearInterval(pollRef.current);
          setResultado({
            ok: true, ref, plantilla_id,
            scenes: [{ scene_number: 1, ok: true, video_url: data.videoUrl, audio_b64: audioB64 || null }],
            success_count: 1, total_scenes: 1, jade_cost: jadeCost,
          });
          setLoading(false);
          setStatusText("");
        } else if (data.status === "failed") {
          clearInterval(pollRef.current);
          setError(data.error || (isEs ? "La generación falló." : "Generation failed."));
          setLoading(false);
          setStatusText("");
        }
      } catch (e) {
        console.error("[ComercialPanel] poll error:", e.message);
      }
    }, 4000);
  }, [isEs]);

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
    if (p.enConstruccion) {
      setError("");
      setPlantilla(p);
      setResultado(null);
      return;
    }
    setPlantilla(p);
    setError(""); setResultado(null); setHasHumanFace(false);
    setImgProducto([]); setImgPlato([]); setImgChef([]);
    setPrevProducto([]); setPrevPlato([]); setPrevChef([]);
    setNarracion(""); setNombreNegocio("");
  }

  async function handleGenerar() {
    if (!plantilla || plantilla.enConstruccion) return;
    if (currentJades < costoActual) {
      setError(isEs ? `Necesitas ${costoActual} Jades. Tienes ${currentJades}.` : `You need ${costoActual} Jades. You have ${currentJades}.`);
      return;
    }
    setError(""); setLoading(true); setResultado(null);

    try {
      const auth = await getAuthHeaders();
      let j = null;

      if (plantilla.id === "producto_estelar") {
        if (!imgProducto.length) { setError(isEs ? "Sube la foto de tu producto." : "Upload your product photo."); setLoading(false); return; }
        setStatusText(isEs ? "Generando video del producto..." : "Generating product video...");
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
        j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || (isEs ? "Error generando" : "Error generating"));
      }

      else if (plantilla.id === "explosion_sabor") {
        if (!imgPlato.length) { setError(isEs ? "Sube la foto de tu platillo." : "Upload your dish photo."); setLoading(false); return; }
        if (!nombreNegocio.trim()) { setError(isEs ? "Escribe el nombre de tu negocio." : "Write your business name."); setLoading(false); return; }
        setStatusText(isEs ? "Generando explosión de sabor..." : "Generating flavor explosion...");
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
        j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || "Error generando");
      }

      else if (plantilla.id === "chef_ia") {
        if (!imgPlato.length) { setError(isEs ? "Sube la foto del platillo." : "Upload the dish photo."); setLoading(false); return; }
        if (!nombreNegocio.trim()) { setError(isEs ? "Escribe el nombre de tu negocio." : "Write your business name."); setLoading(false); return; }
        setStatusText(isEs ? "Generando video del chef (15s)..." : "Generating chef video (15s)...");
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
        j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || (isEs ? "Error generando" : "Error generating"));
      }

      if (j) {
        setStatusText(isEs ? "Renderizando video... esto puede tardar unos minutos" : "Rendering video... this can take a few minutes");
        startPolling(j.taskId, j.plantilla_id, j.audio_b64, j.ref, j.jade_cost);
      }

    } catch (e) {
      setError(e.message || (isEs ? "Error generando. Intenta de nuevo." : "Error generating. Try again."));
      setLoading(false);
      setStatusText("");
    }
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">{isEs ? "Comercial IA" : "AI Commercial"}</h2>
          <p className="mt-1 text-sm text-neutral-400">
            {isEs ? "Videos publicitarios profesionales con Seedance 2.0" : "Professional advertising videos with Seedance 2.0"}
          </p>
        </div>
        <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/5 px-4 py-2 text-right">
          <div className="text-xs text-neutral-400">{isEs ? "Costo" : "Cost"}</div>
          <div className="text-lg font-bold text-cyan-300">{costoActual > 0 ? `${costoActual} Jades` : "—"}</div>
          <div className="text-[10px] text-neutral-500">{isEs ? "Tus Jades" : "Your Jades"}: {currentJades}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PLANTILLAS.map(p => (
          <button
            key={p.id}
            onClick={() => seleccionar(p)}
            disabled={p.enConstruccion}
            className={`relative text-left rounded-2xl border p-4 transition-all bg-gradient-to-br ${p.colores} ${
              p.enConstruccion ? "opacity-60 cursor-not-allowed" :
              plantilla?.id === p.id ? `${p.borde} ring-1 ring-white/20` : "border-white/10 hover:border-white/20"
            }`}
          >
            <div className="text-2xl mb-1">{p.emoji}</div>
            <div className={`text-sm font-semibold mb-1 ${plantilla?.id === p.id ? p.acento : "text-white"}`}>
              {p.nombre}
            </div>
            <div className="text-[10px] text-neutral-400 leading-relaxed">{p.descripcion}</div>
            {!p.enConstruccion && (
              <div className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-white/80 bg-black/30 rounded-full px-2 py-0.5">
                {p.costo} Jades · {p.duracion}
              </div>
            )}
            {p.enConstruccion && (
              <div className="absolute top-3 right-3 text-[9px] font-bold text-amber-300 bg-amber-500/20 border border-amber-500/30 rounded-full px-2 py-0.5">
                🚧 {isEs ? "EN CONSTRUCCIÓN" : "COMING SOON"}
              </div>
            )}
            {plantilla?.id === p.id && !p.enConstruccion && (
              <div className={`absolute top-3 right-3 text-[9px] font-bold ${p.acento} bg-black/40 rounded-full px-2 py-0.5`}>
                ✓ {isEs ? "Activa" : "Active"}
              </div>
            )}
          </button>
        ))}
      </div>

      {plantilla && plantilla.enConstruccion && (
        <div className="rounded-3xl border border-amber-500/30 bg-amber-500/5 p-8 text-center">
          <div className="text-5xl mb-3">🚧</div>
          <h3 className="text-lg font-bold text-amber-300 mb-2">{isEs ? "En construcción" : "Coming soon"}</h3>
          <p className="text-sm text-neutral-400 max-w-sm mx-auto">
            {isEs ? "Esta plantilla está temporalmente en mantenimiento mientras mejoramos su calidad. Mientras tanto prueba Producto Estelar, Explosión de Sabor o Chef IA." : "This template is temporarily under maintenance while we improve its quality. In the meantime try Star Product, Flavor Explosion or AI Chef."}
          </p>
        </div>
      )}

      {plantilla && !plantilla.enConstruccion && (
        <div className={`rounded-3xl border bg-gradient-to-br ${plantilla.colores} ${plantilla.borde} p-5 space-y-5`}>
          <div className="flex items-center gap-3">
            <span className="text-3xl">{plantilla.emoji}</span>
            <div>
              <h3 className={`font-bold ${plantilla.acento}`}>{plantilla.nombre}</h3>
              <p className="text-[11px] text-neutral-400">{plantilla.descripcion}</p>
            </div>
          </div>

          {plantilla.id === "producto_estelar" && (
            <div className="space-y-4">
              <UploadZone
                label={isEs ? "📦 Foto de tu producto" : "📦 Your product photo"}
                hint={isEs ? "Perfume, crema, ropa, accesorio, electrónico... El producto siempre se preserva exactamente." : "Perfume, cream, clothing, accessory, electronics... The product is always preserved exactly."}
                multiple={false}
                previews={prevProducto}
                onFiles={f => handleFiles(setImgProducto, setPrevProducto, f, 1)}
                onRemove={i => removeFile(setImgProducto, setPrevProducto, i, imgProducto)}
                disabled={loading}
                isEs={isEs}
              />
              <div className="space-y-2">
                <label className="text-xs font-semibold text-neutral-300">✨ {isEs ? "Efecto visual" : "Visual effect"}</label>
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

          {plantilla.id === "explosion_sabor" && (
            <div className="space-y-4">
              <UploadZone
                label={isEs ? "🍔 Foto de tu platillo" : "🍔 Your dish photo"}
                hint={isEs ? "Burger, taco, pizza, sushi, comida china, lo que sea." : "Burger, taco, pizza, sushi, Chinese food, anything."}
                multiple={false}
                previews={prevPlato}
                onFiles={f => handleFiles(setImgPlato, setPrevPlato, f, 1)}
                onRemove={i => removeFile(setImgPlato, setPrevPlato, i, imgPlato)}
                disabled={loading}
                isEs={isEs}
              />
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-300">🏪 {isEs ? "Nombre de tu negocio" : "Your business name"}</label>
                <input
                  type="text" value={nombreNegocio} onChange={e => setNombreNegocio(e.target.value)}
                  placeholder={isEs ? "Ej: Burger Bros, Tacos El Rey, Sushi Palace..." : "E.g: Burger Bros, Taco King, Sushi Palace..."}
                  className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white placeholder-neutral-600 focus:border-white/30 focus:outline-none"
                />
              </div>
            </div>
          )}

          {plantilla.id === "chef_ia" && (
            <div className="space-y-4">
              <UploadZone
                label={isEs ? "🍽️ Foto del platillo terminado" : "🍽️ Photo of the finished dish"}
                hint={isEs ? "El plato que el chef va a preparar en el video de 15 segundos." : "The dish the chef will prepare in the 15-second video."}
                multiple={false}
                previews={prevPlato}
                onFiles={f => handleFiles(setImgPlato, setPrevPlato, f, 1)}
                onRemove={i => removeFile(setImgPlato, setPrevPlato, i, imgPlato)}
                disabled={loading}
                isEs={isEs}
              />
              <UploadZone
                label={isEs ? "👤 Tu foto como chef (opcional)" : "👤 Your photo as chef (optional)"}
                hint={isEs ? "Si subes tu foto, activa el checkbox de rostro humano abajo." : "If you upload your photo, check the human face box below."}
                multiple={false}
                previews={prevChef}
                onFiles={f => handleFiles(setImgChef, setPrevChef, f, 1)}
                onRemove={i => removeFile(setImgChef, setPrevChef, i, imgChef)}
                disabled={loading}
                isEs={isEs}
              />
              {!imgChef.length && (
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-neutral-300">🤖 {isEs ? "Avatar chef IA" : "AI chef avatar"}</label>
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
                <label className="text-xs font-semibold text-neutral-300">🏪 {isEs ? "Nombre de tu negocio" : "Your business name"}</label>
                <input
                  type="text" value={nombreNegocio} onChange={e => setNombreNegocio(e.target.value)}
                  placeholder={isEs ? "Ej: La Parrilla de Don Pedro" : "E.g: Don Pedro's Grill"}
                  className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white placeholder-neutral-600 focus:border-white/30 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-neutral-300">🎙️ {isEs ? "Narración en off (opcional)" : "Voiceover narration (optional)"}</label>
            <p className="text-[10px] text-neutral-500">
              {isEs ? "Texto que quieres que se escuche en el video. Si lo dejas vacío, el video será mudo." : "Text you want to hear in the video. If left empty, the video will be silent."}
            </p>
            <textarea
              value={narracion} onChange={e => setNarracion(e.target.value)} rows={2}
              placeholder={isEs ? "Ej: Descubre el sabor que te conquistará. Solo en Burger Bros." : "E.g: Discover the flavor that will win you over. Only at Burger Bros."}
              className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white placeholder-neutral-600 focus:border-white/30 focus:outline-none resize-none"
            />
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 p-4 space-y-3">
            <p className="text-[11px] font-semibold text-neutral-300">🎙️ {isEs ? "Voz de narración" : "Narration voice"}</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] text-neutral-400">{isEs ? "Acento" : "Accent"}</label>
                <select
                  value={accent} onChange={e => setAccent(e.target.value)}
                  className="w-full rounded-xl border border-white/15 bg-black/50 px-2 py-1.5 text-xs text-white focus:outline-none"
                >
                  {ACCENTS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-neutral-400">{isEs ? "Voz" : "Voice"}</label>
                <select
                  value={gender} onChange={e => setGender(e.target.value)}
                  className="w-full rounded-xl border border-white/15 bg-black/50 px-2 py-1.5 text-xs text-white focus:outline-none"
                >
                  <option value="mujer">👩 {isEs ? "Voz femenina" : "Female voice"}</option>
                  <option value="hombre">👨 {isEs ? "Voz masculina" : "Male voice"}</option>
                </select>
              </div>
            </div>
          </div>

          {plantilla.tieneRostro && (
            <HumanFaceCheckbox checked={hasHumanFace} onChange={setHasHumanFace} isEs={isEs} />
          )}

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}

          <button
            onClick={handleGenerar}
            disabled={loading || currentJades < costoActual}
            className={`w-full rounded-2xl border py-3.5 text-sm font-semibold transition-all ${plantilla.borde} ${
              loading || currentJades < costoActual
                ? "opacity-40 cursor-not-allowed text-neutral-500"
                : "bg-white/10 hover:bg-white/15 text-white cursor-pointer"
            }`}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                {statusText || (isEs ? "Generando..." : "Generating...")}
              </span>
            ) : (
              `${plantilla.emoji} ${isEs ? "Generar" : "Generate"} — ${costoActual} Jades`
            )}
          </button>
        </div>
      )}

      {resultado && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-white/10" />
            <span className="text-xs text-neutral-500">
              {resultado.success_count}/{resultado.total_scenes} {isEs ? "escenas generadas" : "scenes generated"}
            </span>
            <div className="h-px flex-1 bg-white/10" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(resultado.scenes || []).map((scene, idx) => (
              <SceneResult key={idx} scene={scene} idx={idx} isEs={isEs} />
            ))}
          </div>
        </div>
      )}

      {!plantilla && (
        <div className="rounded-2xl border border-white/5 bg-black/20 py-10 text-center">
          <p className="text-neutral-600 text-sm">← {isEs ? "Selecciona una plantilla para empezar" : "Select a template to get started"}</p>
        </div>
      )}
    </div>
  );
}
