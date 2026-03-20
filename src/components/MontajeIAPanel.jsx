import { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function MontajeIAPanel({ userStatus }) {
  const UI_COST_JADES_DEFAULT = 8;

  const [status, setStatus] = useState("IDLE");
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState("");

  const [personFile, setPersonFile] = useState(null);
  const [personPreview, setPersonPreview] = useState("");

  const [backgroundFile, setBackgroundFile] = useState(null);
  const [backgroundPreview, setBackgroundPreview] = useState("");

  const [resultUrl, setResultUrl] = useState("");
  const [jadesLocal, setJadesLocal] = useState(null);

  const [prompt, setPrompt] = useState("");
  const [isabelaPlan, setIsabelaPlan] = useState(null);
  const [isabelaLoading, setIsabelaLoading] = useState(false);

  const [messages, setMessages] = useState([
    {
      role: "isabela",
      text: "Hola. Soy Isabela. Cuéntame cómo quieres montar tu imagen y te ayudaré a dejar la orden lista antes de generar.",
    },
  ]);

  const jadesShown = useMemo(() => {
    const base = typeof userStatus?.jades === "number" ? userStatus.jades : 0;
    return typeof jadesLocal === "number" ? jadesLocal : base;
  }, [userStatus?.jades, jadesLocal]);

  function cleanReply(text) {
    if (!text) return "";
    return text.replace(/```json|```/g, "").trim();
  }

  async function handleAskIsabela() {
    const text = prompt.trim();
    if (!text) return;

    try {
      setIsabelaLoading(true);
      setError("");

      setMessages((prev) => [...prev, { role: "user", text }]);

      const session = await supabase.auth.getSession();
      const token = session?.data?.session?.access_token;

      const resp = await fetch("/api/isabela-montaje-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: text,
          hasPersonImage: !!personFile,
          hasBackgroundImage: !!backgroundFile,
        }),
      });

      const json = await resp.json().catch(() => null);

      if (!resp.ok || !json?.ok) {
        throw new Error(json?.reply || "Error interpretando");
      }

      const replyText = cleanReply(json?.reply);

      setMessages((prev) => [
        ...prev,
        { role: "isabela", text: replyText },
      ]);

      if (json?.allowed) {
        setIsabelaPlan(json);
      } else {
        setIsabelaPlan(null);
      }

      setPrompt("");
    } catch (err) {
      setError("Error al procesar mensaje");
    } finally {
      setIsabelaLoading(false);
    }
  }

  function handlePromptKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAskIsabela();
    }
  }

  function MessageBubble({ role, text }) {
    const isUser = role === "user";
    return (
      <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
        <div
          className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
            isUser
              ? "bg-cyan-500/10 border border-cyan-400/20 text-white"
              : "bg-fuchsia-500/10 border border-fuchsia-400/20 text-white"
          }`}
        >
          <p className="mb-1 text-xs opacity-70">
            {isUser ? "Tú" : "Isabela"}
          </p>
          <p>{text}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-white">Montaje IA</h1>

      <div className="rounded-3xl border border-white/10 bg-black/40">

        {/* CHAT */}
        <div className="h-[320px] overflow-y-auto p-4 space-y-3">
          {messages.map((msg, i) => (
            <MessageBubble key={i} {...msg} />
          ))}

          {isabelaLoading && (
            <div className="text-sm text-neutral-400">
              Isabela está escribiendo...
            </div>
          )}
        </div>

        {/* INPUT + BOTÓN */}
        <div className="border-t border-white/10 p-3 flex gap-2 items-end">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handlePromptKeyDown}
            placeholder="Ej: colócala en la playa con sombra suave..."
            className="flex-1 min-h-[60px] rounded-xl bg-black/60 p-3 text-white outline-none"
          />

          <button
            onClick={handleAskIsabela}
            disabled={isabelaLoading || !prompt.trim()}
            className="h-[60px] px-5 rounded-xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white font-semibold"
          >
            Enviar
          </button>
        </div>
      </div>

      {error && (
        <div className="text-red-400 text-sm">{error}</div>
      )}
    </div>
  );
 }
