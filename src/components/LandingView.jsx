// src/components/LandingView.jsx — IsabelaOS Studio v7
// FIXES COMPLETOS:
//   ✅ Barra superior Seedance 2.0 de esquina a esquina
//   ✅ Demo box efecto 3D perspectiva desde esquina
//   ✅ Shimmer/luz en letras PROTAGONISTA
//   ✅ Todos los videos autoplay sin hover
//   ✅ Videos 9:16 correctamente encuadrados
//   ✅ Módulos como overlay sobre la página (sin nueva página)
//   ✅ Menú lateral desplegable solo al hover
//   ✅ Videos Comercial IA (Chef, Producto) en galería
//   ✅ Todos los módulos en panel del usuario logueado
//   ✅ Logo con video opcional
import { useState, useEffect, useRef, useCallback } from "react";
import { JADE_PACKS, COSTS } from "../lib/pricing";

function scrollTo(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Video con autoplay real
function AV({ src, className }) {
  const r = useRef(null);
  useEffect(() => { r.current?.play().catch(() => {}); }, []);
  return <video ref={r} src={src} className={className} muted loop playsInline autoPlay />;
}

// Contador animado
function Ctr({ end, suffix = "" }) {
  const [n, setN] = useState(0);
  const ref = useRef(null);
  const fired = useRef(false);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !fired.current) {
        fired.current = true;
        const t0 = Date.now();
        const tick = () => {
          const p = Math.min((Date.now() - t0) / 2000, 1);
          setN(Math.floor((1 - Math.pow(1 - p, 4)) * end));
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
    }, { threshold: 0.3 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [end]);
  return <span ref={ref}>{n.toLocaleString()}{suffix}</span>;
}

// Menú hover
function HoverMenu({ modules, onSelect, isEs }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}>
      <button style={{
        display: "flex", alignItems: "center", gap: 6,
        background: "rgba(255,90,0,0.1)", border: "1px solid rgba(255,90,0,0.25)",
        borderRadius: 9, padding: "7px 13px", cursor: "pointer",
        color: "#ffb300", fontFamily: "'Space Grotesk',sans-serif",
        fontSize: 13, fontWeight: 600, transition: "all .2s",
      }}>
        ☰ <span style={{ fontSize: 11 }}>{isEs ? "Módulos" : "Modules"}</span>
      </button>
      <div style={{
        position: "absolute", top: "calc(100% + 8px)", right: 0,
        background: "rgba(10,12,18,0.98)", border: "1px solid rgba(255,90,0,0.15)",
        borderRadius: 14, padding: 8, minWidth: 200,
        backdropFilter: "blur(30px)",
        opacity: open ? 1 : 0, transform: open ? "none" : "translateY(-10px) scale(0.97)",
        pointerEvents: open ? "all" : "none", transition: "all .2s",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)", zIndex: 100,
      }}>
        {modules.map(m => (
          <button key={m.key} onClick={() => { onSelect(m.key); setOpen(false); }}
            style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%",
              background: "none", border: "none", color: "rgba(240,236,228,0.75)",
              fontFamily: "'Space Grotesk',sans-serif", fontSize: 13,
              padding: "9px 12px", cursor: "pointer", borderRadius: 8,
              transition: "all .15s", textAlign: "left",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,90,0,0.1)"; e.currentTarget.style.color = "#ffb300"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "rgba(240,236,228,0.75)"; }}
          >
            <span style={{ fontSize: 16 }}>{m.icon}</span> {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Overlay módulo
function ModOverlay({ title, onClose, children }) {
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);
  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{
      position: "fixed", inset: 0, zIndex: 500,
      background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: "96px 16px 16px", overflowY: "auto",
      animation: "moIn .3s ease",
    }}>
      <div style={{
        width: "100%", maxWidth: 1200, flexShrink: 0,
        background: "#0d1017", border: "1px solid rgba(255,90,0,0.15)",
        borderRadius: 24, overflow: "hidden",
        animation: "moPIn .3s ease",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 22px", borderBottom: "1px solid rgba(255,255,255,0.07)",
          background: "rgba(255,90,0,0.05)", position: "sticky", top: 0,
          backdropFilter: "blur(20px)", zIndex: 10,
        }}>
          <button onClick={onClose} style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "none", border: "none", color: "#ff5a00",
            fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 600,
            cursor: "pointer",
          }}>← {title === "library" ? "Biblioteca" : title}</button>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8, color: "rgba(240,236,228,0.5)", fontSize: 16,
            padding: "4px 12px", cursor: "pointer",
          }}>✕</button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}

export default function LandingView({
  user, jades, onOpenAuth, onStartDemo, onOpenContact,
  onOpenAbout, onSignOut, onBuyJades, lang, setLang,
  activeModule, setActiveModule, children,
}) {
  const isEs = lang === "es";
  const [scrolled, setScrolled] = useState(false);
  const [demoText, setDemoText] = useState("");

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  const go = useCallback((key) => {
    setActiveModule(key);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [setActiveModule]);

  const MODS = [
    { key: "cineai",     icon: "🎬", label: "CineAI",           color: "#ff5a00", badge: "🔥 NUEVO",
      desc: isEs ? "Escenas Hollywood con tu cara" : "Hollywood scenes with your face",
      vid: "/gallery/cineai-fight.mp4" },
    { key: "photoshoot", icon: "📸", label: "Photoshoot",        color: "#f59e0b", badge: "📸",
      desc: isEs ? "Fotos de producto profesionales en segundos" : "Professional product photos in seconds",
      vid: "/gallery/comercial-product.mp4" },
    { key: "avatars",    icon: "👤", label: isEs?"Avatares":"Avatars", color: "#a855f7", badge: "👤",
      desc: isEs ? "Tu modelo virtual con tu rostro" : "Your virtual model with your face",
      vid: "/gallery/avatar-demo.mp4" },
    { key: "comercial",  icon: "🎙️", label: "Comercial IA",      color: "#10b981", badge: "🎙️",
      desc: isEs ? "Comerciales profesionales con voz IA" : "Professional commercials with AI voice",
      vid: "/gallery/comercial-chef.mp4" },
    { key: "montaje",    icon: "✨", label: "Montaje IA",         color: "#f43f5e", badge: "✨",
      desc: isEs ? "Personas y productos en cualquier escenario" : "People and products in any scenario",
      vid: "/gallery/montaje-demo.mp4" },
    { key: "generator",  icon: "🖼️", label: isEs?"Imagen IA":"AI Image", color: "#06b6d4", badge: "🖼️",
      desc: isEs ? "Imágenes cinematográficas con FLUX" : "Cinematic images with FLUX",
      vid: null },
    { key: "img2video",  icon: "🎥", label: "Imagen → Video",    color: "#8b5cf6", badge: "🎥",
      desc: isEs ? "Convierte tus fotos en videos" : "Convert your photos to videos",
      vid: null },
    { key: "library",    icon: "📂", label: isEs?"Biblioteca":"Library", color: "#64748b", badge: "📂",
      desc: isEs ? "Tus creaciones guardadas" : "Your saved creations",
      vid: null },
  ];

  const GAL = [
    { src: "/gallery/hero-bg.mp4",           tag: "🎬 CineAI",    label: isEs?"Drone ciudad noche":"City drone night",   wide: true },
    { src: "/gallery/cineai-fight.mp4",      tag: "🎬 CineAI",    label: isEs?"Escena épica":"Epic scene" },
    { src: "/gallery/cineai-drama.mp4",      tag: "🎬 CineAI",    label: isEs?"Drama cinematográfico":"Cinematic drama" },
    { src: "/gallery/cineai-rain.mp4",       tag: "🎬 CineAI",    label: isEs?"Mujer bajo la lluvia":"Woman in rain" },
    { src: "/gallery/comercial-chef.mp4",    tag: "🎙️ Comercial", label: isEs?"Chef IA":"AI Chef" },
    { src: "/gallery/comercial-product.mp4", tag: "🎙️ Comercial", label: isEs?"Producto estelar":"Star product" },
    { src: "/gallery/tiktok-trend.mp4",      tag: "🕺 TikTok",   label: isEs?"Trend viral":"Viral trend" },
    { src: "/gallery/cineai-dance.mp4",      tag: "🎬 CineAI",    label: isEs?"Baile musical":"Music dance" },
  ];

  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500&family=Space+Grotesk:wght@400;500;700&display=swap');
    @keyframes moIn{from{opacity:0}to{opacity:1}}
    @keyframes moPIn{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:none}}
    @keyframes fadeUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
    @keyframes fadeRight{from{opacity:0;transform:translateX(30px)}to{opacity:1;transform:none}}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}
    @keyframes shine{0%{background-position:200% center}100%{background-position:-200% center}}
    @keyframes seedSlide{from{left:-100%}to{left:200%}}
    @keyframes floatUp{from{opacity:0;transform:translateY(40px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
    .lo-shimmer{
      background:linear-gradient(90deg,#ff5a00 0%,#ffb300 35%,#fff 50%,#ffb300 65%,#ff5a00 100%);
      background-size:200% auto;
      -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
      animation:shine 3s linear infinite;
      filter:drop-shadow(0 0 20px rgba(255,90,0,.3));
    }

    /* ── RESPONSIVE MOBILE ── */
    @media(max-width:900px){
      .lo-hero-grid{grid-template-columns:1fr!important;min-height:auto!important;}
      .lo-hero-left{min-height:60vh;}
      .lo-hero-right{padding:32px 20px!important;min-height:auto;}
      .lo-hero-copy{padding:40px 24px!important;}
      .lo-hero-h1{font-size:clamp(42px,10vw,72px)!important;}
      .lo-seedbar-text{font-size:10px!important;letter-spacing:1px!important;gap:6px!important;}
      .lo-trust-grid{grid-template-columns:1fr 1fr!important;}
      .lo-trust-grid>div:nth-child(2){border-right:none!important;}
      .lo-gal-grid{grid-template-columns:1fr 1fr!important;}
      .lo-gal-wide{grid-column:span 2!important;aspect-ratio:16/9!important;}
      .lo-mod-grid-css{grid-template-columns:1fr!important;}
      .lo-how-grid{grid-template-columns:1fr!important;gap:8px!important;background:none!important;}
      .lo-testi-grid{grid-template-columns:1fr!important;}
      .lo-price-grid{grid-template-columns:1fr 1fr!important;}
      .lo-footer-grid{grid-template-columns:1fr 1fr!important;}
      .lo-final-box{margin:0 16px 60px!important;padding:48px 24px!important;}
      .lo-musical-grid{grid-template-columns:1fr!important;}
    }
    @media(max-width:600px){
      .lo-price-grid{grid-template-columns:1fr!important;}
      .lo-hero-ctas{flex-direction:column!important;}
      .lo-hero-h1{font-size:clamp(36px,11vw,60px)!important;}
      .lo-demo-box{padding:20px!important;}
      .lo-demo-grid{grid-template-columns:1fr 1fr!important;}
      .lo-nav-links-desktop{display:none!important;}
    }
  `;

  const V = { // CSS vars
    fire: "#ff5a00", gold: "#ffb300",
    bg: "#080a0e", bg2: "#0d1017",
    border: "rgba(255,90,0,0.12)", border2: "rgba(255,255,255,0.07)",
    text: "#f0ece4", muted: "rgba(240,236,228,0.45)",
    ffD: "'Bebas Neue',sans-serif",
    ffB: "'DM Sans',sans-serif",
    ffU: "'Space Grotesk',sans-serif",
  };

  const s = {
    // Helpers
    btn: (hot) => ({
      width: "100%", borderRadius: 11, fontSize: 13, fontWeight: 700,
      padding: "11px", cursor: "pointer", transition: "all .2s", marginTop: 14,
      fontFamily: V.ffU,
      ...(hot
        ? { background: `linear-gradient(135deg,${V.fire},${V.gold})`, border: "none", color: "#000", boxShadow: `0 0 24px rgba(255,90,0,.3)` }
        : { background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.12)", color: "#fff" })
    }),
  };

  return (
    <div style={{ fontFamily: V.ffB, background: V.bg, color: V.text, overflowX: "hidden", minHeight: "100vh" }}>
      <style>{CSS}</style>

      {/* OVERLAY MÓDULO */}
      {activeModule && children && (
        <ModOverlay title={activeModule} onClose={() => setActiveModule(null)}>
          {children}
        </ModOverlay>
      )}

      {/* BARRA SEEDANCE */}
      <div
        onClick={() => user ? go("cineai") : onOpenAuth()}
        style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 300,
          height: 36, display: "flex", alignItems: "center", justifyContent: "center",
          background: "linear-gradient(90deg,#1a0800,#2e1300,#1a0800)",
          borderBottom: "1px solid rgba(255,90,0,.3)",
          cursor: "pointer", overflow: "hidden",
        }}
      >
        <div style={{ position: "absolute", top: 0, width: "40%", height: "100%",
          background: "linear-gradient(90deg,transparent,rgba(255,179,0,.15),transparent)",
          animation: "seedSlide 3s infinite", left: "-100%" }} />
        <div className="lo-seedbar-text" style={{ fontFamily: V.ffU, fontSize: 12, fontWeight: 700, letterSpacing: 2,
          color: V.gold, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 10, zIndex: 1 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: V.fire, animation: "blink 1.5s infinite" }} />
          <span style={{ background: "rgba(255,90,0,.2)", border: "1px solid rgba(255,90,0,.4)", borderRadius: 4, padding: "2px 8px", fontSize: 10, color: V.fire }}>NUEVO</span>
          {isEs ? "⚡ SEEDANCE 2.0 YA DISPONIBLE EN ISABELAOS" : "⚡ SEEDANCE 2.0 NOW AVAILABLE ON ISABELAOS"}
          <span style={{ background: "rgba(255,90,0,.2)", border: "1px solid rgba(255,90,0,.4)", borderRadius: 4, padding: "2px 8px", fontSize: 10, color: V.fire }}>→</span>
        </div>
      </div>

      {/* NAV */}
      <nav style={{
        position: "fixed", top: 36, left: 0, right: 0, zIndex: 200,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 32px", height: 60, transition: "all .3s",
        ...(scrolled ? { background: "rgba(8,10,14,.94)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,.07)" } : {}),
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => scrollTo("hero")}>
          <div style={{
            width: 36, height: 36, borderRadius: 9, overflow: "hidden",
            background: `linear-gradient(135deg,${V.fire},${V.gold})`,
            display: "grid", placeItems: "center", position: "relative",
            boxShadow: `0 0 20px rgba(255,90,0,.4)`,
          }}>
            <video src="/gallery/logo.mp4" autoPlay muted loop playsInline
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
              onError={e => e.target.style.display = "none"} />
            <span style={{ fontFamily: V.ffU, fontSize: 13, fontWeight: 700, color: "#000", position: "relative", zIndex: 1 }}>io</span>
          </div>
          <div>
            <div style={{ fontFamily: V.ffU, fontSize: 15, fontWeight: 700, color: "#fff" }}>isabelaOs Studio</div>
            <div style={{ fontSize: 10, color: V.muted, letterSpacing: 1 }}>{isEs ? "Plataforma IA" : "AI Platform"}</div>
          </div>
        </div>
        <div className="lo-nav-links-desktop" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {["galeria", "planes"].map(id => (
            <button key={id} onClick={() => scrollTo(id)} style={{
              background: "none", border: "none", color: "rgba(240,236,228,.6)",
              fontFamily: V.ffU, fontSize: 13, padding: "7px 13px",
              cursor: "pointer", borderRadius: 8, transition: "all .2s",
            }}>{id === "galeria" ? (isEs ? "Galería" : "Gallery") : (isEs ? "Planes" : "Plans")}</button>
          ))}
          <button onClick={onOpenContact} style={{ background: "none", border: "none", color: "rgba(240,236,228,.6)", fontFamily: V.ffU, fontSize: 13, padding: "7px 13px", cursor: "pointer", borderRadius: 8 }}>{isEs ? "Contacto" : "Contact"}</button>
          <button onClick={() => setLang(isEs ? "en" : "es")} style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, color: "#fff", fontSize: 12, fontWeight: 700, padding: "7px 12px", cursor: "pointer", fontFamily: V.ffU }}>{isEs ? "🌐 EN" : "🌐 ES"}</button>
          {user
            ? <HoverMenu modules={MODS} onSelect={go} isEs={isEs} />
            : <button onClick={onOpenAuth} style={{ background: `linear-gradient(135deg,${V.fire},${V.gold})`, border: "none", borderRadius: 10, color: "#000", fontFamily: V.ffU, fontSize: 13, fontWeight: 700, padding: "9px 20px", cursor: "pointer", boxShadow: "0 0 24px rgba(255,90,0,.3)" }}>{isEs ? "Entrar" : "Sign in"}</button>
          }
        </div>
      </nav>

      {/* HERO */}
      <section id="hero" style={{ position: "relative", minHeight: "100vh", display: "flex", alignItems: "center", padding: "132px 32px 60px", overflow: "hidden" }}>
        {/* BG */}
        <div style={{ position: "absolute", inset: 0, zIndex: 0, overflow: "hidden" }}>
          <AV src="/gallery/hero-bg.mp4" className="" />
          <style>{`.lo-hv{width:100%;height:100%;object-fit:cover;opacity:.6;filter:saturate(1.2)}`}</style>
          <video src="/gallery/hero-bg.mp4" autoPlay muted loop playsInline
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.6, filter: "saturate(1.2) contrast(1.05)" }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg,rgba(8,10,14,.88) 0%,rgba(8,10,14,.35) 55%,rgba(8,10,14,.92) 100%)" }} />
          <div style={{ position: "absolute", width: 700, height: 700, borderRadius: "50%", filter: "blur(140px)", background: "rgba(255,90,0,.1)", top: -200, left: -150 }} />
          <div style={{ position: "absolute", width: 500, height: 500, borderRadius: "50%", filter: "blur(130px)", background: "rgba(255,179,0,.07)", bottom: -100, right: -100 }} />
        </div>

        <div className="lo-hero-grid" style={{ position: "relative", zIndex: 1, display: "grid", gridTemplateColumns: "1fr 480px", gap: 0, maxWidth: "100%", margin: "0 auto", width: "100%", alignItems: "stretch", minHeight: "calc(100vh - 96px)" }}>
          {/* LEFT — video fullheight + copy encima */}
          <div className="lo-hero-left" style={{ position: "relative", overflow: "hidden" }}>
            {/* Video de fondo izquierdo */
            <video src="/gallery/cineai-fight.mp4" autoPlay muted loop playsInline
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
            {/* Gradientes sobre el video */}
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to right, rgba(8,10,14,.2) 0%, rgba(8,10,14,.85) 100%)" }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, rgba(8,10,14,.5) 0%, transparent 30%, rgba(8,10,14,.6) 100%)" }} />
            {/* Copy encima del video */}
            <div className="lo-hero-copy" style={{ position: "relative", zIndex: 2, padding: "60px 48px", display: "flex", flexDirection: "column", justifyContent: "center", height: "100%" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,90,0,.1)", border: "1px solid rgba(255,90,0,.3)", borderRadius: 100, padding: "6px 16px", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: V.fire, fontWeight: 700, marginBottom: 18 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: V.fire, animation: "blink 1.5s infinite" }} />
              {isEs ? "La plataforma visual IA de LATAM" : "LATAM's AI visual production platform"}
            </div>
            <h1 className="lo-hero-h1" style={{ fontFamily: V.ffD, fontSize: "clamp(52px,8vw,104px)", lineHeight: 0.92, letterSpacing: 2, color: "#fff" }}>
              <span style={{ display: "block" }}>{isEs ? "CONVIÉRTETE EN EL" : "BECOME THE"}</span>
              <span className="lo-shimmer" style={{ display: "block" }}>{isEs ? "PROTAGONISTA" : "PROTAGONIST"}</span>
              <span style={{ display: "block" }}>{isEs ? "DE TU PELÍCULA" : "OF YOUR MOVIE"}</span>
            </h1>
            <p style={{ marginTop: 16, fontSize: 17, lineHeight: 1.7, color: "rgba(240,236,228,.75)", maxWidth: 500 }}>
              {isEs ? "Genera escenas de Hollywood, videos musicales, comerciales y contenido viral con IA — con tu cara, tu historia, tu marca." : "Generate Hollywood scenes, music videos, commercials and viral content with AI — your face, your story, your brand."}
            </p>
            <div className="lo-hero-ctas" style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 28 }}>
              <button onClick={user ? () => go("cineai") : onStartDemo} style={{ background: `linear-gradient(135deg,${V.fire},${V.gold})`, border: "none", borderRadius: 14, color: "#000", fontFamily: V.ffU, fontSize: 16, fontWeight: 800, padding: "16px 36px", cursor: "pointer", boxShadow: `0 0 50px rgba(255,90,0,.35)`, transition: "all .25s" }}>
                {isEs ? "🎬 Comenzar — Registro gratuito" : "🎬 Start — Free sign up"}
              </button>
              <button onClick={() => scrollTo("galeria")} style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 14, color: "#fff", fontSize: 15, padding: "16px 26px", cursor: "pointer", fontFamily: V.ffB }}>
                {isEs ? "Ver ejemplos reales ↓" : "See real examples ↓"}
              </button>
            </div>
              <p style={{ marginTop: 12, fontSize: 12, color: V.muted }}><b style={{ color: V.gold }}>✓ 10 Jades al registrarte</b> · {isEs ? "Para generar imágenes · Sin tarjeta" : "To generate images · No credit card"}</p>
            </div>
          </div>

          {/* RIGHT — Demo box flotando sobre fondo oscuro */}
          <div className="lo-hero-right" style={{ background: "rgba(6,7,12,.97)", display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 32px", position: "relative" }}>
            {/* Glow de fondo */}
            <div style={{ position: "absolute", width: 300, height: 300, borderRadius: "50%", filter: "blur(80px)", background: "rgba(255,90,0,.08)", top: "50%", left: "50%", transform: "translate(-50%,-50%)", pointerEvents: "none" }} />
            <div style={{ width: "100%", maxWidth: 420, position: "relative", zIndex: 1 }}>
            {user ? (
              /* Panel usuario logueado */
              <div style={{ background: "rgba(12,14,22,.98)", border: "1px solid rgba(255,90,0,.2)", borderRadius: 20, padding: 24, backdropFilter: "blur(40px)", boxShadow: "0 8px 32px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.04), 0 0 80px rgba(255,90,0,.08)", animation: "floatUp .8s .2s cubic-bezier(.22,1,.36,1) both" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: `linear-gradient(135deg,${V.fire},${V.gold})`, display: "grid", placeItems: "center", fontFamily: V.ffU, fontSize: 15, fontWeight: 700, color: "#000", flexShrink: 0 }}>{(user?.email?.[0] || "U").toUpperCase()}</div>
                  <div>
                    <div style={{ fontSize: 12, color: "#fff", fontWeight: 600, wordBreak: "break-all" }}>{user?.email}</div>
                    <div style={{ fontSize: 10, color: V.fire, letterSpacing: 1 }}>{isEs ? "Creador activo" : "Active creator"}</div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(255,179,0,.06)", border: "1px solid rgba(255,179,0,.15)", borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
                  <div>
                    <div style={{ fontFamily: V.ffD, fontSize: 28, color: V.gold, letterSpacing: 2, lineHeight: 1 }}>{jades}</div>
                    <div style={{ fontSize: 11, color: V.muted }}>Jades</div>
                  </div>
                  <button onClick={onBuyJades} style={{ marginLeft: "auto", background: `linear-gradient(135deg,${V.fire},${V.gold})`, border: "none", borderRadius: 8, color: "#000", fontFamily: V.ffU, fontSize: 12, fontWeight: 700, padding: "6px 12px", cursor: "pointer", whiteSpace: "nowrap" }}>+ {isEs ? "Comprar" : "Buy"}</button>
                </div>
                <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: V.muted, marginBottom: 8 }}>{isEs ? "Registrarme y crear →" : "Sign up and create →"}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginBottom: 12 }}>
                  {MODS.map(m => (
                    <button key={m.key} onClick={() => go(m.key)} style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 8, padding: "8px 10px", cursor: "pointer", color: "rgba(240,236,228,.6)", fontFamily: V.ffU, fontSize: 11, transition: "all .15s", textAlign: "left" }}
                      onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,90,0,.1)"; e.currentTarget.style.borderColor = "rgba(255,90,0,.2)"; e.currentTarget.style.color = V.gold; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,.04)"; e.currentTarget.style.borderColor = "rgba(255,255,255,.07)"; e.currentTarget.style.color = "rgba(240,236,228,.6)"; }}>
                      <span style={{ fontSize: 14 }}>{m.icon}</span>{m.label}
                    </button>
                  ))}
                </div>
                <button onClick={onSignOut} style={{ width: "100%", background: "none", border: "1px solid rgba(255,255,255,.08)", borderRadius: 8, color: V.muted, fontFamily: V.ffU, fontSize: 12, padding: 9, cursor: "pointer" }}>{isEs ? "Cerrar sesión" : "Sign out"}</button>
              </div>
            ) : (
              /* Demo box visitante */
              <div className="lo-demo-box" style={{ background: "rgba(12,14,22,.98)", border: "1px solid rgba(255,90,0,.25)", borderRadius: 20, padding: 28, backdropFilter: "blur(40px)", boxShadow: "0 8px 32px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.04), 0 0 80px rgba(255,90,0,.08)", animation: "floatUp .8s .2s cubic-bezier(.22,1,.36,1) both" }}>
                <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: V.fire, fontWeight: 700, marginBottom: 4 }}>{isEs ? "Inicio rápido" : "Quick start"}</div>
                <div style={{ fontFamily: V.ffU, fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 10, lineHeight: 1.3 }}>{isEs ? "Crea con IA — 10 Jades al registrarte" : "Create with AI — 10 Jades on signup"}</div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,179,0,.1)", border: "1px solid rgba(255,179,0,.25)", borderRadius: 100, padding: "4px 12px", fontSize: 11, color: V.gold, fontWeight: 600, marginBottom: 14 }}>
                  🎁 {isEs ? "10 Jades al registrarte — genera imágenes" : "10 Jades on signup — generate images"}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginBottom: 12 }}>
                  {MODS.slice(0, 6).map(m => (
                    <div key={m.key} onClick={onStartDemo} style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 7, padding: "7px 9px", cursor: "pointer", fontSize: 11, color: "rgba(240,236,228,.5)", transition: "all .15s" }}
                      onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,90,0,.08)"; e.currentTarget.style.color = V.gold; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,.04)"; e.currentTarget.style.color = "rgba(240,236,228,.5)"; }}>
                      {m.icon} {m.label}
                    </div>
                  ))}
                </div>
                <textarea value={demoText} onChange={e => setDemoText(e.target.value)}
                  placeholder={isEs ? "Describe lo que quieres crear... ej: Yo como protagonista en una escena épica de noche" : "Describe what you want to create..."}
                  style={{ width: "100%", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 11, color: "#fff", fontFamily: V.ffB, fontSize: 13, padding: "12px 14px", resize: "none", outline: "none", height: 84, marginBottom: 11 }} />
                <button onClick={onStartDemo} style={{ width: "100%", background: `linear-gradient(135deg,${V.fire},${V.gold})`, border: "none", borderRadius: 11, color: "#000", fontFamily: V.ffU, fontSize: 15, fontWeight: 800, padding: 14, cursor: "pointer", boxShadow: "0 0 30px rgba(255,90,0,.3)" }}>
                  {isEs ? "Registrarme y crear →" : "Sign up and create →"}
                </button>
                <div style={{ fontSize: 11, color: V.muted, textAlign: "center", marginTop: 8 }}>{isEs ? "10 Jades al registrarte · Sin tarjeta" : "10 Jades on signup · No credit card"}</div>
              </div>
            )}
            </div>
          </div>
        </div>
      </section>

      {/* TRUST BAR */}
      <div className="lo-trust-grid" style={{ borderTop: `1px solid ${V.border2}`, borderBottom: `1px solid ${V.border2}`, background: V.bg2, display: "grid", gridTemplateColumns: "repeat(4,1fr)" }}>
        {[
          { n: <Ctr end={4127} suffix="+" />, l: isEs ? "Cuentas alcanzadas" : "Accounts reached" },
          { n: "< 3s",  l: isEs ? "Tiempo de generación" : "Generation time" },
          { n: "8+",    l: isEs ? "Módulos de producción" : "Production modules" },
          { n: "100%",  l: isEs ? "Hecho en Guatemala 🇬🇹" : "Made in Guatemala 🇬🇹" },
        ].map((item, i) => (
          <div key={i} style={{ padding: "32px 24px", textAlign: "center", borderRight: i < 3 ? `1px solid ${V.border2}` : "none" }}>
            <span style={{ fontFamily: V.ffD, fontSize: 48, letterSpacing: 2, display: "block", background: `linear-gradient(135deg,${V.fire},${V.gold})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", lineHeight: 1, marginBottom: 6 }}>{item.n}</span>
            <div style={{ fontSize: 11, color: V.muted, letterSpacing: 1.5 }}>{item.l}</div>
          </div>
        ))}
      </div>

      {/* VIDEO MUSICAL — Massiel Carrillo */}
      <section style={{ padding: "80px 32px", maxWidth: 1280, margin: "0 auto" }}>
        <span style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: "#ff5a00", fontWeight: 700, marginBottom: 8, display: "block" }}>{isEs ? "Hecho con IsabelaOS" : "Made with IsabelaOS"}</span>
        <h2 style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: "clamp(36px,5.5vw,70px)", lineHeight: 0.95, letterSpacing: 2, color: "#fff", marginBottom: 8 }}>{isEs ? "CLIPS MUSICALES 100% CON IA" : "100% AI MUSIC CLIPS"}</h2>
        <p style={{ fontSize: 16, color: "rgba(240,236,228,.45)", lineHeight: 1.7, maxWidth: 600, marginBottom: 40 }}>
          {isEs ? "Escenas cinematográficas, lip sync y efectos de producción profesional generados completamente con Seedance 2.0 — sin cámaras, sin actores, sin estudio." : "Cinematic scenes, lip sync and professional production effects generated entirely with Seedance 2.0 — no cameras, no actors, no studio."}
        </p>
        <div className="lo-musical-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "center" }}>
          {/* Video */}
          <div style={{ position: "relative", borderRadius: 20, overflow: "hidden", border: "1px solid rgba(255,90,0,.2)", boxShadow: "0 0 60px rgba(255,90,0,.1),0 40px 80px rgba(0,0,0,.5)", aspectRatio: "9/16", maxHeight: 600 }}>
            <video src="/gallery/massiel-clip.mp4" autoPlay muted loop playsInline controls
              style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <div style={{ position: "absolute", top: 16, left: 16, background: "rgba(255,90,0,.9)", borderRadius: 8, padding: "4px 12px", fontSize: 11, fontWeight: 700, color: "#000", letterSpacing: 1, textTransform: "uppercase" }}>
              🎬 100% IA
            </div>
          </div>
          {/* Info */}
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,90,0,.1)", border: "1px solid rgba(255,90,0,.3)", borderRadius: 100, padding: "6px 16px", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#ff5a00", fontWeight: 700, marginBottom: 20 }}>
              ⭐ {isEs ? "Caso de éxito real" : "Real success story"}
            </div>
            <h3 style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: "clamp(28px,4vw,52px)", lineHeight: 0.95, letterSpacing: 2, color: "#fff", marginBottom: 12 }}>
              {isEs ? "PRODUCCIÓN" : "PRODUCTION"}<br />
              <span style={{ background: "linear-gradient(135deg,#ff5a00,#ffb300)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>{isEs ? "CINEMATOGRÁFICA" : "CINEMATIC"}</span>
            </h3>
            <p style={{ fontSize: 15, color: "rgba(240,236,228,.7)", lineHeight: 1.7, marginBottom: 24 }}>
              {isEs ? "Escenas con drones épicos, lip sync perfecto y planos cinematográficos generados 100% con Seedance 2.0. Sin filmar una sola toma real." : "Epic drone scenes, perfect lip sync and cinematic shots generated 100% with Seedance 2.0. Without filming a single real shot."}
            </p>
            {[
              { icon: "🎬", label: isEs?"Drone épico de ciudad":"Epic city drone", sub: "BytePlus Seedance 2.0" },
              { icon: "💃", label: isEs?"Escenas de baile y drama":"Dance and drama scenes", sub: "fal.ai Reference-to-Video" },
              { icon: "🎵", label: isEs?"Lip sync sincronizado":"Synchronized lip sync", sub: "Sync Lipsync v2 Pro" },
              { icon: "📱", label: isEs?"+4,100 cuentas alcanzadas":"+4,100 accounts reached", sub: isEs?"En 24 horas de publicación":"In 24 hours of publication" },
            ].map((f, i) => (
              <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 14, padding: "12px 14px", background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)", borderRadius: 12 }}>
                <span style={{ fontSize: 22, flexShrink: 0 }}>{f.icon}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", fontFamily: "'Space Grotesk',sans-serif" }}>{f.label}</div>
                  <div style={{ fontSize: 11, color: "#ff5a00", marginTop: 2, letterSpacing: 0.5 }}>{f.sub}</div>
                </div>
              </div>
            ))}
            <button onClick={isEs ? onStartDemo : onStartDemo} style={{ marginTop: 8, background: "linear-gradient(135deg,#ff5a00,#ffb300)", border: "none", borderRadius: 14, color: "#000", fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 800, padding: "14px 32px", cursor: "pointer", boxShadow: "0 0 40px rgba(255,90,0,.3)" }}>
              {isEs ? "🎬 Crear con Seedance 2.0 →" : "🎬 Create with Seedance 2.0 →"}
            </button>
          </div>
        </div>
      </section>

      {/* GALERÍA */}
      <section style={{ padding: "80px 32px", maxWidth: 1280, margin: "0 auto" }} id="galeria">
        <span style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: V.fire, fontWeight: 700, marginBottom: 8, display: "block" }}>{isEs ? "¿Cómo es posible?" : "How is this possible?"}</span>
        <h2 style={{ fontFamily: V.ffD, fontSize: "clamp(36px,5.5vw,70px)", lineHeight: 0.95, letterSpacing: 2, color: "#fff", marginBottom: 12 }}>{isEs ? "TODO ESTO ES IA" : "ALL OF THIS IS AI"}</h2>
        <p style={{ fontSize: 16, color: V.muted, lineHeight: 1.7, maxWidth: 600, marginBottom: 40 }}>{isEs ? "Sin actores. Sin cámaras. Sin estudio. Solo tu visión y nuestra IA." : "No actors. No cameras. No studio. Just your vision and our AI."}</p>
        <div className="lo-gal-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
          {GAL.map((v, i) => (
            <div key={i} onClick={() => user ? go("cineai") : onStartDemo()} style={{ position: "relative", overflow: "hidden", borderRadius: 14, border: `1px solid ${V.border2}`, cursor: "pointer", aspectRatio: v.wide ? "16/9" : "9/16", gridColumn: v.wide ? "span 2" : "auto", className: v.wide ? "lo-gal-wide" : "", transition: "transform .3s,border-color .3s" }}
              onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.02)"; e.currentTarget.style.borderColor = "rgba(255,90,0,.4)"; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.borderColor = V.border2; }}>
              <video src={v.src} autoPlay muted loop playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top,rgba(8,10,14,.85) 0%,transparent 55%)" }} />
              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: 14 }}>
                <span style={{ display: "inline-block", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", background: "rgba(255,90,0,.15)", border: "1px solid rgba(255,90,0,.3)", borderRadius: 5, padding: "2px 7px", color: V.fire, marginBottom: 4 }}>{v.tag}</span>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#fff", fontFamily: V.ffU }}>{v.label}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* MÓDULOS */}
      <section style={{ padding: "0 32px 80px", maxWidth: 1280, margin: "0 auto" }}>
        <span style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: V.fire, fontWeight: 700, marginBottom: 8, display: "block" }}>{isEs ? "El sistema completo" : "The complete system"}</span>
        <h2 style={{ fontFamily: V.ffD, fontSize: "clamp(36px,5.5vw,70px)", lineHeight: 0.95, letterSpacing: 2, color: "#fff", marginBottom: 40 }}>{isEs ? "TODO LO QUE NECESITAS" : "EVERYTHING YOU NEED"}</h2>
        <div className="lo-mod-grid-css" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
          {MODS.map(m => (
            <div key={m.key} onClick={() => user ? go(m.key) : onStartDemo()} style={{ border: `1px solid ${V.border2}`, borderRadius: 18, background: V.bg2, overflow: "hidden", cursor: "pointer", transition: "all .3s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = m.color; e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = "0 16px 50px rgba(0,0,0,.4)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = V.border2; e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}>
              {m.vid ? (
                <div style={{ height: 160, overflow: "hidden", position: "relative" }}>
                  <video src={m.vid} autoPlay muted loop playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <div style={{ position: "absolute", inset: 0, background: `linear-gradient(to bottom,transparent 40%,${V.bg2} 100%)` }} />
                </div>
              ) : (
                <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", background: `linear-gradient(135deg,rgba(255,90,0,.06),rgba(8,10,14,.5))` }}>
                  <span style={{ fontSize: 48, opacity: 0.35 }}>{m.icon}</span>
                </div>
              )}
              <div style={{ padding: "16px 18px 20px" }}>
                <span style={{ display: "inline-block", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 5, padding: "2px 7px", color: "rgba(240,236,228,.5)", marginBottom: 7 }}>{m.badge}</span>
                <div style={{ fontFamily: V.ffU, fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 5 }}>{m.label}</div>
                <div style={{ fontSize: 12, color: V.muted, lineHeight: 1.6 }}>{m.desc}</div>
                <div style={{ marginTop: 12, fontSize: 12, fontWeight: 700, color: m.color, letterSpacing: 0.5 }}>{isEs ? "Ver módulo →" : "See module →"}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section style={{ padding: "0 32px 80px", maxWidth: 1280, margin: "0 auto" }}>
        <span style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: V.fire, fontWeight: 700, marginBottom: 8, display: "block" }}>{isEs ? "Tan fácil como escribir" : "As easy as writing"}</span>
        <h2 style={{ fontFamily: V.ffD, fontSize: "clamp(36px,5.5vw,70px)", lineHeight: 0.95, letterSpacing: 2, color: "#fff", marginBottom: 40 }}>{isEs ? "3 PASOS Y LISTO" : "3 STEPS DONE"}</h2>
        <div className="lo-how-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 2, background: V.border2, borderRadius: 18, overflow: "hidden" }}>
          {[
            { n: "01", icon: "📸", t: isEs?"Sube tu foto":"Upload photo",         d: isEs?"La IA aprende tu cara en segundos":"AI learns your face in seconds" },
            { n: "02", icon: "✍️", t: isEs?"Describe la escena":"Describe scene",  d: isEs?"Hollywood, TikTok, comercial — lo que imagines":"Hollywood, TikTok, commercial — anything" },
            { n: "03", icon: "🎬", t: isEs?"Descarga y publica":"Download & share", d: isEs?"Listo en menos de 3 minutos":"Ready in under 3 minutes" },
          ].map((s, i) => (
            <div key={i} style={{ background: V.bg2, padding: "36px 28px", position: "relative", overflow: "hidden" }}>
              <div style={{ fontFamily: V.ffD, fontSize: 80, letterSpacing: 3, color: "rgba(255,90,0,.05)", position: "absolute", right: 16, top: 12, lineHeight: 1 }}>{s.n}</div>
              <div style={{ fontSize: 11, letterSpacing: 3, color: V.fire, fontWeight: 700, textTransform: "uppercase", marginBottom: 12 }}>{s.n}</div>
              <span style={{ fontSize: 34, display: "block", marginBottom: 12 }}>{s.icon}</span>
              <div style={{ fontFamily: V.ffU, fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 7 }}>{s.t}</div>
              <p style={{ fontSize: 13, color: V.muted, lineHeight: 1.7 }}>{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* TESTIMONIOS */}
      <section style={{ padding: "0 32px 80px", maxWidth: 1280, margin: "0 auto" }}>
        <span style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: V.fire, fontWeight: 700, marginBottom: 8, display: "block" }}>{isEs ? "Lo que dicen" : "What they say"}</span>
        <h2 style={{ fontFamily: V.ffD, fontSize: "clamp(36px,5.5vw,70px)", lineHeight: 0.95, letterSpacing: 2, color: "#fff", marginBottom: 40 }}>{isEs ? "ELLOS YA LO USAN" : "THEY ALREADY USE IT"}</h2>
        <div className="lo-testi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
          {[
            { name: "Carlos M.", role: isEs?"Creador, Guatemala":"Creator, Guatemala", stars: 5, text: isEs?'"Video de pelea estilo Matrix en 2 minutos. La gente creyó que era producción real."':'"Matrix-style fight video in 2 minutes. People thought it was real production."' },
            { name: "Sofía R.", role: isEs?"Influencer, México":"Influencer, Mexico", stars: 5, text: isEs?'"El Photoshoot triplicó mi engagement. Mismo día que publiqué llegaron los mensajes."':'"Photoshoot tripled my engagement. Messages came the same day I posted."' },
            { name: "Equipo Nova", role: isEs?"Agencia, Colombia":"Agency, Colombia", stars: 5, text: isEs?'"Lo que tardaba días con equipo ahora lo hacemos en minutos. Cambia todo el negocio."':'"What took days now takes minutes. Changes everything about the business."' },
          ].map((t, i) => (
            <div key={i} style={{ background: V.bg2, border: `1px solid ${V.border2}`, borderRadius: 18, padding: 24, transition: "all .3s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(255,90,0,.2)"; e.currentTarget.style.transform = "translateY(-3px)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = V.border2; e.currentTarget.style.transform = "none"; }}>
              <div style={{ display: "flex", gap: 3, marginBottom: 12 }}>{Array(t.stars).fill(0).map((_, j) => <span key={j} style={{ color: V.gold, fontSize: 14 }}>★</span>)}</div>
              <p style={{ fontSize: 14, color: "rgba(240,236,228,.8)", lineHeight: 1.7, fontStyle: "italic", marginBottom: 16 }}>{t.text}</p>
              <div style={{ height: 1, background: V.border2, marginBottom: 13 }} />
              <div style={{ fontFamily: V.ffU, fontSize: 14, fontWeight: 700, color: "#fff" }}>{t.name}</div>
              <div style={{ fontSize: 12, color: V.muted, marginTop: 2 }}>{t.role}</div>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section style={{ padding: "0 32px 80px", maxWidth: 1280, margin: "0 auto" }} id="planes">
        <span style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: V.fire, fontWeight: 700, marginBottom: 8, display: "block" }}>{isEs ? "Sin suscripción" : "No subscription"}</span>
        <h2 style={{ fontFamily: V.ffD, fontSize: "clamp(36px,5.5vw,70px)", lineHeight: 0.95, letterSpacing: 2, color: "#fff", marginBottom: 12 }}>{isEs ? "PAGA LO QUE USAS" : "PAY WHAT YOU USE"}</h2>
        <p style={{ fontSize: 16, color: V.muted, lineHeight: 1.7, maxWidth: 600, marginBottom: 40 }}>{isEs ? "Compra Jades y genera cuando quieras. Sin mensualidad. 1 Jade ≈ $0.10 USD." : "Buy Jades and generate anytime. No monthly fee. 1 Jade ≈ $0.10 USD."}</p>
        <div className="lo-gal-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
          {Object.entries(JADE_PACKS).map(([key, p]) => {
            const hot = key === "popular";
            return (
              <div key={key} style={{ background: hot ? `linear-gradient(160deg,rgba(255,90,0,.07),${V.bg2})` : V.bg2, border: `1px solid ${hot ? "rgba(255,90,0,.35)" : V.border2}`, borderRadius: 18, padding: 24, position: "relative", transition: "all .3s", ...(hot ? { boxShadow: "0 0 50px rgba(255,90,0,.1)" } : {}) }}
                onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-4px)"; }}
                onMouseLeave={e => { e.currentTarget.style.transform = "none"; }}>
                {hot && <div style={{ position: "absolute", top: 14, right: 14, background: `linear-gradient(135deg,${V.fire},${V.gold})`, color: "#000", fontSize: 10, fontWeight: 800, letterSpacing: 1, borderRadius: 5, padding: "3px 8px", textTransform: "uppercase" }}>Popular</div>}
                <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: V.muted, marginBottom: 8 }}>{p.label}</div>
                <div style={{ fontFamily: V.ffD, fontSize: 50, color: "#fff", lineHeight: 1, letterSpacing: 2 }}>${p.price_usd}</div>
                <div style={{ fontSize: 12, color: V.muted, marginBottom: 4 }}>USD</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: V.gold, marginBottom: 16, fontFamily: V.ffU }}>{p.jades} Jades</div>
                {[
                  `${p.jades} ${isEs ? "imágenes" : "images"}`,
                  `${Math.floor(p.jades / (COSTS?.vid_express_8s || 40))} videos CineAI`,
                  `${Math.floor(p.jades / 20)} ${isEs ? "sesiones Photo" : "Photo sessions"}`,
                  isEs ? "Sin vencimiento" : "Never expire",
                ].map((f, i) => (
                  <div key={i} style={{ display: "flex", gap: 7, fontSize: 12, color: "rgba(240,236,228,.7)", marginBottom: 7, alignItems: "center" }}>
                    <span style={{ color: V.fire, fontSize: 11, flexShrink: 0 }}>✓</span>{f}
                  </div>
                ))}
                <button onClick={user ? onBuyJades : onOpenAuth} style={s.btn(hot)}>
                  {isEs ? "Comprar" : "Buy"} {p.label}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* FINAL CTA */}
      <div className="lo-final-box" style={{ margin: "0 32px 80px", borderRadius: 26, padding: "80px 60px", textAlign: "center", position: "relative", overflow: "hidden", background: "linear-gradient(135deg,rgba(255,90,0,.07),rgba(255,179,0,.04))", border: "1px solid rgba(255,90,0,.15)" }}>
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at center,rgba(255,90,0,.06),transparent 70%)", pointerEvents: "none" }} />
        <div style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: V.fire, fontWeight: 700, marginBottom: 12 }}>{isEs ? "Empieza hoy" : "Start today"}</div>
        <h2 style={{ fontFamily: V.ffD, fontSize: "clamp(36px,6vw,70px)", color: "#fff", letterSpacing: 2, lineHeight: 0.95, marginBottom: 12 }}>{isEs ? "TU PRIMERA ESCENA\nEN MENOS DE 3 MIN" : "YOUR FIRST SCENE\nIN UNDER 3 MIN"}</h2>
        <p style={{ fontSize: 16, color: V.muted, maxWidth: 460, margin: "0 auto 28px", lineHeight: 1.7 }}>{isEs ? "Sin tarjeta. 10 Jades al registrarte para generar imágenes." : "No credit card. 10 Jades on signup to generate images."}</p>
        <button onClick={user ? () => go("cineai") : onStartDemo} style={{ display: "inline-block", background: `linear-gradient(135deg,${V.fire},${V.gold})`, border: "none", borderRadius: 15, color: "#000", fontFamily: V.ffU, fontSize: 18, fontWeight: 800, padding: "20px 50px", cursor: "pointer", boxShadow: `0 0 70px rgba(255,90,0,.4),0 8px 30px rgba(0,0,0,.4)`, transition: "all .25s" }}>
          {isEs ? "🎬 Comenzar con 10 Jades" : "🎬 Start with 10 Jades"}
        </button>
      </div>

      {/* FOOTER */}
      <footer style={{ borderTop: `1px solid ${V.border2}`, background: V.bg2, padding: "52px 32px 28px" }}>
        <div className="lo-footer-grid" style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", gap: 44, marginBottom: 36 }}>
          <div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: `linear-gradient(135deg,${V.fire},${V.gold})`, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 800, color: "#000", fontFamily: V.ffU }}>io</div>
              <div>
                <div style={{ fontFamily: V.ffU, fontSize: 14, fontWeight: 700, color: "#fff" }}>isabelaOs Studio</div>
                <div style={{ fontSize: 10, color: V.muted }}>{isEs ? "Plataforma IA visual" : "AI visual platform"}</div>
              </div>
            </div>
            <p style={{ fontSize: 12, color: V.muted, lineHeight: 1.7 }}>Stalling Technologic · Cobán, Alta Verapaz, Guatemala 🇬🇹</p>
          </div>
          {[
            { title: isEs?"Plataforma":"Platform", links: [{ l: isEs?"Crear cuenta":"Create account", fn: onOpenAuth }, { l: isEs?"Precios":"Pricing", fn: () => scrollTo("planes") }, { l: isEs?"Sobre nosotros":"About us", fn: onOpenAbout }] },
            { title: isEs?"Soporte":"Support", links: [{ l: isEs?"Contacto":"Contact", fn: onOpenContact }, { l: "contacto@isabelaos.com", fn: null }] },
            { title: "Legal", links: [{ l: isEs?"Términos":"Terms", href: "/terms" }, { l: isEs?"Reembolsos":"Refunds", href: "/refund" }, { l: isEs?"Privacidad":"Privacy", href: "/privacy" }] },
          ].map((col, i) => (
            <div key={i}>
              <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: "rgba(255,255,255,.35)", marginBottom: 12 }}>{col.title}</div>
              {col.links.map((lnk, j) => lnk.href
                ? <a key={j} href={lnk.href} target="_blank" style={{ display: "block", fontSize: 12, color: V.muted, marginBottom: 9, textDecoration: "none", transition: "color .2s" }} onMouseEnter={e => e.target.style.color = "#fff"} onMouseLeave={e => e.target.style.color = V.muted}>{lnk.l}</a>
                : <button key={j} onClick={lnk.fn} style={{ display: "block", fontSize: 12, color: V.muted, marginBottom: 9, background: "none", border: "none", cursor: lnk.fn ? "pointer" : "text", padding: 0, fontFamily: V.ffB, transition: "color .2s" }} onMouseEnter={e => lnk.fn && (e.target.style.color = "#fff")} onMouseLeave={e => e.target.style.color = V.muted}>{lnk.l}</button>
              )}
            </div>
          ))}
        </div>
        <div style={{ maxWidth: 1280, margin: "0 auto", borderTop: `1px solid ${V.border2}`, paddingTop: 18, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,.25)" }}>© 2025 IsabelaOS · {isEs ? "Todos los derechos reservados" : "All rights reserved"}</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,.25)" }}>{isEs ? "Hecho con IA · GPU Power · Cobán GT" : "Made with AI · GPU Power · Cobán GT"}</div>
        </div>
      </footer>
    </div>
  );
}
