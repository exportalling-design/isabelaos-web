// src/components/LandingView.jsx — IsabelaOS Studio v8.0
// PATCHES:
//   ✅ Hero rediseñado: 4 plantillas épicas en video full-screen
//   ✅ Social proof compacto + Magic Prompt Generator visible sin scroll profundo
//   ✅ Nav simplificado: logo, módulos, Jades, login
//   ✅ Welcome toast eliminado
import { useState, useEffect, useRef, useCallback } from "react";
import { JADE_PACKS, COSTS } from "../lib/pricing";
import { supabase } from "../lib/supabaseClient";

function scrollTo(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}
function AV({ src, className }) {
  const r = useRef(null);
  useEffect(() => { r.current?.play().catch(() => {}); }, []);
  return <video ref={r} src={src} className={className} muted loop playsInline autoPlay />;
}
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
function HoverMenu({ modules, onSelect, isEs }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,90,0,0.1)", border: "1px solid rgba(255,90,0,0.25)", borderRadius: 9, padding: "7px 13px", cursor: "pointer", color: "#ffb300", fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, fontWeight: 600, transition: "all .2s" }}>
        ☰ <span style={{ fontSize: 11 }}>{isEs ? "Módulos" : "Modules"}</span>
      </button>
      <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, background: "rgba(10,12,18,0.98)", border: "1px solid rgba(255,90,0,0.15)", borderRadius: 14, padding: 8, minWidth: 200, backdropFilter: "blur(30px)", opacity: open ? 1 : 0, transform: open ? "none" : "translateY(-10px) scale(0.97)", pointerEvents: open ? "all" : "none", transition: "all .2s", boxShadow: "0 20px 60px rgba(0,0,0,0.5)", zIndex: 100 }}>
        {modules.map(m => (
          <button key={m.key} onClick={() => { onSelect(m.key); setOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", background: "none", border: "none", color: "rgba(240,236,228,0.75)", fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, padding: "9px 12px", cursor: "pointer", borderRadius: 8, transition: "all .15s", textAlign: "left" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,90,0,0.1)"; e.currentTarget.style.color = "#ffb300"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "rgba(240,236,228,0.75)"; }}>
            <span style={{ fontSize: 16 }}>{m.icon}</span> {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}
function UserNavMenu({ user, jades, modules, onSelectModule, onBuyJades, onSignOut, onOpenAdmin, t }) {
  const [open, setOpen] = useState(false);
  const item = { display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", color: "rgba(240,236,228,0.8)", fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, padding: "9px 10px", cursor: "pointer", borderRadius: 8, transition: "all .15s", textAlign: "left" };
  const sectionLabel = { fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "rgba(240,236,228,0.35)", padding: "8px 10px 4px" };
  return (
    <div style={{ position: "relative" }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,179,0,0.08)", border: "1px solid rgba(255,179,0,0.25)", borderRadius: 9, padding: "6px 12px 6px 6px", cursor: "pointer", color: "#fff", fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, fontWeight: 700 }}>
        <span style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg,#ff5a00,#ffb300)", display: "grid", placeItems: "center", fontSize: 13, flexShrink: 0 }}>👤</span>
        <span style={{ fontSize: 9, opacity: 0.6 }}>▾</span>
      </button>
      <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, background: "rgba(10,12,18,0.98)", border: "1px solid rgba(255,90,0,0.15)", borderRadius: 14, padding: 8, minWidth: 240, maxHeight: "70vh", overflowY: "auto", backdropFilter: "blur(30px)", opacity: open ? 1 : 0, transform: open ? "none" : "translateY(-10px) scale(0.97)", pointerEvents: open ? "all" : "none", transition: "all .2s", boxShadow: "0 20px 60px rgba(0,0,0,0.5)", zIndex: 100 }}>
        <div style={{ fontSize: 11, color: "rgba(240,236,228,0.45)", padding: "4px 10px 8px", wordBreak: "break-all" }}>{user?.email}</div>

        <div style={sectionLabel}>{t.myJades}</div>
        <button onClick={onBuyJades} style={item}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,90,0,0.1)"; e.currentTarget.style.color = "#ffb300"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "rgba(240,236,228,0.8)"; }}>
          💎 {jades} {t.buyMore}
        </button>

        <div style={sectionLabel}>{t.modules}</div>
        {modules.map(m => (
          <button key={m.key} onClick={() => !m.comingSoon && onSelectModule(m.key)} disabled={m.comingSoon} style={{ ...item, opacity: m.comingSoon ? 0.4 : 1, cursor: m.comingSoon ? "default" : "pointer" }}
            onMouseEnter={e => { if (!m.comingSoon) { e.currentTarget.style.background = "rgba(255,90,0,0.1)"; e.currentTarget.style.color = "#ffb300"; } }}
            onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "rgba(240,236,228,0.8)"; }}>
            {m.icon} {m.label}
          </button>
        ))}

        {onOpenAdmin && (
          <button onClick={onOpenAdmin} style={item}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,90,0,0.1)"; e.currentTarget.style.color = "#ffb300"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "rgba(240,236,228,0.8)"; }}>
            🛠️ Admin Panel
          </button>
        )}
        <button onClick={onSignOut} style={{ ...item, color: "#e07070" }}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(200,60,60,0.08)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "none"; }}>
          ↩ {t.signOut}
        </button>
      </div>
    </div>
  );
}
function ModOverlay({ title, onClose, children, isEs }) {
  useEffect(() => { document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = ""; }; }, []);
  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "96px 16px 16px", overflowY: "auto", animation: "moIn .3s ease" }}>
      <div style={{ width: "100%", maxWidth: 1200, flexShrink: 0, background: "#0d1017", border: "1px solid rgba(255,90,0,0.15)", borderRadius: 24, overflow: "hidden", animation: "moPIn .3s ease" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 22px", borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,90,0,0.05)", position: "sticky", top: 0, backdropFilter: "blur(20px)", zIndex: 10 }}>
          <button onClick={onClose} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", color: "#ff5a00", fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>← {title === "library" ? (isEs ? "Biblioteca" : "Library") : title === "templates" ? (isEs ? "Plantillas de Video" : "Video Templates") : title}</button>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "rgba(240,236,228,0.5)", fontSize: 16, padding: "4px 12px", cursor: "pointer" }}>✕</button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}

const STRINGS = {
  es: {
    seedbar: "⚡ SEEDANCE 2.0 YA DISPONIBLE EN ISABELAOS",
    nav: { tagline: "Plataforma IA", signIn: "Entrar", signUp: "Registrarse", myJades: "Mis Jades", buyMore: "Jades — Comprar más", modules: "Módulos", signOut: "Cerrar sesión" },
    hero: {
      freeBadge: "🎁 1 video gratis al registrarte — sin tarjeta",
      h1a: "CONVIÉRTETE EN EL ", h1b: "PROTAGONISTA",
      tryFree: "Probar gratis →", createFace: "Crear con mi cara →",
    },
    heroTemplates: {
      "free-1": "The Day I Saw Him", "free-2": "Ultimate Awakening", "free-3": "The Chosen One",
      divineLight: "Confrontación Divina", coupleDisaster: "La Última Pelea",
      luchaTitanes: "Lucha de Titanes", victoriasSecret: "Victoria's Secret",
    },
    social: { views: "vistas generadas", country: "Guatemala", madeIn: "Hecho en LATAM", engine: "Motor de IA" },
    quickgen: {
      eyebrow: "✨ Magic Prompt Generator", h2: "ESCRIBE TU IDEA Y GENERA",
      sub: "La IA convierte tu idea en una escena cinematográfica lista para generar.",
      placeholder: "Describe tu escena, ej: un guerrero vikingo en una tormenta de nieve",
      generate: "Generar", generating: "Generando...", copy: "Copiar", copied: "Copiado",
      generateVideo: "Generar este video →", missingIdea: "Escribe tu idea primero",
      errorPrompts: "Error generando prompts",
    },
    epicBanner: {
      title: "Plantillas Épicas", badge: "NUEVO",
      desc: "Ponté en escenas cinematográficas épicas ya generadas. Sube tu foto → la IA te pone en la escena. Confrontación Divina · La Última Pelea · Victoria's Secret",
      cta: "Ver plantillas →",
    },
    musical: {
      eyebrow: "Hecho con IsabelaOS", h2: "CLIPS MUSICALES 100% CON IA",
      p: "Escenas cinematográficas, lip sync y efectos de producción profesional generados completamente con Seedance 2.0 — sin cámaras, sin actores, sin estudio.",
      badge: "🎬 100% IA", tag: "⭐ Caso de éxito real", h3a: "PRODUCCIÓN", h3b: "CINEMATOGRÁFICA",
      p2: "Escenas con drones épicos, lip sync perfecto y planos cinematográficos generados 100% con Seedance 2.0. Sin filmar una sola toma real.",
      features: [
        { label: "Drone épico de ciudad", sub: "BytePlus Seedance 2.0" },
        { label: "Escenas de baile y drama", sub: "fal.ai Reference-to-Video" },
        { label: "Lip sync sincronizado", sub: "Sync Lipsync v2 Pro" },
        { label: "+4,100 cuentas alcanzadas", sub: "En 24 horas de publicación" },
      ],
      cta: "🎬 Crear con Seedance 2.0 →",
    },
    gallery: {
      eyebrow: "¿Cómo es posible?", h2: "TODO ESTO ES IA",
      p: "Sin actores. Sin cámaras. Sin estudio. Solo tu visión y nuestra IA.",
      items: {
        heroBg: { tag: "🎬 CineAI", label: "Drone ciudad noche" },
        cineaiFight: { tag: "🎬 CineAI", label: "Escena épica" },
        cineaiDrama: { tag: "🎬 CineAI", label: "Drama cinematográfico" },
        cineaiRain: { tag: "🎬 CineAI", label: "Mujer bajo la lluvia" },
        comercialChef: { tag: "🎙️ Comercial", label: "Chef IA" },
        comercialProduct: { tag: "🎙️ Comercial", label: "Producto estelar" },
        tiktokTrend: { tag: "🕺 TikTok", label: "Trend viral" },
        cineaiDance: { tag: "🎬 CineAI", label: "Baile musical" },
      },
    },
    mods: {
      eyebrow: "El sistema completo", h2: "TODO LO QUE NECESITAS", seeModule: "Ver módulo →", free: "GRATIS",
      items: {
        templates:  { label: "Plantillas de Video", desc: "Videos gratis y épicos con tu rostro" },
        cineai:     { label: "CineAI",              desc: "Escenas Hollywood con tu cara" },
        photoshoot: { label: "Photoshoot",           desc: "Fotos de producto profesionales en segundos" },
        avatars:    { label: "Avatares",             desc: "Tu modelo virtual con tu rostro" },
        comercial:  { label: "Comercial IA",         desc: "Comerciales profesionales con voz IA" },
        montaje:    { label: "Montaje IA",           desc: "Personas y productos en cualquier escenario" },
        generator:  { label: "Imagen IA",            desc: "Imágenes cinematográficas con FLUX" },
        img2video:  { label: "Imagen → Video",       desc: "Convierte tus fotos en videos — Próximamente" },
        library:    { label: "Biblioteca",           desc: "Tus creaciones guardadas" },
      },
    },
    how: {
      eyebrow: "Tan fácil como escribir", h2: "3 PASOS Y LISTO",
      steps: [
        { t: "Sube tu foto", d: "La IA aprende tu cara en segundos" },
        { t: "Genera gratis", d: "Tu primera escena cinematográfica — sin tarjeta" },
        { t: "Descarga y publica", d: "Listo en menos de 5 minutos" },
      ],
    },
    testi: {
      eyebrow: "Lo que dicen", h2: "ELLOS YA LO USAN",
      items: [
        { name: "Carlos M.", role: "Creador, Guatemala", text: '"Video de pelea estilo Matrix en 2 minutos. La gente creyó que era producción real."' },
        { name: "Sofía R.", role: "Influencer, México", text: '"El Photoshoot triplicó mi engagement. Mismo día que publiqué llegaron los mensajes."' },
        { name: "Equipo Nova", role: "Agencia, Colombia", text: '"Lo que tardaba días con equipo ahora lo hacemos en minutos. Cambia todo el negocio."' },
      ],
    },
    pricing: {
      eyebrow: "Sin suscripción", h2: "PAGA LO QUE USAS",
      p: "Compra Jades y genera cuando quieras. Sin mensualidad. 1 Jade ≈ $0.10 USD.",
      images: "imágenes", photoSessions: "sesiones Photo", neverExpire: "Sin vencimiento", buy: "Comprar",
    },
    finalCta: {
      eyebrow: "Empieza hoy", h2: "TU PRIMERA ESCENA\nEN MENOS DE 3 MIN",
      p: "Sin tarjeta. 1 video gratis al registrarte.", cta: "🎁 Generar mi video gratis",
    },
    footer: {
      tagline: "Plataforma IA visual",
      cols: [
        { title: "Plataforma", links: [{ l: "Crear cuenta", k: "auth" }, { l: "Precios", k: "planes" }, { l: "Sobre nosotros", k: "about" }] },
        { title: "Soporte", links: [{ l: "Contacto", k: "contact" }, { l: "contacto@isabelaos.com", k: null }] },
        { title: "Legal", links: [{ l: "Términos", href: "/terms" }, { l: "Reembolsos", href: "/refund" }, { l: "Privacidad", href: "/privacy" }] },
      ],
      rights: "Todos los derechos reservados", madeWith: "Hecho con IA · GPU Power · Cobán GT",
    },
  },
  en: {
    seedbar: "⚡ SEEDANCE 2.0 NOW AVAILABLE ON ISABELAOS",
    nav: { tagline: "AI Platform", signIn: "Sign in", signUp: "Sign up", myJades: "My Jades", buyMore: "Jades — Buy more", modules: "Modules", signOut: "Sign out" },
    hero: {
      freeBadge: "🎁 1 free video on signup — no card needed",
      h1a: "BECOME THE ", h1b: "PROTAGONIST",
      tryFree: "Try for free →", createFace: "Create with my face →",
    },
    heroTemplates: {
      "free-1": "The Day I Saw Him", "free-2": "Ultimate Awakening", "free-3": "The Chosen One",
      divineLight: "Divine Confrontation", coupleDisaster: "The Last Fight",
      luchaTitanes: "Clash of Titans", victoriasSecret: "Victoria's Secret",
    },
    social: { views: "views generated", country: "Guatemala", madeIn: "Made in LATAM", engine: "AI engine" },
    quickgen: {
      eyebrow: "✨ Magic Prompt Generator", h2: "WRITE YOUR IDEA AND GENERATE",
      sub: "AI turns your idea into a ready-to-generate cinematic scene.",
      placeholder: "Describe your scene, e.g: a viking warrior in a snowstorm",
      generate: "Generate", generating: "Generating...", copy: "Copy", copied: "Copied",
      generateVideo: "Generate this video →", missingIdea: "Write your idea first",
      errorPrompts: "Error generating prompts",
    },
    epicBanner: {
      title: "Epic Templates", badge: "NEW",
      desc: "Place yourself in pre-built epic cinematic scenes. Upload your photo → AI puts you in the scene. Divine Confrontation · The Last Fight · Victoria's Secret",
      cta: "See templates →",
    },
    musical: {
      eyebrow: "Made with IsabelaOS", h2: "100% AI MUSIC CLIPS",
      p: "Cinematic scenes, lip sync and professional production effects generated entirely with Seedance 2.0 — no cameras, no actors, no studio.",
      badge: "🎬 100% AI", tag: "⭐ Real success story", h3a: "PRODUCTION", h3b: "CINEMATIC",
      p2: "Epic drone scenes, perfect lip sync and cinematic shots generated 100% with Seedance 2.0. Without filming a single real shot.",
      features: [
        { label: "Epic city drone", sub: "BytePlus Seedance 2.0" },
        { label: "Dance and drama scenes", sub: "fal.ai Reference-to-Video" },
        { label: "Synchronized lip sync", sub: "Sync Lipsync v2 Pro" },
        { label: "+4,100 accounts reached", sub: "In 24 hours of publication" },
      ],
      cta: "🎬 Create with Seedance 2.0 →",
    },
    gallery: {
      eyebrow: "How is this possible?", h2: "ALL OF THIS IS AI",
      p: "No actors. No cameras. No studio. Just your vision and our AI.",
      items: {
        heroBg: { tag: "🎬 CineAI", label: "City drone night" },
        cineaiFight: { tag: "🎬 CineAI", label: "Epic scene" },
        cineaiDrama: { tag: "🎬 CineAI", label: "Cinematic drama" },
        cineaiRain: { tag: "🎬 CineAI", label: "Woman in rain" },
        comercialChef: { tag: "🎙️ Commercial", label: "AI Chef" },
        comercialProduct: { tag: "🎙️ Commercial", label: "Star product" },
        tiktokTrend: { tag: "🕺 TikTok", label: "Viral trend" },
        cineaiDance: { tag: "🎬 CineAI", label: "Music dance" },
      },
    },
    mods: {
      eyebrow: "The complete system", h2: "EVERYTHING YOU NEED", seeModule: "See module →", free: "FREE",
      items: {
        templates:  { label: "Video Templates", desc: "Free and epic videos with your face" },
        cineai:     { label: "CineAI",           desc: "Hollywood scenes with your face" },
        photoshoot: { label: "Photoshoot",       desc: "Professional product photos in seconds" },
        avatars:    { label: "Avatars",          desc: "Your virtual model with your face" },
        comercial:  { label: "Comercial IA",     desc: "Professional AI commercials with voice" },
        montaje:    { label: "Montaje IA",       desc: "People and products in any scenario" },
        generator:  { label: "AI Image",         desc: "Cinematic images with FLUX" },
        img2video:  { label: "Image → Video",    desc: "Convert your photos to videos — Coming soon" },
        library:    { label: "Library",          desc: "Your saved creations" },
      },
    },
    how: {
      eyebrow: "As easy as writing", h2: "3 STEPS DONE",
      steps: [
        { t: "Upload photo", d: "AI learns your face in seconds" },
        { t: "Generate free", d: "Your first cinematic scene — no card needed" },
        { t: "Download & share", d: "Ready in under 5 minutes" },
      ],
    },
    testi: {
      eyebrow: "What they say", h2: "THEY ALREADY USE IT",
      items: [
        { name: "Carlos M.", role: "Creator, Guatemala", text: '"Matrix-style fight video in 2 minutes. People thought it was real production."' },
        { name: "Sofía R.", role: "Influencer, Mexico", text: '"Photoshoot tripled my engagement. Messages came the same day I posted."' },
        { name: "Equipo Nova", role: "Agency, Colombia", text: '"What took days now takes minutes. Changes everything about the business."' },
      ],
    },
    pricing: {
      eyebrow: "No subscription", h2: "PAY WHAT YOU USE",
      p: "Buy Jades and generate anytime. No monthly fee. 1 Jade ≈ $0.10 USD.",
      images: "images", photoSessions: "Photo sessions", neverExpire: "Never expire", buy: "Buy",
    },
    finalCta: {
      eyebrow: "Start today", h2: "YOUR FIRST SCENE\nIN UNDER 3 MIN",
      p: "No credit card. 1 free video on signup.", cta: "🎁 Generate my free video",
    },
    footer: {
      tagline: "AI visual platform",
      cols: [
        { title: "Platform", links: [{ l: "Create account", k: "auth" }, { l: "Pricing", k: "planes" }, { l: "About us", k: "about" }] },
        { title: "Support", links: [{ l: "Contact", k: "contact" }, { l: "contacto@isabelaos.com", k: null }] },
        { title: "Legal", links: [{ l: "Terms", href: "/terms" }, { l: "Refunds", href: "/refund" }, { l: "Privacy", href: "/privacy" }] },
      ],
      rights: "All rights reserved", madeWith: "Made with AI · GPU Power · Cobán GT",
    },
  },
};

export default function LandingView({
  user, jades, onOpenAuth, onStartDemo, onOpenContact,
  onOpenAbout, onSignOut, onBuyJades, lang, setLang,
  activeModule, setActiveModule, children,
  onOpenAdmin,
}) {
  const isEs = lang === "es";
  const t = STRINGS[isEs ? "es" : "en"];
  const [scrolled, setScrolled] = useState(false);
  const [demoText, setDemoText] = useState("");
  const [heroIdea, setHeroIdea] = useState("");
  const [magicLoading, setMagicLoading] = useState(false);
  const [magicPrompts, setMagicPrompts] = useState(null);
  const [magicError,   setMagicError]   = useState(null);
  const [copiedIdx,    setCopiedIdx]    = useState(null);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  const go = useCallback((key) => {
    setActiveModule(key);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [setActiveModule]);

  const handleQuickGenerate = async (ideaOverride) => {
    if (!user) { onOpenAuth(); return; }
    const idea = (ideaOverride ?? heroIdea).trim();
    if (!idea || idea.length < 3) {
      setMagicError(t.quickgen.missingIdea);
      return;
    }
    if (ideaOverride) setHeroIdea(ideaOverride);
    setMagicLoading(true);
    setMagicError(null);
    setMagicPrompts(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/cineai/magic-prompt", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ idea }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || t.quickgen.errorPrompts);
      setMagicPrompts(data.prompts || []);
    } catch (e) {
      setMagicError(e.message || t.quickgen.errorPrompts);
    } finally {
      setMagicLoading(false);
    }
  };

  const MODS = [
    { key: "templates",  icon: "🎬", ...t.mods.items.templates,  color: "#ff5a00", badge: "🎁 FREE+", vid: "/gallery/free-template-1.mp4" },
    { key: "cineai",     icon: "🎬", ...t.mods.items.cineai,     color: "#ff5a00", badge: "🔥 NUEVO", vid: "/gallery/cineai-fight.mp4" },
    { key: "photoshoot", icon: "📸", ...t.mods.items.photoshoot, color: "#f59e0b", badge: "📸",        vid: "/gallery/comercial-product.mp4" },
    { key: "avatars",    icon: "👤", ...t.mods.items.avatars,    color: "#a855f7", badge: "👤",        vid: "/gallery/avatar-demo.mp4" },
    { key: "comercial",  icon: "🎙️", ...t.mods.items.comercial, color: "#10b981", badge: "🎙️",       vid: "/gallery/comercial-chef.mp4" },
    { key: "montaje",    icon: "✨", ...t.mods.items.montaje,    color: "#f43f5e", badge: "✨",        vid: "/gallery/montaje-demo.mp4" },
    { key: "generator",  icon: "🖼️", ...t.mods.items.generator, color: "#06b6d4", badge: "🖼️",       vid: null },
    { key: "img2video",  icon: "🎥", ...t.mods.items.img2video,  color: "#8b5cf6", badge: "🚧 SOON",    vid: null, comingSoon: true },
    { key: "library",    icon: "📂", ...t.mods.items.library,    color: "#64748b", badge: "📂",        vid: null },
  ];

  const HERO_TEMPLATES = [
    { id: "free-1",          type: "free", label: t.heroTemplates["free-1"],          video: "/gallery/free-template-1.mp4" },
    { id: "free-2",          type: "free", label: t.heroTemplates["free-2"],          video: "/gallery/free-template-2.mp4" },
    { id: "free-3",          type: "free", label: t.heroTemplates["free-3"],          video: "/gallery/free-template-3.mp4" },
    { id: "divineLight",     type: "epic", label: t.heroTemplates.divineLight,     video: "/gallery/divine-light.mp4" },
    { id: "coupleDisaster",  type: "epic", label: t.heroTemplates.coupleDisaster,  video: "/gallery/couple-disaster.mp4" },
    { id: "luchaTitanes",    type: "epic", label: t.heroTemplates.luchaTitanes,    video: "/gallery/lucha-titanes.mp4" },
    { id: "victoriasSecret", type: "epic", label: t.heroTemplates.victoriasSecret, video: "/gallery/victorias-secret.mp4" },
  ];

  const GAL = [
    { src: "/gallery/hero-bg.mp4",           ...t.gallery.items.heroBg,         wide: true },
    { src: "/gallery/cineai-fight.mp4",      ...t.gallery.items.cineaiFight },
    { src: "/gallery/cineai-drama.mp4",      ...t.gallery.items.cineaiDrama },
    { src: "/gallery/cineai-rain.mp4",       ...t.gallery.items.cineaiRain },
    { src: "/gallery/comercial-chef.mp4",    ...t.gallery.items.comercialChef },
    { src: "/gallery/comercial-product.mp4", ...t.gallery.items.comercialProduct },
    { src: "/gallery/tiktok-trend.mp4",      ...t.gallery.items.tiktokTrend },
    { src: "/gallery/cineai-dance.mp4",      ...t.gallery.items.cineaiDance },
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
    .lo-shimmer{background:linear-gradient(90deg,#ff5a00 0%,#ffb300 35%,#fff 50%,#ffb300 65%,#ff5a00 100%);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:shine 3s linear infinite;filter:drop-shadow(0 0 20px rgba(255,90,0,.3));}
    .lo-epic-grid{display:grid;grid-auto-flow:column;grid-auto-columns:220px;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;padding-bottom:6px;}
    .lo-epic-card{position:relative;overflow:hidden;border-radius:14px;aspect-ratio:9/16;scroll-snap-align:start;flex-shrink:0;}
    .lo-epic-video{width:100%;height:100%;object-fit:cover;display:block;}
    @media(max-width:900px){
      .lo-hero-h1{font-size:clamp(36px,9vw,60px)!important;}
      .lo-seedbar-text{font-size:10px!important;letter-spacing:1px!important;gap:6px!important;}
      .lo-gal-grid{grid-template-columns:1fr 1fr!important;}
      .lo-gal-wide{grid-column:span 2!important;aspect-ratio:16/9!important;}
      .lo-mod-grid-css{grid-template-columns:1fr!important;}
      .lo-how-grid{grid-template-columns:1fr!important;gap:8px!important;background:none!important;}
      .lo-testi-grid{grid-template-columns:1fr!important;}
      .lo-price-grid{grid-template-columns:1fr 1fr!important;}
      .lo-footer-grid{grid-template-columns:1fr 1fr!important;}
      .lo-final-box{margin:0 16px 60px!important;padding:48px 24px!important;}
      .lo-musical-grid{grid-template-columns:1fr!important;}
      .lo-epic-grid{grid-auto-columns:58vw!important;}
      .lo-quickgen-row{flex-direction:column!important;}
    }
    @media(max-width:600px){
      .lo-price-grid{grid-template-columns:1fr!important;}
      .lo-demo-grid{grid-template-columns:1fr 1fr!important;}
      .lo-nav-links-desktop{display:none!important;}
    }
  `;

  const V = { fire:"#ff5a00",gold:"#ffb300",bg:"#080a0e",bg2:"#0d1017",border:"rgba(255,90,0,0.12)",border2:"rgba(255,255,255,0.07)",text:"#f0ece4",muted:"rgba(240,236,228,0.45)",ffD:"'Bebas Neue',sans-serif",ffB:"'DM Sans',sans-serif",ffU:"'Space Grotesk',sans-serif" };
  const s = { btn:(hot)=>({width:"100%",borderRadius:11,fontSize:13,fontWeight:700,padding:"11px",cursor:"pointer",transition:"all .2s",marginTop:14,fontFamily:V.ffU,...(hot?{background:`linear-gradient(135deg,${V.fire},${V.gold})`,border:"none",color:"#000",boxShadow:`0 0 24px rgba(255,90,0,.3)`}:{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.12)",color:"#fff"})}) };

  return (
    <div style={{ fontFamily: V.ffB, background: V.bg, color: V.text, overflowX: "hidden", minHeight: "100vh" }}>
      <style>{CSS}</style>

      {activeModule && children && (
        <ModOverlay title={activeModule} onClose={() => setActiveModule(null)} isEs={isEs}>
          {children}
        </ModOverlay>
      )}

      {/* BARRA SEEDANCE */}
      <div onClick={() => user ? go("cineai") : onOpenAuth()} style={{ position:"fixed",top:0,left:0,right:0,zIndex:300,height:36,display:"flex",alignItems:"center",justifyContent:"center",background:"linear-gradient(90deg,#1a0800,#2e1300,#1a0800)",borderBottom:"1px solid rgba(255,90,0,.3)",cursor:"pointer",overflow:"hidden" }}>
        <div style={{ position:"absolute",top:0,width:"40%",height:"100%",background:"linear-gradient(90deg,transparent,rgba(255,179,0,.15),transparent)",animation:"seedSlide 3s infinite",left:"-100%" }} />
        <div className="lo-seedbar-text" style={{ fontFamily:V.ffU,fontSize:12,fontWeight:700,letterSpacing:2,color:V.gold,textTransform:"uppercase",display:"flex",alignItems:"center",gap:10,zIndex:1 }}>
          <span style={{ width:6,height:6,borderRadius:"50%",background:V.fire,animation:"blink 1.5s infinite" }} />
          <span style={{ background:"rgba(255,90,0,.2)",border:"1px solid rgba(255,90,0,.4)",borderRadius:4,padding:"2px 8px",fontSize:10,color:V.fire }}>NUEVO</span>
          {t.seedbar}
          <span style={{ background:"rgba(255,90,0,.2)",border:"1px solid rgba(255,90,0,.4)",borderRadius:4,padding:"2px 8px",fontSize:10,color:V.fire }}>→</span>
        </div>
      </div>

      {/* NAV — simplificado: logo, módulos, Jades, login */}
      <nav style={{ position:"fixed",top:36,left:0,right:0,zIndex:200,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 16px",height:60,transition:"all .3s",...(scrolled?{background:"rgba(8,10,14,.94)",backdropFilter:"blur(20px)",borderBottom:"1px solid rgba(255,255,255,.07)"}:{}) }}>
        <div style={{ display:"flex",alignItems:"center",gap:10,cursor:"pointer",flexShrink:0 }} onClick={() => scrollTo("hero")}>
          <div style={{ width:36,height:36,borderRadius:9,overflow:"hidden",background:`linear-gradient(135deg,${V.fire},${V.gold})`,display:"grid",placeItems:"center",position:"relative",boxShadow:`0 0 20px rgba(255,90,0,.4)`,flexShrink:0 }}>
            <video src="/gallery/logo.mp4" autoPlay muted loop playsInline style={{ position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover" }} onError={e=>e.target.style.display="none"} />
            <span style={{ fontFamily:V.ffU,fontSize:13,fontWeight:700,color:"#000",position:"relative",zIndex:1 }}>io</span>
          </div>
          <div className="lo-nav-links-desktop">
            <div style={{ fontFamily:V.ffU,fontSize:15,fontWeight:700,color:"#fff" }}>isabelaOs Studio</div>
            <div style={{ fontSize:10,color:V.muted,letterSpacing:1 }}>{t.nav.tagline}</div>
          </div>
        </div>

        <div style={{ display:"flex",alignItems:"center",gap:8 }}>
          <button onClick={() => setLang(isEs ? "en" : "es")} style={{ background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.12)",borderRadius:8,color:"#fff",fontFamily:V.ffU,fontSize:12,fontWeight:700,padding:"7px 10px",cursor:"pointer",flexShrink:0 }}>
            {isEs ? "ES" : "EN"}
          </button>
          {user
            ? <UserNavMenu user={user} jades={jades} modules={MODS} onSelectModule={go} onBuyJades={onBuyJades} onSignOut={onSignOut} onOpenAdmin={onOpenAdmin} t={t.nav} />
            : (
              <>
                <button onClick={onOpenAuth} style={{ background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.15)",borderRadius:10,color:"#fff",fontFamily:V.ffU,fontSize:13,fontWeight:700,padding:"9px 16px",cursor:"pointer",whiteSpace:"nowrap" }}>{t.nav.signIn}</button>
                <button onClick={onOpenAuth} style={{ background:`linear-gradient(135deg,${V.fire},${V.gold})`,border:"none",borderRadius:10,color:"#000",fontFamily:V.ffU,fontSize:13,fontWeight:700,padding:"9px 20px",cursor:"pointer",boxShadow:"0 0 24px rgba(255,90,0,.3)",whiteSpace:"nowrap" }}>{t.nav.signUp}</button>
              </>
            )
          }
        </div>
      </nav>

      {/* HERO — 4 plantillas épicas en video, full screen */}
      <section id="hero" style={{ position: "relative", paddingTop: 104, paddingBottom: 28 }}>
        <div style={{ textAlign: "center", padding: "16px 20px 18px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,90,0,.1)", border: "1px solid rgba(255,90,0,.3)", borderRadius: 100, padding: "6px 16px", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: V.fire, fontWeight: 700, marginBottom: 14 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: V.fire, animation: "blink 1.5s infinite" }} />
            {t.hero.freeBadge}
          </div>
          <h1 className="lo-hero-h1" style={{ fontFamily: V.ffD, fontSize: "clamp(34px,6vw,64px)", letterSpacing: 2, lineHeight: 0.95, color: "#fff" }}>
            {t.hero.h1a}<span className="lo-shimmer">{t.hero.h1b}</span>
          </h1>
        </div>

        <div className="lo-epic-grid" style={{ padding: "0 3px 3px" }}>
          {HERO_TEMPLATES.map(tpl => (
            <div key={tpl.id} className="lo-epic-card">
              <video src={tpl.video} autoPlay muted loop playsInline className="lo-epic-video" />
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top,rgba(8,10,14,.92) 0%,rgba(8,10,14,.1) 45%,rgba(8,10,14,.5) 100%)" }} />
              <div style={{ position: "absolute", top: 10, left: 10, background: tpl.type === "free" ? V.fire : "#C8A96E", color: "#000", fontSize: 10, fontWeight: 800, borderRadius: 6, padding: "3px 8px", letterSpacing: 1 }}>
                {tpl.type === "free" ? "FREE" : "ÉPICO"}
              </div>
              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "18px 18px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontFamily: V.ffU, fontSize: 15, fontWeight: 800, color: "#fff", textShadow: "0 2px 10px rgba(0,0,0,.7)" }}>{tpl.label}</span>
                <button onClick={() => user ? go("templates") : onStartDemo()} style={{ background: `linear-gradient(135deg,${V.fire},${V.gold})`, border: "none", borderRadius: 10, color: "#000", fontFamily: V.ffU, fontSize: 12, fontWeight: 800, padding: "9px 16px", cursor: "pointer", whiteSpace: "nowrap", boxShadow: "0 0 20px rgba(255,90,0,.35)" }}>
                  {tpl.type === "free" ? t.hero.tryFree : t.hero.createFace}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* SOCIAL PROOF COMPACTO */}
      <div style={{ borderTop: `1px solid ${V.border2}`, borderBottom: `1px solid ${V.border2}`, background: V.bg2, padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "center", gap: 28, flexWrap: "wrap" }}>
        {[
          { icon: "👁️", t: "2.1M", l: t.social.views },
          { icon: "🇬🇹", t: t.social.country, l: t.social.madeIn },
          { icon: "⚡", t: "Seedance 2.0", l: t.social.engine },
        ].map((it, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>{it.icon}</span>
            <span style={{ fontFamily: V.ffU, fontSize: 14, fontWeight: 800, color: "#fff" }}>{it.t}</span>
            <span style={{ fontSize: 11, color: V.muted }}>{it.l}</span>
          </div>
        ))}
      </div>

      {/* MAGIC PROMPT GENERATOR — simplificado, visible sin scroll profundo */}
      <section style={{ padding: "40px 24px", maxWidth: 760, margin: "0 auto", textAlign: "center" }}>
        <span style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: V.fire, fontWeight: 700, marginBottom: 8, display: "block" }}>
          {t.quickgen.eyebrow}
        </span>
        <h2 style={{ fontFamily: V.ffD, fontSize: "clamp(20px,3vw,28px)", letterSpacing: 1.5, color: "#fff", marginBottom: 10, lineHeight: 1.1 }}>
          {t.quickgen.h2}
        </h2>
        <p style={{ fontSize: 14, color: V.muted, marginBottom: 22, lineHeight: 1.6 }}>
          {t.quickgen.sub}
        </p>
        <div className="lo-quickgen-row" style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <input
            value={heroIdea}
            onChange={e => setHeroIdea(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleQuickGenerate(); }}
            placeholder={t.quickgen.placeholder}
            disabled={magicLoading}
            style={{ flex: 1, background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, color: "#fff", padding: "14px 18px", fontSize: 14, outline: "none", fontFamily: V.ffB }}
          />
          <button onClick={() => handleQuickGenerate()} disabled={magicLoading} style={{ background: `linear-gradient(135deg,${V.fire},${V.gold})`, border: "none", borderRadius: 12, color: "#000", fontFamily: V.ffU, fontSize: 14, fontWeight: 800, padding: "14px 26px", cursor: magicLoading ? "not-allowed" : "pointer", whiteSpace: "nowrap", boxShadow: "0 0 24px rgba(255,90,0,.3)", opacity: magicLoading ? 0.7 : 1 }}>
            {magicLoading ? `⏳ ${t.quickgen.generating}` : `✨ ${t.quickgen.generate}`}
          </button>
        </div>

        {magicError && (
          <div style={{ background: "rgba(200,60,60,.08)", border: "1px solid rgba(200,60,60,.25)", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#ff8080", marginBottom: 14, textAlign: "left" }}>
            ⚠️ {magicError}
          </div>
        )}

        {magicPrompts && magicPrompts.length > 0 && (
          <div style={{ display: "grid", gap: 10, marginBottom: 16, textAlign: "left" }}>
            {magicPrompts.map((p, idx) => (
              <div key={p.style || idx} style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 14, padding: 16 }}>
                <div style={{ fontFamily: V.ffU, fontSize: 12, fontWeight: 800, letterSpacing: 1.5, color: V.gold, textTransform: "uppercase", marginBottom: 8 }}>{p.label || p.style}</div>
                <p style={{ fontSize: 13, color: "rgba(240,236,228,.75)", lineHeight: 1.6, marginBottom: 12 }}>{p.prompt}</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => { navigator.clipboard?.writeText(p.prompt); setCopiedIdx(idx); setTimeout(() => setCopiedIdx(c => c === idx ? null : c), 2000); }}
                    style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8, color: "#fff", fontSize: 12, padding: "8px 14px", cursor: "pointer", fontFamily: V.ffB }}>
                    {copiedIdx === idx ? `✅ ${t.quickgen.copied}` : `📋 ${t.quickgen.copy}`}
                  </button>
                  <button onClick={() => go("cineai")}
                    style={{ background: `linear-gradient(135deg,${V.fire},${V.gold})`, border: "none", borderRadius: 8, color: "#000", fontSize: 12, fontWeight: 700, padding: "8px 14px", cursor: "pointer", fontFamily: V.ffU }}>
                    🎬 {t.quickgen.generateVideo}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

      </section>

      {/* PLANTILLAS ÉPICAS */}
      <section style={{ padding: "60px 32px 0", maxWidth: 1280, margin: "0 auto" }}>
        <div onClick={() => user ? go("templates") : onOpenAuth()} style={{ background: "linear-gradient(135deg,rgba(200,169,110,0.08),rgba(200,169,110,0.03))", border: "1px solid rgba(200,169,110,0.25)", borderRadius: 20, padding: "32px 36px", cursor: "pointer", transition: "all .3s", display: "flex", alignItems: "center", gap: 32, overflow: "hidden", position: "relative" }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(200,169,110,0.5)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(200,169,110,0.25)"; e.currentTarget.style.transform = "none"; }}>
          <div style={{ position: "absolute", right: -40, top: -40, width: 200, height: 200, borderRadius: "50%", background: "rgba(200,169,110,0.05)", filter: "blur(40px)", pointerEvents: "none" }} />
          <div style={{ fontSize: 48, flexShrink: 0 }}>⚡</div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <div style={{ fontFamily: V.ffU, fontSize: 20, fontWeight: 800, color: "#fff" }}>{t.epicBanner.title}</div>
              <div style={{ background: "#C8A96E", color: "#000", fontSize: 10, fontWeight: 800, letterSpacing: 1, borderRadius: 5, padding: "3px 8px", textTransform: "uppercase" }}>{t.epicBanner.badge}</div>
            </div>
            <div style={{ fontSize: 14, color: "rgba(240,236,228,0.6)", lineHeight: 1.6 }}>
              {t.epicBanner.desc}
            </div>
          </div>
          <div style={{ background: "#C8A96E", color: "#000", borderRadius: 12, padding: "12px 24px", fontFamily: V.ffU, fontWeight: 800, fontSize: 14, whiteSpace: "nowrap", flexShrink: 0 }}>
            {t.epicBanner.cta}
          </div>
        </div>
      </section>

      {/* VIDEO MUSICAL */}
      <section style={{ padding: "80px 32px", maxWidth: 1280, margin: "0 auto" }}>
        <span style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: "#ff5a00", fontWeight: 700, marginBottom: 8, display: "block" }}>{t.musical.eyebrow}</span>
        <h2 style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: "clamp(36px,5.5vw,70px)", lineHeight: 0.95, letterSpacing: 2, color: "#fff", marginBottom: 8 }}>{t.musical.h2}</h2>
        <p style={{ fontSize: 16, color: "rgba(240,236,228,.45)", lineHeight: 1.7, maxWidth: 600, marginBottom: 40 }}>{t.musical.p}</p>
        <div className="lo-musical-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "center" }}>
          <div style={{ position: "relative", borderRadius: 20, overflow: "hidden", border: "1px solid rgba(255,90,0,.2)", boxShadow: "0 0 60px rgba(255,90,0,.1),0 40px 80px rgba(0,0,0,.5)", aspectRatio: "9/16", maxHeight: 600 }}>
            <video src="/gallery/massiel-clip.mp4" autoPlay muted loop playsInline controls style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <div style={{ position: "absolute", top: 16, left: 16, background: "rgba(255,90,0,.9)", borderRadius: 8, padding: "4px 12px", fontSize: 11, fontWeight: 700, color: "#000", letterSpacing: 1, textTransform: "uppercase" }}>{t.musical.badge}</div>
          </div>
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,90,0,.1)", border: "1px solid rgba(255,90,0,.3)", borderRadius: 100, padding: "6px 16px", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#ff5a00", fontWeight: 700, marginBottom: 20 }}>{t.musical.tag}</div>
            <h3 style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: "clamp(28px,4vw,52px)", lineHeight: 0.95, letterSpacing: 2, color: "#fff", marginBottom: 12 }}>{t.musical.h3a}<br /><span style={{ background: "linear-gradient(135deg,#ff5a00,#ffb300)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>{t.musical.h3b}</span></h3>
            <p style={{ fontSize: 15, color: "rgba(240,236,228,.7)", lineHeight: 1.7, marginBottom: 24 }}>{t.musical.p2}</p>
            {["🎬", "💃", "🎵", "📱"].map((icon, i) => (
              <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 14, padding: "12px 14px", background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)", borderRadius: 12 }}>
                <span style={{ fontSize: 22, flexShrink: 0 }}>{icon}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", fontFamily: "'Space Grotesk',sans-serif" }}>{t.musical.features[i].label}</div>
                  <div style={{ fontSize: 11, color: "#ff5a00", marginTop: 2, letterSpacing: 0.5 }}>{t.musical.features[i].sub}</div>
                </div>
              </div>
            ))}
            <button onClick={onStartDemo} style={{ marginTop: 8, background: "linear-gradient(135deg,#ff5a00,#ffb300)", border: "none", borderRadius: 14, color: "#000", fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 800, padding: "14px 32px", cursor: "pointer", boxShadow: "0 0 40px rgba(255,90,0,.3)" }}>{t.musical.cta}</button>
          </div>
        </div>
      </section>

      {/* GALERÍA */}
      <section style={{ padding: "80px 32px", maxWidth: 1280, margin: "0 auto" }} id="galeria">
        <span style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: V.fire, fontWeight: 700, marginBottom: 8, display: "block" }}>{t.gallery.eyebrow}</span>
        <h2 style={{ fontFamily: V.ffD, fontSize: "clamp(36px,5.5vw,70px)", lineHeight: 0.95, letterSpacing: 2, color: "#fff", marginBottom: 12 }}>{t.gallery.h2}</h2>
        <p style={{ fontSize: 16, color: V.muted, lineHeight: 1.7, maxWidth: 600, marginBottom: 40 }}>{t.gallery.p}</p>
        <div className="lo-gal-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
          {GAL.map((v, i) => (
            <div key={i} onClick={() => user ? go("templates") : onStartDemo()} style={{ position: "relative", overflow: "hidden", borderRadius: 14, border: `1px solid ${V.border2}`, cursor: "pointer", aspectRatio: v.wide ? "16/9" : "9/16", gridColumn: v.wide ? "span 2" : "auto", transition: "transform .3s,border-color .3s" }}
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
        <span style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: V.fire, fontWeight: 700, marginBottom: 8, display: "block" }}>{t.mods.eyebrow}</span>
        <h2 style={{ fontFamily: V.ffD, fontSize: "clamp(36px,5.5vw,70px)", lineHeight: 0.95, letterSpacing: 2, color: "#fff", marginBottom: 40 }}>{t.mods.h2}</h2>
        <div className="lo-mod-grid-css" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
          {MODS.map(m => (
            <div key={m.key} onClick={() => !m.comingSoon && (user ? go(m.key) : onStartDemo())}
              style={{ border: `1px solid ${m.key === "templates" ? "rgba(255,90,0,.35)" : V.border2}`, borderRadius: 18, background: m.key === "templates" ? "rgba(255,90,0,.05)" : V.bg2, overflow: "hidden", cursor: m.comingSoon ? "default" : "pointer", transition: "all .3s", opacity: m.comingSoon ? 0.6 : 1, ...(m.key === "templates" ? { boxShadow: "0 0 40px rgba(255,90,0,.1)" } : {}) }}
              onMouseEnter={e => { if (!m.comingSoon) { e.currentTarget.style.borderColor = m.color; e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = "0 16px 50px rgba(0,0,0,.4)"; } }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = m.key === "templates" ? "rgba(255,90,0,.35)" : V.border2; e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = m.key === "templates" ? "0 0 40px rgba(255,90,0,.1)" : "none"; }}>
              {m.vid ? (
                <div style={{ height: 160, overflow: "hidden", position: "relative" }}>
                  <video src={m.vid} autoPlay muted loop playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <div style={{ position: "absolute", inset: 0, background: `linear-gradient(to bottom,transparent 40%,${m.key === "templates" ? "rgba(20,5,0,.9)" : V.bg2} 100%)` }} />
                  {m.key === "templates" && (
                    <div style={{ position: "absolute", top: 10, right: 10, background: V.fire, color: "#000", fontSize: 10, fontWeight: 800, borderRadius: 6, padding: "3px 8px", letterSpacing: 1 }}>{t.mods.free}</div>
                  )}
                </div>
              ) : (
                <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", background: `linear-gradient(135deg,rgba(255,90,0,.06),rgba(8,10,14,.5))` }}>
                  <span style={{ fontSize: 48, opacity: 0.35 }}>{m.icon}</span>
                </div>
              )}
              <div style={{ padding: "16px 18px 20px" }}>
                <span style={{ display: "inline-block", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", background: m.key === "templates" ? "rgba(255,90,0,.15)" : "rgba(255,255,255,.07)", border: `1px solid ${m.key === "templates" ? "rgba(255,90,0,.3)" : "rgba(255,255,255,.12)"}`, borderRadius: 5, padding: "2px 7px", color: m.key === "templates" ? V.fire : "rgba(240,236,228,.5)", marginBottom: 7 }}>{m.badge}</span>
                <div style={{ fontFamily: V.ffU, fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 5 }}>{m.label}</div>
                <div style={{ fontSize: 12, color: V.muted, lineHeight: 1.6 }}>{m.desc}</div>
                <div style={{ marginTop: 12, fontSize: 12, fontWeight: 700, color: m.color, letterSpacing: 0.5 }}>{t.mods.seeModule}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section style={{ padding: "0 32px 80px", maxWidth: 1280, margin: "0 auto" }}>
        <span style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: V.fire, fontWeight: 700, marginBottom: 8, display: "block" }}>{t.how.eyebrow}</span>
        <h2 style={{ fontFamily: V.ffD, fontSize: "clamp(36px,5.5vw,70px)", lineHeight: 0.95, letterSpacing: 2, color: "#fff", marginBottom: 40 }}>{t.how.h2}</h2>
        <div className="lo-how-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 2, background: V.border2, borderRadius: 18, overflow: "hidden" }}>
          {[
            { n: "01", icon: "📸" },
            { n: "02", icon: "🎁" },
            { n: "03", icon: "🎬" },
          ].map((s, i) => (
            <div key={i} style={{ background: V.bg2, padding: "36px 28px", position: "relative", overflow: "hidden" }}>
              <div style={{ fontFamily: V.ffD, fontSize: 80, letterSpacing: 3, color: "rgba(255,90,0,.05)", position: "absolute", right: 16, top: 12, lineHeight: 1 }}>{s.n}</div>
              <div style={{ fontSize: 11, letterSpacing: 3, color: V.fire, fontWeight: 700, textTransform: "uppercase", marginBottom: 12 }}>{s.n}</div>
              <span style={{ fontSize: 34, display: "block", marginBottom: 12 }}>{s.icon}</span>
              <div style={{ fontFamily: V.ffU, fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 7 }}>{t.how.steps[i].t}</div>
              <p style={{ fontSize: 13, color: V.muted, lineHeight: 1.7 }}>{t.how.steps[i].d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* TESTIMONIOS */}
      <section style={{ padding: "0 32px 80px", maxWidth: 1280, margin: "0 auto" }}>
        <span style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: V.fire, fontWeight: 700, marginBottom: 8, display: "block" }}>{t.testi.eyebrow}</span>
        <h2 style={{ fontFamily: V.ffD, fontSize: "clamp(36px,5.5vw,70px)", lineHeight: 0.95, letterSpacing: 2, color: "#fff", marginBottom: 40 }}>{t.testi.h2}</h2>
        <div className="lo-testi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
          {t.testi.items.map((ti, i) => (
            <div key={i} style={{ background: V.bg2, border: `1px solid ${V.border2}`, borderRadius: 18, padding: 24, transition: "all .3s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(255,90,0,.2)"; e.currentTarget.style.transform = "translateY(-3px)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = V.border2; e.currentTarget.style.transform = "none"; }}>
              <div style={{ display: "flex", gap: 3, marginBottom: 12 }}>{Array(5).fill(0).map((_, j) => <span key={j} style={{ color: V.gold, fontSize: 14 }}>★</span>)}</div>
              <p style={{ fontSize: 14, color: "rgba(240,236,228,.8)", lineHeight: 1.7, fontStyle: "italic", marginBottom: 16 }}>{ti.text}</p>
              <div style={{ height: 1, background: V.border2, marginBottom: 13 }} />
              <div style={{ fontFamily: V.ffU, fontSize: 14, fontWeight: 700, color: "#fff" }}>{ti.name}</div>
              <div style={{ fontSize: 12, color: V.muted, marginTop: 2 }}>{ti.role}</div>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section style={{ padding: "0 32px 80px", maxWidth: 1280, margin: "0 auto" }} id="planes">
        <span style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: V.fire, fontWeight: 700, marginBottom: 8, display: "block" }}>{t.pricing.eyebrow}</span>
        <h2 style={{ fontFamily: V.ffD, fontSize: "clamp(36px,5.5vw,70px)", lineHeight: 0.95, letterSpacing: 2, color: "#fff", marginBottom: 12 }}>{t.pricing.h2}</h2>
        <p style={{ fontSize: 16, color: V.muted, lineHeight: 1.7, maxWidth: 600, marginBottom: 40 }}>{t.pricing.p}</p>
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
                {[`${p.jades} ${t.pricing.images}`,`${Math.floor(p.jades/(COSTS?.vid_express_8s||40))} videos CineAI`,`${Math.floor(p.jades/20)} ${t.pricing.photoSessions}`,t.pricing.neverExpire].map((f,i)=>(
                  <div key={i} style={{ display:"flex",gap:7,fontSize:12,color:"rgba(240,236,228,.7)",marginBottom:7,alignItems:"center" }}><span style={{ color:V.fire,fontSize:11,flexShrink:0 }}>✓</span>{f}</div>
                ))}
                <button onClick={user ? onBuyJades : onOpenAuth} style={s.btn(hot)}>{t.pricing.buy} {p.label}</button>
              </div>
            );
          })}
        </div>
      </section>

      {/* FINAL CTA */}
      <div className="lo-final-box" style={{ margin: "0 32px 80px", borderRadius: 26, padding: "80px 60px", textAlign: "center", position: "relative", overflow: "hidden", background: "linear-gradient(135deg,rgba(255,90,0,.07),rgba(255,179,0,.04))", border: "1px solid rgba(255,90,0,.15)" }}>
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at center,rgba(255,90,0,.06),transparent 70%)", pointerEvents: "none" }} />
        <div style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: V.fire, fontWeight: 700, marginBottom: 12 }}>{t.finalCta.eyebrow}</div>
        <h2 style={{ fontFamily: V.ffD, fontSize: "clamp(36px,6vw,70px)", color: "#fff", letterSpacing: 2, lineHeight: 0.95, marginBottom: 12, whiteSpace: "pre-line" }}>{t.finalCta.h2}</h2>
        <p style={{ fontSize: 16, color: V.muted, maxWidth: 460, margin: "0 auto 28px", lineHeight: 1.7 }}>{t.finalCta.p}</p>
        <button onClick={user ? () => go("templates") : onStartDemo} style={{ display: "inline-block", background: `linear-gradient(135deg,${V.fire},${V.gold})`, border: "none", borderRadius: 15, color: "#000", fontFamily: V.ffU, fontSize: 18, fontWeight: 800, padding: "20px 50px", cursor: "pointer", boxShadow: `0 0 70px rgba(255,90,0,.4),0 8px 30px rgba(0,0,0,.4)`, transition: "all .25s" }}>
          {t.finalCta.cta}
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
                <div style={{ fontSize: 10, color: V.muted }}>{t.footer.tagline}</div>
              </div>
            </div>
            <p style={{ fontSize: 12, color: V.muted, lineHeight: 1.7 }}>Stalling Technologic · Cobán, Alta Verapaz, Guatemala 🇬🇹</p>
          </div>
          {t.footer.cols.map((col,i)=>(
            <div key={i}>
              <div style={{ fontSize:10,letterSpacing:3,textTransform:"uppercase",color:"rgba(255,255,255,.35)",marginBottom:12 }}>{col.title}</div>
              {col.links.map((lnk,j)=>{
                const fn = lnk.k === "auth" ? onOpenAuth : lnk.k === "planes" ? () => scrollTo("planes") : lnk.k === "about" ? onOpenAbout : lnk.k === "contact" ? onOpenContact : null;
                return lnk.href
                  ?<a key={j} href={lnk.href} target="_blank" style={{ display:"block",fontSize:12,color:V.muted,marginBottom:9,textDecoration:"none",transition:"color .2s" }} onMouseEnter={e=>e.target.style.color="#fff"} onMouseLeave={e=>e.target.style.color=V.muted}>{lnk.l}</a>
                  :<button key={j} onClick={fn} style={{ display:"block",fontSize:12,color:V.muted,marginBottom:9,background:"none",border:"none",cursor:fn?"pointer":"text",padding:0,fontFamily:V.ffB,transition:"color .2s" }} onMouseEnter={e=>fn&&(e.target.style.color="#fff")} onMouseLeave={e=>e.target.style.color=V.muted}>{lnk.l}</button>;
              })}
            </div>
          ))}
        </div>
        <div style={{ maxWidth: 1280, margin: "0 auto", borderTop: `1px solid ${V.border2}`, paddingTop: 18, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,.25)" }}>© 2025 IsabelaOS · {t.footer.rights}</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,.25)" }}>{t.footer.madeWith}</div>
        </div>
      </footer>
    </div>
  );
}
