import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Image as ImageIcon,
  LogIn,
  Download,
  Sparkles,
  ShieldCheck,
} from "lucide-react";

// -------------------- Componentes base --------------------

const cn = (...c) => c.filter(Boolean).join(" ");

const Section = ({ className = "", children }) => (
  <section className={cn("mx-auto max-w-6xl px-4", className)}>{children}</section>
);

// -------------------- LANDING --------------------

function Landing({ onOpenPanel }) {
  return (
    <div className="min-h-screen w-full bg-[#05060b] text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          {/* Logo + nombre */}
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-tr from-cyan-500 to-fuchsia-500 text-lg font-bold">
              iO
            </div>
            <div className="leading-tight">
              <div className="text-sm text-neutral-400">Stalling Technologic</div>
              <div className="text-lg font-semibold">
                isabelaOs <span className="text-neutral-400">Studio</span>
              </div>
            </div>
          </div>

          <nav className="hidden gap-6 text-sm text-neutral-300 md:flex">
            <a href="#como-funciona" className="hover:text-white">
              Cómo funciona
            </a>
            <a href="#galeria" className="hover:text-white">
              Galería
            </a>
            <a href="#planes" className="hover:text-white">
              Planes
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <button
              onClick={onOpenPanel}
              className="hidden rounded-xl border border-white/20 px-4 py-2 text-sm text-white hover:bg-white/10 md:inline-flex items-center gap-2"
            >
              <LogIn className="h-4 w-4" />
              Iniciar sesión (demo)
            </button>
            <button
              onClick={onOpenPanel}
              className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-fuchsia-500/30"
            >
              Probar generador en vivo
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Hero principal */}
      <main className="pb-20">
        <Section className="pt-14">
          <div className="grid gap-10 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] items-center">
            <div>
              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="text-balance text-4xl font-semibold leading-tight md:text-5xl"
              >
                isabelaOs Studio •{" "}
                <span className="bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-violet-400 bg-clip-text text-transparent">
                  generación de imágenes con IA
                </span>{" "}
                en la nube
              </motion.h1>
              <p className="mt-5 text-base text-neutral-300 md:text-lg">
                Plataforma creada en Guatemala, pensada para creadores de Latinoamérica.
                Conecta directamente con nuestro pipeline real en RunPod para generar
                imágenes con calidad de estudio.
              </p>
              <p className="mt-2 text-sm text-neutral-400">
                Versión inicial: <strong>solo generación de imagen</strong>. Más adelante
                añadiremos video, BodySync y CineCam.
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-4">
                <button
                  onClick={onOpenPanel}
                  className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-5 py-3 text-sm font-medium text-white shadow-lg shadow-fuchsia-500/30"
                >
                  Probar en vivo
                  <ImageIcon className="h-4 w-4" />
                </button>
                <button
                  onClick={onOpenPanel}
                  className="inline-flex items-center gap-2 rounded-2xl border border-white/15 px-5 py-3 text-sm text-neutral-200 hover:bg-white/10"
                >
                  Iniciar sesión (demo)
                  <LogIn className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-4 text-xs text-neutral-400">
                <span className="inline-flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-lime-300" />
                  Pipeline real conectado a RunPod
                </span>
                <span className="inline-flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-cyan-300" />
                  Primer enfoque: creadores de contenido en LATAM
                </span>
              </div>

              <div className="mt-4 text-sm text-neutral-400">
                Plan beta actual:{" "}
                <span className="font-semibold text-white">$5/mes</span> • Generación
                ilimitada de imágenes mientras dure la beta.
              </div>
            </div>

            {/* Vista previa del panel */}
            <div className="rounded-3xl border border-white/15 bg-white/5 p-4 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.7)]">
              <p className="text-sm text-neutral-300 mb-3">Vista previa del panel</p>
              <div className="aspect-[4/3] rounded-2xl bg-gradient-to-br from-cyan-500/10 via-fuchsia-500/10 to-black/60 p-4">
                <div className="h-full w-full rounded-2xl border border-white/15 bg-black/60" />
              </div>
            </div>
          </div>
        </Section>

        {/* Cómo funciona */}
        <Section id="como-funciona" className="mt-16">
          <h2 className="text-xl font-semibold">Cómo funciona</h2>
          <p className="mt-2 text-sm text-neutral-400">
            1) Escribes un prompt. 2) Nuestro backend manda el job a RunPod. 3) Cuando el
            render termina, ves la imagen en tu panel y puedes descargarla.
          </p>
        </Section>

        {/* Galería simple (estática por ahora) */}
        <Section id="galeria" className="mt-14">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold">Galería de ejemplo</h2>
            <span className="text-xs text-neutral-500">
              Imágenes de muestra (no finales)
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            {[
              "https://images.unsplash.com/photo-1518770660439-4636190af475?q=80&w=900&auto=format&fit=crop",
              "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?q=80&w=900&auto=format&fit=crop",
              "https://images.unsplash.com/photo-1554386690-89dd3aefca87?q=80&w=900&auto=format&fit=crop",
            ].map((src) => (
              <div
                key={src}
                className="overflow-hidden rounded-2xl border border-white/10 bg-black/40"
              >
                <img src={src} className="h-44 w-full object-cover" />
              </div>
            ))}
          </div>
        </Section>

        {/* Planes */}
        <Section id="planes" className="mt-16">
          <h2 className="text-xl font-semibold">Planes (fase imagen)</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/15 bg-white/5 p-5">
              <h3 className="text-lg font-semibold">Plan Beta Creadores</h3>
              <p className="mt-2 text-sm text-neutral-300">
                Acceso al generador conectado a RunPod, pensado para creadores que quieren
                probar isabelaOs Studio desde ya.
              </p>
              <p className="mt-3 text-2xl font-bold">
                $5<span className="text-base font-normal text-neutral-400">/mes</span>
              </p>
              <ul className="mt-3 space-y-1 text-sm text-neutral-300">
                <li>• Generación ilimitada de imágenes (uso justo)</li>
                <li>• Panel de control en la nube</li>
                <li>• Actualizaciones de la fase imagen sin costo extra</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-dashed border-white/15 p-5 text-sm text-neutral-400">
              <p>
                Más adelante agregaremos planes con{" "}
                <strong>video, BodySync, CineCam</strong> y otros módulos. Por ahora
                estamos enfocándonos solo en que la generación de imágenes sea estable y
                profesional.
              </p>
            </div>
          </div>
        </Section>
      </main>
    </div>
  );
}

// -------------------- PANEL + BIBLIOTECA --------------------

function CreatorPanel({ onBackToLanding, images, onNewImage }) {
  const [prompt, setPrompt] = useState(
    "Cinematic portrait, ultra detailed, soft light, 8k"
  );
  const [negative, setNegative] = useState(
    "blurry, low quality, deformed, watermark, text"
  );
  const [steps, setSteps] = useState(22);
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);

  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentImage, setCurrentImage] = useState("");

  async function handleGenerate(e) {
    e.preventDefault();
    setError("");
    setStatusText("Enviando job a RunPod...");
    setCurrentImage("");
    setLoading(true);

    try {
      // 1) Crear job
      const genRes = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          negative_prompt: negative,
          width: Number(width),
          height: Number(height),
          steps: Number(steps),
        }),
      });

      const genJson = await genRes.json();
      if (!genRes.ok || !genJson.ok) {
        throw new Error(genJson.error || "Error al crear el job");
      }

      const jobId = genJson.jobId;
      setStatusText(`Job enviado: ${jobId}`);

      // 2) Polling de estado
      let finished = false;
      while (!finished) {
        const stRes = await fetch(`/api/status?id=${jobId}`);
        const stJson = await stRes.json();

        if (!stRes.ok || !stJson.ok) {
          throw new Error(stJson.error || "Error al leer el estado");
        }

        const s = stJson.status;
        setStatusText(`Estado actual: ${s}...`);

        if (s === "IN_QUEUE" || s === "IN_PROGRESS") {
          await new Promise((r) => setTimeout(r, 3000));
        } else if (s === "COMPLETED") {
          const b64 = stJson.output?.image_b64;
          if (!b64) {
            throw new Error("No llegó la imagen en la respuesta");
          }
          const url = `data:image/png;base64,${b64}`;
          setCurrentImage(url);
          onNewImage(url);
          finished = true;
        } else {
          throw new Error(`Job terminado con estado ${s}`);
        }
      }

      setStatusText("Render completado ✅");
    } catch (err) {
      setError(String(err.message || err));
      setStatusText("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full bg-[#05060b] text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-tr from-cyan-500 to-fuchsia-500 text-lg font-bold">
              iO
            </div>
            <div className="leading-tight">
              <div className="text-xs text-neutral-400">Panel del creador</div>
              <div className="text-lg font-semibold">
                isabelaOs <span className="text-neutral-400">Studio</span>
              </div>
            </div>
          </div>

          <button
            onClick={onBackToLanding}
            className="rounded-xl border border-white/20 px-4 py-2 text-xs text-neutral-200 hover:bg-white/10"
          >
            Volver a la página principal
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 pb-16">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          {/* Formulario */}
          <div className="rounded-3xl border border-white/15 bg-white/5 p-6">
            <h2 className="text-lg font-semibold mb-4">Generador desde prompt</h2>
            <form onSubmit={handleGenerate} className="space-y-4">
              <label className="block text-sm">
                Prompt
                <textarea
                  className="mt-1 w-full rounded-2xl bg-black/70 px-3 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
                  rows={3}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </label>

              <label className="block text-sm">
                Negative prompt
                <textarea
                  className="mt-1 w-full rounded-2xl bg-black/70 px-3 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
                  rows={2}
                  value={negative}
                  onChange={(e) => setNegative(e.target.value)}
                />
              </label>

              <div className="grid grid-cols-3 gap-3 text-sm">
                <label className="block">
                  Steps
                  <input
                    type="number"
                    min={5}
                    max={50}
                    value={steps}
                    onChange={(e) => setSteps(e.target.value)}
                    className="mt-1 w-full rounded-2xl bg-black/70 px-3 py-2 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
                  />
                </label>
                <label className="block">
                  Width
                  <input
                    type="number"
                    value={width}
                    onChange={(e) => setWidth(e.target.value)}
                    className="mt-1 w-full rounded-2xl bg-black/70 px-3 py-2 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
                  />
                </label>
                <label className="block">
                  Height
                  <input
                    type="number"
                    value={height}
                    onChange={(e) => setHeight(e.target.value)}
                    className="mt-1 w-full rounded-2xl bg-black/70 px-3 py-2 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
                  />
                </label>
              </div>

              {statusText && (
                <div className="rounded-2xl bg-black/60 px-3 py-2 text-xs text-cyan-300">
                  {statusText}
                </div>
              )}
              {error && (
                <div className="rounded-2xl bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className={cn(
                  "mt-1 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-5 py-3 text-sm font-medium text-white shadow-lg shadow-fuchsia-500/30",
                  loading && "opacity-70"
                )}
              >
                {loading ? "Generando..." : "Generar imagen desde prompt"}
              </button>
            </form>
          </div>

          {/* Resultado actual */}
          <div className="rounded-3xl border border-white/15 bg-white/5 p-6">
            <h2 className="text-lg font-semibold mb-4">Resultado</h2>
            <div className="flex h-[340px] items-center justify-center rounded-2xl bg-black/70">
              {currentImage ? (
                <img
                  src={currentImage}
                  alt="Resultado"
                  className="max-h-full max-w-full rounded-2xl object-contain"
                />
              ) : (
                <p className="text-sm text-neutral-400 text-center px-4">
                  Aquí verás el resultado en cuanto se complete el render.
                </p>
              )}
            </div>
            {currentImage && (
              <a
                href={currentImage}
                download="isabelaos_image.png"
                className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-white/20 px-4 py-2 text-xs text-neutral-100 hover:bg-white/10"
              >
                <Download className="h-4 w-4" />
                Descargar imagen
              </a>
            )}
          </div>
        </div>

        {/* Biblioteca de imágenes renderizadas en esta sesión */}
        <section className="mt-10">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-neutral-100">
              Biblioteca de esta sesión
            </h3>
            <span className="text-xs text-neutral-500">
              Se guarda solo en tu navegador por ahora.
            </span>
          </div>
          {images.length === 0 ? (
            <p className="text-xs text-neutral-500">
              Aún no has generado imágenes en esta sesión.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-4">
              {images.map((src, i) => (
                <div
                  key={i}
                  className="overflow-hidden rounded-2xl border border-white/10 bg-black/60"
                >
                  <img src={src} className="h-32 w-full object-cover" />
                  <a
                    href={src}
                    download={`isabelaos_${i + 1}.png`}
                    className="flex items-center justify-center gap-1 border-t border-white/10 px-2 py-1.5 text-[11px] text-neutral-200 hover:bg-white/10"
                  >
                    <Download className="h-3 w-3" />
                    Descargar
                  </a>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

// -------------------- APP PRINCIPAL --------------------

export default function App() {
  const [view, setView] = useState("landing"); // 'landing' | 'panel'
  const [images, setImages] = useState([]);

  useEffect(() => {
    document.documentElement.style.background = "#05060b";
  }, []);

  function handleNewImage(url) {
    setImages((prev) => [url, ...prev].slice(0, 20)); // guardamos hasta 20
  }

  if (view === "panel") {
    return (
      <CreatorPanel
        onBackToLanding={() => setView("landing")}
        images={images}
        onNewImage={handleNewImage}
      />
    );
  }

  return <Landing onOpenPanel={() => setView("panel")} />;
}


