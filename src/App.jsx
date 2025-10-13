import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  Mail,
  UserPlus,
  Sparkles,
  ShieldCheck,
  Zap,
  PlayCircle,
} from "lucide-react";

const cn = (...c) => c.filter(Boolean).join(" ");
const Section = ({ id, className = "", children }) => (
  <section id={id} className={cn("mx-auto max-w-7xl px-4", className)}>
    {children}
  </section>
);

const NeonButton = ({ children, className = "", onClick }) => (
  <button
    onClick={onClick}
    className={cn(
      "group inline-flex items-center gap-2 rounded-2xl px-6 py-3 font-medium text-white",
      "bg-gradient-to-r from-cyan-500 to-fuchsia-500 neon-shadow",
      "hover:from-cyan-400 hover:to-fuchsia-400",
      className
    )}
  >
    {children}
  </button>
);

const Card = ({ className = "", children }) => (
  <div
    className={cn(
      "relative rounded-3xl border border-white/10 bg-white/5 p-6",
      "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04),0_20px_60px_-20px_rgba(0,0,0,0.45)]",
      className
    )}
    style={{ backdropFilter: "blur(10px)" }}
  >
    <div className="relative z-10">{children}</div>
    <div
      className="pointer-events-none absolute inset-0 rounded-3xl"
      style={{
        background:
          "radial-gradient(80%_60%_at_20%_0%,rgba(0,229,255,0.08),transparent),radial-gradient(70%_60%_at_100%_30%,rgba(255,23,229,0.06),transparent)",
      }}
    />
  </div>
);

function SignUpModal({ open, onClose }) {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4">
      <Card className="w-full max-w-xl p-8">
        <div className="flex items-start justify-between">
          <h3 className="text-2xl font-semibold text-white">
            Crea tu cuenta en{" "}
            <span className="bg-gradient-to-r from-cyan-400 to-fuchsia-400 bg-clip-text text-transparent">
              isabelaOs
            </span>
          </h3>
          <button
            onClick={onClose}
            className="rounded-xl px-3 py-1 text-neutral-300 hover:bg-white/10"
          >
            ✕
          </button>
        </div>
        <p className="mt-2 text-sm text-neutral-400">
          Regístrate con <strong>usuario</strong> o con tu <strong>correo</strong>.
        </p>
        <div className="mt-6 grid gap-4">
          <label className="block">
            <span className="text-sm text-neutral-300">Usuario</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="tu_usuario"
              className="mt-2 w-full rounded-2xl bg-black/60 px-4 py-3 text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm text-neutral-300">Correo</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                className="mt-2 w-full rounded-2xl bg-black/60 px-4 py-3 text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              />
            </label>
            <label className="block">
              <span className="text-sm text-neutral-300">Contraseña</span>
              <input
                type="password"
                placeholder="••••••••"
                className="mt-2 w-full rounded-2xl bg-black/60 px-4 py-3 text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              />
            </label>
          </div>
          <NeonButton onClick={() => alert(`(DEMO) Registrado: ${username || email}`)}>
            <UserPlus className="h-5 w-5" /> Crear cuenta{" "}
            <ArrowRight className="h-4 w-4 opacity-80" />
          </NeonButton>
          <button className="rounded-2xl border border-white/15 px-5 py-3 text-sm text-neutral-300 hover:bg-white/10">
            Continuar con Google (demo)
          </button>
        </div>
        <p className="mt-4 text-xs text-neutral-500">
          Al registrarte aceptas los <a className="underline decoration-dotted" href="#">Términos</a> y la{" "}
          <a className="underline decoration-dotted" href="#">Privacidad</a>.
        </p>
      </Card>
    </div>
  );
}

function Hero({ onSignup }) {
  return (
    <Section className="pt-16">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-balance text-5xl font-semibold leading-tight text-white md:text-6xl"
          >
            Construye experiencias{" "}
            <span className="bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-violet-400 bg-clip-text text-transparent">
              impulsadas por IA
            </span>
          </motion.h1>
          <p className="mt-5 max-w-xl text-lg text-neutral-300">
            isabelaOs crea imágenes y videos con calidad de estudio. Flujos de trabajo
            inteligentes, branding consistente y performance empresarial.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-4">
            <NeonButton onClick={onSignup}>
              <UserPlus className="h-5 w-5" /> Empieza gratis
            </NeonButton>
            <a
              href="#showcase"
              className="inline-flex items-center gap-2 rounded-2xl border border-white/15 px-6 py-3 text-white hover:bg-white/10"
            >
              <PlayCircle className="h-5 w-5" /> Ver ejemplos
            </a>
          </div>
          <div className="mt-6 flex items-center gap-6 text-sm text-neutral-400">
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-lime-300" /> Seguridad enterprise
            </span>
            <span className="inline-flex items-center gap-2">
              <Zap className="h-4 w-4 text-cyan-300" /> Render ultra-rápido
            </span>
          </div>
        </div>
        <Card className="p-0 overflow-hidden">
          <div className="relative aspect-[4/3] w-full">
            <img
              src="https://images.unsplash.com/photo-1603366615917-1fa6dad5c4fa?q=80&w=1200&auto=format&fit=crop"
              alt="Mujer mitad humana mitad robot"
              className="h-full w-full object-cover"
            />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_40%_at_30%_0%,rgba(0,229,255,0.25),transparent),radial-gradient(60%_40%_at_100%_40%,rgba(255,23,229,0.22),transparent)] mix-blend-screen" />
          </div>
        </Card>
      </div>
    </Section>
  );
}

function Logos() {
  return (
    <Section className="py-8">
      <div className="flex flex-wrap items-center justify-center gap-8 opacity-70">
        {["NVIDIA", "OpenLens", "Vectora", "Lumina", "DeepArts"].map((l) => (
          <div key={l} className="text-sm text-neutral-400">
            {l}
          </div>
        ))}
      </div>
    </Section>
  );
}

function Features() {
  const list = [
    { title: "Edición con IA", desc: "Guiones, escenas y assets generados automáticamente.", icon: <Sparkles className="h-5 w-5" /> },
    { title: "Plantillas Pro", desc: "Diseños de alto impacto con estética futurista.", icon: <Check className="h-5 w-5" /> },
    { title: "Exportación rápida", desc: "Entrega en múltiples formatos y resoluciones.", icon: <Zap className="h-5 w-5" /> },
  ];
  return (
    <Section id="features" className="py-10">
      <div className="mb-6">
        <h3 className="text-2xl font-semibold text-white">Lo que obtienes</h3>
        <p className="mt-2 text-neutral-400">Herramientas profesionales listas para producir.</p>
      </div>
      <div className="grid gap-6 md:grid-cols-3">
        {list.map((f, i) => (
          <Card key={i}>
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-cyan-400/30 to-fuchsia-400/30 text-white">
                {f.icon}
              </div>
              <div>
                <h4 className="text-white">{f.title}</h4>
                <p className="mt-1 text-sm text-neutral-400">{f.desc}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </Section>
  );
}

function Showcase() {
  return (
    <Section id="showcase" className="py-12">
      <div className="mb-6 flex items-end justify-between">
        <h3 className="text-2xl font-semibold text-white">Galería de la plataforma</h3>
        <a href="#" className="text-sm text-cyan-300 hover:text-cyan-200">
          Ver todo
        </a>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { type: "video", src: "https://cdn.coverr.co/videos/coverr-typing-on-a-computer-7657/1080p.mp4", caption: "Generación de escenas" },
          { type: "image", src: "https://images.unsplash.com/photo-1518770660439-4636190af475?q=80&w=1200&auto=format&fit=crop", caption: "Panel de control" },
          { type: "image", src: "https://images.unsplash.com/photo-1554386690-89dd3aefca87?q=80&w=1200&auto=format&fit=crop", caption: "Librería de assets" },
        ].map((m, i) => (
          <div key={i} className="group relative overflow-hidden rounded-2xl border border-white/10 bg-black/40">
            {m.type === "video" ? (
              <video src={m.src} autoPlay loop muted playsInline className="h-56 w-full object-cover" />
            ) : (
              <img src={m.src} alt={m.caption} className="h-56 w-full object-cover transition duration-500 group-hover:scale-105" />
            )}
            <div className="absolute bottom-3 left-3 text-sm text-white/90 drop-shadow">{m.caption}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Pricing({ onSignup }) {
  const plans = [
    { name: "Free", price: "$0", perks: ["Probar editor", "5 renders/mes", "Marca de agua"], cta: "Empieza ahora" },
    { name: "Pro", price: "$19", perks: ["Renders ilimitados", "Plantillas premium", "Soporte prioritario"], cta: "Elegir Pro" },
    { name: "Enterprise", price: "Contacta", perks: ["SSO/SAML", "Seguridad avanzada", "SLA dedicado"], cta: "Hablar con ventas" },
  ];
  return (
    <Section id="pricing" className="py-12">
      <div className="mb-8 text-center">
        <h3 className="text-2xl font-semibold text-white">Planes que crecen contigo</h3>
        <p className="mt-2 text-neutral-400">Comienza gratis, escala cuando lo necesites.</p>
      </div>
      <div className="grid gap-6 md:grid-cols-3">
        {plans.map((p, i) => (
          <Card key={i}>
            <div className="flex items-center justify-between">
              <h4 className="text-white">{p.name}</h4>
              <div className="text-lg font-semibold text-white">
                {p.price}
                <span className="text-sm font-normal text-neutral-400">/mes</span>
              </div>
            </div>
            <ul className="mt-4 space-y-2 text-sm text-neutral-300">
              {p.perks.map((k) => (
                <li key={k} className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-lime-300" /> {k}
                </li>
              ))}
            </ul>
            <NeonButton className="mt-6 w-full" onClick={onSignup}>
              {p.cta}
            </NeonButton>
          </Card>
        ))}
      </div>
    </Section>
  );
}

function Footer({ onSignup }) {
  return (
    <Section className="pb-16">
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h4 className="text-white">
              ¿Listo para crear algo{" "}
              <span className="bg-gradient-to-r from-cyan-400 to-fuchsia-400 bg-clip-text text-transparent">increíble</span>?
            </h4>
            <p className="mt-2 text-sm text-neutral-400">Únete hoy y obtén herramientas con IA.</p>
          </div>
          <div className="flex items-center gap-3 md:justify-end">
            <button
              onClick={onSignup}
              className="flex items-center gap-2 rounded-2xl border border-white/15 px-5 py-3 text-white hover:bg-white/10"
            >
              <Mail className="h-4 w-4" /> Registrarme con correo
            </button>
            <NeonButton>Ver demo</NeonButton>
          </div>
        </div>
        <div className="mt-6 flex items-center justify-between text-xs text-neutral-500">
          <span>© {new Date().getFullYear()} isabelaOs AI. Todos los derechos reservados.</span>
          <div className="flex gap-4">
            <a href="#">Privacidad</a>
            <a href="#">Términos</a>
            <a href="#">Soporte</a>
          </div>
        </div>
      </div>
    </Section>
  );
}

export default function App() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.documentElement.style.background = "#06070B";
  }, []);

  return (
    <div
      className="min-h-screen w-full"
      style={{
        background:
          "radial-gradient(1200px_800px_at_110%_-10%,rgba(255,23,229,0.12),transparent_60%),radial-gradient(900px_600px_at_-10%_0%,rgba(0,229,255,0.10),transparent_50%),#06070B",
      }}
    >
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="isabelaOs AI" className="h-9 w-9 rounded-xl" />
            <span className="text-lg font-semibold text-white">
              isabelaOs <span className="text-neutral-400">AI</span>
            </span>
          </div>
          <nav className="hidden gap-6 text-sm text-neutral-300 md:flex">
            <a href="#features" className="hover:text-white">Funciones</a>
            <a href="#showcase" className="hover:text-white">Galería</a>
            <a href="#pricing" className="hover:text-white">Planes</a>
          </nav>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setOpen(true)}
              className="rounded-xl border border-white/15 px-4 py-2 text-sm text-white hover:bg-white/10"
            >
              Registrarse
            </button>
            <NeonButton className="hidden md:inline-flex">Probar demo</NeonButton>
          </div>
        </div>
      </header>

      <Hero onSignup={() => setOpen(true)} />
      <Logos />
      <Features />
      <Showcase />
      <Pricing onSignup={() => setOpen(true)} />
      <Footer onSignup={() => setOpen(true)} />

      <SignUpModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

