import { useState, useEffect } from "react";
import "./App.css";

// Pequeño helper para clases
const cn = (...c) => c.filter(Boolean).join(" ");

// ----------------------
// Componentes genéricos
// ----------------------

const NeonButton = ({ children, className = "", ...props }) => (
  <button
    {...props}
    className={cn(
      "group inline-flex items-center justify-center gap-2 rounded-2xl px-6 py-3 font-medium text-white",
      "bg-gradient-to-r from-cyan-500 to-fuchsia-500 shadow-[0_0_25px_rgba(56,189,248,0.4)]",
      "hover:from-cyan-400 hover:to-fuchsia-400 hover:shadow-[0_0_35px_rgba(244,114,182,0.6)]",
      "transition-all duration-200",
      className
    )}
  >
    {children}
  </button>
);

const Section = ({ className = "", children }) => (
  <section className={cn("mx-auto max-w-6xl px-4", className)}>{children}</section>
);

// ----------------------
// Landing pública simple
// ----------------------

function Landing({ onOpenPanel }) {
  return (
    <div className="pt-20 pb-16">
      <Section className="grid gap-10 lg:grid-cols-[3fr,2fr] items-center">
        <div>
          <h1 className="text-4xl md:text-5xl font-semibold text-white leading-tight">
            isabelaOs Studio •
            <span className="ml-2 bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-violet-400 bg-clip-text text-transparent">
              generación de imágenes con IA en la nube
            </span>
          </h1>
          <p className="mt-5 text-lg text-neutral-300 max-w-xl">
            Crea imágenes con calidad de estudio conectadas a nuestro pipeline real en
            RunPod. Versión inicial:{" "}
            <span className="font-semibold text-cyan-300">solo generación de imagen</span>.
          </p>

          <div className="mt-7 flex flex-wrap gap-4 items-center">
            <NeonButton onClick={onOpenPanel}>Probar generador en vivo</NeonButton>
            <button
              className="rounded-2xl border border-white/15 px-5 py-3 text-sm text-neutral-200 hover:bg-white/5"
              onClick={onOpenPanel}
            >
              Iniciar sesión (demo)
            </button>
          </div>

          <p className="mt-4 text-sm text-neutral-500">
            Plan actual: <span className="font-semibold text-white">$5/mes</span> •
            Generación ilimitada de imágenes (mientras esté en beta).
          </p>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl shadow-[0_25px_80px_rgba(0,0,0,0.7)]">
          <div className="text-sm text-neutral-300 mb-3">Vista previa del panel</div>
          <div className="aspect-video rounded-2xl bg-gradient-to-br from-cyan-500/20 via-fuchsia-500/15 to-slate-900/90 flex items-center justify-center">
            <span className="text-neutral-200 text-sm">
              Aquí verás el panel de generación cuando entres
            </span>
          </div>
        </div>
      </Section>
    </div>
  );
}

// ----------------------
// Panel privado (demo)
// ----------------------

function Panel({ onBackToLanding }) {
  const [activeTab, setActiveTab] = useState("generate"); // "generate" | "library"

  const [prompt, setPrompt] = useState(
    "Cinematic portrait, ultra detailed, soft light, 8k"
  );
  const [negativePrompt, setNegativePrompt] = useState(
    "blurry, low quality, deformed, watermark, text"
  );
  const [steps, setSteps] = useState(22);
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);

  const [status, setStatus] = useState("idle"); // idle | pending | completed | error
  const [statusMessage, setStatusMessage] = useState("");
  const [generatedImage, setGeneratedImage] = useState(null);

  // Biblioteca local: [{ id, url, prompt, createdAt }]
  const [library, setLibrary] = useState([]);

  const handleGenerate = async () => {
    try {
      setStatus("pending");
      setStatusMessage("Enviando job a RunPod...");
      setGeneratedImage(null);

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          negative_prompt: negativePrompt,
          width: Number(width),
          height: Number(height),
          steps: Number(steps),
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok || !json.jobId) {
        throw new Error(json.error || "Error al crear el job.");
      }

      const jobId = json.jobId;
      setStatusMessage("Job creado. Esperando resultado...");

      // Polling a /api/status hasta que esté COMPLETED o FAILED
      let done = false;
      let data = null;

      while (!done) {
        await new Promise((r) => setTimeout(r, 2500));
        const sRes = await fetch(`/api/status?id=${jobId}`);
        const sJson = await sRes.json();

        if (!sRes.ok || sJson.error) {
          throw new Error(sJson.error || "Error al consultar el status.");
        }

        if (sJson.status === "IN_QUEUE" || sJson.status === "IN_PROGRESS") {
          setStatusMessage(`Estado actual: ${sJson.status}...`);
          continue;
        }

        // COMPLETED o FAILED
        done = true;
        data = sJson;
      }

      if (!data || data.status !== "COMPLETED") {
        setStatus("error");
        setStatusMessage(`Job no completado. Estado: ${data?.status || "?"}`);
        return;
      }

      if (!data.output || !data.output.image_b64) {
        setStatus("error");
        setStatusMessage("Error: No llegó la imagen en la respuesta.");
        return;
      }

      const imageUrl = `data:image/png;base64,${data.output.image_b64}`;
      setGeneratedImage(imageUrl);
      setStatus("completed");
      setStatusMessage("Imagen generada correctamente.");

      // Guardar en biblioteca local
      setLibrary((prev) => [
        {
          id: Date.now(),
          url: imageUrl,
          prompt,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);

      // Cambiamos a la pestaña Biblioteca automáticamente si quieres:
      // setActiveTab("library");
    } catch (err) {
      console.error(err);
      setStatus("error");
      setStatusMessage(String(err.message || err));
    }
  };

  return (
    <div className="min-h-screen pb-16">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/60 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-cyan-400 via-fuchsia-400 to-violet-500 shadow-lg" />
            <div className="flex flex-col">
              <span className="text-sm text-neutral-400">Panel del creador</span>
              <span className="text-lg font-semibold text-white">
                isabelaOs <span className="text-neutral-400">Studio</span>
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              className="rounded-xl border border-white/15 px-3 py-1 text-xs text-neutral-200 hover:bg-white/10"
              onClick={onBackToLanding}
            >
              Volver a la página principal
            </button>
          </div>
        </div>
      </header>

      <Section className="pt-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-xl md:text-2xl font-semibold text-white">
            Panel de generación de imágenes
          </h2>
          <div className="inline-flex rounded-2xl border border-white/10 bg-black/40 p-1 text-sm">
            <button
              onClick={() => setActiveTab("generate")}
              className={cn(
                "px-4 py-1.5 rounded-2xl transition",
                activeTab === "generate"
                  ? "bg-white/10 text-white"
                  : "text-neutral-400 hover:text-white"
              )}
            >
              Generar
            </button>
            <button
              onClick={() => setActiveTab("library")}
              className={cn(
                "px-4 py-1.5 rounded-2xl transition",
                activeTab === "library"
                  ? "bg-white/10 text-white"
                  : "text-neutral-400 hover:text-white"
              )}
            >
              Biblioteca
            </button>
          </div>
        </div>

        {/* Contenido de pestañas */}
        {activeTab === "generate" ? (
          <div className="mt-8 grid gap-8 lg:grid-cols-2">
            {/* Formulario */}
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-neutral-200">
                    Prompt
                  </label>
                  <textarea
                    className="mt-2 w-full rounded-2xl bg-black/60 px-4 py-3 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400 min-h-[96px]"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-200">
                    Negative prompt
                  </label>
                  <textarea
                    className="mt-2 w-full rounded-2xl bg-black/60 px-4 py-3 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-fuchsia-400 min-h-[80px]"
                    value={negativePrompt}
                    onChange={(e) => setNegativePrompt(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <label className="block text-neutral-200">Steps</label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      className="mt-2 w-full rounded-2xl bg-black/60 px-3 py-2 text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
                      value={steps}
                      onChange={(e) => setSteps(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-neutral-200">Width</label>
                    <input
                      type="number"
                      className="mt-2 w-full rounded-2xl bg-black/60 px-3 py-2 text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
                      value={width}
                      onChange={(e) => setWidth(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-neutral-200">Height</label>
                    <input
                      type="number"
                      className="mt-2 w-full rounded-2xl bg-black/60 px-3 py-2 text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
                      value={height}
                      onChange={(e) => setHeight(e.target.value)}
                    />
                  </div>
                </div>

                {/* Mensaje de estado */}
                {status !== "idle" && (
                  <div
                    className={cn(
                      "mt-2 rounded-2xl px-4 py-2 text-xs",
                      status === "pending" && "bg-blue-500/10 text-blue-200",
                      status === "completed" && "bg-emerald-500/10 text-emerald-200",
                      status === "error" && "bg-red-500/10 text-red-200"
                    )}
                  >
                    {statusMessage}
                  </div>
                )}

                <NeonButton
                  className="mt-4 w-full"
                  onClick={handleGenerate}
                  disabled={status === "pending"}
                >
                  {status === "pending" ? "Generando..." : "Generar imagen desde prompt"}
                </NeonButton>
              </div>
            </div>

            {/* Vista previa */}
            <div className="rounded-3xl border border-white/10 bg-black/60 p-4 flex items-center justify-center min-h-[320px]">
              {generatedImage ? (
                <img
                  src={generatedImage}
                  alt="Resultado IA"
                  className="max-h-[420px] max-w-full rounded-2xl shadow-[0_25px_70px_rgba(0,0,0,0.9)]"
                />
              ) : (
                <div className="text-sm text-neutral-500 text-center px-6">
                  Aquí verás el resultado en cuanto se complete el render.
                </div>
              )}
            </div>
          </div>
        ) : (
          // ---------------- Biblioteca ----------------
          <div className="mt-8">
            {library.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-white/15 bg-black/40 p-6 text-center text-sm text-neutral-400">
                Aún no tienes imágenes guardadas en esta sesión. Genera una imagen desde
                la pestaña <span className="text-white">Generar</span> y aparecerá aquí.
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-neutral-400">
                  Biblioteca local de esta sesión ({library.length} imagen
                  {library.length > 1 ? "es" : ""}). Haz clic en{" "}
                  <span className="font-medium text-white">Descargar</span> para guardar
                  el archivo.
                </p>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {library.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-white/10 bg-white/5 p-3 flex flex-col"
                    >
                      <div className="aspect-square overflow-hidden rounded-xl bg-black/80 mb-3">
                        <img
                          src={item.url}
                          alt={item.prompt}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <p className="text-xs text-neutral-300 line-clamp-2">
                        {item.prompt}
                      </p>
                      <p className="mt-1 text-[11px] text-neutral-500">
                        {new Date(item.createdAt).toLocaleString()}
                      </p>
                      <a
                        href={item.url}
                        download={`isabelaos-image-${item.id}.png`}
                        className="mt-3 inline-flex items-center justify-center rounded-xl bg-white/10 px-3 py-2 text-xs text-white hover:bg-white/20"
                      >
                        Descargar PNG
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

// ----------------------
// App principal
// ----------------------

export default function App() {
  const [view, setView] = useState("landing"); // "landing" | "panel"

  useEffect(() => {
    document.documentElement.style.backgroundColor = "#020617";
  }, []);

  return (
    <div
      className="min-h-screen text-white"
      style={{
        background:
          "radial-gradient(1200px_800px_at_110%_-10%,rgba(255,23,229,0.12),transparent_60%),radial-gradient(900px_600px_at_-10%_0%,rgba(0,229,255,0.10),transparent_50%),#020617",
      }}
    >
      {view === "landing" ? (
        <Landing onOpenPanel={() => setView("panel")} />
      ) : (
        <Panel onBackToLanding={() => setView("landing")} />
      )}
    </div>
  );
}


