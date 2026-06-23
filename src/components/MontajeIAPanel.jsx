// src/components/MontajeIAPanel.jsx
// ─────────────────────────────────────────────────────────────
// Panel de Montaje IA
//
// FLUJO A — gemini_edit (ACTIVO):
//   Sube foto → conversa con Isabela → genera edición con Gemini
//   Ejemplos: cartoonizar, estilo studio, agregar a Messi, mejorar, etc.
//
// FLUJO B — compose_scene (EN MANTENIMIENTO):
//   Sube persona + fondo → composición profesional con rembg
//   Se activa cuando RunPod builder esté disponible
//
// Costos: gemini_edit = 5J | compose_scene = 8J
// ─────────────────────────────────────────────────────────────
import { useState, useRef, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

async function getAuthHeaders() {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  } catch { return {}; }
}

async function fileToBase64(file) {
  const buf = await file.arrayBuffer();
  return btoa(new Uint8Array(buf).reduce((d, b) => d + String.fromCharCode(b), ""));
}

async function compressImage(file, maxWidth = 1024, quality = 0.85, isEs = true) {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale  = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        if (blob) resolve(blob);
        else reject(new Error(isEs ? "No se pudo comprimir la imagen." : "Couldn't compress the image."));
      }, "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(isEs ? "No se pudo cargar la imagen." : "Couldn't load the image.")); };
    img.src = url;
  });
}

// ── Componente de upload de imagen ───────────────────────────
function UploadCard({ title, subtitle, preview, onChange, badge, isEs }) {
  return (
    <label className="group relative block cursor-pointer overflow-hidden rounded-3xl border border-white/10 bg-black/40 p-4 transition hover:border-cyan-400/30">
      <div className="pointer-events-none absolute inset-0 rounded-3xl bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.08),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(217,70,239,0.08),transparent_40%)]" />
      <div className="relative z-10">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-white">{title}</p>
          {badge && (
            <span className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-300">{badge}</span>
          )}
        </div>
        <p className="mt-1 text-xs text-neutral-400">{subtitle}</p>
        <div className="mt-3 rounded-2xl border border-dashed border-white/15 bg-black/40 p-4 text-center">
          {!preview ? (
            <div className="py-4">
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-xl">🖼️</div>
              <p className="text-xs text-neutral-400">{isEs ? "Toca para seleccionar" : "Tap to select"}</p>
            </div>
          ) : (
            <img src={preview} className="mx-auto max-h-[200px] w-full rounded-xl object-contain" alt="preview" />
          )}
        </div>
      </div>
      <input type="file" accept="image/*" onChange={onChange} className="hidden" />
    </label>
  );
}

// ── Burbuja de mensaje ────────────────────────────────────────
function MessageBubble({ role, text, imageB64, mimeType, isEs }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
        isUser
          ? "border border-cyan-400/20 bg-cyan-500/10 text-white"
          : "border border-fuchsia-400/20 bg-fuchsia-500/10 text-white"
      }`}>
        <p className="mb-1 text-[10px] opacity-60">{isUser ? (isEs ? "Tú" : "You") : "Isabela"}</p>
        {text && <p className="whitespace-pre-wrap">{text}</p>}
        {imageB64 && (
          <div className="mt-3">
            <img src={`data:${mimeType || "image/jpeg"};base64,${imageB64}`}
              alt={isEs ? "Resultado del montaje" : "Edit result"}
              className="w-full rounded-xl object-contain max-h-[400px]" />
            <p className="mt-1 text-[10px] text-emerald-300">✅ {isEs ? "Imagen generada" : "Image generated"}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MontajeIAPanel({ userStatus, lang = "es" }) {
  const isEs = lang !== "en";
  // ── Imágenes ──────────────────────────────────────────────
  const [personFile,    setPersonFile]    = useState(null);
  const [personPreview, setPersonPreview] = useState("");
  const [bgFile,        setBgFile]        = useState(null);
  const [bgPreview,     setBgPreview]     = useState("");

  // ── Chat ──────────────────────────────────────────────────
  const [messages,       setMessages]       = useState([
    { role: "isabela", text: isEs
      ? "Hola, soy Isabela 👋 Sube tu imagen y cuéntame qué quieres hacer con ella. Puedo cartoonizarla, darle estilo studio, agregar a alguien famoso, cambiar el fondo con IA, y más."
      : "Hi, I'm Isabela 👋 Upload your image and tell me what you want to do with it. I can cartoonize it, give it a studio style, add a famous person, change the background with AI, and more." },
  ]);
  const [prompt,         setPrompt]         = useState("");
  const [chatHistory,    setChatHistory]    = useState([]);
  const [isabelaLoading, setIsabelaLoading] = useState(false);

  // ── Plan de Isabela ───────────────────────────────────────
  const [currentPlan,      setCurrentPlan]      = useState(null);
  const [readyToGenerate,  setReadyToGenerate]  = useState(false);

  // ── Generación ────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [resultB64,  setResultB64]  = useState(null);
  const [resultMime, setResultMime] = useState("image/jpeg");
  const [genError,   setGenError]   = useState("");

  const chatEndRef = useRef(null);
  const currentJades = userStatus?.jades ?? 0;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Handlers de imagen ────────────────────────────────────
  async function handlePersonFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setPersonFile(f);
    setPersonPreview(URL.createObjectURL(f));
    setResultB64(null);
  }

  async function handleBgFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBgFile(f);
    setBgPreview(URL.createObjectURL(f));
  }

  // ── Enviar mensaje a Isabela ──────────────────────────────
  async function handleSendMessage() {
    const text = prompt.trim();
    if (!text || isabelaLoading) return;

    const userMsg = { role: "user", text };
    setMessages((p) => [...p, userMsg]);
    setPrompt("");
    setIsabelaLoading(true);
    setReadyToGenerate(false);

    try {
      const auth = await getAuthHeaders();
      const r    = await fetch("/api/isabela-montaje-chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body:    JSON.stringify({
          message:            text,
          chatHistory,
          hasPersonImage:     !!personFile,
          hasBackgroundImage: !!bgFile,
        }),
      });
      const j = await r.json().catch(() => null);

      if (!r.ok || !j?.ok) throw new Error(j?.error || (isEs ? "Error al responder." : "Error responding."));

      const isabelaReply = String(j.reply || "").replace(/```json|```/g, "").trim();

      // Actualizar historial para contexto continuo
      setChatHistory((prev) => [
        ...prev,
        { role: "user",  text },
        { role: "model", text: isabelaReply },
      ]);

      setMessages((p) => [...p, { role: "isabela", text: isabelaReply }]);

      // Guardar plan si Isabela lo propone
      if (j.final_prompt) {
        setCurrentPlan({
          edit_type:    j.edit_type    || "gemini_edit",
          final_prompt: j.final_prompt || text,
          edit_plan:    j.edit_plan    || "",
        });
      }

      // Isabela dice que está listo para generar
      // También activar si tiene plan y hay imagen subida
      if (j.ready_to_generate || (j.final_prompt && personFile)) {
        setReadyToGenerate(true);
      }

      // Isabela pide imagen si no hay
      if (j.need_person_image && !personFile) {
        setMessages((p) => [...p, { role: "isabela", text: isEs ? "⚠️ Necesito que subas la imagen principal primero." : "⚠️ I need you to upload the main image first." }]);
      }

    } catch (e) {
      setMessages((p) => [...p, { role: "isabela", text: `Error: ${e?.message || (isEs ? "No se pudo responder." : "Couldn't respond.")}` }]);
    } finally {
      setIsabelaLoading(false);
    }
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
  }

  // ── Generar montaje ───────────────────────────────────────
  async function handleGenerate() {
    if (!personFile) {
      setMessages((p) => [...p, { role: "isabela", text: isEs ? "⚠️ Primero sube la imagen principal." : "⚠️ First upload the main image." }]);
      return;
    }
    if (!currentPlan?.final_prompt && !prompt.trim()) {
      setMessages((p) => [...p, { role: "isabela", text: isEs ? "⚠️ Cuéntame qué quieres hacer con la imagen." : "⚠️ Tell me what you want to do with the image." }]);
      return;
    }

    const editType = currentPlan?.edit_type || "gemini_edit";

    // compose_scene está en mantenimiento
    if (editType === "compose_scene" || bgFile) {
      setMessages((p) => [...p, {
        role: "isabela",
        text: isEs
          ? "🔧 La composición profesional con fondo está en mantenimiento. Mientras tanto puedo editar tu imagen con IA — prueba pidiéndome que cambie el fondo describiendo la escena."
          : "🔧 Professional composition with background is under maintenance. In the meantime I can edit your image with AI — try asking me to change the background by describing the scene.",
      }]);
      return;
    }

    const jadeCost = 5;
    if (currentJades < jadeCost) {
      setGenError(isEs ? `Necesitas ${jadeCost} Jades para generar. Tienes ${currentJades}.` : `You need ${jadeCost} Jades to generate. You have ${currentJades}.`);
      return;
    }

    setGenerating(true);
    setGenError("");
    setResultB64(null);

    // No mostrar mensaje en el chat al generar — el usuario ya sabe que hizo click

    try {
      // Comprimir y convertir imagen
      const compressedBlob = await compressImage(personFile, 1024, 0.85, isEs);
      const compressedFile = new File([compressedBlob], "person.jpg", { type: "image/jpeg" });
      const personB64      = await fileToBase64(compressedFile);

      const finalPrompt = currentPlan?.final_prompt || prompt.trim();

      const auth = await getAuthHeaders();
      const r    = await fetch("/api/generate-montaje", {
        method:  "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body:    JSON.stringify({
          edit_type:       "gemini_edit",
          final_prompt:    finalPrompt,
          person_image:    personB64,
          person_mime_type: "image/jpeg",
        }),
      });

      const j = await r.json().catch(() => null);

      if (!r.ok || !j?.ok) {
        if (j?.error === "GEMINI_NO_IMAGE_OUTPUT") {
          setMessages((p) => [...p, {
            role: "isabela",
            text: isEs
              ? "No pude generar una imagen con esa instrucción. Intenta ser más específico — por ejemplo: 'Conviértela en estilo cartoon pixar' o 'Ponla con fondo de playa soleada'."
              : "I couldn't generate an image with that instruction. Try being more specific — for example: 'Turn it into Pixar cartoon style' or 'Put it on a sunny beach background'.",
          }]);
          return;
        }
        // Error genérico — no exponer detalles técnicos
        throw new Error(isEs ? "Error al procesar la imagen." : "Error processing the image.");
      }

      setResultB64(j.image_b64);
      setResultMime(j.mime_type || "image/jpeg");
      setReadyToGenerate(false);
      setCurrentPlan(null);

      setMessages((p) => [...p, {
        role: "isabela",
        text: isEs ? "✅ ¡Lista! Puedes ver tu imagen editada en la sección de resultados." : "✅ Done! You can see your edited image in the results section.",
      }]);

    } catch (e) {
      // No mostrar errores técnicos de Gemini al usuario
      const userMsg = isEs ? "Ocurrió un problema al generar. Por favor intenta de nuevo." : "Something went wrong generating. Please try again.";
      setGenError(userMsg);
      setMessages((p) => [...p, { role: "isabela", text: isEs ? "Lo siento, tuve un problema al procesar tu imagen. ¿Lo intentamos de nuevo?" : "Sorry, I had a problem processing your image. Should we try again?" }]);
      console.error("[montaje] error:", e?.message || e);
    } finally {
      setGenerating(false);
    }
  }

  // ── Descargar resultado ───────────────────────────────────
  function handleDownload() {
    if (!resultB64) return;
    const link    = document.createElement("a");
    link.href     = `data:${resultMime};base64,${resultB64}`;
    link.download = "isabelaos-montaje.jpg";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="space-y-6">

      {/* ── Título ── */}
      <div>
        <h2 className="text-lg font-semibold text-white">{isEs ? "Montaje IA" : "AI Editor"}</h2>
        <p className="mt-1 text-sm text-neutral-400">
          {isEs ? "Edita y monta imágenes con inteligencia artificial. Conversa con Isabela para describir lo que necesitas." : "Edit and compose images with artificial intelligence. Chat with Isabela to describe what you need."}
        </p>
      </div>

      {/* ── Info de costos ── */}
      <div className="grid grid-cols-2 gap-3 text-[11px]">
        <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/5 px-4 py-3">
          <div className="font-semibold text-cyan-300">{isEs ? "Edición con IA · 5 Jades" : "AI editing · 5 Jades"}</div>
          <div className="mt-1 text-neutral-400">{isEs ? "Cartoon, studio, cambiar fondo, mejorar foto, etc." : "Cartoon, studio, change background, improve photo, etc."}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
          <div className="font-semibold text-neutral-400">{isEs ? "Composición profesional · 8 Jades" : "Professional composition · 8 Jades"}</div>
          <div className="mt-1 text-neutral-500">🔧 {isEs ? "En mantenimiento — disponible pronto" : "Under maintenance — coming soon"}</div>
        </div>
      </div>

      {/* ── Upload de imágenes ── */}
      <div className="grid gap-4 md:grid-cols-2">
        <UploadCard
          title={isEs ? "Imagen principal" : "Main image"}
          subtitle={isEs ? "Persona, producto o lo que quieras editar." : "Person, product or anything you want to edit."}
          preview={personPreview}
          onChange={handlePersonFile}
          badge={isEs ? "Requerida" : "Required"}
          isEs={isEs} />

        <div className="relative">
          <UploadCard
            title={isEs ? "Fondo (opcional)" : "Background (optional)"}
            subtitle={isEs ? "Sube un fondo real para montaje profesional." : "Upload a real background for professional composition."}
            preview={bgPreview}
            onChange={handleBgFile}
            badge={isEs ? "En mantenimiento" : "Under maintenance"}
            isEs={isEs} />
          {/* Overlay de mantenimiento */}
          <div className="absolute inset-0 rounded-3xl bg-black/60 flex items-center justify-center">
            <div className="text-center px-4">
              <div className="text-2xl mb-2">🔧</div>
              <p className="text-xs text-neutral-300 font-semibold">{isEs ? "Composición profesional" : "Professional composition"}</p>
              <p className="text-[10px] text-neutral-500 mt-1">{isEs ? "En mantenimiento · Disponible pronto" : "Under maintenance · Coming soon"}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Ejemplos de prompts ── */}
      {!readyToGenerate && (
        <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
          <p className="text-[11px] text-neutral-400 font-semibold mb-2">{isEs ? "Ejemplos de lo que puedes pedir:" : "Examples of what you can ask for:"}</p>
          <div className="flex flex-wrap gap-2">
            {(isEs ? [
              "Conviértela en estilo cartoon Pixar",
              "Ponla con fondo de playa soleada",
              "Hazla con estilo de foto de estudio profesional",
              "Agrégale a Messi a la par",
              "Mejora la iluminación y nitidez",
              "Cámbiala a estilo anime",
            ] : [
              "Turn it into Pixar cartoon style",
              "Put it on a sunny beach background",
              "Give it a professional studio photo style",
              "Add Messi next to it",
              "Improve lighting and sharpness",
              "Change it to anime style",
            ]).map((ex) => (
              <button key={ex} type="button" onClick={() => setPrompt(ex)}
                className="rounded-xl border border-white/10 bg-black/40 px-3 py-1.5 text-[11px] text-neutral-300 hover:bg-white/10 hover:text-white transition-all">
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Banner listo para generar (Isabela confirmó el plan) ── */}
      {readyToGenerate && currentPlan && (
        <div className="rounded-2xl border-2 border-cyan-400/50 bg-cyan-500/10 px-4 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-cyan-300">✅ {isEs ? "Plan acordado — listo para generar" : "Plan agreed — ready to generate"}</p>
            <p className="mt-1 text-xs text-neutral-300">{currentPlan.edit_plan || currentPlan.final_prompt}</p>
          </div>
          <span className="text-[11px] text-cyan-400 whitespace-nowrap">{isEs ? "Da click en Generar →" : "Click Generate →"}</span>
        </div>
      )}

      {/* ── Plan actual de Isabela (mientras conversa) ── */}
      {currentPlan && !readyToGenerate && (
        <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
          <p className="text-[11px] font-semibold text-neutral-300">{isEs ? "Plan en progreso:" : "Plan in progress:"}</p>
          <p className="mt-1 text-xs text-neutral-400">{currentPlan.edit_plan || currentPlan.final_prompt}</p>
        </div>
      )}

      {/* ── Chat con Isabela ── */}
      <div className="rounded-3xl border border-white/10 bg-black/40">
        <div className="h-[300px] overflow-y-auto p-4 space-y-3">
          {messages.map((m, i) => (
            <MessageBubble key={i} {...m} isEs={isEs} />
          ))}
          {isabelaLoading && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-fuchsia-400/20 bg-fuchsia-500/10 px-4 py-3 text-sm text-neutral-400">
                {isEs ? "Isabela está pensando..." : "Isabela is thinking..."}
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <div className="border-t border-white/10 p-3 flex gap-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKey}
            placeholder={isEs ? "Ej: conviértela en estilo cartoon, pon fondo de playa..." : "E.g: turn it into cartoon style, put a beach background..."}
            rows={2}
            className="flex-1 resize-none rounded-2xl bg-black/60 px-4 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-cyan-400"
          />
          <button onClick={handleSendMessage} disabled={isabelaLoading || !prompt.trim()}
            className="rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-5 text-sm font-semibold text-white disabled:opacity-50">
            {isEs ? "Enviar" : "Send"}
          </button>
        </div>
      </div>

      {genError && (
        <div className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-xs text-red-300">
          {isEs ? "Ocurrió un problema. Por favor intenta de nuevo." : "Something went wrong. Please try again."}
        </div>
      )}

      {/* ── Botón generar ── */}
      <div className="grid gap-3 sm:grid-cols-2">
        <button onClick={handleGenerate} disabled={generating || !personFile}
          className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-50">
          {generating ? (isEs ? "Generando..." : "Generating...") : (isEs ? "Generar edición · 5 Jades" : "Generate edit · 5 Jades")}
        </button>

        <button disabled
          className="w-full rounded-2xl border border-white/10 bg-black/30 py-3 text-sm text-neutral-500 cursor-not-allowed">
          🔧 {isEs ? "Composición profesional · Pronto" : "Professional composition · Coming soon"}
        </button>
      </div>

      {/* ── Resultado descargable ── */}
      {resultB64 && (
        <div className="rounded-3xl border border-emerald-400/20 bg-emerald-500/5 p-4">
          <p className="text-sm font-semibold text-emerald-300 mb-3">{isEs ? "Resultado" : "Result"}</p>
          <img src={`data:${resultMime};base64,${resultB64}`}
            alt={isEs ? "Resultado del montaje" : "Edit result"}
            className="w-full rounded-2xl object-contain max-h-[500px]" />
          <button onClick={handleDownload}
            className="mt-3 w-full rounded-2xl border border-emerald-400/30 py-2 text-xs text-emerald-200 hover:bg-emerald-500/10">
            {isEs ? "Descargar imagen" : "Download image"}
          </button>
        </div>
      )}
    </div>
  );
}
