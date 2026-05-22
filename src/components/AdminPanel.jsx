// src/components/AdminPanel.jsx
// Panel de admin — solo visible para exportalling@gmail.com
// Dispara la campaña de correo masivo con un click
import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function AdminPanel({ onClose }) {
  const [status, setStatus]   = useState("idle"); // idle | loading | done | error
  const [result, setResult]   = useState(null);

  const sendCampaign = async () => {
    if (!confirm("¿Enviar correo a TODOS los usuarios registrados?")) return;
    setStatus("loading");
    setResult(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) throw new Error("No hay sesión activa — recarga la página");
      const r = await fetch("/api/send-campaign", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const json = await r.json();
      setResult(json);
      setStatus(json.ok ? "done" : "error");
    } catch (e) {
      setResult({ error: e.message });
      setStatus("error");
    }
  };

  return (
    <div style={{
      position:"fixed",inset:0,zIndex:900,
      display:"grid",placeItems:"center",
      background:"rgba(0,0,0,.88)",backdropFilter:"blur(14px)",padding:16,
    }}>
      <div style={{
        width:"100%",maxWidth:480,
        background:"#0d1017",
        border:"1px solid rgba(255,90,0,.35)",
        borderRadius:20,padding:28,
        boxShadow:"0 0 80px rgba(255,90,0,.12)",
      }}>
        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
          <h2 style={{color:"#fff",fontFamily:"'Space Grotesk',sans-serif",fontSize:18,fontWeight:800,margin:0}}>
            🛠️ Admin Panel
          </h2>
          <button onClick={onClose} style={{background:"none",border:"1px solid rgba(255,255,255,.1)",borderRadius:8,color:"#888",padding:"4px 12px",cursor:"pointer",fontSize:13}}>
            ✕
          </button>
        </div>

        {/* Sección campaña */}
        <div style={{background:"rgba(255,90,0,.06)",border:"1px solid rgba(255,90,0,.15)",borderRadius:14,padding:20,marginBottom:16}}>
          <div style={{color:"#ffb300",fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,fontSize:15,marginBottom:6}}>
            📧 Campaña de correo masivo
          </div>
          <p style={{color:"rgba(240,236,228,.6)",fontSize:13,lineHeight:1.6,margin:"0 0 16px"}}>
            Envía el correo <strong style={{color:"#fff"}}>"10 Jades gratis"</strong> a todos los usuarios confirmados de la plataforma.
          </p>
          <button
            onClick={sendCampaign}
            disabled={status === "loading"}
            style={{
              width:"100%",
              background: status==="loading" ? "rgba(255,90,0,.25)" : "linear-gradient(135deg,#ff5a00,#ffb300)",
              border:"none",borderRadius:12,
              color: status==="loading" ? "rgba(255,255,255,.5)" : "#000",
              fontFamily:"'Space Grotesk',sans-serif",
              fontSize:15,fontWeight:800,
              padding:"14px",cursor:status==="loading"?"not-allowed":"pointer",
              transition:"all .2s",
            }}
          >
            {status === "loading" ? "⏳ Enviando correos..." : "🚀 Enviar campaña ahora"}
          </button>
        </div>

        {/* Resultado */}
        {result && (
          <div style={{
            background: status==="done" ? "rgba(34,197,94,.07)" : "rgba(239,68,68,.07)",
            border:`1px solid ${status==="done" ? "rgba(34,197,94,.2)" : "rgba(239,68,68,.2)"}`,
            borderRadius:12,padding:18,
          }}>
            {status === "done" ? (
              <>
                <div style={{color:"#4ade80",fontWeight:700,fontSize:15,marginBottom:10}}>✅ Campaña enviada</div>
                <div style={{color:"rgba(240,236,228,.75)",fontSize:13,lineHeight:2}}>
                  <div>Total usuarios: <strong style={{color:"#fff"}}>{result.total}</strong></div>
                  <div>Enviados exitosamente: <strong style={{color:"#4ade80"}}>{result.sent}</strong></div>
                  <div>Fallidos: <strong style={{color:result.failed>0?"#f87171":"#fff"}}>{result.failed}</strong></div>
                </div>
                {result.errors?.length > 0 && (
                  <details style={{marginTop:12}}>
                    <summary style={{color:"#f87171",fontSize:12,cursor:"pointer",userSelect:"none"}}>
                      Ver errores ({result.errors.length})
                    </summary>
                    <pre style={{color:"rgba(240,236,228,.45)",fontSize:11,marginTop:8,overflow:"auto",maxHeight:140,background:"rgba(0,0,0,.3)",borderRadius:8,padding:10}}>
                      {JSON.stringify(result.errors, null, 2)}
                    </pre>
                  </details>
                )}
              </>
            ) : (
              <div style={{color:"#f87171",fontSize:13}}>
                ❌ Error: {result.error || "Algo falló — revisa los logs de Vercel"}
              </div>
            )}
          </div>
        )}

        <p style={{marginTop:16,fontSize:11,color:"rgba(240,236,228,.25)",textAlign:"center"}}>
          Solo visible para exportalling@gmail.com
        </p>
      </div>
    </div>
  );
}
