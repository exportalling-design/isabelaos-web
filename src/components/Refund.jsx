// src/components/Refund.jsx
// ─────────────────────────────────────────────────────────────
// Política de Reembolsos de IsabelaOS Studio
// ─────────────────────────────────────────────────────────────

export default function Refund({ lang = "es" }) {

  const content = {
    es: {
      title: "Política de Reembolsos",
      version: "Versión 1.0 — Abril 2025 · IsabelaOS Studio",
      sections: [
        {
          title: "1. Naturaleza del Servicio",
          text: `IsabelaOS Studio ofrece créditos digitales denominados "Jades" para acceder a servicios de generación de contenido con inteligencia artificial. Dado que cada generación consume recursos computacionales en el momento de la solicitud, los Jades tienen naturaleza de servicio digital consumible.`
        },
        {
          title: "2. Política General — Sin Reembolsos",
          text: `Como regla general, los pagos realizados para adquirir Jades NO son reembolsables una vez procesados, por las siguientes razones:\n\n• Los créditos (Jades) son productos digitales de consumo inmediato.\n• Los recursos computacionales se reservan en el momento de la compra.\n• La naturaleza digital del servicio impide la "devolución" del producto.\n\nAl completar una compra, el usuario acepta expresamente esta política de no reembolso.`
        },
        {
          title: "3. Excepciones — Casos en que SÍ Procede Reembolso",
          text: `IsabelaOS Studio evaluará reembolsos parciales o totales únicamente en los siguientes casos:\n\n• Error técnico demostrable que impidió completamente el uso del servicio por más de 72 horas consecutivas.\n• Cobro duplicado o incorrecto por falla en el sistema de pagos.\n• Jades cobrados por generaciones que fallaron por error del servidor (estos se reembolsan automáticamente).\n\nPara solicitar un reembolso por estas causas, el usuario debe contactar a soporte en contacto@isabelaos.com dentro de los 7 días calendario siguientes al incidente, proporcionando evidencia del problema.`
        },
        {
          title: "4. Casos en que NO Procede Reembolso",
          text: `No se realizarán reembolsos en los siguientes casos:\n\n• Insatisfacción con los resultados generados por IA (la calidad del contenido depende del prompt y es subjetiva).\n• Jades utilizados en generaciones completadas exitosamente.\n• Suspensión de cuenta por violación de los Términos y Condiciones.\n• Cambio de opinión del usuario después de completar la compra.\n• Malentendidos sobre el funcionamiento del servicio.\n• Jades no utilizados al momento de cierre voluntario de cuenta.`
        },
        {
          title: "5. Proceso de Pago",
          text: `Los pagos en IsabelaOS Studio son procesados por Pagadito, procesador de pagos certificado. IsabelaOS Studio no almacena datos de tarjetas de crédito. Ante cualquier disputa de cargo, el usuario debe contactar primero a IsabelaOS Studio antes de iniciar un contracargo con su banco, ya que los contracargos fraudulentos resultarán en la suspensión permanente de la cuenta.`
        },
        {
          title: "6. Proceso de Solicitud de Reembolso",
          text: `Para solicitar un reembolso en casos aplicables:\n\n1. Enviar correo a contacto@isabelaos.com con asunto "Solicitud de Reembolso"\n2. Incluir: correo de la cuenta, fecha de compra, monto, descripción del problema y evidencia\n3. El equipo responderá dentro de 3-5 días hábiles\n4. Los reembolsos aprobados se procesan en 5-10 días hábiles dependiendo del banco`
        },
        {
          title: "7. Contacto",
          text: `Para consultas sobre reembolsos:\ncontacto@isabelaos.com\n\nIsabelaOS Studio · Stalling Technologic\nCobán, Alta Verapaz, Guatemala`
        }
      ]
    },
    en: {
      title: "Refund Policy",
      version: "Version 1.0 — April 2025 · IsabelaOS Studio",
      sections: [
        {
          title: "1. Nature of Service",
          text: `IsabelaOS Studio offers digital credits called "Jades" to access AI-powered content generation services. Since each generation consumes computational resources at the time of the request, Jades are consumable digital services.`
        },
        {
          title: "2. General Policy — No Refunds",
          text: `As a general rule, payments made to purchase Jades are NOT refundable once processed, for the following reasons:\n\n• Credits (Jades) are digital products of immediate consumption.\n• Computational resources are reserved at the time of purchase.\n• The digital nature of the service prevents "returning" the product.\n\nBy completing a purchase, the user expressly accepts this no-refund policy.`
        },
        {
          title: "3. Exceptions — Cases Where Refunds Apply",
          text: `IsabelaOS Studio will evaluate partial or full refunds only in the following cases:\n\n• Demonstrable technical error that completely prevented use of the service for more than 72 consecutive hours.\n• Duplicate or incorrect charge due to payment system failure.\n• Jades charged for generations that failed due to server error (these are refunded automatically).\n\nTo request a refund for these reasons, the user must contact support at contacto@isabelaos.com within 7 calendar days of the incident, providing evidence of the problem.`
        },
        {
          title: "4. Cases Where Refunds Do NOT Apply",
          text: `Refunds will not be made in the following cases:\n\n• Dissatisfaction with AI-generated results (content quality depends on the prompt and is subjective).\n• Jades used in successfully completed generations.\n• Account suspension for violation of Terms and Conditions.\n• Change of mind after completing the purchase.\n• Misunderstandings about how the service works.\n• Unused Jades at the time of voluntary account closure.`
        },
        {
          title: "5. Payment Processing",
          text: `Payments at IsabelaOS Studio are processed by Pagadito, a certified payment processor. IsabelaOS Studio does not store credit card data. In case of any charge dispute, the user must contact IsabelaOS Studio before initiating a chargeback with their bank, as fraudulent chargebacks will result in permanent account suspension.`
        },
        {
          title: "6. Refund Request Process",
          text: `To request a refund in applicable cases:\n\n1. Send email to contacto@isabelaos.com with subject "Refund Request"\n2. Include: account email, purchase date, amount, problem description and evidence\n3. The team will respond within 3-5 business days\n4. Approved refunds are processed in 5-10 business days depending on the bank`
        },
        {
          title: "7. Contact",
          text: `For refund inquiries:\ncontacto@isabelaos.com\n\nIsabelaOS Studio · Stalling Technologic\nCobán, Alta Verapaz, Guatemala`
        }
      ]
    }
  };

  const t = content[lang] || content.es;

  return (
    <div className="min-h-screen bg-[#06070B] text-white">
      <div className="max-w-4xl mx-auto px-6 py-16">
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-6">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500 to-fuchsia-500 text-xs font-bold">io</div>
            <span className="text-sm text-neutral-400">IsabelaOS Studio</span>
          </div>
          <h1 className="text-4xl font-bold text-white mb-3">{t.title}</h1>
          <p className="text-sm text-neutral-500">{t.version}</p>
        </div>
        <div className="space-y-10">
          {t.sections.map((section, i) => (
            <div key={i} className="border-b border-white/5 pb-10">
              <h2 className="text-lg font-semibold text-cyan-300 mb-4">{section.title}</h2>
              <div className="text-sm text-neutral-400 leading-relaxed whitespace-pre-line">{section.text}</div>
            </div>
          ))}
        </div>
        <div className="mt-12 pt-8 border-t border-white/10 text-center">
          <p className="text-xs text-neutral-600">© 2025 IsabelaOS Studio · Stalling Technologic · Cobán, Alta Verapaz, Guatemala</p>
        </div>
      </div>
    </div>
  );
}
