// src/components/LandingView.jsx
// ─────────────────────────────────────────────────────────────
// Landing page de IsabelaOS Studio — Versión impacto máximo
//
// Hooks psicológicos aplicados:
//   - Video hero fullscreen (dopamina inmediata)
//   - Curiosity gap en el headline
//   - Endowment effect: 10 Jades gratis
//   - Social proof: contador animado
//   - FOMO: "Únete a los creadores"
//   - Show don't tell: galería de videos reales
//   - Progressive commitment: cuadro de prueba siempre visible
//   - Identidad: "TÚ en una escena de Hollywood"
// ─────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from "react";
import { JADE_PACKS, COSTS } from "../lib/pricing";

function scrollToId(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Contador animado
function Counter({ end, suffix = "", label, duration = 2000 }) {
  const [count, setCount] = useState(0);
  const ref = useRef(null);
  const started = useRef(false);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !started.current) {
        started.current = true;
        const startTime = Date.now();
        const tick = () => {
          const elapsed = Date.now() - startTime;
          const progress = Math.min(elapsed / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          setCount(Math.floor(eased * end));
          if (progress < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
    }, { threshold: 0.5 });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [end, duration]);

  return (
    <div ref={ref} className="text-center">
      <div className="stat-num">{count.toLocaleString()}{suffix}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

// Tarjeta de módulo con video/imagen
function ModuleCard({ title, desc, badge, src, type = "image", accent = "#22d3ee", onClick }) {
  const [hovered, setHovered] = useState(false);
  const videoRef = useRef(null);

  useEffect(() => {
    if (!videoRef.current) return;
    if (hovered) videoRef.current.play().catch(() => {});
    else { videoRef.current.pause(); videoRef.current.currentTime = 0; }
  }, [hovered]);

  return (
    <button
      className="module-card"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ "--accent": accent }}
    >
      <div className="module-card-media">
        {type === "video" ? (
          <video
            ref={videoRef}
            src={src}
            className="module-card-video"
            muted loop playsInline preload="metadata"
          />
        ) : (
          <img src={src} className="module-card-video" alt={title} />
        )}
        <div className="module-card-overlay" />
      </div>
      <div className="module-card-content">
        {badge && <span className="module-badge">{badge}</span>}
        <h3 className="module-card-title">{title}</h3>
        <p className="module-card-desc">{desc}</p>
        <div className="module-card-cta">Probar gratis →</div>
      </div>
    </button>
  );
}

export default function LandingView({ onOpenAuth, onStartDemo, onOpenContact, onOpenAbout, lang, setLang }) {
  const [demoPrompt, setDemoPrompt] = useState("");
  const [heroVideoIdx, setHeroVideoIdx] = useState(0);
  const isEs = lang === "es";

  // Prompts de ejemplo que rotan
  const examplePrompts = isEs ? [
    "Modelo virtual elegante en escena de neón nocturno...",
    "Escena épica de pelea cinematográfica bajo la lluvia...",
    "Mujer modelando en pasarela con luces de ciudad...",
    "Avatar personalizado con identidad facial única...",
  ] : [
    "Elegant virtual model in neon night scene...",
    "Epic cinematic fight scene in the rain...",
    "Woman modeling on runway with city lights...",
    "Custom avatar with unique facial identity...",
  ];

  const [promptIdx, setPromptIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPromptIdx(i => (i + 1) % examplePrompts.length), 3000);
    return () => clearInterval(t);
  }, [lang]);

  // Galería de videos de capabilities — TUS videos reales
  const capVideos = [
    { src: "/gallery/video5.1.mp4", label: isEs ? "Pelea estilo Hollywood" : "Hollywood Fight Scene",    tag: "🎬 CineAI" },
    { src: "/gallery/video2.1.mp4", label: isEs ? "Slow Motion épico"     : "Epic Slow Motion",          tag: "🎬 CineAI" },
    { src: "/gallery/video3.1.mp4", label: isEs ? "Drama cinematográfico"  : "Cinematic Drama",           tag: "🎬 CineAI" },
    { src: "/gallery/video4.1.mp4", label: isEs ? "Mujer bajo la lluvia"   : "Woman in the Rain",         tag: "🎬 CineAI" },
    { src: "/gallery/video6.1.mp4", label: isEs ? "Modelo profesional"     : "Professional Model",        tag: "✨ IA Generativa" },
    { src: "/gallery/video7.1.mp4", label: isEs ? "Escena cinemática"      : "Cinematic Scene",           tag: "✨ IA Generativa" },
    { src: "/gallery/video8.1.mp4", label: isEs ? "Contenido viral"        : "Viral Content",             tag: "🕺 TikTok Trends" },
    { src: "/gallery/video9.1.mp4", label: isEs ? "Producción visual"      : "Visual Production",         tag: "✨ IA Generativa" },
  ];

  const t = {
    // Hero
    eyebrow:      isEs ? "La plataforma de producción visual con IA más avanzada de LATAM" : "The most advanced AI visual production platform in LATAM",
    h1a:          isEs ? "Conviértete en el" : "Become the",
    h1b:          isEs ? "protagonista" : "protagonist",
    h1c:          isEs ? "de tu propia película" : "of your own movie",
    sub:          isEs ? "Genera escenas de Hollywood, trends virales, videos musicales y contenido profesional con IA — con tu cara, tu historia, tu marca." : "Generate Hollywood scenes, viral trends, music videos and professional content with AI — your face, your story, your brand.",
    ctaPrimary:   isEs ? "🎬 Crear gratis ahora" : "🎬 Create free now",
    ctaSecondary: isEs ? "Ver lo que puedes crear ↓" : "See what you can create ↓",
    freeTag:      isEs ? "10 Jades gratis al registrarte · Sin tarjeta de crédito" : "10 free Jades on signup · No credit card",

    // Stats
    stat1n: "42,000+", stat1l: isEs ? "Contenidos generados" : "Contents generated",
    stat2n: "< 3s",    stat2l: isEs ? "Tiempo de generación" : "Generation time",
    stat3n: "98%",     stat3l: isEs ? "Satisfacción de usuarios" : "User satisfaction",
    stat4n: "6+",      stat4l: isEs ? "Módulos de producción" : "Production modules",

    // Curiosity section
    curiosityTag:   isEs ? "¿Cómo es posible?" : "How is this possible?",
    curiosityTitle: isEs ? "Todo esto fue creado con IA en IsabelaOS" : "All of this was created with AI in IsabelaOS",
    curiosityDesc:  isEs ? "Sin actores. Sin cámaras. Sin estudio. Solo tú, tu visión y nuestra IA." : "No actors. No cameras. No studio. Just you, your vision, and our AI.",

    // Modules
    modulesTag:   isEs ? "El sistema completo" : "The complete system",
    modulesTitle: isEs ? "Todo lo que necesitas para crear contenido profesional" : "Everything you need to create professional content",

    // Before/After photoshoot
    photoTag:   isEs ? "Transforma tus productos" : "Transform your products",
    photoTitle: isEs ? "De foto básica a campaña profesional" : "From basic photo to professional campaign",
    photoDesc:  isEs ? "Sube una foto de tu producto y nuestra IA genera 4 variaciones profesionales: Studio, Lifestyle, En uso y Campaña. En segundos." : "Upload a product photo and our AI generates 4 professional variations: Studio, Lifestyle, In Use and Campaign. In seconds.",

    // Avatar section
    avatarTag:   isEs ? "Tu identidad digital" : "Your digital identity",
    avatarTitle: isEs ? "Crea tu modelo virtual con tu rostro" : "Create your virtual model with your face",
    avatarDesc:  isEs ? "Sube 3-5 fotos tuyas y el sistema aprende tu rostro. Luego genera escenas, videos y contenido donde siempre eres tú — consistente, perfecto, en cualquier escenario imaginable." : "Upload 3-5 photos of yourself and the system learns your face. Then generates scenes, videos and content where it's always you — consistent, perfect, in any imaginable scenario.",

    // How
    howTag:   isEs ? "Tan fácil como escribir" : "As easy as writing",
    howTitle: isEs ? "De idea a producción en 3 pasos" : "From idea to production in 3 steps",
    how: [
      { n:"01", icon:"✍️", t: isEs?"Describe tu visión":"Describe your vision",   d: isEs?"Escribe lo que quieres crear. Puedes subir tu foto para aparecer en el resultado.":"Write what you want to create. Upload your photo to appear in the result." },
      { n:"02", icon:"⚡", t: isEs?"La IA genera en segundos":"AI generates in seconds", d: isEs?"Nuestros modelos de IA procesan tu solicitud y generan el contenido visual en tiempo real.":"Our AI models process your request and generate the visual content in real time." },
      { n:"03", icon:"🎬", t: isEs?"Descarga y publica":"Download and publish",   d: isEs?"Descarga en alta calidad. Comparte en TikTok, Instagram, YouTube o úsalo para tu marca.":"Download in high quality. Share on TikTok, Instagram, YouTube or use it for your brand." },
    ],

    // Social proof
    proofTag:   isEs ? "Lo que dicen los creadores" : "What creators say",
    proofTitle: isEs ? "Ellos ya están creando el futuro" : "They're already creating the future",
    testimonials: [
      { name: "Carlos M.",   role: isEs?"Creador de contenido, Guatemala":"Content creator, Guatemala", text: isEs?"Generé mi primer video de pelea estilo Matrix en 2 minutos. La gente pensó que era producción real.":"Generated my first Matrix-style fight video in 2 minutes. People thought it was real production.", stars: 5 },
      { name: "Sofía R.",    role: isEs?"Influencer, México":"Influencer, Mexico",                    text: isEs?"El módulo de Photoshoot transformó mis fotos de productos. Tripled my engagement in one week.":"The Photoshoot module transformed my product photos. Tripled my engagement in one week.", stars: 5 },
      { name: "Equipo Nova", role: isEs?"Agencia creativa, Colombia":"Creative agency, Colombia",     text: isEs?"Usamos IsabelaOS para pre-producción. Lo que tardaba días ahora tarda minutos.":"We use IsabelaOS for pre-production. What took days now takes minutes.", stars: 5 },
    ],

    // CTA Final
    finalTag:   isEs ? "Empieza hoy — es gratis" : "Start today — it's free",
    finalTitle: isEs ? "Tu primera escena cinematográfica en menos de 3 minutos" : "Your first cinematic scene in less than 3 minutes",
    finalDesc:  isEs ? "Sin tarjeta de crédito. Sin suscripción. 10 Jades gratis para comenzar. Cancela cuando quieras." : "No credit card. No subscription. 10 free Jades to start. Cancel anytime.",
    finalCta:   isEs ? "🎬 Crear mi primera escena gratis" : "🎬 Create my first free scene",

    // Nav
    plans:   isEs ? "Planes"        : "Plans",
    about:   isEs ? "Sobre nosotros": "About us",
    contact: isEs ? "Contacto"      : "Contact",
    login:   isEs ? "Iniciar sesión / Registrarse" : "Sign in / Register",
    langBtn: isEs ? "🌐 EN"         : "🌐 ES",

    // Demo box
    demoTag:   isEs ? "Inicio rápido" : "Quick start",
    demoTitle: isEs ? "Pruébalo ahora — 10 Jades gratis" : "Try it now — 10 free Jades",
    demoBtn:   isEs ? "Crear ahora →" : "Create now →",
    demoFree:  isEs ? "Sin tarjeta · Gratis para empezar" : "No card · Free to start",

    // Pricing
    pricingTag:   isEs ? "Sin suscripción"   : "No subscription",
    pricingTitle: isEs ? "Paga solo lo que usas" : "Pay only what you use",
    pricingDesc:  isEs ? "Compra Jades y genera cuando quieras. Sin mensualidad. 1 Jade = $0.10 USD." : "Buy Jades and generate whenever you want. No monthly fee. 1 Jade = $0.10 USD.",
    popular: isEs ? "Popular" : "Popular",
    buy:     isEs ? "Comprar" : "Buy",
  };

  const modules = [
    { key:"cineai",     src:"/gallery/video5.1.mp4",     type:"video", accent:"#f59e0b", badge:"🔥 NUEVO",
      title: isEs?"🎬 CineAI — Escenas Cinematográficas":"🎬 CineAI — Cinematic Scenes",
      desc:  isEs?"Pelea como en Hollywood. Copia trends de TikTok. Crea videos musicales. Con tu cara.":"Fight like Hollywood. Copy TikTok trends. Create music videos. With your face." },
    { key:"photoshoot", src:"/gallery/imagepoto.png",    type:"image", accent:"#22d3ee", badge:"📸",
      title: isEs?"📸 Photoshoot — Productos Pro":"📸 Photoshoot — Pro Products",
      desc:  isEs?"De foto básica a campaña profesional en segundos. Studio, Lifestyle, In Use, Campaign.":"From basic photo to professional campaign in seconds. Studio, Lifestyle, In Use, Campaign." },
    { key:"avatars",    src:"/gallery/avatar.mp4",       type:"video", accent:"#a855f7", badge:"👤",
      title: isEs?"👤 Avatares — Tu Identidad Digital":"👤 Avatars — Your Digital Identity",
      desc:  isEs?"Crea tu modelo virtual con tu rostro. Consistente en todas las generaciones.":"Create your virtual model with your face. Consistent across all generations." },
    { key:"comercial",  src:"/gallery/video1.mp4",       type:"video", accent:"#10b981", badge:"🎙️",
      title: isEs?"🎙️ Comercial IA — Ads en Segundos":"🎙️ Commercial AI — Ads in Seconds",
      desc:  isEs?"Genera comerciales profesionales con video, voz en off y narración IA.":"Generate professional commercials with video, voiceover and AI narration." },
    { key:"montaje",    src:"/gallery/img2.png",         type:"image", accent:"#f43f5e", badge:"✨",
      title: isEs?"✨ Montaje IA — Fondos Perfectos":"✨ Montaje IA — Perfect Backgrounds",
      desc:  isEs?"Monta personas o productos en cualquier escenario con IA.":"Mount people or products in any scenario with AI." },
    { key:"generator",  src:"/gallery/img1.png",         type:"image", accent:"#06b6d4", badge:"🖼️",
      title: isEs?"🖼️ Generador de Imágenes":"🖼️ Image Generator",
      desc:  isEs?"Genera imágenes cinematográficas con FLUX y avatares faciales.":"Generate cinematic images with FLUX and facial avatars." },
  ];

  return (
    <div className="land">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Clash+Display:wght@400;500;600;700&family=Syne:wght@400;500;700;800&family=DM+Sans:wght@300;400;500&display=swap');

        /* ── Reset ── */
        .land *, .land *::before, .land *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .land {
          font-family: 'DM Sans', sans-serif;
          background: #030407;
          color: #e8e4f0;
          overflow-x: hidden;
          min-height: 100vh;
        }

        /* ── CSS Variables ── */
        .land {
          --cyan: #22d3ee;
          --gold: #f59e0b;
          --fuchsia: #d946ef;
          --purple: #a855f7;
          --green: #10b981;
          --red: #f43f5e;
          --bg: #030407;
          --bg2: #07080f;
          --border: rgba(255,255,255,0.08);
          --text-muted: rgba(232,228,240,0.5);
        }

        /* ── NAVBAR ── */
        .land-nav {
          position: fixed;
          top: 0; left: 0; right: 0;
          z-index: 100;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 32px;
          background: rgba(3,4,7,0.75);
          backdrop-filter: blur(20px);
          border-bottom: 1px solid var(--border);
        }
        .land-nav-logo {
          display: flex; align-items: center; gap: 10px;
          text-decoration: none; color: inherit;
        }
        .land-nav-logo-icon {
          width: 36px; height: 36px;
          border-radius: 10px;
          background: linear-gradient(135deg, var(--cyan), var(--fuchsia));
          display: grid; place-items: center;
          font-size: 12px; font-weight: 800; color: #000;
          box-shadow: 0 0 20px rgba(34,211,238,0.4);
        }
        .land-nav-logo-text { font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 700; }
        .land-nav-logo-sub { font-size: 10px; color: var(--text-muted); letter-spacing: 1px; }
        .land-nav-links { display: flex; align-items: center; gap: 8px; }
        .land-nav-link {
          background: none; border: 1px solid transparent; border-radius: 8px;
          color: rgba(232,228,240,0.7); font-size: 13px; padding: 6px 14px; cursor: pointer;
          transition: all 0.2s; font-family: 'DM Sans', sans-serif;
        }
        .land-nav-link:hover { border-color: var(--border); color: #fff; background: rgba(255,255,255,0.05); }
        .land-nav-lang {
          background: rgba(255,255,255,0.06); border: 1px solid var(--border);
          border-radius: 8px; color: #fff; font-size: 12px; font-weight: 700;
          padding: 6px 12px; cursor: pointer; transition: all 0.2s; font-family: 'Syne', sans-serif;
        }
        .land-nav-lang:hover { background: rgba(255,255,255,0.12); }
        .land-nav-cta {
          background: linear-gradient(135deg, var(--cyan), var(--fuchsia));
          border: none; border-radius: 10px; color: #000;
          font-size: 13px; font-weight: 700; padding: 8px 20px; cursor: pointer;
          transition: all 0.2s; font-family: 'Syne', sans-serif;
          box-shadow: 0 0 20px rgba(34,211,238,0.25);
        }
        .land-nav-cta:hover { transform: translateY(-1px); box-shadow: 0 0 30px rgba(34,211,238,0.4); }

        /* ── HERO ── */
        .land-hero {
          position: relative;
          min-height: 100vh;
          display: flex;
          align-items: center;
          padding: 100px 32px 60px;
          overflow: hidden;
        }
        .land-hero-bg {
          position: absolute; inset: 0; z-index: 0;
          overflow: hidden;
        }
        .land-hero-video {
          width: 100%; height: 100%;
          object-fit: cover;
          opacity: 0.35;
          filter: saturate(1.4) contrast(1.1);
        }
        .land-hero-overlay {
          position: absolute; inset: 0;
          background: linear-gradient(
            to bottom,
            rgba(3,4,7,0.3) 0%,
            rgba(3,4,7,0.1) 40%,
            rgba(3,4,7,0.7) 80%,
            rgba(3,4,7,1) 100%
          );
        }
        .land-hero-glow {
          position: absolute;
          width: 600px; height: 600px;
          border-radius: 50%;
          filter: blur(120px);
          pointer-events: none;
        }
        .land-hero-glow-1 { background: rgba(34,211,238,0.15); top: -100px; left: -100px; }
        .land-hero-glow-2 { background: rgba(217,70,239,0.12); bottom: -100px; right: -100px; }

        .land-hero-inner {
          position: relative; z-index: 1;
          display: grid;
          grid-template-columns: 1fr 420px;
          gap: 60px;
          max-width: 1280px;
          margin: 0 auto;
          width: 100%;
          align-items: center;
        }

        .land-hero-left {}

        .land-hero-eyebrow {
          display: inline-flex; align-items: center; gap: 8px;
          background: rgba(34,211,238,0.1);
          border: 1px solid rgba(34,211,238,0.25);
          border-radius: 100px;
          padding: 6px 16px;
          font-size: 11px; letter-spacing: 2px; text-transform: uppercase;
          color: var(--cyan); font-weight: 600;
          margin-bottom: 24px;
          animation: fadeInDown 0.8s ease both;
        }
        .land-hero-eyebrow-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: var(--cyan);
          animation: pulse 2s infinite;
        }

        .land-hero-h1 {
          font-family: 'Clash Display', 'Syne', sans-serif;
          font-size: clamp(48px, 7vw, 88px);
          font-weight: 700;
          line-height: 0.95;
          letter-spacing: -2px;
          color: #fff;
          animation: fadeInDown 0.8s 0.1s ease both;
        }
        .land-hero-h1-accent {
          display: block;
          background: linear-gradient(135deg, var(--cyan) 0%, var(--fuchsia) 50%, var(--gold) 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .land-hero-h1-normal { display: block; }

        .land-hero-sub {
          margin-top: 20px;
          font-size: 17px;
          color: rgba(232,228,240,0.75);
          line-height: 1.7;
          max-width: 520px;
          animation: fadeInDown 0.8s 0.2s ease both;
        }

        .land-hero-ctas {
          margin-top: 36px;
          display: flex; flex-wrap: wrap; gap: 12px;
          animation: fadeInDown 0.8s 0.3s ease both;
        }
        .land-cta-primary {
          background: linear-gradient(135deg, var(--cyan), var(--fuchsia));
          border: none; border-radius: 14px;
          color: #000; font-family: 'Syne', sans-serif;
          font-size: 16px; font-weight: 800;
          padding: 16px 32px; cursor: pointer;
          transition: all 0.25s;
          box-shadow: 0 0 40px rgba(34,211,238,0.3), 0 4px 20px rgba(0,0,0,0.4);
          letter-spacing: 0.5px;
        }
        .land-cta-primary:hover { transform: translateY(-3px); box-shadow: 0 0 60px rgba(34,211,238,0.5), 0 8px 30px rgba(0,0,0,0.5); }
        .land-cta-secondary {
          background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15);
          border-radius: 14px; color: #fff;
          font-size: 15px; padding: 16px 28px; cursor: pointer;
          transition: all 0.2s; font-family: 'DM Sans', sans-serif;
        }
        .land-cta-secondary:hover { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.3); }
        .land-free-tag {
          margin-top: 14px;
          font-size: 12px; color: var(--text-muted);
          letter-spacing: 1px;
          animation: fadeInDown 0.8s 0.4s ease both;
        }
        .land-free-tag span { color: var(--cyan); font-weight: 600; }

        /* Demo box en hero */
        .land-demo-box {
          background: rgba(7,8,15,0.85);
          border: 1px solid rgba(34,211,238,0.2);
          border-radius: 24px;
          padding: 28px;
          backdrop-filter: blur(30px);
          box-shadow: 0 0 60px rgba(34,211,238,0.08), 0 40px 80px rgba(0,0,0,0.5);
          animation: fadeInRight 0.8s 0.3s ease both;
        }
        .land-demo-tag {
          font-size: 10px; letter-spacing: 3px; text-transform: uppercase;
          color: var(--cyan); font-weight: 700; margin-bottom: 8px;
        }
        .land-demo-title {
          font-family: 'Syne', sans-serif;
          font-size: 18px; font-weight: 800; color: #fff;
          margin-bottom: 6px; line-height: 1.3;
        }
        .land-demo-free-pill {
          display: inline-flex; align-items: center; gap: 6px;
          background: rgba(245,158,11,0.1);
          border: 1px solid rgba(245,158,11,0.25);
          border-radius: 100px; padding: 4px 12px;
          font-size: 11px; color: var(--gold); font-weight: 600;
          margin-bottom: 18px;
        }

        .land-demo-textarea {
          width: 100%;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 12px;
          color: #fff;
          font-family: 'DM Sans', sans-serif;
          font-size: 14px;
          padding: 14px 16px;
          resize: none;
          outline: none;
          height: 90px;
          transition: border-color 0.2s;
          margin-bottom: 14px;
        }
        .land-demo-textarea:focus { border-color: rgba(34,211,238,0.4); }
        .land-demo-textarea::placeholder { color: rgba(255,255,255,0.2); font-style: italic; }

        .land-demo-btn {
          width: 100%;
          background: linear-gradient(135deg, var(--cyan), var(--fuchsia));
          border: none; border-radius: 12px;
          color: #000; font-family: 'Syne', sans-serif;
          font-size: 16px; font-weight: 800;
          padding: 16px; cursor: pointer; transition: all 0.2s;
          box-shadow: 0 0 30px rgba(34,211,238,0.25);
          letter-spacing: 0.5px;
        }
        .land-demo-btn:hover { transform: translateY(-2px); box-shadow: 0 0 50px rgba(34,211,238,0.4); }
        .land-demo-sub { font-size: 11px; color: var(--text-muted); text-align: center; margin-top: 10px; }

        .land-demo-modules {
          display: grid; grid-template-columns: 1fr 1fr;
          gap: 6px; margin-bottom: 14px;
        }
        .land-demo-module {
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 8px; padding: 8px 10px;
          font-size: 11px; color: rgba(232,228,240,0.6);
          letter-spacing: 0.5px;
          display: flex; align-items: center; gap: 6px;
        }

        /* ── STATS ── */
        .land-stats {
          max-width: 1280px; margin: 0 auto;
          padding: 60px 32px;
          display: grid; grid-template-columns: repeat(4, 1fr);
          gap: 2px;
          background: var(--border);
          border-top: 1px solid var(--border);
          border-bottom: 1px solid var(--border);
        }
        .land-stats > * { background: var(--bg); padding: 40px 24px; }
        .stat-num {
          font-family: 'Clash Display', 'Syne', sans-serif;
          font-size: 48px; font-weight: 700;
          background: linear-gradient(135deg, var(--cyan), var(--fuchsia));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin-bottom: 6px;
        }
        .stat-label { font-size: 13px; color: var(--text-muted); letter-spacing: 1px; }

        /* ── SECTIONS GENERALES ── */
        .land-section { padding: 100px 32px; max-width: 1280px; margin: 0 auto; }
        .land-section-tag {
          display: inline-block;
          font-size: 11px; letter-spacing: 3px; text-transform: uppercase;
          color: var(--cyan); font-weight: 700; margin-bottom: 12px;
        }
        .land-section-title {
          font-family: 'Clash Display', 'Syne', sans-serif;
          font-size: clamp(32px, 5vw, 56px);
          font-weight: 700; color: #fff; line-height: 1.1;
          letter-spacing: -1px; margin-bottom: 16px;
        }
        .land-section-desc { font-size: 16px; color: var(--text-muted); line-height: 1.7; max-width: 600px; }

        /* ── VIDEOS CAPABILITIES ── */
        .land-cap-grid {
          margin-top: 50px;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          grid-template-rows: auto auto;
          gap: 12px;
        }
        .land-cap-item {
          position: relative; overflow: hidden; border-radius: 16px;
          aspect-ratio: 9/16;
          border: 1px solid var(--border);
          cursor: pointer;
          group: true;
        }
        .land-cap-item:nth-child(1) { grid-column: span 2; aspect-ratio: 16/9; }
        .land-cap-item:nth-child(6) { grid-column: span 2; aspect-ratio: 16/9; }
        .land-cap-video {
          width: 100%; height: 100%;
          object-fit: cover;
          transition: transform 0.5s ease, filter 0.3s;
        }
        .land-cap-item:hover .land-cap-video { transform: scale(1.05); }
        .land-cap-overlay {
          position: absolute; inset: 0;
          background: linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 60%);
          transition: opacity 0.3s;
        }
        .land-cap-info {
          position: absolute; bottom: 0; left: 0; right: 0;
          padding: 16px;
        }
        .land-cap-tag {
          display: inline-block;
          font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase;
          background: rgba(34,211,238,0.15); border: 1px solid rgba(34,211,238,0.3);
          border-radius: 6px; padding: 3px 8px; color: var(--cyan);
          margin-bottom: 6px;
        }
        .land-cap-label { font-size: 14px; font-weight: 600; color: #fff; font-family: 'Syne', sans-serif; }

        /* ── MODULES GRID ── */
        .modules-grid {
          margin-top: 50px;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
        }
        .module-card {
          position: relative; overflow: hidden; border-radius: 20px;
          border: 1px solid rgba(255,255,255,0.07);
          background: var(--bg2);
          cursor: pointer; text-align: left;
          transition: all 0.3s;
          min-height: 340px;
          display: flex; flex-direction: column;
        }
        .module-card:hover {
          border-color: var(--accent);
          transform: translateY(-4px);
          box-shadow: 0 20px 60px rgba(0,0,0,0.4), 0 0 40px color-mix(in srgb, var(--accent) 15%, transparent);
        }
        .module-card-media {
          position: relative; height: 180px; overflow: hidden;
        }
        .module-card-video {
          width: 100%; height: 100%; object-fit: cover;
          transition: transform 0.5s;
        }
        .module-card:hover .module-card-video { transform: scale(1.08); }
        .module-card-overlay {
          position: absolute; inset: 0;
          background: linear-gradient(to bottom, transparent 40%, var(--bg2) 100%);
        }
        .module-card-content {
          padding: 20px 22px 22px;
          flex: 1; display: flex; flex-direction: column;
        }
        .module-badge {
          display: inline-block;
          font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase;
          background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 6px; padding: 3px 8px; color: rgba(255,255,255,0.6);
          margin-bottom: 10px;
        }
        .module-card-title {
          font-family: 'Syne', sans-serif;
          font-size: 17px; font-weight: 700; color: #fff;
          margin-bottom: 8px; line-height: 1.3;
        }
        .module-card-desc {
          font-size: 13px; color: var(--text-muted); line-height: 1.6;
          flex: 1;
        }
        .module-card-cta {
          margin-top: 16px;
          font-size: 13px; font-weight: 600;
          color: var(--accent);
          transition: gap 0.2s;
          letter-spacing: 0.5px;
        }

        /* ── PHOTOSHOOT BEFORE/AFTER ── */
        .photo-ba {
          margin-top: 50px;
          display: grid; grid-template-columns: 1fr 1fr;
          gap: 20px; align-items: center;
        }
        .photo-ba-images {
          display: grid; grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .photo-ba-card {
          border-radius: 16px; overflow: hidden;
          border: 1px solid var(--border);
          position: relative;
        }
        .photo-ba-card img { width: 100%; display: block; }
        .photo-ba-label {
          position: absolute; bottom: 10px; left: 10px;
          background: rgba(0,0,0,0.7); border-radius: 6px;
          padding: 4px 10px; font-size: 11px; color: #fff; letter-spacing: 1px;
          backdrop-filter: blur(10px);
        }
        .photo-ba-arrow {
          display: flex; align-items: center; justify-content: center;
          font-size: 32px; color: var(--cyan);
          position: absolute; left: 50%; transform: translateX(-50%);
        }
        .photo-ba-text {}
        .photo-ba-features { margin-top: 24px; display: flex; flex-direction: column; gap: 12px; }
        .photo-ba-feature {
          display: flex; gap: 12px; align-items: flex-start;
          padding: 14px; border-radius: 12px;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.06);
        }
        .photo-ba-icon { font-size: 20px; flex-shrink: 0; margin-top: 2px; }
        .photo-ba-feature-title { font-size: 14px; font-weight: 600; color: #fff; margin-bottom: 2px; }
        .photo-ba-feature-desc { font-size: 12px; color: var(--text-muted); line-height: 1.5; }

        /* ── AVATAR SECTION ── */
        .avatar-section {
          margin-top: 80px; padding: 80px 32px;
          background: var(--bg2);
          border-top: 1px solid var(--border);
          border-bottom: 1px solid var(--border);
        }
        .avatar-inner {
          max-width: 1280px; margin: 0 auto;
          display: grid; grid-template-columns: 1fr 1fr;
          gap: 60px; align-items: center;
        }
        .avatar-video-wrap {
          position: relative; border-radius: 24px; overflow: hidden;
          border: 1px solid rgba(168,85,247,0.2);
          box-shadow: 0 0 60px rgba(168,85,247,0.1);
          aspect-ratio: 9/16; max-height: 500px;
        }
        .avatar-video { width: 100%; height: 100%; object-fit: cover; }
        .avatar-text {}
        .avatar-features { margin-top: 32px; display: flex; flex-direction: column; gap: 16px; }
        .avatar-feature {
          display: flex; gap: 14px; align-items: flex-start;
        }
        .avatar-feature-icon {
          width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0;
          display: grid; place-items: center; font-size: 18px;
          background: rgba(168,85,247,0.1);
          border: 1px solid rgba(168,85,247,0.2);
        }
        .avatar-feature-title { font-size: 15px; font-weight: 600; color: #fff; margin-bottom: 3px; }
        .avatar-feature-desc { font-size: 13px; color: var(--text-muted); line-height: 1.5; }

        /* ── HOW IT WORKS ── */
        .how-grid {
          margin-top: 50px;
          display: grid; grid-template-columns: repeat(3, 1fr);
          gap: 2px; background: var(--border);
        }
        .how-card {
          background: var(--bg); padding: 40px 32px;
          position: relative; overflow: hidden;
        }
        .how-card::before {
          content: attr(data-num);
          position: absolute; right: 24px; top: 24px;
          font-family: 'Clash Display', sans-serif;
          font-size: 80px; font-weight: 800;
          color: rgba(255,255,255,0.03); line-height: 1;
          pointer-events: none;
        }
        .how-num {
          font-size: 11px; letter-spacing: 3px; color: var(--cyan);
          font-weight: 700; text-transform: uppercase; margin-bottom: 16px;
        }
        .how-icon { font-size: 36px; margin-bottom: 16px; display: block; }
        .how-title {
          font-family: 'Syne', sans-serif;
          font-size: 20px; font-weight: 700; color: #fff; margin-bottom: 10px;
        }
        .how-desc { font-size: 14px; color: var(--text-muted); line-height: 1.7; }

        /* ── TESTIMONIALS ── */
        .testimonials-grid {
          margin-top: 50px;
          display: grid; grid-template-columns: repeat(3, 1fr);
          gap: 16px;
        }
        .testimonial-card {
          background: var(--bg2);
          border: 1px solid var(--border);
          border-radius: 20px;
          padding: 28px;
          transition: all 0.3s;
        }
        .testimonial-card:hover { border-color: rgba(34,211,238,0.2); transform: translateY(-3px); }
        .testimonial-stars { display: flex; gap: 3px; margin-bottom: 16px; }
        .testimonial-star { color: var(--gold); font-size: 16px; }
        .testimonial-text {
          font-size: 15px; color: rgba(232,228,240,0.85);
          line-height: 1.7; font-style: italic; margin-bottom: 20px;
        }
        .testimonial-divider { height: 1px; background: var(--border); margin-bottom: 16px; }
        .testimonial-name { font-size: 14px; font-weight: 700; color: #fff; font-family: 'Syne', sans-serif; }
        .testimonial-role { font-size: 12px; color: var(--text-muted); margin-top: 2px; }

        /* ── PRICING ── */
        .pricing-grid {
          margin-top: 50px;
          display: grid; grid-template-columns: repeat(4, 1fr);
          gap: 12px;
        }
        .pricing-card {
          background: var(--bg2);
          border: 1px solid var(--border);
          border-radius: 20px; padding: 28px;
          position: relative; overflow: hidden;
          transition: all 0.3s;
        }
        .pricing-card:hover { transform: translateY(-4px); }
        .pricing-card.featured {
          border-color: rgba(34,211,238,0.4);
          background: linear-gradient(160deg, rgba(34,211,238,0.08), var(--bg2));
          box-shadow: 0 0 40px rgba(34,211,238,0.1);
        }
        .pricing-popular {
          position: absolute; top: 16px; right: 16px;
          background: var(--cyan); color: #000;
          font-size: 10px; font-weight: 800; letter-spacing: 1px;
          border-radius: 6px; padding: 3px 8px; text-transform: uppercase;
        }
        .pricing-label { font-size: 11px; letter-spacing: 3px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 12px; }
        .pricing-price { display: flex; align-items: flex-end; gap: 4px; margin-bottom: 4px; }
        .pricing-amount { font-family: 'Clash Display', sans-serif; font-size: 48px; font-weight: 700; color: #fff; line-height: 1; }
        .pricing-currency { font-size: 14px; color: var(--text-muted); margin-bottom: 8px; }
        .pricing-jades { font-size: 18px; font-weight: 700; color: var(--cyan); margin-bottom: 20px; }
        .pricing-features { display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px; }
        .pricing-feature { display: flex; gap: 8px; font-size: 12px; color: rgba(232,228,240,0.75); align-items: center; }
        .pricing-feature-check { color: var(--cyan); font-size: 12px; flex-shrink: 0; }
        .pricing-btn {
          width: 100%; border-radius: 12px;
          font-size: 13px; font-weight: 700; padding: 12px;
          cursor: pointer; transition: all 0.2s; font-family: 'Syne', sans-serif;
        }
        .pricing-btn-featured {
          background: linear-gradient(135deg, var(--cyan), var(--fuchsia));
          border: none; color: #000;
          box-shadow: 0 0 20px rgba(34,211,238,0.25);
        }
        .pricing-btn-featured:hover { box-shadow: 0 0 40px rgba(34,211,238,0.4); }
        .pricing-btn-normal {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.12);
          color: #fff;
        }
        .pricing-btn-normal:hover { background: rgba(255,255,255,0.1); }

        /* ── FINAL CTA ── */
        .land-final-cta {
          margin: 0 32px 80px;
          border-radius: 32px;
          padding: 80px 60px;
          text-align: center;
          position: relative; overflow: hidden;
          background: linear-gradient(135deg, rgba(34,211,238,0.08), rgba(217,70,239,0.08));
          border: 1px solid rgba(34,211,238,0.15);
        }
        .land-final-cta::before {
          content: '';
          position: absolute; inset: 0;
          background: radial-gradient(ellipse at center, rgba(34,211,238,0.06), transparent 70%);
          pointer-events: none;
        }
        .land-final-tag { font-size: 11px; letter-spacing: 3px; text-transform: uppercase; color: var(--cyan); font-weight: 700; margin-bottom: 16px; }
        .land-final-title {
          font-family: 'Clash Display', 'Syne', sans-serif;
          font-size: clamp(32px, 5vw, 60px);
          font-weight: 700; color: #fff; line-height: 1.1;
          letter-spacing: -1px; margin-bottom: 16px;
        }
        .land-final-desc { font-size: 16px; color: var(--text-muted); max-width: 500px; margin: 0 auto 36px; line-height: 1.7; }
        .land-final-btn {
          display: inline-block;
          background: linear-gradient(135deg, var(--cyan), var(--fuchsia));
          border: none; border-radius: 16px;
          color: #000; font-family: 'Syne', sans-serif;
          font-size: 18px; font-weight: 800;
          padding: 20px 48px; cursor: pointer;
          transition: all 0.25s;
          box-shadow: 0 0 60px rgba(34,211,238,0.35), 0 8px 30px rgba(0,0,0,0.4);
        }
        .land-final-btn:hover { transform: translateY(-4px); box-shadow: 0 0 80px rgba(34,211,238,0.5), 0 12px 40px rgba(0,0,0,0.5); }

        /* ── FOOTER ── */
        .land-footer {
          border-top: 1px solid var(--border);
          background: rgba(7,8,15,0.8);
          padding: 60px 32px 32px;
        }
        .land-footer-inner {
          max-width: 1280px; margin: 0 auto;
          display: grid; grid-template-columns: 1.5fr 1fr 1fr 1fr;
          gap: 48px; margin-bottom: 48px;
        }
        .land-footer-logo { display: flex; gap: 10px; align-items: center; margin-bottom: 16px; }
        .land-footer-logo-icon {
          width: 36px; height: 36px; border-radius: 10px;
          background: linear-gradient(135deg, var(--cyan), var(--fuchsia));
          display: grid; place-items: center; font-size: 12px; font-weight: 800; color: #000;
        }
        .land-footer-logo-name { font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 700; color: #fff; }
        .land-footer-logo-sub { font-size: 10px; color: var(--text-muted); }
        .land-footer-desc { font-size: 13px; color: var(--text-muted); line-height: 1.7; }
        .land-footer-col-title { font-size: 11px; letter-spacing: 3px; text-transform: uppercase; color: rgba(255,255,255,0.5); font-weight: 700; margin-bottom: 16px; }
        .land-footer-link {
          display: block; font-size: 13px; color: var(--text-muted); margin-bottom: 10px;
          cursor: pointer; transition: color 0.2s; text-decoration: none;
        }
        .land-footer-link:hover { color: #fff; }
        .land-footer-bottom {
          max-width: 1280px; margin: 0 auto;
          border-top: 1px solid var(--border); padding-top: 24px;
          display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;
        }
        .land-footer-copy { font-size: 12px; color: rgba(255,255,255,0.3); }
        .land-footer-legal { font-size: 11px; color: rgba(255,255,255,0.2); text-align: center; flex: 1; }

        /* ── ANIMATIONS ── */
        @keyframes fadeInDown {
          from { opacity: 0; transform: translateY(-20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeInRight {
          from { opacity: 0; transform: translateX(30px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }

        /* ── RESPONSIVE MOBILE ── */
        @media (max-width: 768px) {
          .land-nav { padding: 12px 16px; }
          .land-nav-link { display: none; }
          .land-hero { padding: 80px 16px 40px; min-height: auto; }
          .land-hero-inner { grid-template-columns: 1fr; gap: 32px; }
          .land-hero-h1 { font-size: 42px; letter-spacing: -1px; }
          .land-hero-sub { font-size: 15px; }
          .land-demo-box { padding: 20px; }
          .land-stats { grid-template-columns: repeat(2, 1fr); }
          .stat-num { font-size: 36px; }
          .land-section { padding: 60px 16px; }
          .land-section-title { font-size: 32px; }
          .land-cap-grid { grid-template-columns: 1fr 1fr; }
          .land-cap-item:nth-child(1) { grid-column: span 2; aspect-ratio: 16/9; }
          .land-cap-item:nth-child(6) { grid-column: span 1; aspect-ratio: 9/16; }
          .modules-grid { grid-template-columns: 1fr; }
          .photo-ba { grid-template-columns: 1fr; }
          .avatar-inner { grid-template-columns: 1fr; }
          .avatar-video-wrap { max-height: 300px; aspect-ratio: 16/9; }
          .how-grid { grid-template-columns: 1fr; background: none; gap: 12px; }
          .how-card { border: 1px solid var(--border); border-radius: 16px; }
          .testimonials-grid { grid-template-columns: 1fr; }
          .pricing-grid { grid-template-columns: 1fr 1fr; }
          .land-final-cta { margin: 0 16px 60px; padding: 48px 24px; }
          .land-final-title { font-size: 32px; }
          .land-final-btn { font-size: 15px; padding: 16px 32px; }
          .land-footer-inner { grid-template-columns: 1fr 1fr; gap: 32px; }
        }
        @media (max-width: 480px) {
          .pricing-grid { grid-template-columns: 1fr; }
          .land-hero-h1 { font-size: 36px; }
          .land-ctas { flex-direction: column; }
          .land-cta-primary, .land-cta-secondary { width: 100%; text-align: center; }
        }
      `}</style>

      {/* ══ NAVBAR ══════════════════════════════════════════════ */}
      <nav className="land-nav">
        <div className="land-nav-logo">
          <div className="land-nav-logo-icon">io</div>
          <div>
            <div className="land-nav-logo-text">isabelaOs Studio</div>
            <div className="land-nav-logo-sub">{isEs ? "Plataforma IA" : "AI Platform"}</div>
          </div>
        </div>
        <div className="land-nav-links">
          <button className="land-nav-link" onClick={() => scrollToId("planes")}>{t.plans}</button>
          <button className="land-nav-link" onClick={onOpenAbout}>{t.about}</button>
          <button className="land-nav-link" onClick={onOpenContact}>{t.contact}</button>
          <button className="land-nav-lang" onClick={() => setLang(isEs ? "en" : "es")}>{t.langBtn}</button>
          <button className="land-nav-cta" onClick={onOpenAuth}>{t.login}</button>
        </div>
      </nav>

      {/* ══ HERO ════════════════════════════════════════════════ */}
      <section className="land-hero">
        {/* Video de fondo — la pelea más épica */}
        <div className="land-hero-bg">
          <video
            className="land-hero-video"
            src="/gallery/video5.1.mp4"
            autoPlay muted loop playsInline preload="auto"
          />
          <div className="land-hero-overlay" />
          <div className="land-hero-glow land-hero-glow-1" />
          <div className="land-hero-glow land-hero-glow-2" />
        </div>

        <div className="land-hero-inner">
          {/* Left — Copy */}
          <div className="land-hero-left">
            <div className="land-hero-eyebrow">
              <span className="land-hero-eyebrow-dot" />
              {t.eyebrow}
            </div>

            <h1 className="land-hero-h1">
              <span className="land-hero-h1-normal">{t.h1a}</span>
              <span className="land-hero-h1-accent">{t.h1b}</span>
              <span className="land-hero-h1-normal">{t.h1c}</span>
            </h1>

            <p className="land-hero-sub">{t.sub}</p>

            <div className="land-hero-ctas land-ctas">
              <button className="land-cta-primary" onClick={onStartDemo}>{t.ctaPrimary}</button>
              <button className="land-cta-secondary" onClick={() => scrollToId("capabilities")}>{t.ctaSecondary}</button>
            </div>
            <p className="land-free-tag">
              <span>{isEs ? "✓ 10 Jades gratis" : "✓ 10 free Jades"}</span>
              {" · "}{isEs ? "Sin tarjeta de crédito" : "No credit card required"}
            </p>
          </div>

          {/* Right — Demo box */}
          <div className="land-demo-box" id="demo-box">
            <div className="land-demo-tag">{t.demoTag}</div>
            <div className="land-demo-title">{t.demoTitle}</div>
            <div className="land-demo-free-pill">
              🎁 {isEs ? "10 Jades gratis al registrarte" : "10 free Jades on signup"}
            </div>

            <div className="land-demo-modules">
              {["🎬 CineAI", "📸 Photoshoot", "👤 Avatares", "🎙️ Comercial IA", "✨ Montaje", "🖼️ Imagen"].map(m => (
                <div key={m} className="land-demo-module">{m}</div>
              ))}
            </div>

            <textarea
              className="land-demo-textarea"
              value={demoPrompt}
              onChange={e => setDemoPrompt(e.target.value)}
              placeholder={examplePrompts[promptIdx]}
            />

            <button className="land-demo-btn" onClick={() => { onStartDemo(); }}>
              {t.demoBtn}
            </button>
            <div className="land-demo-sub">{t.demoFree}</div>
          </div>
        </div>
      </section>

      {/* ══ STATS ═══════════════════════════════════════════════ */}
      <div className="land-stats">
        <Counter end={42000} suffix="+" label={isEs ? "Contenidos generados" : "Contents generated"} />
        <div className="text-center" style={{ background: "var(--bg)", padding: "40px 24px" }}>
          <div className="stat-num">&lt; 3s</div>
          <div className="stat-label">{isEs ? "Tiempo de generación" : "Generation time"}</div>
        </div>
        <Counter end={98} suffix="%" label={isEs ? "Satisfacción de usuarios" : "User satisfaction"} />
        <div className="text-center" style={{ background: "var(--bg)", padding: "40px 24px" }}>
          <div className="stat-num">6+</div>
          <div className="stat-label">{isEs ? "Módulos de producción" : "Production modules"}</div>
        </div>
      </div>

      {/* ══ CAPABILITIES — GALERÍA DE VIDEOS ═══════════════════ */}
      <section className="land-section" id="capabilities">
        <div className="land-section-tag">{t.curiosityTag}</div>
        <h2 className="land-section-title">{t.curiosityTitle}</h2>
        <p className="land-section-desc">{t.curiosityDesc}</p>

        <div className="land-cap-grid">
          {capVideos.map((v, i) => (
            <VideoCapCard key={i} {...v} onClick={onStartDemo} />
          ))}
        </div>
      </section>

      {/* ══ MÓDULOS ═════════════════════════════════════════════ */}
      <section className="land-section" style={{ paddingTop: 0 }}>
        <div className="land-section-tag">{t.modulesTag}</div>
        <h2 className="land-section-title">{t.modulesTitle}</h2>

        <div className="modules-grid">
          {modules.map(m => (
            <ModuleCard key={m.key} {...m} onClick={onStartDemo} />
          ))}
        </div>
      </section>

      {/* ══ PHOTOSHOOT BEFORE/AFTER ════════════════════════════ */}
      <section className="land-section" style={{ paddingTop: 0 }}>
        <div className="photo-ba">
          <div className="photo-ba-images">
            <div className="photo-ba-card">
              <img src="/gallery/imagepoto.png" alt="Before" />
              <div className="photo-ba-label">📷 {isEs ? "Antes" : "Before"}</div>
            </div>
            <div className="photo-ba-card">
              <img src="/gallery/imagepoto1.png" alt="After" />
              <div className="photo-ba-label" style={{ color: "#22d3ee" }}>✨ {isEs ? "Después" : "After"}</div>
            </div>
          </div>
          <div className="photo-ba-text">
            <div className="land-section-tag">{t.photoTag}</div>
            <h2 className="land-section-title" style={{ fontSize: "clamp(28px,4vw,44px)" }}>{t.photoTitle}</h2>
            <p className="land-section-desc">{t.photoDesc}</p>
            <div className="photo-ba-features">
              {[
                { icon: "🏢", t: "Studio",    d: isEs ? "Fondo blanco profesional, luz de estudio perfecta" : "Professional white background, perfect studio light" },
                { icon: "🌿", t: "Lifestyle", d: isEs ? "Contexto de vida real, auténtico y aspiracional" : "Real life context, authentic and aspirational" },
                { icon: "🎯", t: "In Use",    d: isEs ? "Producto en acción, muestra el valor real" : "Product in action, shows real value" },
                { icon: "🚀", t: "Campaign",  d: isEs ? "Listo para publicar en redes sociales" : "Ready to publish on social media" },
              ].map(f => (
                <div key={f.t} className="photo-ba-feature">
                  <div className="photo-ba-icon">{f.icon}</div>
                  <div>
                    <div className="photo-ba-feature-title">{f.t}</div>
                    <div className="photo-ba-feature-desc">{f.d}</div>
                  </div>
                </div>
              ))}
            </div>
            <button className="land-cta-primary" style={{ marginTop: 28 }} onClick={onStartDemo}>
              {isEs ? "📸 Probar Photoshoot gratis" : "📸 Try Photoshoot free"}
            </button>
          </div>
        </div>
      </section>

      {/* ══ AVATAR SECTION ══════════════════════════════════════ */}
      <div className="avatar-section">
        <div className="avatar-inner">
          <div className="avatar-video-wrap">
            <video
              className="avatar-video"
              src="/gallery/avatar.mp4"
              autoPlay muted loop playsInline
            />
          </div>
          <div className="avatar-text">
            <div className="land-section-tag">{t.avatarTag}</div>
            <h2 className="land-section-title" style={{ fontSize: "clamp(28px,4vw,48px)" }}>{t.avatarTitle}</h2>
            <p className="land-section-desc">{t.avatarDesc}</p>
            <div className="avatar-features">
              {[
                { icon: "🧬", t: isEs?"Identidad consistente":"Consistent identity",       d: isEs?"Tu rostro reconocido en todas las generaciones, sin variaciones.":"Your face recognized in all generations, no variations." },
                { icon: "🎭", t: isEs?"Cualquier escenario":"Any scenario",                d: isEs?"Desde escenas de acción hasta fotos de moda. Siempre tú.":"From action scenes to fashion photos. Always you." },
                { icon: "⚡", t: isEs?"Generación en segundos":"Generation in seconds",   d: isEs?"No esperes horas. Tu contenido listo en segundos con GPU dedicada.":"Don't wait hours. Your content ready in seconds with dedicated GPU." },
              ].map(f => (
                <div key={f.t} className="avatar-feature">
                  <div className="avatar-feature-icon">{f.icon}</div>
                  <div>
                    <div className="avatar-feature-title">{f.t}</div>
                    <div className="avatar-feature-desc">{f.d}</div>
                  </div>
                </div>
              ))}
            </div>
            <button className="land-cta-primary" style={{ marginTop: 28 }} onClick={onStartDemo}>
              {isEs ? "👤 Crear mi avatar gratis" : "👤 Create my free avatar"}
            </button>
          </div>
        </div>
      </div>

      {/* ══ HOW IT WORKS ════════════════════════════════════════ */}
      <section className="land-section">
        <div className="land-section-tag">{t.howTag}</div>
        <h2 className="land-section-title">{t.howTitle}</h2>
        <div className="how-grid">
          {t.how.map((s, i) => (
            <div key={i} className="how-card" data-num={s.n}>
              <div className="how-num">{s.n}</div>
              <span className="how-icon">{s.icon}</span>
              <div className="how-title">{s.t}</div>
              <p className="how-desc">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ══ TESTIMONIALS ════════════════════════════════════════ */}
      <section className="land-section" style={{ paddingTop: 0 }}>
        <div className="land-section-tag">{t.proofTag}</div>
        <h2 className="land-section-title">{t.proofTitle}</h2>
        <div className="testimonials-grid">
          {t.testimonials.map((tm, i) => (
            <div key={i} className="testimonial-card">
              <div className="testimonial-stars">
                {Array(tm.stars).fill(0).map((_, j) => <span key={j} className="testimonial-star">★</span>)}
              </div>
              <p className="testimonial-text">"{tm.text}"</p>
              <div className="testimonial-divider" />
              <div className="testimonial-name">{tm.name}</div>
              <div className="testimonial-role">{tm.role}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ══ PRICING ═════════════════════════════════════════════ */}
      <section className="land-section" id="planes">
        <div className="land-section-tag">{t.pricingTag}</div>
        <h2 className="land-section-title">{t.pricingTitle}</h2>
        <p className="land-section-desc">{t.pricingDesc}</p>

        <div className="pricing-grid">
          {Object.entries(JADE_PACKS).map(([key, p]) => {
            const isFeat = key === "popular";
            return (
              <div key={key} className={`pricing-card ${isFeat ? "featured" : ""}`}>
                {isFeat && <div className="pricing-popular">{t.popular}</div>}
                <div className="pricing-label">{p.label}</div>
                <div className="pricing-price">
                  <span className="pricing-amount">${p.price_usd}</span>
                  <span className="pricing-currency">USD</span>
                </div>
                <div className="pricing-jades">{p.jades} Jades</div>
                <div className="pricing-features">
                  {[
                    { check: true,  text: `${p.jades} ${isEs ? "imágenes" : "images"}` },
                    { check: true,  text: `${Math.floor(p.jades / COSTS.vid_express_8s)} videos Express 8s` },
                    { check: true,  text: `${Math.floor(p.jades / 40)} videos CineAI 5s` },
                    { check: true,  text: `${Math.floor(p.jades / 20)} ${isEs ? "sesiones Photoshoot" : "Photoshoot sessions"}` },
                    { check: true,  text: isEs ? "Jades sin vencimiento" : "Jades never expire" },
                  ].map((f, i) => (
                    <div key={i} className="pricing-feature">
                      <span className="pricing-feature-check">✓</span>
                      {f.text}
                    </div>
                  ))}
                </div>
                <button
                  onClick={onOpenAuth}
                  className={`pricing-btn ${isFeat ? "pricing-btn-featured" : "pricing-btn-normal"}`}
                >
                  {t.buy} {p.label}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* ══ FINAL CTA ═══════════════════════════════════════════ */}
      <div className="land-final-cta">
        <div className="land-final-tag">{t.finalTag}</div>
        <h2 className="land-final-title">{t.finalTitle}</h2>
        <p className="land-final-desc">{t.finalDesc}</p>
        <button className="land-final-btn" onClick={onStartDemo}>{t.finalCta}</button>
      </div>

      {/* ══ FOOTER ══════════════════════════════════════════════ */}
      <footer className="land-footer">
        <div className="land-footer-inner">
          <div>
            <div className="land-footer-logo">
              <div className="land-footer-logo-icon">io</div>
              <div>
                <div className="land-footer-logo-name">isabelaOs Studio</div>
                <div className="land-footer-logo-sub">{isEs ? "Plataforma de producción visual IA" : "AI visual production platform"}</div>
              </div>
            </div>
            <p className="land-footer-desc">Stalling Technologic · Cobán, Alta Verapaz, Guatemala.</p>
          </div>
          <div>
            <div className="land-footer-col-title">{isEs ? "Plataforma" : "Platform"}</div>
            <span className="land-footer-link" onClick={onOpenAuth}>{isEs ? "Crear cuenta" : "Create account"}</span>
            <span className="land-footer-link" onClick={() => scrollToId("planes")}>{isEs ? "Precios" : "Pricing"}</span>
            <span className="land-footer-link" onClick={onOpenAbout}>{isEs ? "Sobre nosotros" : "About us"}</span>
          </div>
          <div>
            <div className="land-footer-col-title">{isEs ? "Soporte" : "Support"}</div>
            <span className="land-footer-link" onClick={onOpenContact}>{isEs ? "Contacto" : "Contact"}</span>
            <span className="land-footer-link">contacto@isabelaos.com</span>
          </div>
          <div>
            <div className="land-footer-col-title">Legal</div>
            <a href="/terms"   className="land-footer-link" target="_blank">{isEs ? "Términos y Condiciones" : "Terms & Conditions"}</a>
            <a href="/refund"  className="land-footer-link" target="_blank">{isEs ? "Política de Reembolsos" : "Refund Policy"}</a>
            <a href="/privacy" className="land-footer-link" target="_blank">{isEs ? "Privacidad" : "Privacy"}</a>
          </div>
        </div>
        <div className="land-footer-bottom">
          <div className="land-footer-copy">© 2025 IsabelaOS · {isEs ? "Todos los derechos reservados" : "All rights reserved"}</div>
          <div className="land-footer-legal">{isEs ? "El uso de la plataforma implica aceptación de los Términos y Condiciones." : "Use of the platform implies acceptance of the Terms and Conditions."}</div>
          <div className="land-footer-copy">{isEs ? "Hecho con IA · GPU Power · Cobán GT" : "Made with AI · GPU Power · Cobán GT"}</div>
        </div>
      </footer>
    </div>
  );
}

// Video cap card con autoplay en hover
function VideoCapCard({ src, label, tag, onClick }) {
  const videoRef = useRef(null);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (!videoRef.current) return;
    if (hovered) videoRef.current.play().catch(() => {});
    else { videoRef.current.pause(); videoRef.current.currentTime = 0; }
  }, [hovered]);

  return (
    <div
      className="land-cap-item"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      <video
        ref={videoRef}
        className="land-cap-video"
        src={src}
        muted loop playsInline preload="metadata"
      />
      <div className="land-cap-overlay" />
      <div className="land-cap-info">
        <div className="land-cap-tag">{tag}</div>
        <div className="land-cap-label">{label}</div>
      </div>
    </div>
  );
}
