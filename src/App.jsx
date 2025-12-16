import React, { useState, useEffect } from "react";

// ---------------------------------------------------------
// Dependencias / Constantes (Asegúrate de que estas estén definidas en tu entorno real)
// ---------------------------------------------------------
// Definiciones ficticias para que el código sea ejecutable/entendible
const useAuth = () => ({ user: null, loading: false });
const AuthModal = ({ open, onClose }) => null;
const CreatorPanel = ({ isDemo, onAuthRequired }) => null;
const DashboardView = () => <p>Dashboard</p>;
const PayPalButton = ({ amount, containerId }) => <div id={containerId}>[PayPal Button]</div>;

const DEMO_LIMIT = 5;
const DAILY_LIMIT = 10;
const PLAN_BASIC_USD = 10;
const PLAN_BASIC_JADE = 50;


// ---------------------------------------------------------
// Landing (no sesión) con neon + BodySync
// ---------------------------------------------------------
function LandingView({ onOpenAuth, onStartDemo, onViewContact }) { 
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactMessage, setContactMessage] = useState("");

  const handlePaddleCheckout = async () => {
    try {
      const res = await fetch("/api/paddle-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        console.error("Respuesta Paddle:", data);
        alert("No se pudo abrir el pago con Paddle. Intenta con Paypal.");
      }
    } catch (err) {
      console.error("Error Paddle:", err);
      alert("Error al conectar con Paddle.");
    }
  };

  const handleContactSubmit = (e) => {
    e.preventDefault();
    const subject = encodeURIComponent("Contacto desde IsabelaOS Studio");
    const body = encodeURIComponent(
      `Nombre: ${contactName}\nCorreo: ${contactEmail}\n\nMensaje:\n${contactMessage}`
    );
    window.location.href = `mailto:contacto@isabelaos.com?subject=${subject}&body=${body}`;
  };

  return (
    <div
      className="min-h-screen w-full text-white"
      style={{
        // Fondo: Degradado Gris Oscuro con gráficos neón a los lados (ajustado de black/blue/fuchsia)
        background:
          "radial-gradient(1200px_800px_at_110%_-10%,rgba(100,100,100,0.22),transparent_60%),radial-gradient(900px_600px_at_-10%_0%,rgba(100,100,100,0.22),transparent_55%),#0A0A0A",
      }}
    >
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500 to-fuchsia-500 text-xs font-bold shadow-lg shadow-cyan-500/40">
              io
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">
                isabelaOs{" "}
                <span className="text-xs text-neutral-400">Studio</span>
              </div>
              <div className="text-[10px] text-neutral-500">
                Generación visual con IA
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onViewContact} // Nueva acción para ir a la pestaña de Contacto
              className="rounded-xl border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10"
            >
              Contacto
            </button>
            <button
              onClick={onOpenAuth}
              className="rounded-xl border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10"
            >
              Iniciar sesión / Registrarse
            </button>
          </div>
        </div>
      </header>

      {/* Hero + Gallery */}
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-10">
        <section className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
          {/* Columna texto */}
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-cyan-400/40 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300/90 shadow-[0_0_25px_rgba(34,211,238,0.35)]">
              <span className="h-1 w-1 rounded-full bg-cyan-300" />
              <span>Beta privada · Motor de imagen de estudio</span>
            </p>
            <h1 className="mt-3 text-4xl font-semibold leading-tight md:text-5xl">
              Genera imágenes fotorrealistas{" "}
              <span className="block bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-violet-400 bg-clip-text text-transparent">
                con IA en la nube.
              </span>
            </h1>

            {/* Barra neón bajo el título */}
            <div className="mt-3 h-[2px] w-40 rounded-full bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-transparent shadow-[0_0_20px_rgba(168,85,247,0.7)]" />

            <p className="mt-4 max-w-xl text-sm text-neutral-300">
              IsabelaOS Studio es el primer sistema de generación visual con IA
              desarrollado desde Guatemala para creadores, estudios y agencias
              de modelos virtuales. Escribe un prompt y obtén imágenes con
              calidad de estudio en segundos.
            </p>

            <p className="mt-3 max-w-xl text-xs text-neutral-400">
              Durante la beta puedes usar nuestro motor de imágenes y, más
              adelante, acceder a módulos exclusivos como BodySync (movimiento
              corporal IA), Script2Film, CineCam y generador de video desde
              texto. Además, hemos añadido un módulo especial de{" "}
              <span className="font-semibold text-white">
                Foto Navideña IA
              </span>{" "}
              para transformar una foto real de tu familia en un retrato
              navideño de estudio con fondo totalmente generado por IA.
            </p>

            {/* NUEVO: descripción del sistema de prompts optimizados */}
            <p className="mt-2 max-w-xl text-xs text-neutral-400">
              También puedes activar la opción{" "}
              <span className="font-semibold text-white">
                “Optimizar mi prompt con IA (OpenAI)”
              </span>{" "}
              para que el sistema mejore automáticamente el texto que escribes
              antes de enviarlo al motor en la nube, tal como funciona en tu
              versión local.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-4">
              <button
                onClick={onStartDemo}
                className="rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-3 text-sm font-semibold text-white shadow-[0_0_35px_rgba(34,211,238,0.45)] hover:shadow-[0_0_40px_rgba(236,72,153,0.6)] transition-shadow"
              >
                Generar mis {DEMO_LIMIT} imágenes GRATIS ahora
              </button>
              <p className="max-w-xs text-[11px] text-neutral-400">
                Prueba la calidad del motor antes de crear tu cuenta y
                desbloquea {DAILY_LIMIT} imágenes diarias registrándote.
              </p>
            </div>

            <p className="mt-4 text-xs text-neutral-500">
              Próximamente: módulos de video y nuestro motor propio de realismo
              corporal{" "}
              <span className="font-semibold text-white">BodySync v1</span>.
            </p>
          </div>

          {/* Galería 2x2: Dos imágenes arriba, con texto sobre una y fondo difuminado */}
          <div className="relative order-first lg:order-last">
            {/* Halo neón detrás de la galería */}
            <div className="pointer-events-none absolute -inset-8 -z-10 rounded-[32px] bg-gradient-to-br from-cyan-500/18 via-transparent to-fuchsia-500/25 blur-3xl" />

            <h2 className="text-sm font-semibold text-white mb-3">
              Calidad de estudio · Renderizado con el motor actual
            </h2>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-white/10 overflow-hidden shadow-xl shadow-fuchsia-500/10 relative">
                <img
                  src="/gallery/img1.png?v=2"
                  alt="Imagen generada 1"
                  className="w-full h-auto object-cover"
                />
              </div>
              <div className="rounded-2xl border border-white/10 overflow-hidden shadow-xl shadow-cyan-500/10 relative">
                 <img
                  src="/gallery/img2.png?v=2"
                  alt="Imagen generada 2"
                  className="w-full h-auto object-cover"
                />
                {/* Texto con fondo difuminado */}
                <div className="absolute inset-0 flex items-end p-4">
                  <p className="text-white text-xs font-semibold bg-black/60 backdrop-blur-sm rounded-lg p-2">
                    ¡Imágenes IA de alta calidad!
                  </p>
                </div>
              </div>
            </div>
            
            <div className="mt-3 grid grid-cols-2 gap-2">
                 <div className="rounded-2xl border border-white/10 overflow-hidden shadow-xl shadow-fuchsia-500/10">
                    <img
                      src="/gallery/img3.png?v=2"
                      alt="Imagen generada 3"
                      className="w-full h-auto object-cover"
                    />
                  </div>
                  <div className="rounded-2xl border border-white/10 overflow-hidden shadow-xl shadow-cyan-500/10">
                    <img
                      src="/gallery/img4.png?v=2"
                      alt="Imagen generada 4"
                      className="w-full h-auto object-cover"
                    />
                  </div>
            </div>

            <p className="mt-3 text-[10px] text-neutral-500">
              isabelaOs Studio es el primer sistema de generación visual con IA
              desarrollado en Guatemala pensando en creadores, estudios y
              agencias de modelos virtuales.
            </p>
          </div>
        </section>

        {/* Sección: Imagen a Video */}
        <section className="mt-12">
            <h2 className="text-sm font-semibold text-white mb-2">
              De Imagen a Video · Convierte una foto en un clip animado
            </h2>
            <p className="text-xs text-neutral-300 max-w-2xl">
              Con la nueva función de "Imagen a Video", puedes subir una foto
              estática y, usando BodySync, generar un video corto con movimiento
              natural de la persona en la imagen. ¡Solo una foto es suficiente!
            </p>
            <div className="mt-4 flex items-center gap-6">
                {/* Única Imagen */}
                <div className="max-w-[200px] w-full rounded-2xl border border-white/10 overflow-hidden shadow-xl shadow-fuchsia-500/10 relative">
                    <img
                      src="/gallery/img1.png?v=2" // Reutilizamos img1.png para demostrar la conversión
                      alt="Imagen estática para convertir a video"
                      className="w-full h-auto object-cover"
                    />
                    <div className="absolute inset-0 bg-black/30 grid place-items-center text-xs font-semibold">
                        IMAGEN ESTATICA
                    </div>
                </div>

                {/* Flecha Neón */}
                <div className="text-4xl text-cyan-400 font-extrabold shadow-[0_0_15px_rgba(34,211,238,0.8)] animate-pulse">
                    →
                </div>
                
                {/* Placeholder de Video */}
                <div className="flex-1 max-w-[300px] rounded-2xl border border-white/10 overflow-hidden bg-black/70 grid place-items-center h-[300px] shadow-xl shadow-cyan-500/10">
                    <p className="text-xs text-neutral-400 text-center">
                        VIDEO GENERADO <br/> (BodySync Motion)
                    </p>
                </div>
            </div>
        </section>


        {/* Sección: Video desde Prompt (Biblioteca de Videos - Collage) */}
        <section className="mt-12">
            <h2 className="text-sm font-semibold text-white mb-2">
              Biblioteca de Clips de Video desde Prompt (Collage)
            </h2>
            <p className="text-xs text-neutral-300 max-w-2xl">
              Estos son ejemplos de los clips que puedes generar directamente
              desde texto. Los videos se muestran en un estilo collage de diversos
              tamaños, listos para tu biblioteca privada.
            </p>

            {/* MODIFICACIÓN DE TAMAÑO: Aumento de altura del contenedor de videos de h-96 a h-['480px'] */}
            <div className="mt-4 grid grid-cols-4 gap-3 h-['480px']">
                {/* Videos funcionales que se subirán a public (simulados) */}
                <div className="col-span-2 row-span-2 rounded-2xl border border-white/10 overflow-hidden bg-black/70 grid place-items-center shadow-lg">
                    <p className="text-xs text-neutral-400">Video1 (600x900) - Vertical</p>
                    <video controls muted className="hidden">
                        <source src="/public/video1.mp4" type="video/mp4" />
                    </video>
                </div>
                <div className="col-span-1 row-span-1 rounded-xl border border-white/10 overflow-hidden bg-black/70 grid place-items-center shadow-md">
                    <p className="text-xs text-neutral-500">Video2 (300x300) - Cuadrado</p>
                     <video controls muted className="hidden">
                        <source src="/public/video2.mp4" type="video/mp4" />
                    </video>
                </div>
                <div className="col-span-1 row-span-1 rounded-xl border border-white/10 overflow-hidden bg-black/70 grid place-items-center shadow-md">
                    <p className="text-xs text-neutral-500">Video3 (300x300) - Cuadrado</p>
                     <video controls muted className="hidden">
                        <source src="/public/video3.mp4" type="video/mp4" />
                    </video>
                </div>
                <div className="col-span-2 row-span-1 rounded-xl border border-white/10 overflow-hidden bg-black/70 grid place-items-center shadow-md">
                    <p className="text-xs text-neutral-500">Video4 (600x300) - Horizontal</p>
                     <video controls muted className="hidden">
                        <source src="/public/video4.mp4" type="video/mp4" />
                    </video>
                </div>
            </div>
        </section>
        
        {/* Sección: Imágenes Generadas (Biblioteca de Imágenes - Collage) */}
        <section className="mt-12">
            <h2 className="text-sm font-semibold text-white mb-2">
              Biblioteca de Imágenes Generadas desde Prompt
            </h2>
            <p className="text-xs text-neutral-300 max-w-2xl">
              Aquí puedes ver un ejemplo del *collage* de 9 imágenes generadas
              que se almacenan en tu biblioteca personal de IsabelaOS Studio.
            </p>
            
            {/* Collage de 9 Imágenes */}
            {/* MODIFICACIÓN DE TAMAÑO: Aumento de altura de cada imagen de h-24 a h-32 */}
            <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="h-32 rounded-xl border border-white/10 overflow-hidden bg-black/70">
                    <img src="/gallery/img1.png" alt="img1" className="w-full h-full object-cover"/>
                </div>
                <div className="h-32 rounded-xl border border-white/10 overflow-hidden bg-black/70">
                    <img src="/gallery/img2.png" alt="img2" className="w-full h-full object-cover"/>
                </div>
                <div className="h-32 rounded-xl border border-white/10 overflow-hidden bg-black/70">
                    <img src="/gallery/img3.png" alt="img3" className="w-full h-full object-cover"/>
                </div>
                <div className="h-32 rounded-xl border border-white/10 overflow-hidden bg-black/70">
                    <img src="/gallery/img4.png" alt="img4" className="w-full h-full object-cover"/>
                </div>
                <div className="h-32 rounded-xl border border-white/10 overflow-hidden bg-black/70">
                    <img src="/gallery/img5.jpg" alt="img5" className="w-full h-full object-cover"/>
                </div>
                <div className="h-32 rounded-xl border border-white/10 overflow-hidden bg-black/70">
                    <img src="/gallery/img6.jpg" alt="img6" className="w-full h-full object-cover"/>
                </div>
                <div className="h-32 rounded-xl border border-white/10 overflow-hidden bg-black/70">
                    <img src="/gallery/img7.jpg" alt="img7" className="w-full h-full object-cover"/>
                </div>
                <div className="h-32 rounded-xl border border-white/10 overflow-hidden bg-black/70">
                    <img src="/gallery/img8.jpg" alt="img8" className="w-full h-full object-cover"/>
                </div>
                <div className="h-32 rounded-xl border border-white/10 overflow-hidden bg-black/70">
                    <img src="/gallery/img9.jpg" alt="img9" className="w-full h-full object-cover"/>
                </div>
            </div>
        </section>
        
        {/* Sección especial Foto Navideña IA */}
        <section className="mt-12 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="rounded-3xl border border-white/10 bg-black/50 p-5 text-xs text-neutral-300">
            <h3 className="text-sm font-semibold text-white">
              Especial Navidad · Foto Navideña IA
            </b>
            <p className="mt-2 text-[11px] text-neutral-300">
              Sube una foto real tuya o de tu familia y deja que IsabelaOS
              Studio la convierta en un retrato navideño de estudio con fondo,
              luces y decoración generados por IA.
            </p>
            <ul className="mt-2 list-disc list-inside text-[11px] text-neutral-400">
              <li>Ideal para compartir en redes sociales o imprimir.</li>
              <li>
                Respeta la pose original y cambia el entorno a una escena
                navideña realista.
              </li>
              <li>
                Forma parte de los módulos premium incluidos al activar el Plan
                Basic de US${PLAN_BASIC_USD}/mes.
              </li>
            </ul>
            <p className="mt-3 text-[11px] text-neutral-400">
              Dentro del panel del creador encontrarás la sección{" "}
              <span className="font-semibold text-white">
                “Foto Navideña IA (Premium)”
              </span>{" "}
              donde se explica con detalle qué tipo de foto subir y cómo
              funciona el proceso.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-black/60 p-4 flex items-center justify-center">
            <img
              src="/gallery/xmas_family_before_after.png"
              alt="Ejemplo de familia antes y después con fondo navideño"
              className="w-full rounded-2xl object-cover"
            />
          </div>
        </section>

        {/* Sección BodySync: Texto a la par de imagen más pequeña */}
        <section className="mt-12 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          {/* Columna de Texto BodySync */}
          <div>
            <h2 className="text-sm font-semibold text-white mb-2">
              Preparándonos para BodySync · Movimiento corporal IA
            </h2>
            <p className="text-xs text-neutral-300 max-w-2xl">
              Estas imágenes fueron generadas con nuestro prototipo BodySync,
              pensado para describir poses y movimiento corporal realista mediante
              una “firma de movimiento” (Motion Signature). Muy pronto podrás
              combinar IsabelaOS Studio con BodySync para crear escenas completas
              en video con movimiento natural.
            </p>

            <ul className="mt-3 max-w-2xl list-disc list-inside text-[11px] text-neutral-400">
              <li>
                Diseñado para creadores que necesitan coreografías y poses
                naturales sin horas de animación manual.
              </li>
              <li>
                Ideal para videos cortos, reels y escenas cinemáticas con
                personajes IA consistentes.
              </li>
              <li>
                Integración directa con nuestro futuro módulo de video y con el
                motor de imágenes de IsabelaOS Studio.
              </li>
            </ul>
          </div>
          
          {/* Columna de Imagen BodySync (más pequeña) */}
          <div className="flex justify-center items-start">
            <div className="max-w-xs w-full rounded-3xl border border-white/10 bg-black/70 px-4 py-4 shadow-lg shadow-cyan-500/25">
              <img
                src="/gallery/bodysync_showcase.png"
                alt="Ejemplo generado con BodySync"
                className="w-full rounded-2xl object-cover"
              />
            </div>
          </div>
        </section>
        
        {/* Plan de pago (Suscripciones - Híbrido JADE) */}
        <section className="mt-14 max-w-xl border-t border-white/10 pt-8">
          <h2 className="text-sm font-semibold text-white">
            Plan Beta Híbrido: US${PLAN_BASIC_USD}/mes + Créditos JADE
          </b>
          <p className="mt-2 text-xs text-neutral-300">
            Si llegas al límite de {DAILY_LIMIT} imágenes gratuitas al día y quieres seguir
            generando sin restricciones, puedes activar el plan ilimitado. Nuestro sistema
            es **híbrido**: pagas una tarifa mensual y tienes la opción de comprar
            créditos JADE adicionales para módulos avanzados o consumos mayores.
          </p>
          <ul className="mt-2 list-disc list-inside text-[11px] text-neutral-400">
            <li>
              **Plan Basic (${PLAN_BASIC_USD}/mes):** Generador de imágenes desde prompt sin límite diario.
            </li>
            <li>
              **JADE de cortesía:** Por cada pago del Plan Basic, se te acreditarán **{PLAN_BASIC_JADE} JADE** para que puedas empezar a usarlos en módulos de consumo (p. ej., videos o futuros modelos premium).
            </li>
            <li>
              Acceso a los módulos premium actuales (como Foto Navideña IA).
            </li>
            <li>
              Acceso anticipado a nuevos módulos avanzados que se vayan
              liberando durante la beta.
            </li>
          </ul>

          <div className="mt-4 flex flex-wrap items-center gap-4">
            <button
              onClick={handlePaddleCheckout}
              className="rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-2 text-sm font-semibold text-white"
            >
              isabelaOs Basic – US${PLAN_BASIC_USD}/mes (tarjeta / Paddle)
            </button>
            <div className="flex flex-col gap-1 text-[11px] text-neutral-400">
              <span className="text-neutral-300">
                o pagar con <span className="font-semibold">PayPal</span>:
              </span>
              <PayPalButton amount={PLAN_BASIC_USD} containerId="paypal-button-landing" />
            </div>
          </div>

          <p className="mt-3 text-[11px] text-neutral-400">
            Los usuarios que se registren y activen el plan durante la beta
            serán considerados{" "}
            <span className="font-semibold text-white">usuarios beta</span> con
            un Plan Basic activo mientras se mantenga la suscripción.
          </p>
        </section>

        <footer className="mt-16 border-t border-white/10 pt-6 text-[11px] text-neutral-500">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              © {new Date().getFullYear()} isabelaOs Studio · Desarrollado en
              Guatemala, Cobán Alta Verapaz por Stalling Technologic.
            </span>
            <span className="flex flex-wrap gap-3">
              <a href="/terms.html" className="hover:text-neutral-300">
                Términos de servicio
              </a>
              <span>•</span>
              <a href="/privacy.html" className="hover:text-neutral-300">
                Política de privacidad
              </a>
              <span>•</span>
              <a href="/refunds.html" className="hover:text-neutral-300">
                Política de reembolsos
              </a>
            </span>
          </div>
        </footer>
      </main>
    </div>
  );
}


// ---------------------------------------------------------
// Contacto View (Sección principal dedicada)
// ---------------------------------------------------------
function ContactPage({ onReturn }) {
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactMessage, setContactMessage] = useState("");

  const handleContactSubmit = (e) => {
    e.preventDefault();
    const subject = encodeURIComponent("Contacto desde IsabelaOS Studio");
    const body = encodeURIComponent(
      `Nombre: ${contactName}\nCorreo: ${contactEmail}\n\nMensaje:\n${contactMessage}`
    );
    window.location.href = `mailto:contacto@isabelaos.com?subject=${subject}&body=${body}`;
  };

  return (
    <div
      className="min-h-screen w-full text-white"
      style={{
        background:
          "radial-gradient(1200px_800px_at_110%_-10%,rgba(100,100,100,0.22),transparent_60%),radial-gradient(900px_600px_at_-10%_0%,rgba(100,100,100,0.22),transparent_55%),#0A0A0A",
      }}
    >
      <header className="border-b border-white/10 bg-black/60 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500 to-fuchsia-500 text-xs font-bold">
              io
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">
                isabelaOs{" "}
                <span className="text-xs text-neutral-400">Studio</span>
              </div>
              <div className="text-[10px] text-neutral-500">
                Contacto
              </div>
            </div>
          </div>
           <button
              onClick={onReturn}
              className="rounded-xl border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10"
            >
              ← Regresar a Principal
            </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-10">
        <section className="mt-6 max-w-xl mx-auto">
          <h1 className="text-3xl font-semibold text-white">
            Contacto y Soporte
          </b>
          <p className="mt-2 text-sm text-neutral-400">
            Si tienes dudas o necesitas soporte técnico sobre IsabelaOS Studio,
            llena el formulario o escríbenos directamente a{" "}
            <span className="font-semibold text-white">
              contacto@isabelaos.com
            </span>
            .
          </p>

          <form
            onSubmit={handleContactSubmit}
            className="mt-6 space-y-4 text-sm rounded-3xl border border-white/10 bg-black/60 p-6"
          >
            <div>
              <label className="text-xs text-neutral-300">Nombre</label>
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              />
            </div>
            <div>
              <label className="text-xs text-neutral-300">Correo</label>
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              />
            </div>
            <div>
              <label className="text-xs text-neutral-300">Mensaje</label>
              <textarea
                rows={4}
                value={contactMessage}
                onChange={(e) => setContactMessage(e.target.value)}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              />
            </div>
            <button
              type="submit"
              className="mt-2 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-2 text-sm font-semibold text-white"
            >
              Enviar mensaje por Correo
            </button>
          </form>
        </section>
      </main>
      <footer className="mt-16 border-t border-white/10 pt-6 text-[11px] text-neutral-500">
          {/* ... (Footer del Landing) */}
          <div className="mx-auto max-w-6xl px-4 flex flex-wrap items-center justify-between gap-3">
            <span>
              © {new Date().getFullYear()} isabelaOs Studio · Desarrollado en
              Guatemala, Cobán Alta Verapaz por Stalling Technologic.
            </span>
            <span className="flex flex-wrap gap-3">
              <a href="/terms.html" className="hover:text-neutral-300">
                Términos de servicio
              </a>
              <span>•</span>
              <a href="/privacy.html" className="hover:text-neutral-300">
                Política de privacidad
              </a>
              <span>•</span>
              <a href="/refunds.html" className="hover:text-neutral-300">
                Política de reembolsos
              </a>
            </span>
          </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------
// App principal
// ---------------------------------------------------------
export default function App() {
  const { user, loading } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [viewMode, setViewMode] = useState("landing"); // landing, demo, dashboard, contact-page

  useEffect(() => {
    document.documentElement.style.background = "#0A0A0A"; // Fondo base oscuro
  }, []);

  const openAuth = () => {
    setShowAuthModal(true);
    setViewMode("landing");
  };
  const closeAuth = () => setShowAuthModal(false);

  const handleStartDemo = () => {
    setViewMode("demo");
  };
  
  const handleViewContact = () => {
    setViewMode("contact-page");
  }
  
  const handleReturnToLanding = () => {
    setViewMode("landing");
  }

  useEffect(() => {
    if (user && viewMode !== "dashboard") {
      setViewMode("dashboard");
    }
  }, [user, viewMode]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-black text-white">
        <p className="text-sm text-neutral-400">Cargando sesión...</p>
      </div>
    );
  }

  if (user) {
    return <DashboardView />;
  }
  
  // NUEVA PESTAÑA: Contacto
  if (viewMode === "contact-page") {
      return (
        <ContactPage onReturn={handleReturnToLanding} />
      )
  }

  if (viewMode === "demo") {
    return (
      <>
        <div id="top" className="pt-10">
          <CreatorPanel isDemo={true} onAuthRequired={openAuth} />
        </div>
        <LandingView onOpenAuth={openAuth} onStartDemo={handleStartDemo} onViewContact={handleViewContact} />
        <AuthModal open={showAuthModal} onClose={closeAuth} />
      </>
    );
  }

  return (
    <>
      <LandingView onOpenAuth={openAuth} onStartDemo={handleStartDemo} onViewContact={handleViewContact} />
      <AuthModal open={showAuthModal} onClose={closeAuth} />
    </>
  );
}
