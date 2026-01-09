import React from "react";

export default function ContactView({ onBack }) {
  return (
    <div
      className="min-h-screen w-full text-white"
      style={{
        background:
          "radial-gradient(1200px_800px_at_110%-10%,rgba(255,23,229,0.22),transparent_60%),radial-gradient(900px_600px_at-10%_0%,rgba(0,229,255,0.22),transparent_55%),radial-gradient(700px_700px_at_50%_120%,rgba(140,90,255,0.5),transparent_60%),#05060A",
      }}
    >
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500 to-fuchsia-500 text-xs font-bold shadow-lg shadow-cyan-500/40">
              io
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">
                isabelaOs <span className="text-xs text-neutral-400">Studio</span>
              </div>
              <div className="text-[10px] text-neutral-500">Contacto</div>
            </div>
          </div>

          <button
            onClick={onBack}
            className="rounded-xl border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10"
          >
            ← Volver
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-10">
        <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
          <h1 className="text-2xl font-semibold text-white">Contáctanos</h1>
          <p className="mt-2 text-sm text-neutral-300">
            Escríbenos y te respondemos lo antes posible.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-3xl border border-white/10 bg-black/40 p-5">
              <p className="text-xs text-neutral-400">Correo</p>
              <p className="mt-1 text-sm text-white">contacto@isabelaos.com</p>

              <a
                href="mailto:contacto@isabelaos.com?subject=Soporte%20IsabelaOS%20Studio&body=Hola%2C%20necesito%20ayuda%20con%20IsabelaOS%20Studio.%0A%0A"
                className="mt-4 inline-flex w-full items-center justify-center rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white"
              >
                Enviar correo
              </a>
            </div>

            <div className="rounded-3xl border border-white/10 bg-black/40 p-5">
              <p className="text-xs text-neutral-400">Soporte</p>
              <p className="mt-1 text-sm text-white">
                Indica tu correo, el problema y si puedes adjunta screenshots/logs.
              </p>

              <div className="mt-4 rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-xs text-neutral-300">
                Tip: si es tema de PayPal/Webhook, incluye el ID del evento o captura del panel.
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-white/10 bg-black/30">
        <div className="mx-auto max-w-6xl px-4 py-6 text-center text-[11px] text-neutral-400">
          IsabelaOS 2025 creado por Stalling Technologic Cobán, Alta Verapaz.
        </div>
      </footer>
    </div>
  );
}