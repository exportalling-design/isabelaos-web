// src/App.jsx
// ─────────────────────────────────────────────────────────────
// App principal de IsabelaOS Studio — v5
// CAMBIOS:
//   - TermsAcceptanceModal al primer login (guarda en Supabase)
//   - Botón 🌐 EN/ES en header (persiste en localStorage)
//   - Terms.jsx y Refund.jsx conectados en /terms y /refund
//   - Footer legal con links reales a términos y reembolsos
//   - LegalFooter reutilizable en landing y dashboard
// ─────────────────────────────────────────────────────────────
import { useEffect, useState, useRef } from "react";
import { useAuth }          from "./context/AuthContext";
import { supabase }         from "./lib/supabaseClient";
import { JADE_PACKS, COSTS } from "./lib/pricing";

import ContactView              from "./components/ContactView";
import { Img2VideoPanel }       from "./components/Img2VideoPanel";
import LibraryView              from "./components/LibraryView";
import AvatarStudioPanel        from "./components/AvatarStudioPanel";
import MontajeIAPanel           from "./components/MontajeIAPanel";
import CreatorPanel             from "./components/CreatorPanel";
import ComercialPanel           from "./components/ComercialPanel";
import ProductPhotoshoot        from "./components/ProductPhotoshoot";
import CineAIPanel              from "./components/CineAIPanel";
import Terms                    from "./components/Terms";
import Refund                   from "./components/Refund";
import TermsAcceptanceModal     from "./components/TermsAcceptanceModal";
import LandingView              from "./components/LandingView";

const DEMO_PROMPT_KEY = "isabela_demo_prompt_text2img";
function saveDemoPrompt(p) { try { localStorage.setItem(DEMO_PROMPT_KEY, String(p || "")); } catch {} }
function scrollToId(id) { document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }

async function getAuthHeadersGlobal() {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  } catch { return {}; }
}

// ══════════════════════════════════════════════════════════════
// FOOTER LEGAL — reutilizable en landing y dashboard
// ══════════════════════════════════════════════════════════════
function LegalFooter({ lang = "es", onOpenAuth, onOpenAbout, onOpenContact }) {
  const isEs = lang === "es";
  return (
    <footer className="border-t border-white/10 bg-black/40 mt-8">
      <div className="mx-auto max-w-7xl px-4 py-10">
        <div className="grid gap-8 md:grid-cols-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400 to-yellow-400 text-xs font-bold text-black">io</div>
              <div><div className="text-sm font-semibold text-white">isabelaOs Studio</div><div className="text-[10px] text-neutral-400">{isEs ? "Plataforma de modelos virtuales" : "Virtual models platform"}</div></div>
            </div>
            <p className="mt-4 text-xs text-neutral-400 max-w-xs leading-relaxed">Stalling Technologic · Cobán, Alta Verapaz, Guatemala.</p>
          </div>
          <div>
            <div className="text-xs font-semibold text-white uppercase tracking-wider mb-4">{isEs ? "Plataforma" : "Platform"}</div>
            <div className="space-y-2 text-xs text-neutral-400">
              {onOpenAuth && <div className="hover:text-white cursor-pointer transition-colors" onClick={onOpenAuth}>{isEs ? "Crear cuenta" : "Create account"}</div>}
              <div className="hover:text-white cursor-pointer transition-colors" onClick={() => scrollToId("planes")}>{isEs ? "Precios" : "Pricing"}</div>
              {onOpenAbout && <div className="hover:text-white cursor-pointer transition-colors" onClick={onOpenAbout}>{isEs ? "Sobre nosotros" : "About us"}</div>}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-white uppercase tracking-wider mb-4">{isEs ? "Soporte" : "Support"}</div>
            <div className="space-y-2 text-xs text-neutral-400">
              {onOpenContact && <div className="hover:text-white cursor-pointer transition-colors" onClick={onOpenContact}>{isEs ? "Contacto" : "Contact"}</div>}
              <div className="text-neutral-500">contacto@isabelaos.com</div>
            </div>
          </div>
          <div>
            {/* Legal — conectado a rutas reales */}
            <div className="text-xs font-semibold text-white uppercase tracking-wider mb-4">Legal</div>
            <div className="space-y-2 text-xs text-neutral-400">
              <a href="/terms"   target="_blank" rel="noopener noreferrer" className="block hover:text-white transition-colors">{isEs ? "Términos y Condiciones" : "Terms & Conditions"}</a>
              <a href="/refund"  target="_blank" rel="noopener noreferrer" className="block hover:text-white transition-colors">{isEs ? "Política de Reembolsos" : "Refund Policy"}</a>
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="block hover:text-white transition-colors">{isEs ? "Privacidad" : "Privacy"}</a>
            </div>
          </div>
        </div>
        <div className="mt-8 border-t border-white/10 pt-6 flex flex-wrap items-center justify-between gap-4">
          <div className="text-[11px] text-neutral-500">© 2025 IsabelaOS · {isEs ? "Todos los derechos reservados" : "All rights reserved"}</div>
          <div className="text-[11px] text-neutral-500">{isEs ? "Hecho con IA · GPU Power · Cobán GT" : "Made with AI · GPU Power · Cobán GT"}</div>
        </div>
        <div className="mt-2 text-center">
          <p className="text-[10px] text-neutral-700">
            {isEs ? "El uso de la plataforma implica aceptación de los Términos y Condiciones." : "Use of the platform implies acceptance of the Terms and Conditions."}
          </p>
        </div>
      </div>
    </footer>
  );
}

// ══════════════════════════════════════════════════════════════
// MODAL DE COMPRA DE JADES
// ══════════════════════════════════════════════════════════════
function BuyJadesModal({ open, onClose, userId, onSuccess }) {
  const [selectedPack, setSelectedPack] = useState("popular");
  const [step,  setStep]  = useState("form");
  const [cardError,   setCardError]   = useState("");
  const [cardSuccess, setCardSuccess] = useState("");
  const [setupData,   setSetupData]   = useState(null);
  const iframeRef = useRef(null);
  const formRef   = useRef(null);
  const [card, setCard] = useState({ cardHolderName:"", number:"", expirationDate:"", cvv:"", firstName:"", lastName:"", email:"", phone:"", line1:"7a Calle Pte. Bis, 511 y 531" });
  const upd = (k,v) => setCard(p=>({...p,[k]:v}));

  useEffect(()=>{
    if(step!=="iframe") return;
    const h = async(e)=>{ if(!["https://centinelapistag.cardinalcommerce.com","https://centinelapi.cardinalcommerce.com"].includes(e.origin))return; setStep("paying"); await callJadesPay(); };
    window.addEventListener("message",h); return ()=>window.removeEventListener("message",h);
  },[step,setupData]);
  useEffect(()=>{
    if(step!=="iframe"||!setupData) return;
    setTimeout(()=>{ try{formRef.current?.submit();}catch{setStep("paying");callJadesPay();} setTimeout(()=>{if(step==="iframe"){setStep("paying");callJadesPay();}},5000);},500);
  },[step,setupData]);

  if(!open) return null;
  const pack = JADE_PACKS[selectedPack];

  async function handlePay(e){
    e.preventDefault(); setCardError("");
    if(!card.number||!card.expirationDate||!card.cvv||!card.cardHolderName){setCardError("Completa los datos de tarjeta.");return;}
    if(!card.firstName||!card.lastName||!card.email){setCardError("Completa tu nombre y correo.");return;}
    setStep("loading");
    try{
      const auth=await getAuthHeadersGlobal();
      const r=await fetch("/api/jades-setup",{method:"POST",headers:{"Content-Type":"application/json",...auth},body:JSON.stringify({pack:selectedPack,card})});
      const j=await r.json().catch(()=>null);
      if(!r.ok||!j?.ok) throw new Error(j?.response_message||j?.error||"Error en setup.");
      setSetupData(j); setStep("iframe");
    }catch(err){setCardError(err?.message||"Error iniciando el pago.");setStep("form");}
  }

  async function callJadesPay(){
    try{
      const auth=await getAuthHeadersGlobal();
      const r=await fetch("/api/jades-pay",{method:"POST",headers:{"Content-Type":"application/json",...auth},body:JSON.stringify({pack:selectedPack,card,setupRequestId:setupData?.request_id,referenceId:setupData?.referenceId,deviceFingerprintID:setupData?.fingerprint||""})});
      const j=await r.json().catch(()=>null);
      if(!r.ok||!j?.ok){if(j?.challenge_required){setCardError("Tu banco requiere verificación adicional.");setStep("form");return;} throw new Error(j?.response_message||j?.error||"Error.");}
      setCardSuccess(`¡Listo! Se acreditaron ${j.jades_added} Jades.`); setStep("done");
      if(typeof onSuccess==="function") await onSuccess();
      setTimeout(()=>{setCardSuccess("");setStep("form");onClose();},2500);
    }catch(err){setCardError(err?.message||"Error procesando pago.");setStep("form");}
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end" onClick={onClose}>
      <div className="relative h-full w-full max-w-md overflow-y-auto border-l border-white/10 bg-[#06070B] p-6 shadow-2xl" onClick={e=>e.stopPropagation()}>
        {step==="iframe"&&setupData&&(<div style={{position:"absolute",width:0,height:0,overflow:"hidden"}}><iframe ref={iframeRef} name="collectionIframe" height="1" width="1" style={{display:"none"}}/><form ref={formRef} method="POST" target="collectionIframe" action={setupData.deviceDataCollectionUrl}><input type="hidden" name="JWT" value={setupData.accessToken}/></form></div>)}
        <div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold text-white">Comprar Jades</h2><p className="mt-1 text-xs text-neutral-400">1 Jade = $0.10 USD · Sin suscripción</p></div><button onClick={onClose} className="rounded-xl border border-white/15 px-3 py-1.5 text-xs text-neutral-400 hover:bg-white/10">✕</button></div>
        {(step==="loading"||step==="iframe"||step==="paying")&&(<div className="mt-10 text-center space-y-4"><div className="text-4xl animate-pulse">💳</div><p className="text-sm text-white font-semibold">{step==="loading"?"Iniciando pago seguro...":step==="iframe"?"Verificando dispositivo...":"Procesando pago..."}</p><p className="text-xs text-neutral-400">No cierres esta ventana</p><div className="flex justify-center gap-1 mt-4">{[0,1,2,3,4].map(i=>(<div key={i} className="h-2 w-2 rounded-full bg-cyan-400 animate-bounce" style={{animationDelay:`${i*0.15}s`}}/>))}</div></div>)}
        {step==="done"&&cardSuccess&&(<div className="mt-10 text-center space-y-4"><div className="text-5xl">✅</div><p className="text-sm text-emerald-300 font-semibold">{cardSuccess}</p></div>)}
        {step==="form"&&(<>
          <div className="mt-5 grid grid-cols-2 gap-3">{Object.entries(JADE_PACKS).map(([key,p])=>(<button key={key} type="button" onClick={()=>setSelectedPack(key)} className={`rounded-2xl border p-4 text-left transition ${selectedPack===key?"border-cyan-400 bg-cyan-500/10":"border-white/10 bg-black/40 hover:bg-black/50"}`}><div className="text-sm font-semibold text-white">{p.label}</div><div className="mt-1 text-xl font-bold text-cyan-300">{p.jades}J</div><div className="mt-1 text-xs text-neutral-400">${p.price_usd} USD</div></button>))}</div>
          <div className="mt-4 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-[11px] text-neutral-300"><div className="font-semibold text-white">Con {pack.jades} Jades:</div><div className="mt-2 space-y-1"><div>· <span className="font-semibold text-white">{pack.jades}</span> imágenes sin avatar</div><div>· <span className="font-semibold text-white">{Math.floor(pack.jades/2)}</span> imágenes con avatar</div><div>· <span className="font-semibold text-white">{Math.floor(pack.jades/COSTS.vid_express_8s)}</span> videos Express 8s</div><div>· <span className="font-semibold text-white">{Math.floor(pack.jades/40)}</span> videos CineAI 5s</div></div></div>
          <form onSubmit={handlePay} className="mt-5 space-y-3">
            <div className="text-xs font-semibold text-white">Pagar ${pack.price_usd} USD · Pack {pack.label}</div>
            {[{label:"Nombre en tarjeta",key:"cardHolderName",ph:"JOHN DOE"},{label:"Número de tarjeta",key:"number",ph:"4000000000002701"},{label:"Vencimiento (MM/YYYY)",key:"expirationDate",ph:"01/2030"},{label:"CVV",key:"cvv",ph:"123"},{label:"Nombre",key:"firstName",ph:"John"},{label:"Apellido",key:"lastName",ph:"Doe"},{label:"Correo",key:"email",ph:"tu@email.com"},{label:"Teléfono",key:"phone",ph:"2264-7032"},{label:"Dirección",key:"line1",ph:"7a Calle Pte. Bis, 511 y 531"}].map(({label,key,ph})=>(<div key={key}><label className="text-[11px] text-neutral-400">{label}</label><input type={key==="email"?"email":"text"} value={card[key]} onChange={e=>upd(key,e.target.value)} placeholder={ph} className="mt-1 w-full rounded-xl bg-black/60 px-3 py-2 text-xs text-white outline-none ring-1 ring-white/10 focus:ring-cyan-400"/></div>))}
            {cardError&&(<div className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{cardError}</div>)}
            <button type="submit" className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white hover:opacity-90 transition-all">Pagar ${pack.price_usd} · {pack.jades} Jades</button>
          </form>
        </>)}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MODAL DE AUTENTICACIÓN
// ══════════════════════════════════════════════════════════════
function AuthModal({ open, onClose }) {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();
  const [mode,setMode]=useState("login"); const [email,setEmail]=useState(""); const [password,setPassword]=useState(""); const [loading,setLoading]=useState(false); const [error,setError]=useState("");
  if(!open) return null;
  const handleSubmit=async(e)=>{e.preventDefault();setError("");setLoading(true);try{if(mode==="login")await signInWithEmail(email,password);else{await signUpWithEmail(email,password);alert("Cuenta creada. Revisa tu correo.");}onClose();}catch(err){setError(err.message||String(err));}finally{setLoading(false);}};
  const handleGoogle=async()=>{setError("");setLoading(true);try{await signInWithGoogle();onClose();}catch(err){setError(err.message||String(err));setLoading(false);}};
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-black/90 p-6">
        <div className="flex items-center justify-between"><h3 className="text-lg font-semibold text-white">{mode==="login"?"Inicia sesión":"Crea tu cuenta"}</h3><button onClick={onClose} className="rounded-lg px-3 py-1 text-neutral-400 hover:bg-white/10">✕</button></div>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div><label className="text-xs text-neutral-300">Correo</label><input type="email" required value={email} onChange={e=>setEmail(e.target.value)} className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"/></div>
          <div><label className="text-xs text-neutral-300">Contraseña</label><input type="password" required value={password} onChange={e=>setPassword(e.target.value)} className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"/></div>
          {error&&<p className="text-xs text-red-400">{error}</p>}
          <button type="submit" disabled={loading} className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-2 text-sm font-semibold text-white disabled:opacity-60">{loading?"Procesando...":mode==="login"?"Entrar":"Registrarme"}</button>
        </form>
        <button onClick={handleGoogle} disabled={loading} className="mt-3 w-full rounded-2xl border border-white/20 py-2 text-sm text-white hover:bg-white/10 disabled:opacity-60">Continuar con Google</button>
        <p className="mt-3 text-center text-xs text-neutral-400">{mode==="login"?<>¿No tienes cuenta? <button type="button" onClick={()=>setMode("register")} className="text-cyan-300 underline">Regístrate aquí</button></>:<>¿Ya tienes cuenta? <button type="button" onClick={()=>setMode("login")} className="text-cyan-300 underline">Inicia sesión</button></>}</p>
      </div>
    </div>
  );
}

function GoogleOnlyModal({ open, onClose, onGoogle }) {
  if(!open) return null;
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-black/90 p-6">
        <div className="flex items-center justify-between"><h3 className="text-lg font-semibold text-white">Regístrate con Google</h3><button onClick={onClose} className="rounded-lg px-3 py-1 text-neutral-400 hover:bg-white/10">✕</button></div>
        <p className="mt-2 text-xs text-neutral-400">Crea tu cuenta con Google. Al entrar recibirás tus <span className="font-semibold text-white">10 jades gratis</span>.</p>
        <button onClick={onGoogle} className="mt-5 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white">Registrarme con Google</button>
        <button onClick={onClose} className="mt-3 w-full rounded-2xl border border-white/20 py-3 text-sm text-white hover:bg-white/10">Cancelar</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════
function DashboardView({ lang, setLang }) {
  const { user, isAdmin, signOut } = useAuth();
  const [activeModule, setActiveModule] = useState(null);
  const [buyJadesOpen, setBuyJadesOpen] = useState(false);
  const [userStatus, setUserStatus] = useState({ loading:true, plan:null, subscription_status:"none", jades:0 });

  const fetchUserStatus = async () => {
    if(!user?.id) return;
    try {
      const auth = await getAuthHeadersGlobal();
      const r    = await fetch(`/api/user-status?user_id=${encodeURIComponent(user.id)}`,{headers:auth});
      const data = await r.json().catch(()=>null);
      if(!r.ok||!data?.ok) throw new Error(data?.error||"error");
      setUserStatus({loading:false,plan:data.plan,subscription_status:data.subscription_status,jades:data.jades??0});
    } catch { setUserStatus(p=>({...p,loading:false})); }
  };

  useEffect(()=>{
    if(!user?.id) return;
    fetchUserStatus();
    const t=setInterval(fetchUserStatus,15000);
    return ()=>clearInterval(t);
  },[user?.id]);

  const spendJades=async({amount,reason})=>{
    if(!user?.id) throw new Error("No user");
    const auth=await getAuthHeadersGlobal();
    const r=await fetch("/api/jades-spend",{method:"POST",headers:{"Content-Type":"application/json",...auth},body:JSON.stringify({user_id:user.id,amount:Number(amount),reason:reason||"spend"})});
    const data=await r.json().catch(()=>null);
    if(!r.ok||!data?.ok) throw new Error(data?.error||"No se pudo descontar jades.");
    await fetchUserStatus(); return data;
  };

  const handleContact=()=>{ const s=encodeURIComponent("Soporte IsabelaOS Studio"); window.location.href=`mailto:contacto@isabelaos.com?subject=${s}`; };

  const isEs = lang === "es";

  const tabs = [
    { key:"generator",  label: isEs ? "Imagen" : "Image"          },
    { key:"img2video",  label: isEs ? "Imagen → Video" : "Image → Video" },
    { key:"avatars",    label: isEs ? "Avatares" : "Avatars"        },
    { key:"library",    label: isEs ? "Biblioteca" : "Library"      },
    { key:"montaje",    label: "Montaje IA"                         },
    { key:"comercial",  label: "🎬 Comercial IA"                   },
    { key:"photoshoot", label: "📸 Photoshoot"                      },
    { key:"cineai",     label: "🎥 CineAI"                          },
  ];

  return (
    <div className="min-h-screen w-full text-white" style={{background:"radial-gradient(1200px_800px_at_110%-10%,rgba(255,23,229,0.12),transparent_60%),radial-gradient(900px_600px_at-10%_0%,rgba(0,229,255,0.10),transparent_50%),#06070B"}}>

      {/* Modal de términos — primera vez que entra al dashboard */}
      <TermsAcceptanceModal user={user} lang={lang} onAccepted={()=>{}} />

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/60 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500 to-fuchsia-500 text-xs font-bold shadow-[0_0_25px_rgba(34,211,238,0.35)]">io</div>
            <div><div className="text-sm font-semibold leading-tight">isabelaOs <span className="text-xs text-neutral-400">Studio</span></div><div className="text-[10px] text-neutral-500">{isEs ? "Workspace del creador" : "Creator workspace"}</div></div>
          </div>
          <div className="flex items-center gap-2 md:gap-3 text-xs">
            <span className="hidden lg:inline text-neutral-300">{user?.email}{isAdmin?" · admin":""}</span>
            {/* Botón idioma */}
            <button onClick={()=>setLang(lang==="es"?"en":"es")} className="rounded-xl border border-white/20 px-3 py-1.5 text-xs text-white hover:bg-white/10 font-semibold">
              {lang==="es"?"🌐 EN":"🌐 ES"}
            </button>
            <button onClick={()=>setBuyJadesOpen(true)} className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/60 px-3 py-1.5 hover:border-cyan-400/40 hover:bg-cyan-500/5 transition-all">
              <span className="text-base">💎</span>
              <span className="text-[11px] text-neutral-300">Jades: <span className="font-semibold text-white">{userStatus.loading?"...":userStatus.jades??0}</span></span>
              <span className="text-[10px] text-cyan-400/70">+ {isEs?"Comprar":"Buy"}</span>
            </button>
            <button onClick={handleContact} className="rounded-xl border border-white/20 px-3 py-1.5 text-xs text-white hover:bg-white/10">{isEs?"Contacto":"Contact"}</button>
            <button onClick={signOut} className="rounded-xl border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10">{isEs?"Cerrar sesión":"Sign out"}</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-16 pt-8">
        <section className="mb-6">
          <p className="text-[11px] uppercase tracking-[0.22em] text-neutral-400">Workspace</p>
          <h1 className="mt-2 text-2xl font-semibold text-white md:text-3xl">{isEs?"Panel del creador":"Creator dashboard"}</h1>
          <p className="mt-2 max-w-2xl text-sm text-neutral-400">{isEs?"Genera, revisa, descarga y administra resultados desde un solo sistema conectado a GPU.":"Generate, review, download and manage results from a single GPU-connected system."}</p>
        </section>

        {/* Tabs */}
        <section className="mb-6">
          <div className="no-scrollbar flex gap-2 overflow-x-auto rounded-[24px] border border-white/10 bg-black/35 p-2">
            {tabs.map(item=>{
              const active=activeModule===item.key;
              return (<button key={item.key} type="button" onClick={()=>setActiveModule(active?null:item.key)} className={["whitespace-nowrap rounded-2xl px-4 py-3 text-sm font-medium transition-all",active?"bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white shadow-[0_0_30px_rgba(34,211,238,0.22)]":"bg-white/5 text-white/75 hover:bg-white/10 hover:text-white"].join(" ")}>{item.label}</button>);
            })}
          </div>
        </section>

        {/* Módulo activo */}
        {activeModule&&(
          <section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-black/35 p-4 md:p-6">
            <div className="pointer-events-none absolute -inset-16 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.10),transparent_25%),radial-gradient(circle_at_top_right,rgba(236,72,153,0.10),transparent_28%)]" />
            {activeModule==="generator"  && <CreatorPanel isDemo={false}/>}
            {activeModule==="img2video"  && <Img2VideoPanel userStatus={userStatus} spendJades={spendJades}/>}
            {activeModule==="avatars"    && <AvatarStudioPanel userStatus={userStatus}/>}
            {activeModule==="library"    && <LibraryView/>}
            {activeModule==="montaje"    && <MontajeIAPanel userStatus={userStatus}/>}
            {activeModule==="comercial"  && <ComercialPanel userStatus={userStatus}/>}
            {activeModule==="photoshoot" && <ProductPhotoshoot userJades={userStatus.jades??0} onJadesDeducted={async(a)=>{try{await spendJades({amount:a,reason:"product_photoshoot"});}catch{}}}/>}
            {activeModule==="cineai"     && <CineAIPanel/>}
          </section>
        )}

        {/* Home cards */}
        {!activeModule&&(
          <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {tabs.map(item=>(
              <button key={item.key} type="button" onClick={()=>setActiveModule(item.key)}
                className={["group rounded-[28px] border p-6 text-left transition-all",
                  item.key==="photoshoot"?"border-cyan-400/25 bg-cyan-500/5 hover:border-cyan-400/40"
                  :item.key==="cineai"?"border-yellow-400/25 bg-yellow-500/5 hover:border-yellow-400/40"
                  :"border-white/10 bg-black/35 hover:border-cyan-400/30 hover:bg-black/50"].join(" ")}>
                <div className={["text-base font-semibold transition-colors",
                  item.key==="photoshoot"?"text-cyan-200 group-hover:text-cyan-100"
                  :item.key==="cineai"?"text-yellow-200 group-hover:text-yellow-100"
                  :"text-white group-hover:text-cyan-300"].join(" ")}>{item.label}</div>
                <div className="mt-2 text-xs text-neutral-400">
                  {item.key==="generator"  && (isEs?"Genera imágenes con FLUX y avatares faciales":"Generate images with FLUX and facial avatars")}
                  {item.key==="img2video"  && (isEs?"Convierte imágenes en videos con Express o Standard":"Convert images to videos with Express or Standard")}
                  {item.key==="avatars"    && (isEs?"Crea y administra tus modelos virtuales":"Create and manage your virtual models")}
                  {item.key==="library"    && (isEs?"Revisa y descarga todas tus generaciones":"Review and download all your generations")}
                  {item.key==="montaje"    && (isEs?"Monta personas o productos en fondos personalizados":"Mount people or products on custom backgrounds")}
                  {item.key==="comercial"  && (isEs?"Genera comerciales profesionales con video, voz y narración IA":"Generate professional AI commercials")}
                  {item.key==="photoshoot" && (isEs?"Convierte fotos de productos en shoots profesionales":"Convert product photos into professional shoots")}
                  {item.key==="cineai"     && (isEs?"Escenas cinematográficas tipo Hollywood y trends de TikTok — Seedance 2.0":"Hollywood-style cinematic scenes and TikTok trends")}
                </div>
                {item.key==="cineai"&&(<div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-yellow-400/20 bg-yellow-400/8 px-3 py-1 text-[10px] text-yellow-300">✦ Nuevo · Seedance 2.0 · desde 40 Jades</div>)}
                <div className={["mt-4 text-[11px] transition-colors",item.key==="cineai"?"text-yellow-400/60 group-hover:text-yellow-400":"text-cyan-400/60 group-hover:text-cyan-400"].join(" ")}>{isEs?"Abrir módulo →":"Open module →"}</div>
              </button>
            ))}
            <button type="button" onClick={()=>setBuyJadesOpen(true)} className="group rounded-[28px] border border-cyan-400/20 bg-cyan-500/5 p-6 text-left hover:border-cyan-400/40 hover:bg-cyan-500/10 transition-all">
              <div className="flex items-center gap-2"><span className="text-2xl">💎</span><div className="text-base font-semibold text-white">{isEs?"Mis Jades":"My Jades"}</div></div>
              <div className="mt-2 text-3xl font-bold text-cyan-300">{userStatus.loading?"...":userStatus.jades??0}</div>
              <div className="mt-2 text-xs text-neutral-400">{isEs?"Créditos para generar imágenes y videos":"Credits to generate images and videos"}</div>
              <div className="mt-4 text-[11px] text-cyan-400/60 group-hover:text-cyan-400 transition-colors">{isEs?"Comprar más Jades →":"Buy more Jades →"}</div>
            </button>
          </section>
        )}
      </main>

      <LegalFooter lang={lang} onOpenContact={handleContact} />
      <BuyJadesModal open={buyJadesOpen} onClose={()=>setBuyJadesOpen(false)} userId={user?.id} onSuccess={fetchUserStatus}/>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// LANDING VIEW (simplificada — mantiene la estructura original)
// ══════════════════════════════════════════════════════════════
function StatCounter({ value, label, suffix="" }) {
  const [count,setCount]=useState(0);
  useEffect(()=>{ let s=0; const e=parseInt(value); if(s===e)return; const step=Math.ceil(e/(1800/16)); const t=setInterval(()=>{s=Math.min(s+step,e);setCount(s);if(s>=e)clearInterval(t);},16); return()=>clearInterval(t); },[value]);
  return(<div className="text-center"><div className="text-3xl md:text-4xl font-bold text-white">{count.toLocaleString()}{suffix}</div><div className="mt-1 text-[11px] text-neutral-400 uppercase tracking-wider">{label}</div></div>);
}

function AboutView({ onBackHome, lang }) {
  const videoRef=useRef(null); const [soundOn,setSoundOn]=useState(false);
  const enableSound=async()=>{ const v=videoRef.current; if(!v)return; try{v.muted=false;v.volume=1;await v.play();setSoundOn(true);}catch{} };
  return(
    <div className="min-h-screen w-full text-white" style={{background:"#05060A"}}>
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500 to-fuchsia-500 text-xs font-bold">io</div><div className="text-sm font-semibold">isabelaOs Studio</div></div>
          <button onClick={onBackHome} className="rounded-xl border border-white/20 bg-white/5 px-4 py-1.5 text-xs text-white hover:bg-white/10">{lang==="es"?"Volver":"Back"}</button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-10">
        <section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-white/5 p-4">
          <h1 className="mt-2 text-3xl font-semibold text-white mb-4">IsabelaOS Studio</h1>
          <div className="relative">
            <video ref={videoRef} className="h-[360px] w-full rounded-[24px] border border-white/10 bg-black/40 object-cover md:h-[500px]" src="/gallery/video10.mp4" autoPlay muted loop playsInline preload="metadata" controls={soundOn}/>
            {!soundOn&&<button onClick={enableSound} className="absolute bottom-4 left-4 rounded-2xl border border-white/15 bg-black/60 px-4 py-2 text-xs text-white hover:bg-black/70">🔊 {lang==="es"?"Activar audio":"Enable audio"}</button>}
          </div>
        </section>
        <div className="mt-8"><button onClick={onBackHome} className="rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-3 text-sm font-semibold text-white">{lang==="es"?"Regresar":"Go back"}</button></div>
      </main>
    </div>
  );
}

function LandingView({ onOpenAuth, onStartDemo, onOpenContact, onOpenAbout, lang, setLang }) {
  const [demoPrompt,setDemoPrompt]=useState("Modelo virtual elegante para redes sociales, rostro consistente, luz cinematográfica, formato vertical");
  const isEs=lang==="es";
  const topVisuals=[
    {type:"video",src:"/gallery/video1.mp4",label:"Demo principal",big:true},
    {type:"image",src:"/gallery/img2.png?v=2",label:"Campaña visual",big:false},
    {type:"image",src:"/gallery/img3.png?v=2",label:"Escena IA",big:false},
    {type:"image",src:"/gallery/img4.png?v=2",label:"Avatar",big:false},
    {type:"image",src:"/gallery/img1.png?v=2",label:"Contenido",big:false},
    {type:"image",src:"/gallery/img5.png?v=2",label:"Preview",big:false},
  ];
  return(
    <div className="min-h-screen w-full text-white overflow-x-hidden" style={{background:"radial-gradient(1200px_800px_at_100%_-10%,rgba(250,204,21,0.14),transparent_55%),radial-gradient(900px_700px_at_-10%_0%,rgba(34,211,238,0.16),transparent_50%),#05060A"}}>
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/50 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400 via-sky-500 to-yellow-400 text-xs font-bold text-black shadow-[0_0_30px_rgba(250,204,21,0.22)]">io</div>
            <div><div className="text-sm font-semibold leading-tight">isabelaOs <span className="text-xs text-neutral-400">Studio</span></div><div className="text-[10px] text-neutral-500">{isEs?"Plataforma de modelos virtuales":"Virtual models platform"}</div></div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={()=>scrollToId("planes")} className="hidden sm:inline rounded-xl border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10">{isEs?"Planes":"Plans"}</button>
            <button onClick={onOpenAbout}               className="hidden sm:inline rounded-xl border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10">{isEs?"Sobre nosotros":"About us"}</button>
            <button onClick={onOpenContact}             className="hidden sm:inline rounded-xl border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10">{isEs?"Contacto":"Contact"}</button>
            {/* Botón idioma */}
            <button onClick={()=>setLang(lang==="es"?"en":"es")} className="rounded-xl border border-white/20 px-3 py-1.5 text-xs text-white hover:bg-white/10 font-semibold">
              {lang==="es"?"🌐 EN":"🌐 ES"}
            </button>
            <button onClick={onOpenAuth} className="rounded-xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90">
              {isEs?"Iniciar sesión / Registrarse":"Sign in / Register"}
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 pb-20 pt-10">
        <section className="grid gap-10 xl:grid-cols-[1fr_1.2fr_0.85fr]">
          <div className="xl:pt-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-yellow-400/30 bg-yellow-400/10 px-4 py-1.5 text-[11px] text-yellow-200">
              <span className="h-1.5 w-1.5 rounded-full bg-yellow-400 animate-pulse"/>{isEs?"Estudio visual con IA · GPU en vivo":"AI visual studio · Live GPU"}
            </div>
            <h1 className="mt-6 text-5xl font-bold leading-[0.95] md:text-6xl lg:text-7xl tracking-tight">
              {isEs?"Tu estudio de":"Your studio of"}
              <span className="block bg-gradient-to-r from-cyan-300 via-sky-300 to-yellow-300 bg-clip-text text-transparent mt-1">{isEs?"modelos\nvirtuales":"virtual\nmodels"}</span>
            </h1>
            <p className="mt-6 max-w-md text-base text-neutral-300 leading-relaxed">
              {isEs?"Crea, organiza y escala contenido visual para personajes y modelos virtuales desde un solo sistema conectado a GPU.":"Create, organize and scale visual content for characters and virtual models from a single GPU-connected system."}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button onClick={()=>scrollToId("demo-box")} className="rounded-2xl bg-gradient-to-r from-cyan-400 via-sky-500 to-yellow-400 px-7 py-3.5 text-sm font-bold text-black shadow-[0_0_40px_rgba(250,204,21,0.22)]">{isEs?"Crear mi modelo virtual":"Create my virtual model"}</button>
              <button onClick={onOpenAbout} className="rounded-2xl border border-white/20 bg-white/5 px-7 py-3.5 text-sm font-semibold text-white hover:bg-white/10">{isEs?"Ver presentación":"See presentation"}</button>
            </div>
            <div className="mt-10 grid grid-cols-3 gap-4 border-t border-white/10 pt-8">
              <StatCounter value={1240} suffix="+" label={isEs?"Modelos creados":"Models created"}/>
              <StatCounter value={3}    suffix="s"  label={isEs?"Tiempo promedio":"Avg. time"}/>
              <StatCounter value={98}   suffix="%"  label={isEs?"Satisfacción":"Satisfaction"}/>
            </div>
          </div>
          <div className="order-3 xl:order-2">
            <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-white/3 p-3">
              <div className="grid auto-rows-[200px] grid-cols-2 gap-3 lg:grid-cols-3 lg:auto-rows-[185px]">
                {topVisuals.map((item,idx)=>(
                  <div key={idx} className={`group relative overflow-hidden rounded-[22px] border border-white/10 bg-black/40 ${item.big?"lg:col-span-2 lg:row-span-2":""}`}>
                    {item.type==="video"
                      ?<video className="absolute inset-0 h-full w-full object-cover" src={item.src} autoPlay muted loop playsInline preload="metadata" style={{transform:"scale(1.01)"}}/>
                      :<div className="absolute inset-0 bg-cover bg-center" style={{backgroundImage:`url(${item.src})`,transform:"scale(1.01)"}}/>}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent"/>
                    <div className="absolute left-3 top-3 rounded-full border border-white/15 bg-black/50 px-3 py-1 text-[10px] text-white/80 backdrop-blur-sm">{item.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="order-2 xl:order-3 xl:pt-10">
            <div className="sticky top-24">
              <div id="demo-box" className="relative overflow-hidden rounded-[30px] border-2 border-yellow-400/35 bg-black/60 p-6 backdrop-blur-md">
                <p className="text-[11px] uppercase tracking-[0.22em] text-yellow-200/80">{isEs?"Inicio rápido":"Quick start"}</p>
                <h2 className="mt-2 text-xl font-bold text-white">{isEs?"Empieza con tu primer modelo virtual":"Start with your first virtual model"}</h2>
                <textarea className="mt-4 h-28 w-full resize-none rounded-2xl border border-yellow-400/20 bg-black/60 px-4 py-3 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-yellow-300"
                  value={demoPrompt} onChange={e=>setDemoPrompt(e.target.value)}/>
                <button onClick={()=>{saveDemoPrompt(demoPrompt);onStartDemo();}} disabled={!demoPrompt.trim()}
                  className="mt-5 w-full rounded-2xl bg-gradient-to-r from-cyan-400 via-sky-500 to-yellow-400 py-3.5 text-sm font-bold text-black disabled:opacity-60">
                  {isEs?"Crear modelo →":"Create model →"}
                </button>
                <p className="mt-2 text-[10px] text-neutral-400 text-center">{isEs?"Sin tarjeta · Gratis para empezar":"No card · Start free"}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="planes" className="mt-24">
          <div className="text-center mb-10">
            <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-400/70">{isEs?"Sin suscripción":"No subscription"}</p>
            <h3 className="mt-3 text-3xl md:text-4xl font-semibold text-white">{isEs?"Paga solo lo que usas":"Pay only what you use"}</h3>
            <p className="mt-3 text-sm text-neutral-400 max-w-xl mx-auto">{isEs?"Compra Jades y genera cuando quieras. Sin mensualidad. 1 Jade = $0.10 USD.":"Buy Jades and generate whenever you want. No monthly fee. 1 Jade = $0.10 USD."}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(JADE_PACKS).map(([key,p])=>{
              const isFeat=key==="popular";
              return(<div key={key} className={`relative overflow-hidden rounded-[28px] border p-6 transition-all hover:-translate-y-1 ${isFeat?"border-cyan-400/60 bg-gradient-to-b from-cyan-500/15 to-black/60":"border-white/10 bg-black/40 hover:border-white/20"}`}>
                {isFeat&&<div className="absolute top-4 right-4 rounded-full bg-cyan-400 px-2.5 py-0.5 text-[10px] font-bold text-black">Popular</div>}
                <div className="text-xs text-neutral-400 uppercase tracking-widest">{p.label}</div>
                <div className="mt-3 flex items-end gap-1"><span className="text-4xl font-bold text-white">${p.price_usd}</span><span className="mb-1 text-xs text-neutral-400">USD</span></div>
                <div className="mt-1 text-lg font-semibold text-cyan-300">{p.jades} Jades</div>
                <div className="mt-5 space-y-2 text-[11px] text-neutral-300">
                  <div className="flex items-center gap-2"><span className="text-cyan-400">✓</span> {p.jades} {isEs?"imágenes sin avatar":"images"}</div>
                  <div className="flex items-center gap-2"><span className="text-fuchsia-400">✓</span> {Math.floor(p.jades/COSTS.vid_express_8s)} videos Express 8s</div>
                  <div className="flex items-center gap-2"><span className="text-yellow-400">✓</span> {Math.floor(p.jades/40)} videos CineAI 5s</div>
                  <div className="flex items-center gap-2"><span className="text-yellow-400">✓</span> {isEs?"Jades sin vencimiento":"Jades never expire"}</div>
                </div>
                <button onClick={onOpenAuth} className={`mt-6 w-full rounded-2xl py-2.5 text-xs font-semibold transition-all ${isFeat?"bg-gradient-to-r from-cyan-400 to-fuchsia-500 text-white":"border border-white/20 text-white hover:bg-white/10"}`}>
                  {isEs?"Comprar":"Buy"} {p.label}
                </button>
              </div>);
            })}
          </div>
        </section>
      </main>

      <LegalFooter lang={lang} onOpenAuth={onOpenAuth} onOpenContact={onOpenContact} onOpenAbout={onOpenAbout}/>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// APP ROOT
// ══════════════════════════════════════════════════════════════
export default function App() {
  const { user, signInWithGoogle } = useAuth();

  // Idioma global — persiste en localStorage
  const [lang, setLangState] = useState(() => {
    try { return localStorage.getItem("isabelaos_lang") || "es"; } catch { return "es"; }
  });
  const setLang = (l) => { try { localStorage.setItem("isabelaos_lang", l); } catch {} setLangState(l); };

  const [authOpen,        setAuthOpen]        = useState(false);
  const [landingPage,     setLandingPage]     = useState("home");
  const [googleModalOpen, setGoogleModalOpen] = useState(false);

  // Rutas legales simples
  const path = window.location.pathname;
  if (path === "/terms")  return <Terms  lang={lang} />;
  if (path === "/refund") return <Refund lang={lang} />;

  if (user) return <DashboardView lang={lang} setLang={setLang} />;

  return (
    <>
      <AuthModal open={authOpen} onClose={()=>setAuthOpen(false)} />
      <GoogleOnlyModal open={googleModalOpen} onClose={()=>setGoogleModalOpen(false)}
        onGoogle={async()=>{ try{await signInWithGoogle();setGoogleModalOpen(false);}catch(e){alert(e?.message||"Error.");} }} />
      {landingPage==="home" && (
        <LandingView
          onOpenAuth={()    => setAuthOpen(true)}
          onStartDemo={()   => setGoogleModalOpen(true)}
          onOpenContact={() => setLandingPage("contact")}
          onOpenAbout={()   => setLandingPage("about")}
          lang={lang}
          setLang={setLang}
        />
      )}
      {landingPage==="contact" && <ContactView onBack={()=>setLandingPage("home")} />}
      {landingPage==="about"   && <AboutView onBackHome={()=>setLandingPage("home")} lang={lang} />}
    </>
  );
}
