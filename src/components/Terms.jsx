// src/components/Terms.jsx
// ─────────────────────────────────────────────────────────────
// Términos y Condiciones de IsabelaOS Studio
// Versión: 1.0 — Abril 2025
//
// Este documento está redactado para deslindar a IsabelaOS Studio
// de responsabilidad por uso inadecuado de la plataforma.
// ─────────────────────────────────────────────────────────────

export default function Terms({ lang = "es" }) {

  const content = {
    es: {
      title: "Términos y Condiciones de Uso",
      version: "Versión 1.0 — Abril 2025 · IsabelaOS Studio",
      lastUpdate: "Última actualización: Abril 2025",
      sections: [
        {
          title: "1. Aceptación de los Términos",
          text: `Al registrarse, acceder o usar IsabelaOS Studio (en adelante "la Plataforma"), el usuario acepta íntegramente estos Términos y Condiciones de Uso. Si no está de acuerdo con alguno de estos términos, debe abstenerse de usar la Plataforma. El uso continuado de la Plataforma constituye aceptación plena y vinculante de estos términos, equivalente a la firma de un contrato digital entre el usuario y Stalling Technologic, creador y operador de IsabelaOS Studio, con sede en Cobán, Alta Verapaz, Guatemala.`
        },
        {
          title: "2. Descripción del Servicio",
          text: `IsabelaOS Studio es una plataforma de generación de contenido visual con inteligencia artificial que permite a los usuarios crear imágenes, videos y contenido multimedia mediante modelos de IA. El servicio se ofrece bajo un sistema de créditos denominados "Jades" que el usuario adquiere para acceder a las funciones de generación. Los resultados generados son de naturaleza digital y no garantizamos resultados específicos, disponibilidad continua sin interrupciones, ni que el contenido generado sea apto para ningún propósito específico.`
        },
        {
          title: "3. Responsabilidad Exclusiva del Usuario",
          text: `El usuario es el ÚNICO Y EXCLUSIVO responsable de:\n\n• Todo el contenido que genere, solicite, descargue, comparta o publique usando la Plataforma.\n• El uso que haga del contenido generado por IA, independientemente del propósito.\n• Las consecuencias legales, civiles o penales que puedan derivarse del uso que haga del contenido.\n• Verificar que el contenido generado cumple con las leyes aplicables en su jurisdicción antes de usarlo.\n• Obtener los permisos, licencias o consentimientos necesarios para usar imágenes de terceros.\n\nIsabelaOS Studio actúa únicamente como proveedor de tecnología y NO asume ninguna responsabilidad por el contenido generado por los usuarios ni por las consecuencias de su uso.`
        },
        {
          title: "4. Prohibición Absoluta de Suplantación de Identidad",
          text: `Queda terminantemente PROHIBIDO usar IsabelaOS Studio para:\n\n• Suplantar la identidad de cualquier persona, ya sea pública o privada.\n• Crear contenido que falsamente atribuya declaraciones, acciones o comportamientos a personas reales.\n• Generar videos o imágenes de personas reales sin su consentimiento expreso y documentado.\n• Crear deepfakes con fines de engaño, fraude, extorsión, difamación o cualquier fin que cause daño.\n• Usar la imagen o voz de menores de edad bajo ninguna circunstancia.\n\nEl incumplimiento de esta prohibición puede constituir un delito penal. IsabelaOS Studio reportará a las autoridades competentes cualquier caso de suplantación de identidad del que tenga conocimiento.`
        },
        {
          title: "5. Prohibición de Contenido Ilegal y Dañino",
          text: `Está estrictamente PROHIBIDO generar, solicitar o distribuir:\n\n• Contenido sexual explícito o pornográfico de cualquier tipo.\n• Material de abuso sexual infantil (CSAM) — lo cual es un delito grave.\n• Contenido que incite al odio, la violencia o la discriminación.\n• Contenido que glorifique el terrorismo, el extremismo o la violencia.\n• Información falsa diseñada para engañar al público (desinformación).\n• Contenido que viole derechos de autor, marcas registradas u otros derechos de propiedad intelectual.\n• Cualquier contenido ilegal según las leyes de Guatemala, el país del usuario, o el derecho internacional.\n\nIsabelaOS Studio tiene sistemas de filtrado activos pero no puede garantizar la detección del 100% del contenido inapropiado. El usuario es responsable de no intentar eludir estos sistemas.`
        },
        {
          title: "6. Propiedad Intelectual y Derechos de Imagen",
          text: `Al subir fotografías o imágenes a la Plataforma, el usuario declara y garantiza que:\n\n• Es el titular de los derechos de autor y/o derechos de imagen de dichas fotografías, O\n• Cuenta con el consentimiento expreso, documentado y válido de todas las personas que aparecen en ellas.\n\nIsabelaOS Studio NO verifica la titularidad de derechos sobre las imágenes subidas. Cualquier reclamación de terceros relacionada con derechos de imagen o derechos de autor sobre contenido subido por un usuario es responsabilidad exclusiva de dicho usuario. El usuario se compromete a indemnizar y mantener indemne a IsabelaOS Studio frente a cualquier reclamación de este tipo.`
        },
        {
          title: "7. Exención de Responsabilidad de IsabelaOS Studio",
          text: `IsabelaOS Studio, Stalling Technologic y sus colaboradores NO serán responsables bajo ninguna circunstancia de:\n\n• Los usos que los usuarios hagan del contenido generado por IA.\n• Daños directos, indirectos, incidentales o consecuentes derivados del uso de la Plataforma.\n• Pérdida de datos, ingresos, reputación o cualquier otro daño intangible.\n• El contenido generado por los modelos de IA, incluyendo imprecisiones, sesgos o contenido inesperado.\n• Interrupciones del servicio, errores técnicos o pérdida de créditos (Jades) por fallas técnicas.\n• Acciones de terceros relacionadas con el contenido que los usuarios generen y compartan.\n\nLA PLATAFORMA SE OFRECE "TAL CUAL" Y "SEGÚN DISPONIBILIDAD" SIN GARANTÍAS DE NINGÚN TIPO, EXPRESAS O IMPLÍCITAS.`
        },
        {
          title: "8. Cooperación con Autoridades",
          text: `IsabelaOS Studio cooperará plenamente con las autoridades competentes de cualquier jurisdicción ante solicitudes legales válidas relacionadas con el uso de la Plataforma. Esto incluye proporcionar información sobre usuarios cuando sea requerido por orden judicial o mandato legal válido. Al aceptar estos términos, el usuario consiente expresamente dicha cooperación.`
        },
        {
          title: "9. Suspensión y Terminación",
          text: `IsabelaOS Studio se reserva el derecho de suspender o cancelar el acceso de cualquier usuario, sin previo aviso y sin reembolso, cuando exista evidencia o sospecha razonable de:\n\n• Violación de estos Términos y Condiciones.\n• Uso de la Plataforma para actividades ilegales.\n• Suplantación de identidad o creación de deepfakes maliciosos.\n• Generación de contenido sexual explícito o CSAM.\n• Evasión de los sistemas de seguridad de la Plataforma.\n\nLos Jades (créditos) no utilizados al momento de la suspensión por violación de términos NO serán reembolsados.`
        },
        {
          title: "10. Modificaciones a los Términos",
          text: `IsabelaOS Studio puede actualizar estos Términos y Condiciones en cualquier momento. Los cambios serán notificados a través de la Plataforma. El uso continuado de la Plataforma tras la publicación de cambios constituye aceptación de los nuevos términos. Se recomienda revisar estos términos periódicamente.`
        },
        {
          title: "11. Ley Aplicable y Jurisdicción",
          text: `Estos Términos se rigen por las leyes de la República de Guatemala. Para cualquier disputa relacionada con estos Términos o el uso de la Plataforma, las partes se someten a la jurisdicción de los tribunales competentes de Guatemala, renunciando a cualquier otro fuero que pudiera corresponderles.`
        },
        {
          title: "12. Contacto",
          text: `Para consultas sobre estos términos, contáctenos en: contacto@isabelaos.com\n\nIsabelaOS Studio · Stalling Technologic\nCobán, Alta Verapaz, Guatemala.`
        }
      ]
    },
    en: {
      title: "Terms and Conditions of Use",
      version: "Version 1.0 — April 2025 · IsabelaOS Studio",
      lastUpdate: "Last updated: April 2025",
      sections: [
        {
          title: "1. Acceptance of Terms",
          text: `By registering, accessing, or using IsabelaOS Studio (hereinafter "the Platform"), the user fully accepts these Terms and Conditions of Use. If you do not agree with any of these terms, you must refrain from using the Platform. Continued use of the Platform constitutes full and binding acceptance of these terms, equivalent to a digital contract signed between the user and Stalling Technologic, creator and operator of IsabelaOS Studio, based in Cobán, Alta Verapaz, Guatemala.`
        },
        {
          title: "2. Service Description",
          text: `IsabelaOS Studio is an AI-powered visual content generation platform that allows users to create images, videos, and multimedia content using AI models. The service operates on a credit system called "Jades" that users purchase to access generation features. Generated results are digital in nature and we do not guarantee specific results, uninterrupted availability, or that generated content is suitable for any specific purpose.`
        },
        {
          title: "3. Exclusive User Responsibility",
          text: `The user is the SOLE AND EXCLUSIVE responsible party for:\n\n• All content they generate, request, download, share, or publish using the Platform.\n• The use made of AI-generated content, regardless of purpose.\n• Any legal, civil, or criminal consequences arising from their use of the content.\n• Verifying that generated content complies with applicable laws in their jurisdiction before use.\n• Obtaining necessary permissions, licenses, or consents to use third-party images.\n\nIsabelaOS Studio acts solely as a technology provider and assumes NO responsibility for user-generated content or the consequences of its use.`
        },
        {
          title: "4. Absolute Prohibition of Identity Impersonation",
          text: `It is strictly PROHIBITED to use IsabelaOS Studio to:\n\n• Impersonate any person, whether public or private.\n• Create content that falsely attributes statements, actions, or behaviors to real people.\n• Generate videos or images of real people without their express and documented consent.\n• Create deepfakes for purposes of deception, fraud, extortion, defamation, or any harmful purpose.\n• Use the image or voice of minors under any circumstances.\n\nViolation of this prohibition may constitute a criminal offense. IsabelaOS Studio will report to competent authorities any identity impersonation case it becomes aware of.`
        },
        {
          title: "5. Prohibition of Illegal and Harmful Content",
          text: `It is strictly PROHIBITED to generate, request, or distribute:\n\n• Explicit sexual or pornographic content of any kind.\n• Child Sexual Abuse Material (CSAM) — which is a serious criminal offense.\n• Content that incites hatred, violence, or discrimination.\n• Content glorifying terrorism, extremism, or violence.\n• False information designed to deceive the public (disinformation).\n• Content that violates copyrights, trademarks, or other intellectual property rights.\n• Any content illegal under the laws of Guatemala, the user's country, or international law.\n\nIsabelaOS Studio has active filtering systems but cannot guarantee detection of 100% of inappropriate content. Users are responsible for not attempting to circumvent these systems.`
        },
        {
          title: "6. Intellectual Property and Image Rights",
          text: `By uploading photographs or images to the Platform, the user declares and warrants that:\n\n• They own the copyright and/or image rights to such photographs, OR\n• They have the express, documented, and valid consent of all persons appearing in them.\n\nIsabelaOS Studio does NOT verify ownership of rights over uploaded images. Any third-party claims related to image rights or copyright over user-uploaded content are the exclusive responsibility of that user. The user agrees to indemnify and hold harmless IsabelaOS Studio against any such claims.`
        },
        {
          title: "7. Disclaimer of IsabelaOS Studio Liability",
          text: `IsabelaOS Studio, Stalling Technologic, and its collaborators shall NOT be liable under any circumstances for:\n\n• The uses users make of AI-generated content.\n• Direct, indirect, incidental, or consequential damages arising from use of the Platform.\n• Loss of data, revenue, reputation, or any other intangible damage.\n• Content generated by AI models, including inaccuracies, biases, or unexpected content.\n• Service interruptions, technical errors, or loss of credits (Jades) due to technical failures.\n• Third-party actions related to content that users generate and share.\n\nTHE PLATFORM IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED.`
        },
        {
          title: "8. Cooperation with Authorities",
          text: `IsabelaOS Studio will fully cooperate with competent authorities from any jurisdiction in response to valid legal requests related to the use of the Platform. This includes providing user information when required by valid court order or legal mandate. By accepting these terms, the user expressly consents to such cooperation.`
        },
        {
          title: "9. Suspension and Termination",
          text: `IsabelaOS Studio reserves the right to suspend or cancel any user's access, without prior notice and without refund, when there is evidence or reasonable suspicion of:\n\n• Violation of these Terms and Conditions.\n• Use of the Platform for illegal activities.\n• Identity impersonation or creation of malicious deepfakes.\n• Generation of explicit sexual content or CSAM.\n• Evasion of the Platform's security systems.\n\nUnused Jades (credits) at the time of suspension for terms violation will NOT be refunded.`
        },
        {
          title: "10. Modifications to Terms",
          text: `IsabelaOS Studio may update these Terms and Conditions at any time. Changes will be notified through the Platform. Continued use of the Platform after posting changes constitutes acceptance of the new terms. We recommend reviewing these terms periodically.`
        },
        {
          title: "11. Applicable Law and Jurisdiction",
          text: `These Terms are governed by the laws of the Republic of Guatemala. For any dispute related to these Terms or use of the Platform, the parties submit to the jurisdiction of the competent courts of Guatemala, waiving any other jurisdiction that may apply.`
        },
        {
          title: "12. Contact",
          text: `For inquiries about these terms, contact us at: contacto@isabelaos.com\n\nIsabelaOS Studio · Stalling Technologic\nCobán, Alta Verapaz, Guatemala.`
        }
      ]
    }
  };

  const t = content[lang] || content.es;

  return (
    <div className="min-h-screen bg-[#06070B] text-white">
      <div className="max-w-4xl mx-auto px-6 py-16">

        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-6">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500 to-fuchsia-500 text-xs font-bold">
              io
            </div>
            <span className="text-sm text-neutral-400">IsabelaOS Studio</span>
          </div>
          <h1 className="text-4xl font-bold text-white mb-3">{t.title}</h1>
          <p className="text-sm text-neutral-500">{t.version}</p>
          <p className="text-xs text-neutral-600 mt-1">{t.lastUpdate}</p>
          <div className="mt-6 p-4 rounded-2xl border border-yellow-400/20 bg-yellow-500/5">
            <p className="text-xs text-yellow-200 leading-relaxed">
              ⚖️ {lang === "es"
                ? "Al usar IsabelaOS Studio, aceptas estos términos en su totalidad. La aceptación queda registrada como un contrato digital vinculante."
                : "By using IsabelaOS Studio, you accept these terms in their entirety. Acceptance is recorded as a binding digital contract."}
            </p>
          </div>
        </div>

        {/* Sections */}
        <div className="space-y-10">
          {t.sections.map((section, i) => (
            <div key={i} className="border-b border-white/5 pb-10">
              <h2 className="text-lg font-semibold text-cyan-300 mb-4">{section.title}</h2>
              <div className="text-sm text-neutral-400 leading-relaxed whitespace-pre-line">
                {section.text}
              </div>
            </div>
          ))}
        </div>

        {/* Footer del documento */}
        <div className="mt-12 pt-8 border-t border-white/10 text-center">
          <p className="text-xs text-neutral-600">
            © 2025 IsabelaOS Studio · Stalling Technologic · Cobán, Alta Verapaz, Guatemala
          </p>
          <p className="text-xs text-neutral-700 mt-1">
            {lang === "es" ? "Documento legal vinculante — Versión 1.0" : "Binding legal document — Version 1.0"}
          </p>
        </div>
      </div>
    </div>
  );
}
