// src/components/ComercialPanel.jsx
// ─────────────────────────────────────────────────────────────
// Módulo Comercial IA
// El usuario sube 1-3 fotos, describe el comercial,
// elige acento y duración → el sistema genera:
//   - Storyboard con Gemini
//   - Imágenes por escena con Gemini Image
//   - Clips de video con Veo3 Fast
//   - Narración con ElevenLabs
// Costo: 120 Jades = $12 todo incluido
// ─────────────────────────────────────────────────────────────
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
      canvas.toBlob(blob => {
        URL.revokeObjectURL(url);
        blob ? resolve(blob) : reject(new Error("Error comprimiendo imagen"));
      }, "image/jpeg", 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Error cargando imagen")); };
    img.src = url;
  });
}

const ACCENTS = [
  { value: "neutro",        label: "🌎 Neutro latino" },
  { value: "guatemalteco",  label: "🇬🇹 Guatemalteco" },
  { value: "colombiano",    label: "🇨🇴 Colombiano" },
  { value: "mexicano",      label: "🇲🇽 Mexicano" },
  { value: "argentino",     label: "🇦🇷 Argentino" },
  { value: "español",       label: "🇪🇸 Español" },
];

const EXAMPLES = [
  "Comercial de una boutique de ropa femenina elegante. Una mujer entra, se prueba vestidos y sale radiante.",
  "Anuncio de un restaurante de comida típica guatemalteca. Platos humeantes, ambiente familiar, precios accesibles.",
  "Promoción de un spa y salón de belleza. Relajación, tratamientos, transformación personal.",
  "Comercial de joyería artesanal. Primer plano de las piezas, elegancia, regalo perfecto.",
];

// ── Componente de escena generada ─────────────────────────────
function SceneCard({ scene, index }) {
  const videoRef = useRef(null);

  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 overflow-hidden">
      <div className="bg-black/60 px-4 py-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-white">Escena {scene.scene_number}</span>
        <span className="text-[10px] text-neutral-400">{scene.camera}</span>
      </div>

      {/* Video o imagen de la escena */}
      <div className="relative bg-black aspect-[9/16] max-h-[300px] w-full">
        {scene.video_url ? (
          <video ref={videoRef} src={scene.video_url} controls
            className="w-full h-full object-contain" />
        ) : scene.video_b64 ? (
          <video ref={videoRef}
            src={`data:video/mp4;base64,${scene.video_b64}`} controls
            className="w-full h-full object-contain" />
        ) : scene.image_b64 ? (
          <img src={`data:${scene.image_mime};base64,${scene.image_b64}`}
            alt={`Escena ${scene.scene_number}`}
            className="w-full h-full object-contain" />
        ) : (
          <div className="flex items-center justify-center h-full text-neutral-500 text-xs">
            {scene.error || "Sin contenido generado"}
          </div>
        )}

        {!scene.ok && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <span className="text-xs text-red-300">Error en esta escena</span>
          </div>
        )}
      </div>

      {/* Narración */}
      {scene.narration_text && (
        <div className="px-4 py-3">
          <p className="text-[11px] text-neutral-400 italic">"{scene.narration_text}"</p>
          {scene.audio_b64 && (
            <audio controls className="mt-2 w-full h-8"
              src={`data:${scene.audio_mime};base64,${scene.audio_b64}`} />
          )}
        </div>
      )}

      {/* Descargar clip */}
      {(scene.video_url || scene.video_b64) && (
        <div className="px-4 pb-3">
          <a href={scene.video_url || `data:video/mp4;base64,${scene.video_b64}`}
            download={`comercial-escena-${scene.scene_number}.mp4`}
            className="block text-center rounded-xl border border-cyan-400/30 py-1.5 text-[11px] text-cyan-200 hover:bg-cyan-500/10 transition-all">
            ↓ Descargar clip
          </a>
        </div>
      )}
    </div>
  );
}

export default function ComercialPanel({ userStatus }) {
  // ── Fotos de referencia ───────────────────────────────────
  const [refFiles,    setRefFiles]    = useState([]);
  const [refPreviews, setRefPreviews] = useState([]);

  // ── Configuración ─────────────────────────────────────────
  const [description, setDescription] = useState("");
  const [duration,    setDuration]    = useState(30);
  const [accent,      setAccent]      = useState("neutro");
  const [hasAvatar,   setHasAvatar]   = useState(false);

  // ── Estados del pipeline ──────────────────────────────────
  const [step,        setStep]        = useState("config"); // config | storyboard | generating | done
  const [storyboard,  setStoryboard]  = useState(null);
  const [result,      setResult]      = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [statusText,  setStatusText]  = useState("");
  const [error,       setError]       = useState("");

  const currentJades = userStatus?.jades ?? 0;

  // ── Manejar fotos ─────────────────────────────────────────
  async function handleRefFiles(e) {
    const files = Array.from(e.target.files || []).slice(0, 3);
    setRefFiles(files);
    setRefPreviews(files.map(f => URL.createObjectURL(f)));
  }

  function removeRef(idx) {
    setRefFiles(prev => prev.filter((_, i) => i !== idx));
    setRefPreviews(prev => prev.filter((_, i) => i !== idx));
  }

  // ── Paso 1: Generar storyboard ────────────────────────────
  async function handleGenerateStoryboard() {
    if (!description.trim()) { setError("Describe tu comercial primero."); return; }
    if (currentJades < COMERCIAL_COST) {
      setError(`Necesitas ${COMERCIAL_COST} Jades. Tienes ${currentJades}.`); return;
    }

    setError(""); setLoading(true); setStatusText("Gemini está diseñando tu comercial...");

    try {
      // Comprimir y convertir fotos
      const refImages = [];
      for (const file of refFiles) {
        const compressed = await compressImage(file);
        const compFile   = new File([compressed], "ref.jpg", { type: "image/jpeg" });
        const b64        = await fileToBase64(compFile);
        refImages.push({ base64: b64, mimeType: "image/jpeg" });
      }

      const auth = await getAuthHeaders();
      const r    = await fetch("/api/comercial-storyboard", {
        method:  "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body:    JSON.stringify({ description, duration, hasAvatar, accent, referenceImages: refImages }),
      });

      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Error generando storyboard.");

      setStoryboard(j.storyboard);
      setStep("storyboard");
    } catch (e) {
      setError("No se pudo generar el storyboard. Intenta de nuevo.");
      console.error(e);
    } finally {
      setLoading(false); setStatusText("");
    }
  }

  // ── Paso 2: Generar el comercial completo ─────────────────
  async function handleGenerateComercial() {
    setError(""); setLoading(true); setStep("generating");
    setStatusText("Generando imágenes de cada escena...");

    try {
      // Re-comprimir fotos para el backend
      const refImages = [];
      for (const file of refFiles) {
        const compressed = await compressImage(file);
        const compFile   = new File([compressed], "ref.jpg", { type: "image/jpeg" });
        const b64        = await fileToBase64(compFile);
        refImages.push({ base64: b64, mimeType: "image/jpeg" });
      }

      setStatusText(`Generando ${storyboard.scenes.length} clips con Veo3... esto puede tomar 2-4 minutos ⏳`);

      const auth = await getAuthHeaders();
      const r    = await fetch("/api/comercial-generate", {
        method:  "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body:    JSON.stringify({ storyboard, referenceImages: refImages, accent, hasAvatar }),
      });

      const j = await r.json().catch(() => null);

      if (!r.ok) {
        if (j?.error === "INSUFFICIENT_JADES") {
          setError(`Jades insuficientes. Necesitas ${COMERCIAL_COST}J.`);
          setStep("config"); return;
        }
        throw new Error(j?.error || "Error generando comercial.");
      }

      setResult(j);
      setStep("done");
      setStatusText(`✅ ${j.success_count}/${j.total_scenes} escenas generadas`);

    } catch (e) {
      setError("Ocurrió un problema al generar el comercial. Intenta de nuevo.");
      setStep("storyboard");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">

      {/* ── Título ── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Comercial IA</h2>
          <p className="mt-1 text-sm text-neutral-400">
            Sube fotos de tu producto o persona y genera un comercial profesional completo con video, voz y narración.
          </p>
        </div>
        <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/5 px-4 py-2 text-right">
          <div className="text-xs text-neutral-400">Precio todo incluido</div>
          <div className="text-lg font-bold text-cyan-300">{COMERCIAL_COST} Jades</div>
          <div className="text-[10px] text-neutral-500">≈ $12 USD</div>
        </div>
      </div>

      {/* ── Info de lo que incluye ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
        {[
          { icon: "🎬", label: "4-7 clips de video", sub: "Veo3 Fast · 8s cada uno" },
          { icon: "🎙️", label: "Narración con IA",   sub: "ElevenLabs · acento latino" },
          { icon: "🖼️", label: "Imágenes HD",         sub: "Gemini Image · por escena" },
          { icon: "📱", label: "Formato vertical",   sub: "9:16 · listo para redes" },
        ].map(({ icon, label, sub }) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-black/30 px-3 py-3 text-center">
            <div className="text-xl mb-1">{icon}</div>
            <div className="font-semibold text-white">{label}</div>
            <div className="text-neutral-500 mt-0.5">{sub}</div>
          </div>
        ))}
      </div>

      {/* ════════════════════════════════════════
          PASO 1: CONFIGURACIÓN
      ════════════════════════════════════════ */}
      {(step === "config" || step === "storyboard") && (
        <div className="space-y-5">

          {/* Fotos de referencia */}
          <div>
            <label className="text-sm font-semibold text-white">
              Fotos de referencia <span className="text-neutral-400 font-normal">(hasta 3)</span>
            </label>
            <p className="mt-1 text-xs text-neutral-400">
              Sube fotos del producto, persona o ropa. El sistema las usará como base para cada escena.
            </p>

            <div className="mt-3 flex flex-wrap gap-3">
              {refPreviews.map((src, idx) => (
                <div key={idx} className="relative h-24 w-24 overflow-hidden rounded-2xl border border-white/10">
                  <img src={src} alt="" className="h-full w-full object-cover" />
                  <button onClick={() => removeRef(idx)}
                    className="absolute right-1 top-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] text-white hover:bg-red-500/80">
                    ✕
                  </button>
                </div>
              ))}

              {refFiles.length < 3 && (
                <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/20 bg-black/30 hover:border-cyan-400/40 hover:bg-cyan-500/5 transition-all">
                  <span className="text-2xl">+</span>
                  <span className="mt-1 text-[10px] text-neutral-400">Agregar foto</span>
                  <input type="file" accept="image/*" multiple onChange={handleRefFiles} className="hidden" />
                </label>
              )}
            </div>
          </div>

          {/* Descripción */}
          <div>
            <label className="text-sm font-semibold text-white">Describe tu comercial</label>
            <p className="mt-1 text-xs text-neutral-400">Explica qué vendes, qué quieres mostrar y qué sensación debe transmitir.</p>
            <textarea value={description} onChange={e => setDescription(e.target.value)}
              rows={4}
              placeholder="Ej: Comercial de una boutique de ropa femenina elegante. Una mujer entra, se prueba vestidos y sale radiante."
              className="mt-2 w-full resize-none rounded-2xl bg-black/60 px-4 py-3 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-cyan-400 transition-all" />

            {/* Ejemplos rápidos */}
            <div className="mt-2 flex flex-wrap gap-2">
              {EXAMPLES.map((ex, i) => (
                <button key={i} onClick={() => setDescription(ex)}
                  className="rounded-xl border border-white/10 bg-black/40 px-3 py-1.5 text-[10px] text-neutral-300 hover:bg-white/10 hover:text-white transition-all text-left">
                  {ex.slice(0, 40)}...
                </button>
              ))}
            </div>
          </div>

          {/* Duración y acento */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-semibold text-white">Duración</label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {[
                  { val: 30, label: "30 segundos", sub: "4 escenas" },
                  { val: 60, label: "60 segundos", sub: "7 escenas" },
                ].map(({ val, label, sub }) => (
                  <button key={val} onClick={() => setDuration(val)}
                    className={`rounded-2xl border p-3 text-left text-sm transition-all ${
                      duration === val
                        ? "border-cyan-400 bg-cyan-500/10 text-white"
                        : "border-white/10 bg-black/30 text-neutral-300 hover:border-white/20"
                    }`}>
                    <div className="font-semibold">{label}</div>
                    <div className="text-[10px] text-neutral-400">{sub}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold text-white">Acento de la narración</label>
              <select value={accent} onChange={e => setAccent(e.target.value)}
                className="mt-2 w-full rounded-2xl bg-black/60 px-4 py-3 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-cyan-400">
                {ACCENTS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Avatar */}
          <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-white">¿Tienes avatar creado?</div>
              <div className="text-xs text-neutral-400 mt-0.5">
                Si tienes un avatar, el sistema lo usará para mantener consistencia facial en cada escena.
              </div>
            </div>
            <button onClick={() => setHasAvatar(p => !p)}
              className={`rounded-xl px-4 py-2 text-xs font-semibold transition-all ${
                hasAvatar ? "bg-cyan-500 text-white" : "border border-white/20 text-neutral-300"
              }`}>
              {hasAvatar ? "✓ Sí tengo" : "No tengo"}
            </button>
          </div>

          {error && (
            <div className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-xs text-red-200">
              {error}
            </div>
          )}

          {/* Botón generar storyboard */}
          {step === "config" && (
            <button onClick={handleGenerateStoryboard} disabled={loading || !description.trim()}
              className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-4 text-sm font-bold text-white disabled:opacity-50 hover:opacity-90 transition-all">
              {loading ? statusText || "Generando storyboard..." : "🎬 Diseñar mi comercial"}
            </button>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════
          PASO 2: STORYBOARD — revisar antes de generar
      ════════════════════════════════════════ */}
      {step === "storyboard" && storyboard && (
        <div className="space-y-5">
          <div className="rounded-3xl border border-emerald-400/20 bg-emerald-500/5 p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="text-[11px] text-emerald-300 font-semibold uppercase tracking-wider">Storyboard listo</p>
                <h3 className="mt-1 text-xl font-bold text-white">"{storyboard.title}"</h3>
                <p className="mt-1 text-xs text-neutral-400">{storyboard.style}</p>
              </div>
              <div className="text-right text-xs text-neutral-400">
                <div>{storyboard.scenes?.length} escenas</div>
                <div className="mt-1">🎵 {storyboard.music_mood}</div>
              </div>
            </div>

            {/* Escenas del storyboard */}
            <div className="mt-5 space-y-3">
              {storyboard.scenes?.map((scene, idx) => (
                <div key={idx} className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="rounded-xl border border-white/10 bg-black/50 px-2.5 py-1 text-[10px] font-bold text-white">
                      {scene.scene_number}
                    </span>
                    <span className="text-[10px] text-neutral-400">{scene.camera}</span>
                  </div>
                  <p className="mt-2 text-sm text-neutral-200">{scene.description}</p>
                  <p className="mt-1 text-xs text-cyan-300 italic">"{scene.narration}"</p>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-2xl border border-yellow-400/20 bg-yellow-500/5 px-4 py-2 text-xs text-yellow-200">
              CTA final: "{storyboard.call_to_action}"
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button onClick={() => { setStep("config"); setStoryboard(null); }}
              className="rounded-2xl border border-white/20 py-3 text-sm text-white hover:bg-white/10 transition-all">
              ← Cambiar descripción
            </button>
            <button onClick={handleGenerateComercial} disabled={loading}
              className="rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-bold text-white disabled:opacity-50 hover:opacity-90 transition-all">
              {loading ? "Generando..." : `⚡ Generar comercial · ${COMERCIAL_COST}J`}
            </button>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════
          PASO 3: GENERANDO
      ════════════════════════════════════════ */}
      {step === "generating" && (
        <div className="rounded-3xl border border-cyan-400/20 bg-black/50 p-8 text-center">
          <div className="text-4xl mb-4 animate-pulse">🎬</div>
          <h3 className="text-lg font-semibold text-white">Produciendo tu comercial</h3>
          <p className="mt-2 text-sm text-neutral-400">{statusText}</p>
          <p className="mt-4 text-xs text-neutral-500">
            El motor genera cada escena de forma independiente.<br />
            Esto puede tomar 3-5 minutos. No cierres esta ventana.
          </p>
          <div className="mt-6 flex justify-center gap-1">
            {[0,1,2,3,4].map(i => (
              <div key={i} className="h-2 w-2 rounded-full bg-cyan-400 animate-bounce"
                style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════
          PASO 4: RESULTADO
      ════════════════════════════════════════ */}
      {step === "done" && result && (
        <div className="space-y-5">
          <div className="rounded-3xl border border-emerald-400/20 bg-emerald-500/5 px-5 py-4">
            <p className="text-sm font-semibold text-emerald-300">
              ✅ Comercial generado — {result.success_count}/{result.total_scenes} escenas completadas
            </p>
            <p className="mt-1 text-xs text-neutral-400">"{result.title}"</p>
            {result.call_to_action && (
              <p className="mt-2 text-xs text-yellow-200">CTA: {result.call_to_action}</p>
            )}
          </div>

          {/* Grid de escenas */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {result.scenes?.map((scene, idx) => (
              <SceneCard key={idx} scene={scene} index={idx} />
            ))}
          </div>

          {/* Botón nuevo comercial */}
          <button onClick={() => { setStep("config"); setStoryboard(null); setResult(null); setError(""); }}
            className="w-full rounded-2xl border border-white/20 py-3 text-sm text-white hover:bg-white/10 transition-all">
            + Crear otro comercial
          </button>
        </div>
      )}
    </div>
  );
}
