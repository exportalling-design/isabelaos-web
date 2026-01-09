import { useState } from "react";

export default function ContactView({ onBack }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();

    const subject = encodeURIComponent("Contacto desde IsabelaOS Studio");
    const body = encodeURIComponent(
      `Nombre: ${name}\nCorreo: ${email}\n\nMensaje:\n${message}`
    );

    window.location.href = `mailto:contacto@isabelaos.com?subject=${subject}&body=${body}`;
  };

  return (
    <div
      className="min-h-screen w-full text-white"
      style={{
        background:
          "radial-gradient(1200px_800px_at_110%-10%,rgba(255,23,229,0.22),transparent_60%),radial-gradient(900px_600px_at-10%_0%,rgba(0,229,255,0.22),transparent_55%),radial-gradient(700px_700px_at_50%_120%,rgba(140,90,255,0.5),transparent_60%),#05060A",
      }}
    >
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500 to-fuchsia-500 text-xs font-bold">
              io
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">
                isabelaOs <span className="text-xs text-neutral-400">Studio</span>
              </div>
              <div className="text-[10px] text-neutral-500">
                Motor de producción visual
              </div>
            </div>
          </div>

          <button
            onClick={onBack}
            className="rounded-xl border border-white/20 px-4 py-1.5 text-xs hover:bg-white/10"
          >
            ← Volver
          </button>
        </div>
      </header>

      {/* Contenido */}
      <main className="mx-auto max-w-4xl px-4 py-16">
        <div className="rounded-3xl border border-white/10 bg-black/40 p-8">
          <h1 className="text-2xl font-semibold text-white">Contacto</h1>
          <p className="mt-2 text-sm text-neutral-400">
            Escríbenos y te responderemos lo antes posible.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 grid gap-4">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre"
              className="rounded-2xl bg-black/60 px-4 py-3 text-sm outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              required
            />

            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="Correo"
              className="rounded-2xl bg-black/60 px-4 py-3 text-sm outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              required
            />

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Mensaje"
              rows={5}
              className="resize-none rounded-2xl bg-black/60 px-4 py-3 text-sm outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              required
            />

            <button
              type="submit"
              className="mt-4 rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white shadow-lg"
            >
              Enviar mensaje
            </button>
          </form>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 bg-black/30">
        <div className="mx-auto max-w-6xl px-4 py-6 text-center text-[11px] text-neutral-400">
          IsabelaOS 2025 · Stalling Technologic · Guatemala
        </div>
      </footer>
    </div>
  );
}