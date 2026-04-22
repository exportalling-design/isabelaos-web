// src/components/LandingView.jsx
// ─────────────────────────────────────────────────────────────
// IsabelaOS Studio — Landing + App en una sola pantalla
//
// ARQUITECTURA NUEVA:
//   - Todo en una sola pantalla, sin navegación a dashboard
//   - Demo visible sin registro (genera preview inmediato)
//   - Al registrarse: aparece panel lateral de Jades + Biblioteca
//   - Colores: Naranja fuego + Dorado + Negro profundo
//   - Videos y galería prominentes arriba del fold
//   - SEO optimizado: meta tags, structured data, headings correctos
//   - Neuromarketing: curiosidad, FOMO, prueba social, identidad
// ─────────────────────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from "react";
import { JADE_PACKS, COSTS } from "../lib/pricing";

// ── Utilidades ────────────────────────────────────────────────
function scrollTo(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── Contador animado con IntersectionObserver ─────────────────
function AnimCounter({ end, suffix = "", duration = 2200 }) {
  const [n, setN] = useState(0);
  const ref = useRef(null);
  const fired = useRef(false);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !fired.current) {
        fired.current = true;
        const t0 = Date.now();
        const tick = () => {
          const p = Math.min((Date.now() - t0) / duration, 1);
          const ease = 1 - Math.pow(1 - p, 4);
          setN(Math.floor(ease * end));
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
    }, { threshold: 0.3 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [end, duration]);
  return <span ref={ref}>{n.toLocaleString()}{suffix}</span>;
}

// ── Video card con autoplay en hover ─────────────────────────
function VideoCard({ src, label, tag, tall, onClick }) {
  const vRef = useRef(null);
  const [hov, setHov] = useState(false);
  useEffect(() => {
    if (!vRef.current) return;
    if (hov) vRef.current.play().catch(() => {});
    else { vRef.current.pause(); vRef.current.currentTime = 0; }
  }, [hov]);
  return (
    <div
      className={`vc${tall ? " vc-tall" : ""}`}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={onClick}
      role="button"
      tabIndex={0}
    >
      <video ref={vRef} src={src} className="vc-video" muted loop playsInline preload="metadata" />
      <div className="vc-overlay" />
      <div className="vc-info">
        <span className="vc-tag">{tag}</span>
        <span className="vc-label">{label}</span>
      </div>
      <div className="vc-play">▶</div>
    </div>
  );
}

// ── Panel lateral de usuario (post-login) ─────────────────────
function UserPanel({ user, jades, onBuyJades, onSignOut, lang }) {
  const isEs = lang === "es";
  return (
    <div className="up">
      <div className="up-header">
        <div className="up-avatar">{(user?.email?.[0] || "U").toUpperCase()}</div>
        <div>
          <div className="up-email">{user?.email}</div>
          <div className="up-role">{isEs ? "Creador activo" : "Active creator"}</div>
        </div>
      </div>
      <div className="up-jades">
        <div className="up-jades-icon">💎</div>
        <div>
          <div className="up-jades-num">{jades}</div>
          <div className="up-jades-label">Jades</div>
        </div>
        <button className="up-buy-btn" onClick={onBuyJades}>
          + {isEs ? "Comprar" : "Buy"}
        </button>
      </div>
      <div className="up-modules-title">{isEs ? "Módulos" : "Modules"}</div>
      {[
        { icon: "🎬", label: "CineAI", key: "cineai" },
        { icon: "📸", label: "Photoshoot", key: "photoshoot" },
        { icon: "👤", label: isEs ? "Avatares" : "Avatars", key: "avatars" },
        { icon: "🎙️", label: "Comercial IA", key: "comercial" },
        { icon: "✨", label: "Montaje IA", key: "montaje" },
        { icon: "🖼️", label: isEs ? "Imagen" : "Image", key: "generator" },
        { icon: "📂", label: isEs ? "Biblioteca" : "Library", key: "library" },
      ].map(m => (
        <button key={m.key} className="up-module-btn" onClick={() => scrollTo(`module-${m.key}`)}>
          <span>{m.icon}</span> {m.label}
        </button>
      ))}
      <button className="up-signout" onClick={onSignOut}>
        {isEs ? "Cerrar sesión" : "Sign out"}
      </button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════
export default function LandingView({
  user, jades, onOpenAuth, onStartDemo, onOpenContact,
  onOpenAbout, onSignOut, onBuyJades, lang, setLang,
  activeModule, setActiveModule, children,
}) {
  const isEs = lang === "es";
  const [demoText, setDemoText] = useState("");
  const [showUserPanel, setShowUserPanel] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 60);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  // Mostrar panel de usuario cuando se loguea
  useEffect(() => {
    if (user) setShowUserPanel(true);
  }, [user]);

  const MODULES = [
    { key: "cineai",     icon: "🎬", label: "CineAI",             badge: "🔥 NUEVO",  color: "#ff6b00", src: "/gallery/video5.1.mp4",  type: "video",
      desc: isEs ? "Pelea, baile, drama — Hollywood con tu cara" : "Fight, dance, drama — Hollywood with your face" },
    { key: "photoshoot", icon: "📸", label: "Product Photoshoot",  badge: "📸",        color: "#f59e0b", src: "/gallery/imagepoto.png",  type: "image",
      desc: isEs ? "Fotos de producto en 4 estilos profesionales en segundos" : "Product photos in 4 professional styles in seconds" },
    { key: "avatars",    icon: "👤", label: isEs?"Avatares":"Avatars",  badge: "👤",   color: "#a855f7", src: "/gallery/avatar.mp4",    type: "video",
      desc: isEs ? "Tu modelo virtual con tu rostro — consistente siempre" : "Your virtual model with your face — always consistent" },
    { key: "comercial",  icon: "🎙️", label: "Comercial IA",        badge: "🎙️",       color: "#10b981", src: "/gallery/video1.mp4",    type: "video",
      desc: isEs ? "Comerciales profesionales con voz IA en segundos" : "Professional commercials with AI voice in seconds" },
    { key: "montaje",    icon: "✨", label: "Montaje IA",           badge: "✨",        color: "#f43f5e", src: "/gallery/img2.png",       type: "image",
      desc: isEs ? "Personas y productos en cualquier escenario" : "People and products in any scenario" },
    { key: "generator",  icon: "🖼️", label: isEs?"Imagen IA":"AI Image", badge: "🖼️", color: "#06b6d4", src: "/gallery/img1.png",      type: "image",
      desc: isEs ? "Genera imágenes cinematográficas con FLUX" : "Generate cinematic images with FLUX" },
  ];

  const GALLERY = [
    { src: "/gallery/video5.1.mp4", label: isEs?"Escena de pelea épica":"Epic fight scene",    tag: "🎬 CineAI",  tall: true },
    { src: "/gallery/video2.1.mp4", label: isEs?"Slow motion cinematográfico":"Cinematic slow motion", tag: "🎬 CineAI",  tall: false },
    { src: "/gallery/video3.1.mp4", label: isEs?"Drama noir":"Noir drama",              tag: "🎬 CineAI",  tall: false },
    { src: "/gallery/video4.1.mp4", label: isEs?"Mujer bajo la lluvia":"Woman in rain",  tag: "🎬 CineAI",  tall: false },
    { src: "/gallery/video6.1.mp4", label: isEs?"Modelo profesional":"Pro model",        tag: "✨ IA",       tall: false },
    { src: "/gallery/video7.1.mp4", label: isEs?"Escena cinemática":"Cinematic scene",   tag: "✨ IA",       tall: true },
    { src: "/gallery/video8.1.mp4", label: isEs?"Trend viral TikTok":"Viral TikTok",     tag: "🕺 TikTok",  tall: false },
    { src: "/gallery/video9.1.mp4", label: isEs?"Comercial de producto":"Product ad",    tag: "🎙️ Comercial", tall: false },
  ];

  const STEPS = [
    { n: "01", icon: "📸", t: isEs?"Sube tu foto":"Upload your photo",   d: isEs?"Una foto tuya y la IA aprende tu cara en segundos":"One photo of you and the AI learns your face in seconds" },
    { n: "02", icon: "✍️", t: isEs?"Describe la escena":"Describe the scene", d: isEs?"Escribe qué quieres crear. Hollywood, TikTok, comercial, lo que imagines":"Write what you want to create. Hollywood, TikTok, commercial, anything you imagine" },
    { n: "03", icon: "🎬", t: isEs?"Descarga y publica":"Download & publish", d: isEs?"En menos de 3 minutos tienes tu contenido listo para TikTok, Instagram o YouTube":"In less than 3 minutes your content is ready for TikTok, Instagram or YouTube" },
  ];

  const TESTIMONIALS = [
    { name: "Carlos M.",   role: isEs?"Creador, Guatemala":"Creator, Guatemala",     stars: 5, text: isEs?'"Generé un video de pelea estilo Matrix en 2 minutos. La gente pensó que era producción real de Hollywood."':'"Generated a Matrix-style fight video in 2 minutes. People thought it was real Hollywood production."' },
    { name: "Sofía R.",    role: isEs?"Influencer, México":"Influencer, Mexico",      stars: 5, text: isEs?'"El Photoshoot triplicó el engagement de mis productos. Mismo día que lo publiqué empezaron los mensajes."':'"The Photoshoot tripled my product engagement. Same day I published it messages started coming."' },
    { name: "Equipo Nova", role: isEs?"Agencia, Colombia":"Agency, Colombia",         stars: 5, text: isEs?'"Lo que tardaba días con equipo de producción ahora lo hacemos en minutos. Cambia todo el negocio."':'"What took days with a production team now takes minutes. Changes everything about the business."' },
  ];

  return (
    <div className="lo">
      {/* ── ESTILOS GLOBALES ───────────────────────────────── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,400&family=Space+Grotesk:wght@400;500;700&display=swap');

        /* Reset */
        .lo *, .lo *::before, .lo *::after { box-sizing:border-box; margin:0; padding:0; }

        /* Variables — Paleta Naranja Fuego + Negro Profundo */
        .lo {
          --fire:    #ff5a00;
          --gold:    #ffb300;
          --ember:   #ff8c00;
          --cream:   #fff5e0;
          --bg:      #080a0e;
          --bg2:     #0d1017;
          --bg3:     #131820;
          --border:  rgba(255,90,0,0.12);
          --border2: rgba(255,255,255,0.07);
          --text:    #f0ece4;
          --muted:   rgba(240,236,228,0.45);
          --font-display: 'Bebas Neue', 'Impact', sans-serif;
          --font-body:    'DM Sans', sans-serif;
          --font-ui:      'Space Grotesk', sans-serif;
          background: var(--bg);
          color: var(--text);
          font-family: var(--font-body);
          overflow-x: hidden;
          min-height: 100vh;
        }

        /* ── NAV ───────────────────────────────────────────── */
        .lo-nav {
          position: fixed; top:0; left:0; right:0; z-index:200;
          display: flex; align-items:center; justify-content:space-between;
          padding: 0 32px; height: 64px;
          transition: all 0.3s;
        }
        .lo-nav.scrolled {
          background: rgba(8,10,14,0.92);
          backdrop-filter: blur(20px);
          border-bottom: 1px solid var(--border);
        }
        .lo-logo { display:flex; align-items:center; gap:10px; cursor:pointer; }
        .lo-logo-mark {
          width:36px; height:36px; border-radius:9px;
          background: linear-gradient(135deg, var(--fire), var(--gold));
          display:grid; place-items:center;
          font-family: var(--font-ui); font-size:13px; font-weight:700; color:#000;
          box-shadow: 0 0 20px rgba(255,90,0,0.4);
        }
        .lo-logo-text { font-family:var(--font-ui); font-size:15px; font-weight:700; color:#fff; }
        .lo-logo-sub { font-size:10px; color:var(--muted); letter-spacing:1px; }
        .lo-nav-right { display:flex; align-items:center; gap:8px; }
        .lo-nav-link {
          background:none; border:none; color:rgba(240,236,228,0.65);
          font-family:var(--font-ui); font-size:13px; padding:8px 14px;
          cursor:pointer; border-radius:8px; transition:all 0.2s;
        }
        .lo-nav-link:hover { color:#fff; background:rgba(255,255,255,0.06); }
        .lo-nav-lang {
          background:rgba(255,255,255,0.06); border:1px solid var(--border2);
          border-radius:8px; color:#fff; font-size:12px; font-weight:700;
          padding:7px 12px; cursor:pointer; font-family:var(--font-ui); transition:all 0.2s;
        }
        .lo-nav-lang:hover { background:rgba(255,255,255,0.12); }
        .lo-nav-cta {
          background:linear-gradient(135deg, var(--fire), var(--gold));
          border:none; border-radius:10px; color:#000;
          font-family:var(--font-ui); font-size:13px; font-weight:700;
          padding:9px 20px; cursor:pointer; transition:all 0.2s;
          box-shadow:0 0 24px rgba(255,90,0,0.3);
        }
        .lo-nav-cta:hover { transform:translateY(-1px); box-shadow:0 0 36px rgba(255,90,0,0.5); }
        .lo-nav-user {
          display:flex; align-items:center; gap:8px;
          background:rgba(255,90,0,0.1); border:1px solid rgba(255,90,0,0.2);
          border-radius:10px; padding:6px 14px; cursor:pointer;
          font-family:var(--font-ui); font-size:13px; color:var(--gold);
          font-weight:600; transition:all 0.2s;
        }
        .lo-nav-user:hover { background:rgba(255,90,0,0.18); }

        /* ── HERO ──────────────────────────────────────────── */
        .lo-hero {
          position:relative; min-height:100vh;
          display:flex; align-items:center;
          padding:80px 32px 60px;
          overflow:hidden;
        }
        .lo-hero-bg {
          position:absolute; inset:0; z-index:0; overflow:hidden;
        }
        .lo-hero-vid {
          width:100%; height:100%; object-fit:cover;
          opacity:0.55; filter:saturate(1.3) contrast(1.05);
          transform:scale(1.04);
        }
        .lo-hero-grad {
          position:absolute; inset:0;
          background:linear-gradient(
            135deg,
            rgba(8,10,14,0.85) 0%,
            rgba(8,10,14,0.4) 50%,
            rgba(8,10,14,0.9) 100%
          );
        }
        .lo-hero-grain {
          position:absolute; inset:0;
          background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E");
          opacity:0.4; pointer-events:none;
        }
        .lo-hero-glow {
          position:absolute; border-radius:50%;
          filter:blur(140px); pointer-events:none;
        }
        .lo-hero-glow-1 { width:700px; height:700px; background:rgba(255,90,0,0.12); top:-200px; left:-150px; }
        .lo-hero-glow-2 { width:500px; height:500px; background:rgba(255,179,0,0.08); bottom:-100px; right:-100px; }

        .lo-hero-inner {
          position:relative; z-index:1;
          display:grid; grid-template-columns:1fr 440px; gap:56px;
          max-width:1280px; margin:0 auto; width:100%; align-items:center;
        }

        .lo-eyebrow {
          display:inline-flex; align-items:center; gap:8px;
          background:rgba(255,90,0,0.1); border:1px solid rgba(255,90,0,0.3);
          border-radius:100px; padding:6px 16px;
          font-size:11px; letter-spacing:2.5px; text-transform:uppercase;
          color:var(--fire); font-weight:700; margin-bottom:20px;
          animation:fadeUp 0.7s ease both;
        }
        .lo-eyebrow-dot {
          width:6px; height:6px; border-radius:50%;
          background:var(--fire); animation:blink 2s infinite;
        }
        .lo-h1 {
          font-family:var(--font-display);
          font-size:clamp(56px,8vw,110px);
          line-height:0.92; letter-spacing:2px;
          color:#fff;
          animation:fadeUp 0.7s 0.1s ease both;
        }
        .lo-h1-fire {
          display:block;
          background:linear-gradient(135deg, var(--fire) 0%, var(--gold) 60%);
          -webkit-background-clip:text; -webkit-text-fill-color:transparent;
          background-clip:text;
          filter:drop-shadow(0 0 30px rgba(255,90,0,0.4));
        }
        .lo-sub {
          margin-top:18px; font-size:17px; line-height:1.7;
          color:rgba(240,236,228,0.75); max-width:500px;
          animation:fadeUp 0.7s 0.2s ease both;
        }
        .lo-hero-ctas {
          margin-top:32px; display:flex; flex-wrap:wrap; gap:12px;
          animation:fadeUp 0.7s 0.3s ease both;
        }
        .lo-cta-main {
          background:linear-gradient(135deg, var(--fire), var(--gold));
          border:none; border-radius:14px; color:#000;
          font-family:var(--font-ui); font-size:16px; font-weight:800;
          padding:16px 36px; cursor:pointer; transition:all 0.25s;
          box-shadow:0 0 50px rgba(255,90,0,0.35), 0 4px 20px rgba(0,0,0,0.4);
          letter-spacing:0.3px;
        }
        .lo-cta-main:hover { transform:translateY(-3px); box-shadow:0 0 70px rgba(255,90,0,0.55), 0 8px 30px rgba(0,0,0,0.5); }
        .lo-cta-sec {
          background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.15);
          border-radius:14px; color:#fff; font-size:15px;
          padding:16px 26px; cursor:pointer; transition:all 0.2s;
          font-family:var(--font-body);
        }
        .lo-cta-sec:hover { background:rgba(255,255,255,0.1); }
        .lo-free-note {
          margin-top:14px; font-size:12px; color:var(--muted); letter-spacing:1px;
          animation:fadeUp 0.7s 0.4s ease both;
        }
        .lo-free-note b { color:var(--gold); }

        /* Demo box */
        .lo-demo {
          background:rgba(13,16,23,0.88);
          border:1px solid rgba(255,90,0,0.2);
          border-radius:24px; padding:28px;
          backdrop-filter:blur(30px);
          box-shadow:0 0 80px rgba(255,90,0,0.08), 0 40px 80px rgba(0,0,0,0.5);
          animation:fadeRight 0.8s 0.3s ease both;
        }
        .lo-demo-tag { font-size:10px; letter-spacing:3px; text-transform:uppercase; color:var(--fire); font-weight:700; margin-bottom:6px; }
        .lo-demo-title { font-family:var(--font-ui); font-size:18px; font-weight:700; color:#fff; margin-bottom:14px; line-height:1.3; }
        .lo-demo-pill {
          display:inline-flex; align-items:center; gap:6px;
          background:rgba(255,179,0,0.1); border:1px solid rgba(255,179,0,0.25);
          border-radius:100px; padding:4px 12px;
          font-size:11px; color:var(--gold); font-weight:600; margin-bottom:16px;
        }
        .lo-demo-grid {
          display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:14px;
        }
        .lo-demo-chip {
          background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.07);
          border-radius:8px; padding:8px 10px;
          font-size:11px; color:rgba(240,236,228,0.55); letter-spacing:0.5px;
          display:flex; align-items:center; gap:6px;
        }
        .lo-demo-ta {
          width:100%; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1);
          border-radius:12px; color:#fff; font-family:var(--font-body);
          font-size:14px; padding:14px 16px; resize:none; outline:none;
          height:88px; transition:border-color 0.2s; margin-bottom:12px;
        }
        .lo-demo-ta:focus { border-color:rgba(255,90,0,0.4); }
        .lo-demo-ta::placeholder { color:rgba(255,255,255,0.2); font-style:italic; }
        .lo-demo-btn {
          width:100%;
          background:linear-gradient(135deg, var(--fire), var(--gold));
          border:none; border-radius:12px; color:#000;
          font-family:var(--font-ui); font-size:16px; font-weight:800;
          padding:15px; cursor:pointer; transition:all 0.2s;
          box-shadow:0 0 30px rgba(255,90,0,0.3);
        }
        .lo-demo-btn:hover { transform:translateY(-2px); box-shadow:0 0 50px rgba(255,90,0,0.5); }
        .lo-demo-sub { font-size:11px; color:var(--muted); text-align:center; margin-top:10px; }

        /* ── TRUST BAR ──────────────────────────────────────── */
        .lo-trust {
          border-top:1px solid var(--border2); border-bottom:1px solid var(--border2);
          background:var(--bg2);
          display:grid; grid-template-columns:repeat(4,1fr);
        }
        .lo-trust-item {
          padding:36px 24px; text-align:center; position:relative;
          border-right:1px solid var(--border2);
        }
        .lo-trust-item:last-child { border-right:none; }
        .lo-trust-num {
          font-family:var(--font-display); font-size:52px; letter-spacing:2px;
          background:linear-gradient(135deg, var(--fire), var(--gold));
          -webkit-background-clip:text; -webkit-text-fill-color:transparent;
          background-clip:text; display:block; line-height:1;
        }
        .lo-trust-label { font-size:12px; color:var(--muted); letter-spacing:1.5px; margin-top:6px; }

        /* ── SECCIÓN GENÉRICA ──────────────────────────────── */
        .lo-sec { padding:90px 32px; max-width:1280px; margin:0 auto; }
        .lo-sec-tag {
          font-size:11px; letter-spacing:3px; text-transform:uppercase;
          color:var(--fire); font-weight:700; margin-bottom:10px; display:block;
        }
        .lo-sec-h {
          font-family:var(--font-display);
          font-size:clamp(36px,5.5vw,72px);
          line-height:0.95; letter-spacing:2px;
          color:#fff; margin-bottom:16px;
        }
        .lo-sec-p { font-size:16px; color:var(--muted); line-height:1.7; max-width:600px; }

        /* ── GALERÍA ───────────────────────────────────────── */
        .lo-gallery {
          margin-top:48px;
          display:grid;
          grid-template-columns:repeat(4,1fr);
          grid-auto-rows:200px;
          gap:10px;
        }
        /* Video card */
        .vc {
          position:relative; overflow:hidden; border-radius:14px;
          border:1px solid var(--border2); cursor:pointer;
          transition:transform 0.3s, border-color 0.3s;
        }
        .vc:hover { transform:scale(1.02); border-color:rgba(255,90,0,0.4); }
        .vc-tall { grid-row:span 2; }
        .vc-video {
          width:100%; height:100%; object-fit:cover;
          transition:transform 0.5s;
        }
        .vc:hover .vc-video { transform:scale(1.08); }
        .vc-overlay {
          position:absolute; inset:0;
          background:linear-gradient(to top, rgba(8,10,14,0.85) 0%, transparent 60%);
          transition:opacity 0.3s;
        }
        .vc-info { position:absolute; bottom:0; left:0; right:0; padding:14px; }
        .vc-tag {
          display:inline-block; font-size:10px; letter-spacing:1.5px; text-transform:uppercase;
          background:rgba(255,90,0,0.15); border:1px solid rgba(255,90,0,0.3);
          border-radius:5px; padding:2px 7px; color:var(--fire); margin-bottom:5px;
        }
        .vc-label { display:block; font-size:13px; font-weight:600; color:#fff; font-family:var(--font-ui); }
        .vc-play {
          position:absolute; top:50%; left:50%; transform:translate(-50%,-60%);
          width:44px; height:44px; border-radius:50%;
          background:rgba(255,90,0,0.8); color:#fff;
          display:flex; align-items:center; justify-content:center;
          font-size:16px; opacity:0; transition:all 0.3s;
          backdrop-filter:blur(10px);
        }
        .vc:hover .vc-play { opacity:1; transform:translate(-50%,-50%); }

        /* ── MÓDULOS GRID ──────────────────────────────────── */
        .lo-mod-grid {
          margin-top:48px;
          display:grid; grid-template-columns:repeat(3,1fr); gap:14px;
        }
        .lo-mod {
          border:1px solid var(--border2); border-radius:18px;
          background:var(--bg2); overflow:hidden; cursor:pointer;
          transition:all 0.3s; position:relative;
          --acc: #ff5a00;
        }
        .lo-mod:hover {
          border-color:var(--acc);
          transform:translateY(-5px);
          box-shadow:0 20px 60px rgba(0,0,0,0.4);
        }
        .lo-mod-media { height:170px; overflow:hidden; position:relative; }
        .lo-mod-img, .lo-mod-vid {
          width:100%; height:100%; object-fit:cover;
          transition:transform 0.5s;
        }
        .lo-mod:hover .lo-mod-img, .lo-mod:hover .lo-mod-vid { transform:scale(1.08); }
        .lo-mod-media-overlay {
          position:absolute; inset:0;
          background:linear-gradient(to bottom, transparent 40%, var(--bg2) 100%);
        }
        .lo-mod-body { padding:18px 20px 22px; }
        .lo-mod-badge {
          display:inline-block; font-size:10px; letter-spacing:1.5px; text-transform:uppercase;
          background:rgba(255,255,255,0.07); border:1px solid rgba(255,255,255,0.12);
          border-radius:5px; padding:2px 8px; color:rgba(240,236,228,0.55);
          margin-bottom:8px;
        }
        .lo-mod-title { font-family:var(--font-ui); font-size:16px; font-weight:700; color:#fff; margin-bottom:6px; }
        .lo-mod-desc { font-size:13px; color:var(--muted); line-height:1.6; }
        .lo-mod-cta { margin-top:14px; font-size:12px; font-weight:700; color:var(--acc); letter-spacing:0.5px; }

        /* ── HOW IT WORKS ──────────────────────────────────── */
        .lo-how {
          display:grid; grid-template-columns:repeat(3,1fr);
          gap:2px; background:var(--border2);
          margin-top:48px; border-radius:20px; overflow:hidden;
        }
        .lo-how-card {
          background:var(--bg2); padding:40px 32px; position:relative; overflow:hidden;
        }
        .lo-how-n {
          font-family:var(--font-display); font-size:80px; letter-spacing:3px;
          color:rgba(255,90,0,0.06); position:absolute; right:20px; top:16px; line-height:1;
        }
        .lo-how-num { font-size:11px; letter-spacing:3px; color:var(--fire); font-weight:700; text-transform:uppercase; margin-bottom:14px; }
        .lo-how-icon { font-size:36px; display:block; margin-bottom:14px; }
        .lo-how-title { font-family:var(--font-ui); font-size:19px; font-weight:700; color:#fff; margin-bottom:8px; }
        .lo-how-desc { font-size:14px; color:var(--muted); line-height:1.7; }

        /* ── TESTIMONIOS ───────────────────────────────────── */
        .lo-testi-grid {
          display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-top:48px;
        }
        .lo-testi {
          background:var(--bg2); border:1px solid var(--border2);
          border-radius:18px; padding:26px; transition:all 0.3s;
        }
        .lo-testi:hover { border-color:rgba(255,90,0,0.2); transform:translateY(-3px); }
        .lo-testi-stars { display:flex; gap:3px; margin-bottom:14px; }
        .lo-testi-star { color:var(--gold); font-size:15px; }
        .lo-testi-text { font-size:14px; color:rgba(240,236,228,0.8); line-height:1.7; font-style:italic; margin-bottom:18px; }
        .lo-testi-line { height:1px; background:var(--border2); margin-bottom:14px; }
        .lo-testi-name { font-family:var(--font-ui); font-size:14px; font-weight:700; color:#fff; }
        .lo-testi-role { font-size:12px; color:var(--muted); margin-top:2px; }

        /* ── PRICING ───────────────────────────────────────── */
        .lo-price-grid {
          display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-top:48px;
        }
        .lo-price {
          background:var(--bg2); border:1px solid var(--border2);
          border-radius:18px; padding:26px; position:relative; overflow:hidden;
          transition:all 0.3s;
        }
        .lo-price:hover { transform:translateY(-4px); }
        .lo-price.hot {
          border-color:rgba(255,90,0,0.35);
          background:linear-gradient(160deg,rgba(255,90,0,0.07),var(--bg2));
          box-shadow:0 0 50px rgba(255,90,0,0.1);
        }
        .lo-price-popular {
          position:absolute; top:14px; right:14px;
          background:linear-gradient(135deg,var(--fire),var(--gold));
          color:#000; font-size:10px; font-weight:800; letter-spacing:1px;
          border-radius:5px; padding:3px 8px; text-transform:uppercase;
        }
        .lo-price-label { font-size:11px; letter-spacing:2.5px; text-transform:uppercase; color:var(--muted); margin-bottom:10px; }
        .lo-price-amount { font-family:var(--font-display); font-size:52px; color:#fff; line-height:1; letter-spacing:2px; }
        .lo-price-usd { font-size:13px; color:var(--muted); margin-bottom:4px; }
        .lo-price-jades { font-size:20px; font-weight:700; color:var(--gold); margin-bottom:18px; font-family:var(--font-ui); }
        .lo-price-feat { display:flex; gap:8px; font-size:12px; color:rgba(240,236,228,0.7); margin-bottom:8px; align-items:center; }
        .lo-price-check { color:var(--fire); font-size:12px; flex-shrink:0; }
        .lo-price-btn {
          width:100%; border-radius:12px; font-size:13px; font-weight:700;
          padding:12px; cursor:pointer; transition:all 0.2s; margin-top:18px;
          font-family:var(--font-ui);
        }
        .lo-price-btn-hot {
          background:linear-gradient(135deg,var(--fire),var(--gold));
          border:none; color:#000;
          box-shadow:0 0 24px rgba(255,90,0,0.3);
        }
        .lo-price-btn-hot:hover { box-shadow:0 0 40px rgba(255,90,0,0.5); }
        .lo-price-btn-norm {
          background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12); color:#fff;
        }
        .lo-price-btn-norm:hover { background:rgba(255,255,255,0.1); }

        /* ── FINAL CTA ─────────────────────────────────────── */
        .lo-final {
          margin:0 32px 80px; border-radius:28px;
          padding:80px 60px; text-align:center;
          position:relative; overflow:hidden;
          background:linear-gradient(135deg, rgba(255,90,0,0.07), rgba(255,179,0,0.05));
          border:1px solid rgba(255,90,0,0.15);
        }
        .lo-final::before {
          content:''; position:absolute; inset:0;
          background:radial-gradient(ellipse at center, rgba(255,90,0,0.06), transparent 70%);
          pointer-events:none;
        }
        .lo-final-tag { font-size:11px; letter-spacing:3px; text-transform:uppercase; color:var(--fire); font-weight:700; margin-bottom:14px; }
        .lo-final-h {
          font-family:var(--font-display);
          font-size:clamp(36px,6vw,72px);
          color:#fff; letter-spacing:2px; line-height:0.95; margin-bottom:14px;
        }
        .lo-final-p { font-size:16px; color:var(--muted); max-width:480px; margin:0 auto 32px; line-height:1.7; }
        .lo-final-btn {
          display:inline-block;
          background:linear-gradient(135deg,var(--fire),var(--gold));
          border:none; border-radius:16px; color:#000;
          font-family:var(--font-ui); font-size:18px; font-weight:800;
          padding:20px 52px; cursor:pointer; transition:all 0.25s;
          box-shadow:0 0 70px rgba(255,90,0,0.4), 0 8px 30px rgba(0,0,0,0.4);
        }
        .lo-final-btn:hover { transform:translateY(-4px); box-shadow:0 0 100px rgba(255,90,0,0.6), 0 12px 40px rgba(0,0,0,0.5); }

        /* ── PANEL USUARIO ─────────────────────────────────── */
        .up {
          position:fixed; right:0; top:0; bottom:0; width:280px; z-index:300;
          background:rgba(13,16,23,0.97); backdrop-filter:blur(30px);
          border-left:1px solid rgba(255,90,0,0.15);
          display:flex; flex-direction:column; gap:0;
          padding:80px 20px 20px;
          overflow-y:auto;
          animation:slideLeft 0.4s ease;
        }
        .up-header {
          display:flex; align-items:center; gap:12px;
          padding:16px; background:rgba(255,90,0,0.06);
          border:1px solid rgba(255,90,0,0.12); border-radius:14px;
          margin-bottom:16px;
        }
        .up-avatar {
          width:40px; height:40px; border-radius:10px;
          background:linear-gradient(135deg,var(--fire),var(--gold));
          display:grid; place-items:center;
          font-family:var(--font-ui); font-size:16px; font-weight:700; color:#000;
        }
        .up-email { font-size:12px; color:#fff; font-weight:600; word-break:break-all; }
        .up-role { font-size:10px; color:var(--fire); letter-spacing:1px; margin-top:2px; }
        .up-jades {
          display:flex; align-items:center; gap:12px;
          padding:14px 16px; background:rgba(255,179,0,0.06);
          border:1px solid rgba(255,179,0,0.15); border-radius:14px; margin-bottom:20px;
        }
        .up-jades-icon { font-size:24px; }
        .up-jades-num { font-family:var(--font-display); font-size:32px; color:var(--gold); line-height:1; letter-spacing:2px; }
        .up-jades-label { font-size:11px; color:var(--muted); }
        .up-buy-btn {
          margin-left:auto; background:linear-gradient(135deg,var(--fire),var(--gold));
          border:none; border-radius:8px; color:#000;
          font-family:var(--font-ui); font-size:12px; font-weight:700;
          padding:6px 12px; cursor:pointer; white-space:nowrap;
        }
        .up-modules-title {
          font-size:10px; letter-spacing:3px; text-transform:uppercase;
          color:var(--muted); margin-bottom:10px; padding:0 4px;
        }
        .up-module-btn {
          display:flex; align-items:center; gap:10px;
          width:100%; background:none; border:1px solid transparent;
          border-radius:10px; color:rgba(240,236,228,0.7);
          font-family:var(--font-ui); font-size:13px;
          padding:10px 12px; cursor:pointer; transition:all 0.2s;
          margin-bottom:4px; text-align:left;
        }
        .up-module-btn:hover { background:rgba(255,90,0,0.08); border-color:rgba(255,90,0,0.2); color:#fff; }
        .up-signout {
          margin-top:auto; padding-top:20px; width:100%;
          background:none; border:1px solid rgba(255,255,255,0.1);
          border-radius:10px; color:var(--muted); font-family:var(--font-ui);
          font-size:13px; padding:10px; cursor:pointer; transition:all 0.2s;
        }
        .up-signout:hover { border-color:var(--fire); color:var(--fire); }

        /* ── MÓDULO ACTIVO ─────────────────────────────────── */
        .lo-module-wrap {
          max-width:1280px; margin:0 auto; padding:0 32px 60px;
        }
        .lo-module-back {
          display:flex; align-items:center; gap:8px;
          background:none; border:none; color:var(--fire);
          font-family:var(--font-ui); font-size:13px; font-weight:600;
          cursor:pointer; padding:0; margin-bottom:20px;
          transition:opacity 0.2s;
        }
        .lo-module-back:hover { opacity:0.7; }
        .lo-module-box {
          background:var(--bg2); border:1px solid var(--border);
          border-radius:24px; overflow:hidden; padding:4px;
        }

        /* ── FOOTER ────────────────────────────────────────── */
        .lo-footer {
          border-top:1px solid var(--border2);
          background:var(--bg2); padding:56px 32px 28px;
        }
        .lo-footer-inner {
          max-width:1280px; margin:0 auto;
          display:grid; grid-template-columns:1.5fr 1fr 1fr 1fr;
          gap:48px; margin-bottom:40px;
        }
        .lo-footer-logo { display:flex; gap:10px; align-items:center; margin-bottom:14px; }
        .lo-footer-mark {
          width:34px; height:34px; border-radius:9px;
          background:linear-gradient(135deg,var(--fire),var(--gold));
          display:grid; place-items:center;
          font-size:12px; font-weight:800; color:#000; font-family:var(--font-ui);
        }
        .lo-footer-name { font-family:var(--font-ui); font-size:14px; font-weight:700; color:#fff; }
        .lo-footer-sub { font-size:10px; color:var(--muted); }
        .lo-footer-desc { font-size:13px; color:var(--muted); line-height:1.7; }
        .lo-footer-col-h { font-size:10px; letter-spacing:3px; text-transform:uppercase; color:rgba(255,255,255,0.4); margin-bottom:14px; }
        .lo-footer-link {
          display:block; font-size:13px; color:var(--muted); margin-bottom:10px;
          cursor:pointer; transition:color 0.2s; text-decoration:none;
          background:none; border:none; text-align:left; padding:0; font-family:var(--font-body);
        }
        .lo-footer-link:hover { color:#fff; }
        .lo-footer-bottom {
          max-width:1280px; margin:0 auto;
          border-top:1px solid var(--border2); padding-top:20px;
          display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;
        }
        .lo-footer-copy { font-size:12px; color:rgba(255,255,255,0.25); }

        /* ── ANIMACIONES ───────────────────────────────────── */
        @keyframes fadeUp {
          from { opacity:0; transform:translateY(24px); }
          to   { opacity:1; transform:translateY(0); }
        }
        @keyframes fadeRight {
          from { opacity:0; transform:translateX(30px); }
          to   { opacity:1; transform:translateX(0); }
        }
        @keyframes slideLeft {
          from { transform:translateX(100%); }
          to   { transform:translateX(0); }
        }
        @keyframes blink {
          0%,100% { opacity:1; } 50% { opacity:0.2; }
        }

        /* ── RESPONSIVE ────────────────────────────────────── */
        @media (max-width:900px) {
          .lo-hero-inner { grid-template-columns:1fr; }
          .lo-trust { grid-template-columns:repeat(2,1fr); }
          .lo-gallery { grid-template-columns:repeat(2,1fr); }
          .lo-mod-grid { grid-template-columns:1fr 1fr; }
          .lo-how { grid-template-columns:1fr; background:none; gap:10px; }
          .lo-how-card { border:1px solid var(--border2); border-radius:16px; }
          .lo-testi-grid { grid-template-columns:1fr; }
          .lo-price-grid { grid-template-columns:1fr 1fr; }
          .lo-footer-inner { grid-template-columns:1fr 1fr; }
          .lo-hero { padding:80px 16px 40px; }
          .lo-sec { padding:60px 16px; }
          .lo-final { margin:0 16px 60px; padding:48px 24px; }
          .up { width:100%; }
        }
        @media (max-width:600px) {
          .lo-mod-grid { grid-template-columns:1fr; }
          .lo-price-grid { grid-template-columns:1fr; }
          .lo-gallery { grid-template-columns:1fr 1fr; grid-auto-rows:150px; }
          .vc-tall { grid-row:span 2; }
          .lo-hero-ctas { flex-direction:column; }
          .lo-cta-main, .lo-cta-sec { width:100%; text-align:center; }
        }

        /* ── SEEDANCE BADGE ────────────────────────────────── */
        .lo-seedance {
          display:inline-flex; align-items:center; gap:8px;
          background:rgba(255,179,0,0.08); border:1px solid rgba(255,179,0,0.2);
          border-radius:100px; padding:5px 14px;
          font-size:11px; color:var(--gold); font-weight:600; letter-spacing:1px;
          margin-bottom:14px;
        }
        .lo-seedance::before { content:'⚡'; }
      `}</style>

      {/* ── SEO META (inyectado en head via useEffect) ──────── */}

      {/* ── NAV ─────────────────────────────────────────────── */}
      <nav className={`lo-nav${scrolled ? " scrolled" : ""}`}>
        <div className="lo-logo" onClick={() => scrollTo("hero")}>
          <div className="lo-logo-mark">io</div>
          <div>
            <div className="lo-logo-text">isabelaOs Studio</div>
            <div className="lo-logo-sub">{isEs ? "Plataforma IA" : "AI Platform"}</div>
          </div>
        </div>
        <div className="lo-nav-right">
          <button className="lo-nav-link" onClick={() => scrollTo("galeria")}>{isEs ? "Galería" : "Gallery"}</button>
          <button className="lo-nav-link" onClick={() => scrollTo("planes")}>{isEs ? "Planes" : "Plans"}</button>
          <button className="lo-nav-link" onClick={onOpenContact}>{isEs ? "Contacto" : "Contact"}</button>
          <button className="lo-nav-lang" onClick={() => setLang(isEs ? "en" : "es")}>{isEs ? "🌐 EN" : "🌐 ES"}</button>
          {user ? (
            <button className="lo-nav-user" onClick={() => setShowUserPanel(p => !p)}>
              💎 {jades} Jades
            </button>
          ) : (
            <button className="lo-nav-cta" onClick={onOpenAuth}>
              {isEs ? "Entrar gratis →" : "Enter free →"}
            </button>
          )}
        </div>
      </nav>

      {/* ── PANEL USUARIO (post-login) ──────────────────────── */}
      {user && showUserPanel && (
        <UserPanel
          user={user} jades={jades} lang={lang}
          onBuyJades={onBuyJades}
          onSignOut={() => { setShowUserPanel(false); onSignOut(); }}
        />
      )}

      {/* ── MÓDULO ACTIVO ───────────────────────────────────── */}
      {activeModule && children && (
        <div style={{ paddingTop: 80 }}>
          <div className="lo-module-wrap">
            <button className="lo-module-back" onClick={() => setActiveModule(null)}>
              ← {isEs ? "Volver al inicio" : "Back to home"}
            </button>
            <div className="lo-module-box">{children}</div>
          </div>
        </div>
      )}

      {/* ── CONTENIDO PRINCIPAL (oculto si hay módulo activo) ── */}
      {!activeModule && (
        <>
          {/* ── HERO ────────────────────────────────────────── */}
          <section className="lo-hero" id="hero">
            <div className="lo-hero-bg">
              <video className="lo-hero-vid" src="/gallery/video5.1.mp4" autoPlay muted loop playsInline preload="auto" />
              <div className="lo-hero-grad" />
              <div className="lo-hero-grain" />
              <div className="lo-hero-glow lo-hero-glow-1" />
              <div className="lo-hero-glow lo-hero-glow-2" />
            </div>

            <div className="lo-hero-inner">
              {/* LEFT */}
              <div>
                <div className="lo-seedance">Seedance 2.0 · Powered by ByteDance</div>
                <div className="lo-eyebrow">
                  <span className="lo-eyebrow-dot" />
                  {isEs ? "La plataforma de producción visual IA de LATAM" : "LATAM's AI visual production platform"}
                </div>
                <h1 className="lo-h1">
                  {isEs ? (
                    <><span>CONVIÉRTETE EN EL</span><span className="lo-h1-fire">PROTAGONISTA</span><span>DE TU PELÍCULA</span></>
                  ) : (
                    <><span>BECOME THE</span><span className="lo-h1-fire">PROTAGONIST</span><span>OF YOUR MOVIE</span></>
                  )}
                </h1>
                <p className="lo-sub">
                  {isEs
                    ? "Genera escenas de Hollywood, videos musicales, comerciales y contenido viral con IA — con tu cara, tu historia, tu marca."
                    : "Generate Hollywood scenes, music videos, commercials and viral content with AI — your face, your story, your brand."}
                </p>
                <div className="lo-hero-ctas">
                  <button className="lo-cta-main" onClick={user ? () => setActiveModule("cineai") : onStartDemo}>
                    {isEs ? "🎬 Crear gratis ahora" : "🎬 Create free now"}
                  </button>
                  <button className="lo-cta-sec" onClick={() => scrollTo("galeria")}>
                    {isEs ? "Ver ejemplos reales ↓" : "See real examples ↓"}
                  </button>
                </div>
                <p className="lo-free-note">
                  <b>✓ 10 Jades gratis</b> {isEs ? "· Sin tarjeta de crédito · Cancela cuando quieras" : "· No credit card · Cancel anytime"}
                </p>
              </div>

              {/* RIGHT — DEMO BOX */}
              <div className="lo-demo">
                <div className="lo-demo-tag">{isEs ? "Inicio rápido" : "Quick start"}</div>
                <div className="lo-demo-title">{isEs ? "Pruébalo ahora — 10 Jades gratis" : "Try it now — 10 free Jades"}</div>
                <div className="lo-demo-pill">🎁 {isEs ? "10 Jades gratis al registrarte" : "10 free Jades on signup"}</div>
                <div className="lo-demo-grid">
                  {["🎬 CineAI", "📸 Photoshoot", "👤 Avatares", "🎙️ Comercial IA", "✨ Montaje", "🖼️ Imagen"].map(m => (
                    <div key={m} className="lo-demo-chip">{m}</div>
                  ))}
                </div>
                <textarea
                  className="lo-demo-ta"
                  value={demoText}
                  onChange={e => setDemoText(e.target.value)}
                  placeholder={isEs ? "Describe lo que quieres crear... ej: Yo como protagonista de una escena cinematográfica bajo la lluvia de noche" : "Describe what you want to create... eg: Me as protagonist of a cinematic scene in the rain at night"}
                />
                <button className="lo-demo-btn" onClick={user ? () => setActiveModule("cineai") : onStartDemo}>
                  {isEs ? "Crear ahora →" : "Create now →"}
                </button>
                <div className="lo-demo-sub">{isEs ? "Sin tarjeta · Gratis para empezar" : "No card · Free to start"}</div>
              </div>
            </div>
          </section>

          {/* ── TRUST BAR ───────────────────────────────────── */}
          <div className="lo-trust">
            <div className="lo-trust-item">
              <span className="lo-trust-num"><AnimCounter end={4127} suffix="+" /></span>
              <div className="lo-trust-label">{isEs ? "Cuentas alcanzadas" : "Accounts reached"}</div>
            </div>
            <div className="lo-trust-item">
              <span className="lo-trust-num">&lt; 3s</span>
              <div className="lo-trust-label">{isEs ? "Tiempo de generación" : "Generation time"}</div>
            </div>
            <div className="lo-trust-item">
              <span className="lo-trust-num">6+</span>
              <div className="lo-trust-label">{isEs ? "Módulos de producción" : "Production modules"}</div>
            </div>
            <div className="lo-trust-item">
              <span className="lo-trust-num">100%</span>
              <div className="lo-trust-label">{isEs ? "Hecho en Guatemala" : "Made in Guatemala"}</div>
            </div>
          </div>

          {/* ── GALERÍA ─────────────────────────────────────── */}
          <section className="lo-sec" id="galeria">
            <span className="lo-sec-tag">{isEs ? "¿Cómo es posible?" : "How is this possible?"}</span>
            <h2 className="lo-sec-h">{isEs ? "TODO ESTO ES IA" : "ALL OF THIS IS AI"}</h2>
            <p className="lo-sec-p">{isEs ? "Sin actores. Sin cámaras. Sin estudio. Solo tu visión y nuestra IA." : "No actors. No cameras. No studio. Just your vision and our AI."}</p>
            <div className="lo-gallery">
              {GALLERY.map((v, i) => (
                <VideoCard key={i} {...v} onClick={user ? () => setActiveModule("cineai") : onStartDemo} />
              ))}
            </div>
          </section>

          {/* ── MÓDULOS ─────────────────────────────────────── */}
          <section className="lo-sec" style={{ paddingTop: 0 }}>
            <span className="lo-sec-tag">{isEs ? "El sistema completo" : "The complete system"}</span>
            <h2 className="lo-sec-h">{isEs ? "TODO LO QUE NECESITAS" : "EVERYTHING YOU NEED"}</h2>
            <div className="lo-mod-grid">
              {MODULES.map(m => {
                const isVideo = m.type === "video";
                return (
                  <div
                    key={m.key}
                    className="lo-mod"
                    style={{ "--acc": m.color }}
                    onClick={user ? () => setActiveModule(m.key) : onStartDemo}
                  >
                    <div className="lo-mod-media">
                      {isVideo
                        ? <video className="lo-mod-vid" src={m.src} muted loop playsInline preload="metadata" autoPlay />
                        : <img className="lo-mod-img" src={m.src} alt={m.label} />
                      }
                      <div className="lo-mod-media-overlay" />
                    </div>
                    <div className="lo-mod-body">
                      <span className="lo-mod-badge">{m.badge}</span>
                      <div className="lo-mod-title">{m.label}</div>
                      <div className="lo-mod-desc">{m.desc}</div>
                      <div className="lo-mod-cta" style={{ color: m.color }}>
                        {isEs ? "Probar gratis →" : "Try free →"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── HOW IT WORKS ────────────────────────────────── */}
          <section className="lo-sec" style={{ paddingTop: 0 }}>
            <span className="lo-sec-tag">{isEs ? "Tan fácil como escribir" : "As easy as writing"}</span>
            <h2 className="lo-sec-h">{isEs ? "3 PASOS Y LISTO" : "3 STEPS AND DONE"}</h2>
            <div className="lo-how">
              {STEPS.map((s, i) => (
                <div key={i} className="lo-how-card">
                  <div className="lo-how-n">{s.n}</div>
                  <div className="lo-how-num">{s.n}</div>
                  <span className="lo-how-icon">{s.icon}</span>
                  <div className="lo-how-title">{s.t}</div>
                  <p className="lo-how-desc">{s.d}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ── TESTIMONIOS ─────────────────────────────────── */}
          <section className="lo-sec" style={{ paddingTop: 0 }}>
            <span className="lo-sec-tag">{isEs ? "Lo que dicen los creadores" : "What creators say"}</span>
            <h2 className="lo-sec-h">{isEs ? "ELLOS YA LO USAN" : "THEY ALREADY USE IT"}</h2>
            <div className="lo-testi-grid">
              {TESTIMONIALS.map((t, i) => (
                <div key={i} className="lo-testi">
                  <div className="lo-testi-stars">{Array(t.stars).fill(0).map((_, j) => <span key={j} className="lo-testi-star">★</span>)}</div>
                  <p className="lo-testi-text">{t.text}</p>
                  <div className="lo-testi-line" />
                  <div className="lo-testi-name">{t.name}</div>
                  <div className="lo-testi-role">{t.role}</div>
                </div>
              ))}
            </div>
          </section>

          {/* ── PRICING ─────────────────────────────────────── */}
          <section className="lo-sec" id="planes" style={{ paddingTop: 0 }}>
            <span className="lo-sec-tag">{isEs ? "Sin suscripción" : "No subscription"}</span>
            <h2 className="lo-sec-h">{isEs ? "PAGA LO QUE USAS" : "PAY WHAT YOU USE"}</h2>
            <p className="lo-sec-p">{isEs ? "Compra Jades y genera cuando quieras. Sin mensualidad. 1 Jade ≈ $0.10 USD." : "Buy Jades and generate whenever. No monthly fee. 1 Jade ≈ $0.10 USD."}</p>
            <div className="lo-price-grid">
              {Object.entries(JADE_PACKS).map(([key, p]) => {
                const hot = key === "popular";
                return (
                  <div key={key} className={`lo-price${hot ? " hot" : ""}`}>
                    {hot && <div className="lo-price-popular">{isEs ? "Popular" : "Popular"}</div>}
                    <div className="lo-price-label">{p.label}</div>
                    <div className="lo-price-amount">${p.price_usd}</div>
                    <div className="lo-price-usd">USD</div>
                    <div className="lo-price-jades">{p.jades} Jades</div>
                    {[
                      `${p.jades} ${isEs ? "imágenes" : "images"}`,
                      `${Math.floor(p.jades / (COSTS.vid_express_8s || 40))} videos CineAI`,
                      `${Math.floor(p.jades / 20)} ${isEs ? "sesiones Photo" : "Photo sessions"}`,
                      isEs ? "Jades sin vencimiento" : "Jades never expire",
                    ].map((f, i) => (
                      <div key={i} className="lo-price-feat"><span className="lo-price-check">✓</span>{f}</div>
                    ))}
                    <button
                      className={`lo-price-btn ${hot ? "lo-price-btn-hot" : "lo-price-btn-norm"}`}
                      onClick={user ? onBuyJades : onOpenAuth}
                    >
                      {isEs ? "Comprar" : "Buy"} {p.label}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── FINAL CTA ───────────────────────────────────── */}
          <div className="lo-final">
            <div className="lo-final-tag">{isEs ? "Empieza hoy — es gratis" : "Start today — it's free"}</div>
            <h2 className="lo-final-h">{isEs ? "TU PRIMERA ESCENA EN\nMENOS DE 3 MINUTOS" : "YOUR FIRST SCENE IN\nLESS THAN 3 MINUTES"}</h2>
            <p className="lo-final-p">{isEs ? "Sin tarjeta de crédito. 10 Jades gratis. Cancela cuando quieras." : "No credit card. 10 free Jades. Cancel anytime."}</p>
            <button className="lo-final-btn" onClick={user ? () => setActiveModule("cineai") : onStartDemo}>
              {isEs ? "🎬 Crear mi primera escena gratis" : "🎬 Create my first free scene"}
            </button>
          </div>

          {/* ── FOOTER ──────────────────────────────────────── */}
          <footer className="lo-footer">
            <div className="lo-footer-inner">
              <div>
                <div className="lo-footer-logo">
                  <div className="lo-footer-mark">io</div>
                  <div>
                    <div className="lo-footer-name">isabelaOs Studio</div>
                    <div className="lo-footer-sub">{isEs ? "Plataforma IA visual" : "AI visual platform"}</div>
                  </div>
                </div>
                <p className="lo-footer-desc">Stalling Technologic · Cobán, Alta Verapaz, Guatemala 🇬🇹</p>
              </div>
              <div>
                <div className="lo-footer-col-h">{isEs ? "Plataforma" : "Platform"}</div>
                <button className="lo-footer-link" onClick={onOpenAuth}>{isEs ? "Crear cuenta" : "Create account"}</button>
                <button className="lo-footer-link" onClick={() => scrollTo("planes")}>{isEs ? "Precios" : "Pricing"}</button>
                <button className="lo-footer-link" onClick={onOpenAbout}>{isEs ? "Sobre nosotros" : "About us"}</button>
              </div>
              <div>
                <div className="lo-footer-col-h">{isEs ? "Soporte" : "Support"}</div>
                <button className="lo-footer-link" onClick={onOpenContact}>{isEs ? "Contacto" : "Contact"}</button>
                <span className="lo-footer-link" style={{ cursor: "text" }}>contacto@isabelaos.com</span>
              </div>
              <div>
                <div className="lo-footer-col-h">Legal</div>
                <a href="/terms"   className="lo-footer-link" target="_blank">{isEs ? "Términos" : "Terms"}</a>
                <a href="/refund"  className="lo-footer-link" target="_blank">{isEs ? "Reembolsos" : "Refunds"}</a>
                <a href="/privacy" className="lo-footer-link" target="_blank">{isEs ? "Privacidad" : "Privacy"}</a>
              </div>
            </div>
            <div className="lo-footer-bottom">
              <div className="lo-footer-copy">© 2025 IsabelaOS · {isEs ? "Todos los derechos reservados" : "All rights reserved"}</div>
              <div className="lo-footer-copy">{isEs ? "Hecho con IA · GPU Power · Cobán GT 🇬🇹" : "Made with AI · GPU Power · Cobán GT 🇬🇹"}</div>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}
