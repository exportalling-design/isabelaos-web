"use client";

import { useState, useCallback, useRef, useEffect } from "react";

// ============================================================
// TIPOS DE TEMPLATE - 4 modos como Pomelli
// ============================================================
const TEMPLATES = [
  {
    id: "studio",
    label: "Studio",
    icon: "✦",
    description: "Fondo limpio, iluminación profesional de estudio",
    tag: "Más popular",
  },
  {
    id: "lifestyle",
    label: "Lifestyle",
    icon: "◈",
    description: "Producto en escena real, ambiente natural",
    tag: null,
  },
  {
    id: "inuse",
    label: "In Use",
    icon: "◉",
    description: "Modelo latinx usando o sosteniendo el producto",
    tag: "Exclusivo LatAm",
  },
  {
    id: "campaign",
    label: "Campaign",
    icon: "◇",
    description: "Campaña de temporada: Navidad, San Valentín, etc.",
    tag: null,
  },
];

const SEASONS = [
  { id: "christmas", label: "🎄 Navidad" },
  { id: "valentines", label: "💕 San Valentín" },
  { id: "halloween", label: "🎃 Halloween" },
  { id: "mothers", label: "🌸 Día de la Madre" },
  { id: "blackfriday", label: "🛍 Black Friday" },
  { id: "summer", label: "☀️ Verano" },
];

const JADES_PER_IMAGE = 5;
const IMAGES_PER_SESSION = 4;
const TOTAL_JADES = JADES_PER_IMAGE * IMAGES_PER_SESSION;

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================
export default function ProductPhotoshoot({ userJades = 0, onJadesDeducted }) {
  // Inyectar CSS responsive una sola vez
  useEffect(() => {
    const id = "photoshoot-responsive-css";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      .ps-config-layout {
        display: grid;
        grid-template-columns: 240px 1fr;
        min-height: 500px;
      }
      .ps-preview-panel {
        padding: 24px;
        border-right: 1px solid rgba(255,255,255,0.06);
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .ps-config-panel {
        padding: 24px;
        overflow-y: auto;
      }
      .ps-templates-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 10px;
      }
      .ps-results-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 14px;
        margin-bottom: 24px;
      }
      .ps-cost-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 20px;
        padding: 16px 20px;
        background: rgba(124,255,212,0.04);
        border: 1px solid rgba(124,255,212,0.12);
        border-radius: 12px;
        flex-wrap: wrap;
        gap: 12px;
      }
      .ps-placeholder-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
      }
      .ps-more-templates-btns {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .ps-seasons-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      /* ── MOBILE ── */
      @media (max-width: 640px) {
        .ps-config-layout {
          grid-template-columns: 1fr !important;
          min-height: unset;
        }
        .ps-preview-panel {
          border-right: none !important;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          padding: 16px !important;
          flex-direction: row !important;
          align-items: center;
          gap: 16px;
        }
        .ps-preview-panel .ps-image-preview-box {
          width: 90px !important;
          min-width: 90px;
          height: 90px !important;
          flex-shrink: 0;
        }
        .ps-config-panel {
          padding: 16px !important;
        }
        .ps-templates-grid {
          grid-template-columns: repeat(2, 1fr) !important;
          gap: 8px !important;
        }
        .ps-results-grid {
          grid-template-columns: repeat(2, 1fr) !important;
          gap: 10px !important;
        }
        .ps-placeholder-grid {
          grid-template-columns: repeat(2, 1fr) !important;
        }
        .ps-cost-row {
          flex-direction: column !important;
          align-items: stretch !important;
        }
        .ps-cost-row .ps-generate-btn {
          width: 100% !important;
          text-align: center;
        }
        .ps-results-header {
          flex-direction: column !important;
          gap: 10px !important;
        }
        .ps-dropzone {
          padding: 36px 20px !important;
          margin: 12px !important;
        }
        .ps-generating-inner {
          max-width: 100% !important;
          padding: 0 8px;
        }
      }
    `;
    document.head.appendChild(style);
  }, []);

  const [step, setStep] = useState("upload"); // upload | configure | generating | results
  const [uploadedImage, setUploadedImage] = useState(null);
  const [uploadedImageBase64, setUploadedImageBase64] = useState(null);
  const [uploadedMimeType, setUploadedMimeType] = useState("image/jpeg");
  const [selectedTemplate, setSelectedTemplate] = useState("studio");
  const [selectedSeason, setSelectedSeason] = useState("christmas");
  const [productDescription, setProductDescription] = useState("");
  const [generatedImages, setGeneratedImages] = useState([]);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  // ---- manejo de upload ----
  const handleFile = useCallback((file) => {
    if (!file || !file.type.startsWith("image/")) return;
    setUploadedMimeType(file.type || "image/jpeg");
    const url = URL.createObjectURL(file);
    setUploadedImage(url);

    // convertir a base64 para enviar a la API
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result.split(",")[1];
      setUploadedImageBase64(base64);
    };
    reader.readAsDataURL(file);
    setStep("configure");
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  // ---- generación ----
  const handleGenerate = async () => {
    if (userJades < TOTAL_JADES) {
      setError(`Necesitas ${TOTAL_JADES} Jades. Tienes ${userJades}.`);
      return;
    }
    setError(null);
    setStep("generating");
    setProgress(0);

    try {
      // Generar 4 variaciones en paralelo
      const promises = Array.from({ length: 4 }, (_, i) =>
        generateVariation(i)
      );

      const results = [];
      let completed = 0;

      for (const promise of promises) {
        const result = await promise;
        results.push(result);
        completed++;
        setProgress(Math.round((completed / 4) * 100));
      }

      setGeneratedImages(results);
      onJadesDeducted?.(TOTAL_JADES);
      setStep("results");
    } catch (err) {
      setError("Error generando imágenes. Intenta de nuevo.");
      setStep("configure");
    }
  };

  const generateVariation = async (variationIndex) => {
    // Obtener token igual que CreatorPanel y demás módulos
    let token = null;
    try {
      const { supabase } = await import("../lib/supabaseClient.js");
      const { data } = await supabase.auth.getSession();
      token = data?.session?.access_token || null;
    } catch {}

    const response = await fetch("/api/product-photoshoot", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        imageBase64:        uploadedImageBase64,
        imageMimeType:      uploadedMimeType,
        template:           selectedTemplate,
        season:             selectedTemplate === "campaign" ? selectedSeason : null,
        productDescription,
        variationIndex,
      }),
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      // Mensaje amigable para saldo insuficiente
      if (data.error === "INSUFFICIENT_JADES") {
        throw new Error(`Jades insuficientes. Necesitas ${data.required} Jades.`);
      }
      throw new Error(data.detail || data.error || "Error generando imagen");
    }
    return data.imageUrl;
  };

  const handleReset = () => {
    setStep("upload");
    setUploadedImage(null);
    setUploadedImageBase64(null);
    setUploadedMimeType("image/jpeg");
    setGeneratedImages([]);
    setProductDescription("");
    setSelectedTemplate("studio");
    setError(null);
  };

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div style={styles.wrapper}>
      {/* Header del módulo */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.headerIcon}>◈</span>
          <div>
            <h2 style={styles.headerTitle}>Product Photoshoot</h2>
            <p style={styles.headerSub}>
              Convierte cualquier foto en contenido profesional
            </p>
          </div>
        </div>
        <div style={styles.jadeBadge}>
          <span style={styles.jadeIcon}>◆</span>
          <span style={styles.jadeCount}>{userJades} Jades</span>
        </div>
      </div>

      {/* ---- STEP: UPLOAD ---- */}
      {step === "upload" && (
        <div
          style={{
            ...styles.dropzone,
            ...(isDragging ? styles.dropzoneActive : {}),
          }} className="ps-dropzone"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => handleFile(e.target.files[0])}
          />
          <div style={styles.dropzoneIcon}>⬆</div>
          <p style={styles.dropzoneTitle}>Sube la foto de tu producto</p>
          <p style={styles.dropzoneSub}>
            No importa la calidad — nosotros la transformamos
          </p>
          <p style={styles.dropzoneFormats}>PNG, JPG, WEBP · Máx 10MB</p>
          <button style={styles.uploadBtn}>Seleccionar archivo</button>
        </div>
      )}

      {/* ---- STEP: CONFIGURE ---- */}
      {step === "configure" && (
        <div style={styles.configLayout} className="ps-config-layout">
          {/* Preview del producto */}
          <div style={styles.previewPanel} className="ps-preview-panel">
            <p style={styles.panelLabel}>Tu producto</p>
            <div style={styles.imagePreviewBox} className="ps-image-preview-box">
              <img
                src={uploadedImage}
                alt="Producto"
                style={styles.previewImg}
              />
            </div>
            <button style={styles.changeBtn} onClick={handleReset}>
              ← Cambiar imagen
            </button>
          </div>

          {/* Configuración */}
          <div style={styles.configPanel} className="ps-config-panel">
            {/* Templates */}
            <p style={styles.panelLabel}>Tipo de foto</p>
            <div style={styles.templatesGrid} className="ps-templates-grid">
              {TEMPLATES.map((t) => (
                <div
                  key={t.id}
                  style={{
                    ...styles.templateCard,
                    ...(selectedTemplate === t.id
                      ? styles.templateCardActive
                      : {}),
                  }}
                  onClick={() => setSelectedTemplate(t.id)}
                >
                  {t.tag && <span style={styles.templateTag}>{t.tag}</span>}
                  <div style={styles.templateIcon}>{t.icon}</div>
                  <p style={styles.templateLabel}>{t.label}</p>
                  <p style={styles.templateDesc}>{t.description}</p>
                </div>
              ))}
            </div>

            {/* Selector de temporada (solo si campaign) */}
            {selectedTemplate === "campaign" && (
              <div style={{ marginTop: 16 }}>
                <p style={styles.panelLabel}>Temporada</p>
                <div style={styles.seasonsGrid} className="ps-seasons-grid">
                  {SEASONS.map((s) => (
                    <button
                      key={s.id}
                      style={{
                        ...styles.seasonBtn,
                        ...(selectedSeason === s.id
                          ? styles.seasonBtnActive
                          : {}),
                      }}
                      onClick={() => setSelectedSeason(s.id)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Descripción opcional */}
            <div style={{ marginTop: 16 }}>
              <p style={styles.panelLabel}>
                Describe tu producto{" "}
                <span style={styles.optional}>(opcional)</span>
              </p>
              <textarea
                style={styles.textarea}
                placeholder="Ej: Crema hidratante con aloe vera, empaque verde, para piel sensible..."
                value={productDescription}
                onChange={(e) => setProductDescription(e.target.value)}
                rows={3}
              />
            </div>

            {/* Costo y CTA */}
            <div style={styles.costRow} className="ps-cost-row">
              <div style={styles.costInfo}>
                <span style={styles.costLabel}>Costo de sesión</span>
                <div style={styles.costAmount}>
                  <span style={styles.jadeIcon}>◆</span>
                  <span style={styles.costNumber}>{TOTAL_JADES} Jades</span>
                  <span style={styles.costSub}>
                    (4 variaciones × {JADES_PER_IMAGE} Jades)
                  </span>
                </div>
              </div>
              <button
                style={{
                  ...styles.generateBtn,
                  ...(userJades < TOTAL_JADES ? styles.generateBtnDisabled : {}),
                }}
                onClick={handleGenerate}
                disabled={userJades < TOTAL_JADES}
              >
                Generar 4 fotos →
              </button>
            </div>

            {userJades < TOTAL_JADES && (
              <p style={styles.errorMsg}>
                Necesitas {TOTAL_JADES} Jades. Tienes {userJades}.{" "}
                <a href="/jades" style={styles.buyLink}>
                  Comprar Jades
                </a>
              </p>
            )}

            {error && <p style={styles.errorMsg}>{error}</p>}
          </div>
        </div>
      )}

      {/* ---- STEP: GENERATING ---- */}
      {step === "generating" && (
        <div style={styles.generatingWrapper}>
          <div style={styles.generatingInner} className="ps-generating-inner">
            <div style={styles.spinnerWrapper}>
              <div style={styles.spinner} />
              <span style={styles.spinnerIcon}>◈</span>
            </div>
            <h3 style={styles.generatingTitle}>Creando tus fotos...</h3>
            <p style={styles.generatingDesc}>
              Generando 4 variaciones profesionales de tu producto
            </p>

            {/* Barra de progreso */}
            <div style={styles.progressBar}>
              <div
                style={{ ...styles.progressFill, width: `${progress}%` }}
              />
            </div>
            <p style={styles.progressText}>{progress}% completado</p>

            {/* Placeholders animados */}
            <div style={styles.placeholderGrid} className="ps-placeholder-grid">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  style={{
                    ...styles.placeholder,
                    opacity: progress >= (i + 1) * 25 ? 1 : 0.3,
                  }}
                >
                  {progress >= (i + 1) * 25 ? "✓" : "..."}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ---- STEP: RESULTS ---- */}
      {step === "results" && (
        <div style={styles.resultsWrapper}>
          <div style={styles.resultsHeader} className="ps-results-header">
            <div>
              <h3 style={styles.resultsTitle}>
                ✦ Tus fotos están listas
              </h3>
              <p style={styles.resultsSub}>
                4 variaciones •{" "}
                {TEMPLATES.find((t) => t.id === selectedTemplate)?.label}
              </p>
            </div>
            <div style={styles.resultsActions}>
              <button style={styles.newSessionBtn} onClick={handleReset}>
                Nueva sesión
              </button>
            </div>
          </div>

          <div style={styles.resultsGrid} className="ps-results-grid">
            {generatedImages.map((imgUrl, i) => (
              <div key={i} style={styles.resultCard}>
                <div style={styles.resultImageBox}>
                  <img
                    src={imgUrl}
                    alt={`Variación ${i + 1}`}
                    style={styles.resultImg}
                  />
                  {/* Botón de descarga siempre visible — esquina superior derecha */}
                  <a
                    href={imgUrl}
                    download={`photoshoot-${selectedTemplate}-${i + 1}.jpg`}
                    style={styles.downloadBadge}
                    title="Descargar imagen"
                    onClick={(e) => e.stopPropagation()}
                  >
                    ↓
                  </a>
                  {/* Número de variación — esquina inferior izquierda */}
                  <div style={styles.varBadge}>
                    {i + 1}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={styles.moreTemplates}>
            <p style={styles.moreLabel}>¿Quieres probar otro estilo?</p>
            <div style={styles.moreTemplatesBtns} className="ps-more-templates-btns">
              {TEMPLATES.filter((t) => t.id !== selectedTemplate).map((t) => (
                <button
                  key={t.id}
                  style={styles.moreTemplateBtn}
                  onClick={() => {
                    setSelectedTemplate(t.id);
                    setStep("configure");
                  }}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// ESTILOS
// ============================================================
const styles = {
  wrapper: {
    background: "#0a0a0f",
    borderRadius: 20,
    border: "1px solid rgba(255,255,255,0.08)",
    overflow: "hidden",
    fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
    color: "#f0f0f5",
  },

  // Header
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "20px 24px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    background: "rgba(255,255,255,0.02)",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  headerIcon: {
    fontSize: 28,
    color: "#7cffd4",
  },
  headerTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: "-0.3px",
  },
  headerSub: {
    margin: 0,
    fontSize: 13,
    color: "rgba(255,255,255,0.45)",
    marginTop: 2,
  },
  jadeBadge: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "rgba(124,255,212,0.08)",
    border: "1px solid rgba(124,255,212,0.2)",
    borderRadius: 20,
    padding: "6px 14px",
  },
  jadeIcon: {
    color: "#7cffd4",
    fontSize: 12,
  },
  jadeCount: {
    fontSize: 13,
    fontWeight: 600,
    color: "#7cffd4",
  },

  // Dropzone
  dropzone: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: "60px 40px",
    margin: 24,
    border: "2px dashed rgba(255,255,255,0.12)",
    borderRadius: 16,
    cursor: "pointer",
    transition: "all 0.2s",
    background: "rgba(255,255,255,0.02)",
    textAlign: "center",
  },
  dropzoneActive: {
    border: "2px dashed #7cffd4",
    background: "rgba(124,255,212,0.04)",
  },
  dropzoneIcon: {
    fontSize: 36,
    color: "rgba(255,255,255,0.3)",
  },
  dropzoneTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 600,
  },
  dropzoneSub: {
    margin: 0,
    fontSize: 14,
    color: "rgba(255,255,255,0.45)",
  },
  dropzoneFormats: {
    margin: 0,
    fontSize: 12,
    color: "rgba(255,255,255,0.25)",
  },
  uploadBtn: {
    marginTop: 8,
    padding: "10px 24px",
    background: "rgba(124,255,212,0.1)",
    border: "1px solid rgba(124,255,212,0.3)",
    borderRadius: 10,
    color: "#7cffd4",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },

  // Config layout
  configLayout: {
    display: "grid",
    gridTemplateColumns: "240px 1fr",
    gap: 0,
    minHeight: 500,
  },
  previewPanel: {
    padding: 24,
    borderRight: "1px solid rgba(255,255,255,0.06)",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  imagePreviewBox: {
    borderRadius: 12,
    overflow: "hidden",
    background: "#111118",
    border: "1px solid rgba(255,255,255,0.06)",
    aspectRatio: "1",
  },
  previewImg: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
  },
  changeBtn: {
    background: "none",
    border: "none",
    color: "rgba(255,255,255,0.4)",
    fontSize: 13,
    cursor: "pointer",
    padding: 0,
    textAlign: "left",
  },
  configPanel: {
    padding: 24,
    overflowY: "auto",
  },
  panelLabel: {
    margin: "0 0 10px",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "rgba(255,255,255,0.4)",
  },
  optional: {
    fontWeight: 400,
    textTransform: "none",
    letterSpacing: 0,
    color: "rgba(255,255,255,0.25)",
  },

  // Templates
  templatesGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 10,
  },
  templateCard: {
    padding: "14px 10px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.02)",
    cursor: "pointer",
    transition: "all 0.15s",
    textAlign: "center",
    position: "relative",
  },
  templateCardActive: {
    border: "1px solid rgba(124,255,212,0.5)",
    background: "rgba(124,255,212,0.06)",
  },
  templateTag: {
    position: "absolute",
    top: -8,
    left: "50%",
    transform: "translateX(-50%)",
    background: "#7cffd4",
    color: "#0a0a0f",
    fontSize: 9,
    fontWeight: 800,
    padding: "2px 8px",
    borderRadius: 20,
    whiteSpace: "nowrap",
  },
  templateIcon: {
    fontSize: 22,
    marginBottom: 6,
    color: "#7cffd4",
  },
  templateLabel: {
    margin: "0 0 4px",
    fontSize: 13,
    fontWeight: 700,
  },
  templateDesc: {
    margin: 0,
    fontSize: 11,
    color: "rgba(255,255,255,0.35)",
    lineHeight: 1.4,
  },

  // Seasons
  seasonsGrid: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  },
  seasonBtn: {
    padding: "7px 14px",
    borderRadius: 20,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.03)",
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    cursor: "pointer",
    transition: "all 0.15s",
  },
  seasonBtnActive: {
    border: "1px solid rgba(124,255,212,0.5)",
    background: "rgba(124,255,212,0.08)",
    color: "#7cffd4",
  },

  // Textarea
  textarea: {
    width: "100%",
    padding: "12px 14px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 10,
    color: "#f0f0f5",
    fontSize: 13,
    resize: "vertical",
    fontFamily: "inherit",
    boxSizing: "border-box",
    outline: "none",
  },

  // Cost row
  costRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 20,
    padding: "16px 20px",
    background: "rgba(124,255,212,0.04)",
    border: "1px solid rgba(124,255,212,0.12)",
    borderRadius: 12,
    flexWrap: "wrap",
    gap: 12,
  },
  costInfo: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  costLabel: {
    fontSize: 11,
    color: "rgba(255,255,255,0.35)",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  costAmount: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  costNumber: {
    fontSize: 20,
    fontWeight: 800,
    color: "#7cffd4",
  },
  costSub: {
    fontSize: 12,
    color: "rgba(255,255,255,0.3)",
  },
  generateBtn: {
    padding: "12px 28px",
    background: "#7cffd4",
    color: "#0a0a0f",
    border: "none",
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 800,
    cursor: "pointer",
    letterSpacing: "-0.2px",
    transition: "all 0.15s",
  },
  generateBtnDisabled: {
    opacity: 0.4,
    cursor: "not-allowed",
  },
  errorMsg: {
    marginTop: 10,
    fontSize: 13,
    color: "#ff7c7c",
  },
  buyLink: {
    color: "#7cffd4",
    textDecoration: "underline",
  },

  // Generating
  generatingWrapper: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 480,
    padding: 40,
  },
  generatingInner: {
    textAlign: "center",
    maxWidth: 400,
  },
  spinnerWrapper: {
    position: "relative",
    width: 64,
    height: 64,
    margin: "0 auto 24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  spinner: {
    position: "absolute",
    inset: 0,
    borderRadius: "50%",
    border: "2px solid rgba(124,255,212,0.15)",
    borderTopColor: "#7cffd4",
    animation: "spin 1s linear infinite",
  },
  spinnerIcon: {
    fontSize: 24,
    color: "#7cffd4",
    position: "relative",
    zIndex: 1,
  },
  generatingTitle: {
    margin: "0 0 8px",
    fontSize: 22,
    fontWeight: 700,
  },
  generatingDesc: {
    margin: "0 0 24px",
    fontSize: 14,
    color: "rgba(255,255,255,0.45)",
  },
  progressBar: {
    height: 4,
    background: "rgba(255,255,255,0.08)",
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: 8,
  },
  progressFill: {
    height: "100%",
    background: "#7cffd4",
    borderRadius: 4,
    transition: "width 0.4s ease",
  },
  progressText: {
    fontSize: 13,
    color: "rgba(255,255,255,0.4)",
    margin: "0 0 24px",
  },
  placeholderGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 8,
  },
  placeholder: {
    height: 80,
    background: "rgba(255,255,255,0.04)",
    borderRadius: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 18,
    color: "#7cffd4",
    transition: "opacity 0.3s",
  },

  // Results
  resultsWrapper: {
    padding: 24,
  },
  resultsHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  resultsTitle: {
    margin: "0 0 4px",
    fontSize: 20,
    fontWeight: 700,
  },
  resultsSub: {
    margin: 0,
    fontSize: 13,
    color: "rgba(255,255,255,0.4)",
  },
  resultsActions: {
    display: "flex",
    gap: 10,
  },
  newSessionBtn: {
    padding: "8px 18px",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    color: "#f0f0f5",
    fontSize: 13,
    cursor: "pointer",
  },
  resultsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 14,
    marginBottom: 24,
  },
  resultCard: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  resultImageBox: {
    position: "relative",
    borderRadius: 12,
    overflow: "hidden",
    background: "#111118",
    aspectRatio: "1",
    border: "1px solid rgba(255,255,255,0.06)",
  },
  resultImg: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  // Badge de descarga — siempre visible, esquina superior derecha
  downloadBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: "50%",
    background: "#7cffd4",
    color: "#0a0a0f",
    fontSize: 15,
    fontWeight: 900,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textDecoration: "none",
    boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
    zIndex: 2,
    transition: "transform 0.15s, box-shadow 0.15s",
    cursor: "pointer",
  },
  // Número de variación — esquina inferior izquierda
  varBadge: {
    position: "absolute",
    bottom: 8,
    left: 8,
    background: "rgba(0,0,0,0.55)",
    backdropFilter: "blur(4px)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 6,
    padding: "2px 8px",
    fontSize: 11,
    fontWeight: 700,
    color: "rgba(255,255,255,0.7)",
    zIndex: 2,
  },
  resultLabel: {
    margin: 0,
    fontSize: 12,
    color: "rgba(255,255,255,0.35)",
    textAlign: "center",
  },

  // More templates
  moreTemplates: {
    padding: "16px 20px",
    background: "rgba(255,255,255,0.02)",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.06)",
  },
  moreLabel: {
    margin: "0 0 10px",
    fontSize: 13,
    color: "rgba(255,255,255,0.45)",
  },
  moreTemplatesBtns: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },
  moreTemplateBtn: {
    padding: "7px 16px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 20,
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    cursor: "pointer",
    transition: "all 0.15s",
  },
};
