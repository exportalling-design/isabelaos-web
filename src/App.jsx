// src/App.jsx — IsabelaOS Studio v7.3
// CAMBIOS v7.3:
//   - UnifiedTemplatesPanel reemplaza FreeTemplatePanel + TemplatesPanel
//   - WelcomeModal → dirige a templates (panel unificado)
import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth }               from "./context/AuthContext";
import { supabase }              from "./lib/supabaseClient";
import { JADE_PACKS, COSTS }     from "./lib/pricing";
import ContactView               from "./components/ContactView";
import { Img2VideoPanel }        from "./components/Img2VideoPanel";
import LibraryView               from "./components/LibraryView";
import AvatarStudioPanel         from "./components/AvatarStudioPanel";
import MontajeIAPanel            from "./components/MontajeIAPanel";
import CreatorPanel              from "./components/CreatorPanel";
import ComercialPanel            from "./components/ComercialPanel";
import ProductPhotoshoot         from "./components/ProductPhotoshoot";
import CineAIPanel               from "./components/CineAIPanel";
import UnifiedTemplatesPanel     from "./components/UnifiedTemplatesPanel";
import Terms                     from "./components/Terms";
import Refund                    from "./components/Refund";
import Privacy                   from "./components/Privacy";
import TermsAcceptanceModal      from "./components/TermsAcceptanceModal";
import LandingView               from "./components/LandingView";
import { BuyJadesModal }         from "./components/BuyJadesModal";
import AdminPanel                from "./components/AdminPanel";

const ADMIN_EMAIL = "exportalling@gmail.com";

async function getAuthHeaders() {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch { return {}; }
}

function AuthModal({ open, onClose }) {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();
  const [mode,    setMode]    = useState("login");
  const [email,   setEmail]   = useState("");
  const [pass,    setPass]    = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  if (!open) return null;
  const submit = async (e) => {
    e.preventDefault(); setError(""); setLoading(true);
    try {
      if (mode === "login") {
        await signInWithEmail(email, pass);
      } else {
        await signUpWithEmail(email, pass);
        // Canjear código promo si se ingresó
        if (promoCode.trim()) {
          try {
            const { supabase: sb } = await import("./lib/supabaseClient");
            const { data: { session } } = await sb.auth.getSession();
            const token = session?.access_token;
            if (token) {
              const r = await fetch("/api/redeem-promo", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
                body: JSON.stringify({ code: promoCode.trim() }),
              });
              const j = await r.json();
              if (j.ok) setPromoMsg("✅ " + j.jades + " Jades acreditados");
              else setPromoMsg("⚠️ " + (j.error || "Código no válido"));
            }
          } catch {}
        }
        alert("Cuenta creada. Revisa tu correo.");
      }
      onClose();
    } catch (err) { setError(err.message || String(err)); }
    finally { setLoading(false); }
  };
  const google = async () => {
    setError(""); setLoading(true);
    try { await signInWithGoogle(); onClose(); }
    catch (err) { setError(err.message || String(err)); setLoading(false); }
  };
  const inp = { width:"100%",background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:12,color:"#fff",padding:"10px 14px",fontSize:14,outline:"none",fontFamily:"'DM Sans',sans-serif" };
  return (
    <div style={{ position:"fixed",inset:0,zIndex:600,display:"grid",placeItems:"center",background:"rgba(0,0,0,.8)",backdropFilter:"blur(10px)",padding:16 }}>
      <div style={{ width:"100%",maxWidth:420,background:"#0d1017",border:"1px solid rgba(255,90,0,.2)",borderRadius:24,padding:28 }}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20 }}>
          <h3 style={{ color:"#fff",fontFamily:"'Space Grotesk',sans-serif",fontSize:18,fontWeight:700 }}>{mode==="login"?"Inicia sesión":"Crea tu cuenta"}</h3>
          <button onClick={onClose} style={{ background:"none",border:"1px solid rgba(255,255,255,.1)",borderRadius:8,color:"#666",padding:"4px 10px",cursor:"pointer" }}>✕</button>
        </div>
        <form onSubmit={submit} style={{ display:"flex",flexDirection:"column",gap:12 }}>
          <div>
            <label style={{ fontSize:12,color:"rgba(240,236,228,.6)",display:"block",marginBottom:4 }}>Correo</label>
            <input type="email" required value={email} onChange={e=>setEmail(e.target.value)} style={inp} />
          </div>
          <div>
            <label style={{ fontSize:12,color:"rgba(240,236,228,.6)",display:"block",marginBottom:4 }}>Contraseña</label>
            <input type="password" required value={pass} onChange={e=>setPass(e.target.value)} style={inp} />
          </div>
          {error && <p style={{ fontSize:12,color:"#f87171" }}>{error}</p>}
          {/* Campo código promo — solo en registro */}
          {mode === "register" && (
            <div>
              <label style={{ fontSize:12,color:"rgba(240,236,228,.6)",display:"block",marginBottom:4 }}>
                Promo code <span style={{ color:"rgba(240,236,228,.3)",fontWeight:400 }}>(optional)</span>
              </label>
              <input
                type="text"
                value={promoCode}
                onChange={e => setPromoCode(e.target.value.toUpperCase())}
                placeholder="ISABELAOS-CREATOR1"
                style={{ ...inp, letterSpacing:1 }}
              />
              {promoMsg && <p style={{ fontSize:11,color:promoMsg.startsWith("✅") ? "#4ade80" : "#fbbf24",marginTop:4 }}>{promoMsg}</p>}
            </div>
          )}
          <button type="submit" disabled={loading} style={{ background:"linear-gradient(135deg,#ff5a00,#ffb300)",border:"none",borderRadius:12,color:"#000",fontSize:15,fontWeight:700,padding:12,cursor:"pointer",opacity:loading?.6:1,fontFamily:"'Space Grotesk',sans-serif" }}>
            {loading?"Procesando...":mode==="login"?"Entrar":"Registrarme"}
          </button>
        </form>
        <button onClick={google} disabled={loading} style={{ marginTop:10,width:"100%",background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.12)",borderRadius:12,color:"#fff",fontSize:14,padding:12,cursor:"pointer",fontFamily:"'DM Sans',sans-serif" }}>
          Continuar con Google
        </button>
        <p style={{ marginTop:14,textAlign:"center",fontSize:12,color:"rgba(240,236,228,.5)" }}>
          {mode==="login"
            ? <><span>¿No tienes cuenta? </span><button type="button" onClick={()=>setMode("register")} style={{ background:"none",border:"none",color:"#ffb300",cursor:"pointer",textDecoration:"underline",fontSize:12 }}>Regístrate</button></>
            : <><span>¿Ya tienes cuenta? </span><button type="button" onClick={()=>setMode("login")} style={{ background:"none",border:"none",color:"#ffb300",cursor:"pointer",textDecoration:"underline",fontSize:12 }}>Inicia sesión</button></>
          }
        </p>
      </div>
    </div>
  );
}

// ── Modal bienvenida ──────────────────────────────────────────
function WelcomeModal({ lang, onGoFree, onGoImage, onClose }) {
  const isEn = lang === "en";
  return (
    <div style={{ position:"fixed",inset:0,zIndex:700,display:"grid",placeItems:"center",background:"rgba(0,0,0,.88)",backdropFilter:"blur(14px)",padding:16 }}>
      <div style={{ width:"100%",maxWidth:460,background:"linear-gradient(160deg,#0d1017,#0a0c10)",border:"1px solid rgba(255,90,0,.3)",borderRadius:24,padding:32,textAlign:"center",boxShadow:"0 0 80px rgba(255,90,0,.12)" }}>
        <div style={{ fontSize:52,marginBottom:12 }}>🎬</div>
        <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:22,fontWeight:800,color:"#fff",marginBottom:8 }}>
          {isEn ? "Welcome to IsabelaOS!" : "¡Bienvenido a IsabelaOS!"}
        </div>
        <div style={{ display:"inline-flex",alignItems:"center",gap:8,background:"rgba(255,90,0,.12)",border:"1px solid rgba(255,90,0,.35)",borderRadius:100,padding:"8px 20px",marginBottom:20 }}>
          <span style={{ fontSize:18 }}>🎁</span>
          <span style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:14,fontWeight:800,color:"#ff5a00" }}>
            {isEn ? "1 FREE VIDEO — No card needed" : "1 VIDEO GRATIS — Sin tarjeta"}
          </span>
        </div>
        <p style={{ fontSize:13,color:"rgba(240,236,228,.7)",lineHeight:1.7,marginBottom:24 }}>
          {isEn
            ? "Put your face in a cinematic AI scene for free. Upload your photo and generate your video in minutes."
            : "Ponté en una escena cinematográfica de IA gratis. Sube tu foto y genera tu video en minutos."}
        </p>
        <div style={{ display:"flex",flexDirection:"column",gap:10,marginBottom:16 }}>
          <button onClick={onGoFree} style={{ background:"linear-gradient(135deg,#ff5a00,#ffb300)",border:"none",borderRadius:12,color:"#000",fontFamily:"'Space Grotesk',sans-serif",fontSize:15,fontWeight:800,padding:"16px",cursor:"pointer" }}>
            🎬 {isEn ? "Generate my FREE video now" : "Generar mi video GRATIS ahora"}
          </button>
          <button onClick={onGoImage} style={{ background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:12,color:"rgba(240,236,228,.6)",fontFamily:"'Space Grotesk',sans-serif",fontSize:13,fontWeight:600,padding:"12px",cursor:"pointer" }}>
            🖼️ {isEn ? "Generate AI Images with 10 free Jades" : "Generar Imágenes IA con 10 Jades gratis"}
          </button>
        </div>
        <button onClick={onClose} style={{ background:"none",border:"none",color:"rgba(240,236,228,.3)",fontSize:12,cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif" }}>
          {isEn ? "Explore on my own" : "Explorar por mi cuenta"}
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const { user, signInWithGoogle, signOut } = useAuth();

  const [lang, setLangState] = useState(() => {
    try { return localStorage.getItem("isabelaos_lang") || "en"; } catch { return "en"; }
  });
  const setLang = (l) => { try { localStorage.setItem("isabelaos_lang", l); } catch {} setLangState(l); };

  const [authOpen,     setAuthOpen]     = useState(false);
  const [buyOpen,      setBuyOpen]      = useState(false);
  const [adminOpen,    setAdminOpen]    = useState(false);
  const [activeModule, setActiveModule] = useState(null);
  const [landingPage,  setLandingPage]  = useState("home");
  const [jades,        setJades]        = useState(0);
  const [showWelcome,  setShowWelcome]  = useState(false);
  const prevJades = useRef(0);

  const isAdmin = user?.email === ADMIN_EMAIL;

  // Rutas estáticas
  const path = window.location.pathname;
  if (path === "/terms")   return <Terms   lang={lang} />;
  if (path === "/refund")  return <Refund  lang={lang} />;
  if (path === "/privacy") return <Privacy lang={lang} />;

  const fetchJades = useCallback(async () => {
    if (!user?.id) return;
    try {
      const auth = await getAuthHeaders();
      const r = await fetch(`/api/user-status?user_id=${encodeURIComponent(user.id)}`, { headers: auth });
      const data = await r.json().catch(() => null);
      if (data?.ok) {
        const newJades = data.jades ?? 0;
        if (newJades === 10 && prevJades.current === 0) {
          const key = `isabelaos_welcome_${user.id}`;
          if (!localStorage.getItem(key)) {
            localStorage.setItem(key, "1");
            setShowWelcome(true);
          }
        }
        prevJades.current = newJades;
        setJades(newJades);
      }
    } catch {}
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    fetchJades();
    const t = setInterval(fetchJades, 15000);
    return () => clearInterval(t);
  }, [fetchJades]);

  const spendJades = async ({ amount, reason }) => {
    if (!user?.id) throw new Error("No user");
    const auth = await getAuthHeaders();
    const r = await fetch("/api/jades-spend", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ user_id: user.id, amount: Number(amount), reason: reason || "spend" }),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data?.ok) throw new Error(data?.error || "No se pudo descontar jades.");
    await fetchJades();
    return data;
  };

  const renderModule = () => {
    const us = { jades, loading: false, plan: null };
    switch (activeModule) {
      // Panel unificado — engloba gratis + épicas
      case "free-template":
      case "templates":
        return (
          <UnifiedTemplatesPanel
            lang={lang}
            userJades={jades}
            onJadesUpdate={fetchJades}
          />
        );
      case "generator":   return <CreatorPanel isDemo={false} />;
      case "img2video":   return <Img2VideoPanel userStatus={us} spendJades={spendJades} />;
      case "avatars":     return <AvatarStudioPanel userStatus={us} />;
      case "library":     return <LibraryView />;
      case "img2video":
        return (
          <div style={{ fontFamily:"'DM Sans',sans-serif", color:"#fff", padding:"60px 24px", textAlign:"center" }}>
            <div style={{ fontSize:56, marginBottom:16 }}>🚧</div>
            <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:22, fontWeight:800, marginBottom:10 }}>
              {lang === "es" ? "En construcción" : "Coming Soon"}
            </div>
            <div style={{ fontSize:14, color:"rgba(255,255,255,0.45)", lineHeight:1.7, maxWidth:360, margin:"0 auto" }}>
              {lang === "es"
                ? "Este módulo estará disponible muy pronto. Mientras tanto prueba nuestras plantillas de video o CineAI."
                : "This module will be available very soon. In the meantime try our video templates or CineAI."}
            </div>
          </div>
        );
      case "montaje":   return <MontajeIAPanel userStatus={us} />;
      case "comercial": return <ComercialPanel userStatus={us} />;
      case "photoshoot":  return <ProductPhotoshoot userJades={jades} onJadesDeducted={async(a)=>{ try{await spendJades({amount:a,reason:"product_photoshoot"});}catch{} }} />;
      case "cineai":      return <CineAIPanel />;
      default:            return null;
    }
  };

  if (landingPage === "contact") return <ContactView onBack={() => setLandingPage("home")} />;

  return (
    <>
      {isAdmin && adminOpen && <AdminPanel onClose={() => setAdminOpen(false)} />}

      {showWelcome && (
        <WelcomeModal
          lang={lang}
          onGoFree={() => { setShowWelcome(false); setActiveModule("templates"); }}
          onGoImage={() => { setShowWelcome(false); setActiveModule("generator"); }}
          onClose={() => setShowWelcome(false)}
        />
      )}

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
      <BuyJadesModal open={buyOpen} onClose={() => setBuyOpen(false)} userId={user?.id} onSuccess={fetchJades} />
      {user && <TermsAcceptanceModal user={user} lang={lang} onAccepted={() => {}} />}

      <LandingView
        user={user}
        jades={jades}
        lang={lang}
        setLang={setLang}
        activeModule={activeModule}
        setActiveModule={setActiveModule}
        onOpenAuth={() => setAuthOpen(true)}
        onStartDemo={() => user ? setActiveModule("templates") : setAuthOpen(true)}
        onOpenContact={() => setLandingPage("contact")}
        onOpenAbout={() => setLandingPage("about")}
        onSignOut={signOut}
        onBuyJades={() => setBuyOpen(true)}
        onOpenAdmin={isAdmin ? () => setAdminOpen(true) : null}
      >
        {activeModule && renderModule()}
      </LandingView>
    </>
  );
}
