// src/components/TermsAcceptanceModal.jsx
// ─────────────────────────────────────────────────────────────
// Modal de aceptación de términos que aparece la primera vez
// que un usuario entra al dashboard.
//
// - Verifica en Supabase si el usuario ya aceptó los términos
// - Si no aceptó, muestra el modal bloqueante
// - Al aceptar, guarda en user_terms_acceptance con timestamp
// - El usuario NO puede usar la plataforma sin aceptar
// ─────────────────────────────────────────────────────────────
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

const TERMS_VERSION = "v1.0-2025";

export default function TermsAcceptanceModal({ user, lang = "es", onAccepted }) {
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [needsAccept, setNeedsAccept] = useState(false);
  const [checked,   setChecked]   = useState({
    terms:          false,
    privacy:        false,
    noImpersonation: false,
    aiContent:      false,
    ageConfirm:     false,
  });
  const [error, setError] = useState(null);

  const allChecked = Object.values(checked).every(Boolean);

  // Verificar si ya aceptó
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      setLoading(true);
      try {
        const { data } = await supabase
          .from("user_terms_acceptance")
          .select("id")
          .eq("user_id", user.id)
          .eq("terms_version", TERMS_VERSION)
          .maybeSingle();

        if (!data) {
          setNeedsAccept(true);
        } else {
          onAccepted?.();
        }
      } catch {
        setNeedsAccept(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [user?.id]);

  const handleAccept = async () => {
    if (!allChecked) return;
    setSaving(true);
    setError(null);
    try {
      const userAgent = navigator?.userAgent?.slice(0, 500) || "";

      const { error: insertErr } = await supabase
        .from("user_terms_acceptance")
        .upsert({
          user_id:              user.id,
          terms_version:        TERMS_VERSION,
          accepted_at:          new Date().toISOString(),
          user_agent:           userAgent,
          accepted_terms:       true,
          accepted_privacy:     true,
          accepted_refund:      true,
          accepted_ai_content:  true,
          accepted_no_impersonation: true,
        }, { onConflict: "user_id,terms_version" });

      if (insertErr) throw insertErr;

      setNeedsAccept(false);
      onAccepted?.();
    } catch (e) {
      setError(lang === "es"
        ? "Error guardando tu aceptación. Intenta de nuevo."
        : "Error saving your acceptance. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !needsAccept) return null;

  const texts = {
    es: {
      title: "Bienvenido a IsabelaOS Studio",
      subtitle: "Antes de continuar, debes leer y aceptar nuestros términos",
      warning: "No podrás usar la plataforma sin aceptar estos términos. Tu aceptación queda registrada como un contrato digital vinculante.",
      checks: [
        { key: "terms",           label: "He leído y acepto los Términos y Condiciones de uso de IsabelaOS Studio." },
        { key: "privacy",         label: "Acepto la Política de Privacidad y el tratamiento de mis datos según lo descrito." },
        { key: "noImpersonation", label: "Entiendo que está PROHIBIDO suplantar identidades, crear deepfakes maliciosos o usar imágenes de terceros sin su consentimiento. Soy el único responsable del contenido que genere." },
        { key: "aiContent",       label: "Entiendo que está PROHIBIDO generar contenido sexual explícito, pornografía, CSAM, o cualquier contenido ilegal. El incumplimiento puede resultar en suspensión de cuenta y reporte a autoridades." },
        { key: "ageConfirm",      label: "Confirmo que soy mayor de 18 años y que el contenido que genere cumplirá con las leyes de mi país." },
      ],
      viewTerms: "Ver Términos completos",
      viewRefund: "Política de Reembolsos",
      accept: "ACEPTO TODOS LOS TÉRMINOS",
      accepting: "Guardando aceptación...",
      mustCheck: "Debes marcar todas las casillas para continuar.",
    },
    en: {
      title: "Welcome to IsabelaOS Studio",
      subtitle: "Before continuing, you must read and accept our terms",
      warning: "You cannot use the platform without accepting these terms. Your acceptance is recorded as a binding digital contract.",
      checks: [
        { key: "terms",           label: "I have read and accept the Terms and Conditions of use of IsabelaOS Studio." },
        { key: "privacy",         label: "I accept the Privacy Policy and the processing of my data as described." },
        { key: "noImpersonation", label: "I understand that it is PROHIBITED to impersonate identities, create malicious deepfakes, or use third-party images without their consent. I am solely responsible for the content I generate." },
        { key: "aiContent",       label: "I understand that it is PROHIBITED to generate explicit sexual content, pornography, CSAM, or any illegal content. Violation may result in account suspension and reporting to authorities." },
        { key: "ageConfirm",      label: "I confirm that I am over 18 years old and that the content I generate will comply with the laws of my country." },
      ],
      viewTerms: "View full Terms",
      viewRefund: "Refund Policy",
      accept: "I ACCEPT ALL TERMS",
      accepting: "Saving acceptance...",
      mustCheck: "You must check all boxes to continue.",
    }
  };

  const t = texts[lang] || texts.es;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/95 backdrop-blur-md px-4">
      <div className="w-full max-w-lg bg-[#0a0a0c] border border-white/10 rounded-3xl overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="bg-gradient-to-r from-cyan-500/10 to-fuchsia-500/10 border-b border-white/10 p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500 to-fuchsia-500 text-xs font-bold text-white">io</div>
            <span className="text-sm text-neutral-400">IsabelaOS Studio</span>
          </div>
          <h2 className="text-xl font-bold text-white">{t.title}</h2>
          <p className="mt-1 text-sm text-neutral-400">{t.subtitle}</p>
        </div>

        {/* Body */}
        <div className="p-6 max-h-[60vh] overflow-y-auto">

          {/* Warning */}
          <div className="mb-5 p-3 rounded-xl border border-yellow-400/20 bg-yellow-500/5">
            <p className="text-xs text-yellow-200 leading-relaxed">⚖️ {t.warning}</p>
          </div>

          {/* Checkboxes */}
          <div className="space-y-3">
            {t.checks.map(({ key, label }) => (
              <label key={key}
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                  checked[key]
                    ? "border-cyan-400/40 bg-cyan-500/5"
                    : "border-white/10 bg-white/2 hover:border-white/20"
                }`}>
                <input
                  type="checkbox"
                  checked={checked[key]}
                  onChange={(e) => setChecked(prev => ({ ...prev, [key]: e.target.checked }))}
                  className="mt-0.5 h-4 w-4 flex-shrink-0 accent-cyan-400 cursor-pointer"
                />
                <span className="text-xs text-neutral-300 leading-relaxed">{label}</span>
              </label>
            ))}
          </div>

          {/* Links a documentos */}
          <div className="mt-4 flex gap-3 flex-wrap">
            <a href="/terms" target="_blank" rel="noopener noreferrer"
              className="text-xs text-cyan-400 underline hover:text-cyan-300">
              {t.viewTerms} →
            </a>
            <a href="/refund" target="_blank" rel="noopener noreferrer"
              className="text-xs text-cyan-400 underline hover:text-cyan-300">
              {t.viewRefund} →
            </a>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/10">
          {!allChecked && (
            <p className="text-xs text-neutral-500 mb-3 text-center">{t.mustCheck}</p>
          )}
          {error && (
            <p className="text-xs text-red-400 mb-3 text-center">{error}</p>
          )}
          <button
            onClick={handleAccept}
            disabled={!allChecked || saving}
            className={`w-full rounded-2xl py-3.5 text-sm font-semibold transition-all ${
              allChecked && !saving
                ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white shadow-[0_0_30px_rgba(34,211,238,0.2)] hover:opacity-90"
                : "bg-white/5 text-neutral-600 cursor-not-allowed"
            }`}>
            {saving ? t.accepting : t.accept}
          </button>
          <p className="mt-3 text-center text-[10px] text-neutral-600">
            {lang === "es"
              ? `Tu aceptación queda registrada con fecha, hora y dispositivo como evidencia legal. Versión ${TERMS_VERSION}.`
              : `Your acceptance is recorded with date, time and device as legal evidence. Version ${TERMS_VERSION}.`}
          </p>
        </div>
      </div>
    </div>
  );
}
