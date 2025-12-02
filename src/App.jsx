import { useEffect, useState } from "react";

// ------------------ Helpers UI ------------------

const cn = (...c) => c.filter(Boolean).join(" ");

const PrimaryButton = ({ children, className = "", ...props }) => (
  <button
    className={cn(
      "inline-flex items-center justify-center rounded-2xl px-6 py-3 text-sm font-medium text-white",
      "bg-gradient-to-r from-cyan-400 via-fuchsia-500 to-violet-500",
      "shadow-[0_10px_30px_rgba(0,0,0,0.6)] hover:from-cyan-300 hover:to-fuchsia-400",
      "transition-colors disabled:cursor-not-allowed disabled:opacity-60",
      className
    )}
    {...props}
  >
    {children}
  </button>
);

const SecondaryButton = ({ children, className = "", ...props }) => (
  <button
    className={cn(
      "inline-flex items-center justify-center rounded-2xl border border-white/15 px-5 py-2.5 text-sm font-medium text-white",
      "hover:bg-white/10 transition-colors disabled:opacity-60 disabled:cursor-not-allowed",
      className
    )}
    {...props}
  >
    {children}
  </button>
);

const Modal = ({ open, onClose, title, children }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm px-4">
      <div className="relative w-full max-w-lg rounded-3xl border border-white/10 bg-[#05070b] px-6 py-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-xl px-2 py-1 text-sm text-neutral-300 hover:bg-white/10"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

// ------------------ Auth modals ------------------

const ADMIN_EMAIL =
  import.meta.env.VITE_ADMIN_EMAIL || "admin@isabelaos.local";

function AuthModal({ mode, open, onClose, onAuth }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setName("");
      setEmail("");
      setPassword("");
      setError("");
    }
  }, [open]);

  const isLogin = mode === "login";

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");

    if (!email || !password || (!isLogin && !name)) {
      setError("Por favor completa todos los campos.");
      return;
    }

    // DEMO: no hay backend real, solo guardamos en localStorage
    const user = {
      name: name || email.split("@")[0],
      email,
      isAdmin: email === ADMIN_EMAIL,
    };

    onAuth(user);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isLogin ? "Iniciar sesión" : "Crear cuenta"}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {!isLogin && (
          <div>
            <label className="text-sm text-neutral-300">Nombre</label>
            <input
              className="mt-1 w-full rounded-2xl bg-black/60 px-4 py-2.5 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tu nombre o alias"
            />
          </div>
        )}
        <div>
          <label className="text-sm text-neutral-300">Correo</label>
          <input
            type="email"
            className="mt-1 w-full rounded-2xl bg-black/60 px-4 py-2.5 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tucorreo@email.com"
          />
        </div>
        <div>
          <label className="text-sm text-neutral-300">Contraseña (demo)</label>
          <input
            type="password"
            className="mt-1 w-full rounded-2xl bg-black/60 px-4 py-2.5 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        {error && (
          <p className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-2xl px-3 py-2">
            {error}
          </p>
        )}

        <PrimaryButton type="submit" className="w-full mt-2">
          {isLogin ? "Entrar" : "Crear cuenta"}
        </PrimaryButton>

        <button
          type="button"
          className="w-full rounded-2xl border border-white/15 px-5 py-2.5 text-sm text-neutral-200 hover:bg-white/10"
        >
          Continuar con Google (placeholder)
        </button>

        <p className="text-[11px] text-neutral-500 mt-2">
          *Esta autenticación es solo de prueba. Luego conectaremos un sistema
          real con base de datos y pagos. Tu cuenta admin será el correo{" "}
          <span className="font-mono text-neutral-300">{ADMIN_EMAIL}</span>,
          que no paga suscripción.
        </p>
      </form>
    </Modal>
  );
}

// ------------------ Panel de generación ------------------

function GeneratorPanel({ user, onBack }) {
  const [prompt, setPrompt] = useState(
    "Cinematic portrait, ultra detailed, soft light, 8k"
  );
  const [negativePrompt, setNegativePrompt] = useState(
    "blurry, low quality, deformed, watermark, text"
  );
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);
  const [steps, setSteps] = useState(22);

  const [backendStatus, setBackendStatus] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");
  const [imageSrc, setImageSrc] = useState("");
  const [sessionImages, setSessionImages] = useState([]);

  // pequeño helper de espera
  const delay = (ms) => new Promise((res) => setTimeout(res, ms));

  const startGeneration = async () => {
    try {
      setIsGenerating(true);
      setError("");
      setImageSrc("");
      setBackendStatus("IN_QUEUE");

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          negative_prompt: negativePrompt,
          width,
          height,
          steps,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Error en /api/generate");
      }

      const jobId = data.jobId;
      await pollStatus(jobId, prompt);
    } catch (e) {
      console.error(e);
      setError("No se pudo iniciar el render. Revisa los logs si persiste.");
      setIsGenerating(false);
    }
  };

  const pollStatus = async (jobId, originalPrompt) => {
    try {
      // poll cada 3s hasta COMPLETED / FAILED
      // para evitar bucle eterno ponemos un límite de ~60s
      const maxTries = 25;
      let tries = 0;

      while (tries < maxTries) {
        tries += 1;
        const res = await fetch(`/api/status?id=${jobId}`);
        const data = await res.json();

        if (!res.ok || data.error) {
          throw new Error(data.error || "Error en /api/status");
        }

        setBackendStatus(data.status || "");

        if (data.status === "COMPLETED") {
          const b64 = data.output?.image_b64;
          if (!b64) {
            setError("El worker terminó pero no envió la imagen.");
            setIsGenerating(false);
            return;
          }
          const src = `data:image/png;base64,${b64}`;
          setImageSrc(src);
          setSessionImages((prev) => [
            {
              id: jobId,
              src,
              prompt: originalPrompt,
              createdAt: Date.now(),
            },
            ...prev,
          ]);
          setIsGenerating(false);
          return;
        }

        if (data.status === "FAILED") {
          setError("El render falló (status FAILED en RunPod).");
          setIsGenerating(false);
          return;
        }

        await delay(3000);
      }

      setError("El render tardó demasiado. Intenta de nuevo.");
      setIsGenerating(false);
    } catch (e) {
      console.error(e);
      setError("Error consultando el estado en RunPod.");
      setIsGenerating(false);
    }
  };

  const downloadImage = (src, filename = "isabelaos_image.png") => {
    const a = document.createElement("a");
    a.href = src;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="min-h-screen bg-[#05070b] text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-fuchsia-500 text-xs font-bold">
            io
          </div>
          <div>
            <div className="text-sm font-semibold">Panel del creador</div>
            <div className="text-xs text-neutral-400">isabelaOs Studio</div>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs text-neutral-300">
          {user && (
            <span>
              Sesión: <strong>{user.name}</strong>{" "}
              {user.isAdmin && (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
                  Admin (no cobra)
                </span>
              )}
            </span>
          )}
          <SecondaryButton onClick={onBack}>
            Volver a la página principal
          </SecondaryButton>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 lg:flex-row">
        {/* Columna izquierda: formulario */}
        <section className="flex-1 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-md">
          <h2 className="text-lg font-semibold mb-4">Generador desde prompt</h2>

          <div className="space-y-4 text-sm">
            <div>
              <label className="mb-1 block text-neutral-300">Prompt</label>
              <textarea
                className="h-24 w-full rounded-2xl bg-black/70 px-4 py-3 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-1 block text-neutral-300">
                Negative prompt
              </label>
              <textarea
                className="h-20 w-full rounded-2xl bg-black/70 px-4 py-3 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-neutral-300 text-xs">
                  Steps
                </label>
                <input
                  type="number"
                  min={5}
                  max={60}
                  className="w-full rounded-2xl bg-black/70 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
                  value={steps}
                  onChange={(e) => setSteps(Number(e.target.value || 0))}
                />
              </div>
              <div>
                <label className="mb-1 block text-neutral-300 text-xs">
                  Width
                </label>
                <input
                  type="number"
                  min={256}
                  max={1024}
                  step={64}
                  className="w-full rounded-2xl bg-black/70 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value || 0))}
                />
              </div>
              <div>
                <label className="mb-1 block text-neutral-300 text-xs">
                  Height
                </label>
                <input
                  type="number"
                  min={256}
                  max={1024}
                  step={64}
                  className="w-full rounded-2xl bg-black/70 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
                  value={height}
                  onChange={(e) => setHeight(Number(e.target.value || 0))}
                />
              </div>
            </div>

            <div className="mt-1 text-xs text-neutral-400">
              Estado actual:{" "}
              <span className="font-medium text-cyan-300">
                {backendStatus || "—"}
              </span>
            </div>

            {error && (
              <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-2xl px-3 py-2">
                {error}
              </p>
            )}

            <PrimaryButton
              onClick={startGeneration}
              disabled={isGenerating}
              className="mt-2 w-full"
            >
              {isGenerating ? "Generando..." : "Generar imagen desde prompt"}
            </PrimaryButton>
          </div>
        </section>

        {/* Columna derecha: resultado */}
        <section className="flex-1 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-md flex flex-col">
          <h2 className="text-lg font-semibold mb-4">Resultado</h2>
          <div className="flex-1 rounded-2xl bg-black/60 flex items-center justify-center overflow-hidden">
            {imageSrc ? (
              <img
                src={imageSrc}
                alt="Resultado"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <p className="px-6 text-center text-sm text-neutral-400">
                Aquí verás el resultado en cuanto se complete el render.
              </p>
            )}
          </div>

          {imageSrc && (
            <PrimaryButton
              className="mt-4 w-full"
              onClick={() => downloadImage(imageSrc, "isabelaos_resultado.png")}
            >
              Descargar imagen actual
            </PrimaryButton>
          )}
        </section>
      </main>

      {/* Biblioteca de la sesión */}
      <section className="mx-auto mb-10 mt-2 max-w-6xl px-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-white">
            Biblioteca de esta sesión
          </h3>
          <p className="text-[11px] text-neutral-500">
            De momento se guarda solo en tu navegador.
          </p>
        </div>

        {sessionImages.length === 0 ? (
          <p className="text-xs text-neutral-500">
            Aún no has generado imágenes en esta sesión.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-4">
            {sessionImages.map((img) => (
              <button
                key={img.id}
                onClick={() =>
                  downloadImage(
                    img.src,
                    `isabelaos_${new Date(img.createdAt)
                      .toISOString()
                      .slice(0, 19)
                      .replace(/[:T]/g, "-")}.png`
                  )
                }
                className="group overflow-hidden rounded-2xl border border-white/10 bg-black/60 text-left text-xs"
              >
                <img
                  src={img.src}
                  alt={img.prompt}
                  className="h-32 w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                <div className="p-2">
                  <p className="line-clamp-2 text-[11px] text-neutral-300">
                    {img.prompt}
                  </p>
                  <p className="mt-1 text-[10px] text-cyan-300">
                    Descargar PNG
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ------------------ Landing ------------------

function Landing({ user, onOpenLogin, onOpenRegister, onOpenPanel }) {
  return (
    <div className="min-h-screen bg-[#05070b] text-white">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#05070b]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-fuchsia-500 text-xs font-bold">
              io
            </div>
            <div>
              <div className="text-sm font-semibold">isabelaOs Studio</div>
              <div className="text-[11px] text-neutral-400">
                IA visual creada en Latinoamérica
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            {user && (
              <span className="hidden text-neutral-300 sm:inline">
                Sesión: <strong>{user.name}</strong>
              </span>
            )}
            {!user && (
              <>
                <button
                  onClick={onOpenLogin}
                  className="text-neutral-300 hover:text-white"
                >
                  Iniciar sesión
                </button>
                <button
                  onClick={onOpenRegister}
                  className="rounded-full border border-white/15 px-3 py-1.5 text-neutral-100 hover:bg-white/10"
                >
                  Crear cuenta
                </button>
              </>
            )}
            {user && (
              <SecondaryButton onClick={onOpenPanel}>
                Panel del creador
              </SecondaryButton>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-10">
        {/* Hero */}
        <section className="grid gap-10 md:grid-cols-[1.3fr_1fr] md:items-center">
          <div>
            <h1 className="text-balance text-4xl font-semibold leading-tight md:text-5xl">
              isabelaOs Studio •{" "}
              <span className="bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-violet-400 bg-clip-text text-transparent">
                generación de imágenes con IA en la nube
              </span>
            </h1>
            <p className="mt-4 text-sm text-neutral-300 md:text-base">
              Crea imágenes con calidad de estudio conectadas a nuestro pipeline
              real en RunPod. Versión inicial:{" "}
              <span className="font-semibold text-cyan-300">
                solo generación de imagen
              </span>{" "}
              a{" "}
              <span className="font-semibold text-emerald-300">
                $5/mes, ilimitado
              </span>{" "}
              mientras esté en beta.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <PrimaryButton onClick={onOpenPanel}>
                Probar generador en vivo
              </PrimaryButton>
              <SecondaryButton onClick={onOpenLogin}>
                Iniciar sesión (demo)
              </SecondaryButton>
            </div>

            <p className="mt-3 text-[11px] text-neutral-500">
              isabelaOs Studio es uno de los primeros sistemas de generación
              visual con IA desarrollados desde Latinoamérica, enfocado en
              creadores, agencias y negocios que quieren controlar su propio
              pipeline.
            </p>
          </div>

          {/* Preview panel miniatura */}
          <div className="hidden rounded-3xl border border-white/10 bg-gradient-to-b from-white/10 to-white/0 p-4 md:block">
            <div className="rounded-2xl border border-white/10 bg-black/70 p-4 text-[11px] text-neutral-300">
              <div className="mb-3 flex items-center justify-between">
                <span className="font-semibold text-white">
                  Vista previa del panel
                </span>
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
                  Live con RunPod
                </span>
              </div>
              <div className="h-24 rounded-xl bg-gradient-to-br from-cyan-500/20 via-fuchsia-500/20 to-violet-500/10" />
              <p className="mt-3 text-[11px] text-neutral-400">
                Escribe un prompt, ajusta pasos y resolución, y deja que
                isabelaOs Studio genere tus imágenes en la nube. Los resultados
                se guardan en tu biblioteca de sesión.
              </p>
            </div>
          </div>
        </section>

        {/* Galería ejemplo simple */}
        <section className="mt-14">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">
              Ejemplos que puedes generar
            </h2>
            <span className="text-[11px] text-neutral-500">
              Las imágenes reales se generan desde tu panel conectado a RunPod.
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/60">
              <img
                src="https://images.unsplash.com/photo-1519681393784-d120267933ba?q=80&w=900&auto=format&fit=crop"
                alt="Retrato cinematográfico"
                className="h-40 w-full object-cover"
              />
              <div className="p-3 text-[11px] text-neutral-300">
                Retratos cinematográficos ultra detallados con luz suave.
              </div>
            </div>
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/60">
              <img
                src="https://images.unsplash.com/photo-1498050108023-c5249f4df085?q=80&w=900&auto=format&fit=crop"
                alt="Escena futurista"
                className="h-40 w-full object-cover"
              />
              <div className="p-3 text-[11px] text-neutral-300">
                Escenas futuristas para branding, anuncios y contenido de
                redes.
              </div>
            </div>
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/60">
              <img
                src="https://images.unsplash.com/photo-1526498460520-4c246339dccb?q=80&w=900&auto=format&fit=crop"
                alt="Concept art"
                className="h-40 w-full object-cover"
              />
              <div className="p-3 text-[11px] text-neutral-300">
                Concept art y fondos para tus proyectos de video y producto.
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

// ------------------ App root ------------------

export default function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState("landing"); // "landing" | "panel"
  const [authMode, setAuthMode] = useState(null); // "login" | "register" | null

  // Cargar usuario guardado
  useEffect(() => {
    try {
      const raw = localStorage.getItem("io_user");
      if (raw) setUser(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  // Guardar usuario cuando cambie
  useEffect(() => {
    if (user) {
      localStorage.setItem("io_user", JSON.stringify(user));
    } else {
      localStorage.removeItem("io_user");
    }
  }, [user]);

  const openPanel = () => {
    // Si no hay usuario, forzamos login primero
    if (!user) {
      setAuthMode("login");
      return;
    }
    setView("panel");
  };

  const handleAuth = (u) => {
    setUser(u);
    setView("panel");
  };

  const goBackToLanding = () => {
    setView("landing");
  };

  return (
    <>
      {view === "landing" && (
        <Landing
          user={user}
          onOpenLogin={() => setAuthMode("login")}
          onOpenRegister={() => setAuthMode("register")}
          onOpenPanel={openPanel}
        />
      )}
      {view === "panel" && <GeneratorPanel user={user} onBack={goBackToLanding} />}

      <AuthModal
        mode={authMode || "login"}
        open={authMode !== null}
        onClose={() => setAuthMode(null)}
        onAuth={handleAuth}
      />
    </>
  );
}

