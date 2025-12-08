import { useState } from "react";
import { saveGenerationInSupabase } from "./lib/generations"; // ajusta la ruta si es distinto

// -------------------------------------------------------------------
// Helper: comprimir/redimensionar foto a ~1600px (con modo agresivo)
// -------------------------------------------------------------------
async function fileToCompressedBase64(file) {
  const MAX_SIZE = 1600; // lado base más grande recomendado

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        const maxSide = Math.max(width, height);

        // Compresión súper agresiva para imágenes enormes
        let targetMax = MAX_SIZE;
        let quality = 0.9;

        if (maxSide > 7000) {
          // Fotos tipo 200MP / resolución extrema
          targetMax = 1280;
          quality = 0.72;
        } else if (maxSide > 5000) {
          // Fotos tipo 50–108MP
          targetMax = 1400;
          quality = 0.78;
        }

        // Mantener proporción y limitar tamaño según targetMax
        if (width > height) {
          if (width > targetMax) {
            height = Math.round((height * targetMax) / width);
            width = targetMax;
          }
        } else {
          if (height > targetMax) {
            width = Math.round((width * targetMax) / height);
            height = targetMax;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");

        ctx.drawImage(img, 0, 0, width, height);

        // JPEG con calidad ajustada según tamaño original
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        const base64 = dataUrl.split(",")[1]; // quitar "data:image/jpeg;base64,"

        resolve(base64);
      };

      img.onerror = reject;
      img.src = e.target.result;
    };

    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// 🔹 NUEVO: fallback por si la compresión falla (usa la imagen original)
async function fileToRawBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result || "";
      const base64 = String(dataUrl).split(",")[1] || "";
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// 🔹 NUEVO: helper para leer dimensiones reales de la foto
async function getImageDimensions(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.width, height: img.height });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function ChristmasStudioPage({ currentUser }) {
  const [subiendo, setSubiendo] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [descripcion, setDescripcion] = useState("");

  const [uploadedImage, setUploadedImage] = useState(null); // preview original
  const [navidadImage, setNavidadImage] = useState(null);   // resultado estudio

  // 🔹 NUEVO: aviso dinámico según tamaño/resolución de la foto
  const [resolutionWarning, setResolutionWarning] = useState("");

  // -------------------------------------------------------------------
  // Manejar archivo subido
  // -------------------------------------------------------------------
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg("");
    setResolutionWarning("");
    setSubiendo(true);

    try {
      // 0) Analizar peso y resolución de la foto para mostrar aviso
      try {
        const megaBytes = file.size / (1024 * 1024);
        let warning = "";

        if (megaBytes > 8) {
          warning =
            `Tu foto pesa aproximadamente ${megaBytes.toFixed(
              1
            )} MB. ` +
            "Si ves errores al procesar, prueba bajando la calidad de la cámara a modo estándar o recortando la foto antes de subirla.";
        }

        const dims = await getImageDimensions(file).catch(() => null);
        if (dims) {
          const { width, height } = dims;
          const maxSide = Math.max(width, height);

          if (maxSide > 5000) {
            warning =
              (warning ? warning + " " : "") +
              `Detectamos una resolución muy alta (${width} x ${height}). ` +
              "Las cámaras de gama alta (Xiaomi, Samsung, iPhone, etc.) pueden generar archivos enormes. " +
              "Si tu foto no se procesa correctamente, toma la foto en calidad estándar / retrato o reduce la resolución antes de subirla.";
          }
        }

        if (warning) {
          setResolutionWarning(warning);
        }
      } catch (dimErr) {
        console.warn("No se pudieron leer las dimensiones de la foto:", dimErr);
      }

      // 1) Comprimir/redimensionar
      // 🔹 CAMBIO: intentamos comprimir y, si falla, usamos la imagen original
      let base64Compressed;
      try {
        base64Compressed = await fileToCompressedBase64(file);
      } catch (err) {
        console.error("Error al comprimir, usando imagen original:", err);
        base64Compressed = await fileToRawBase64(file);
      }

      // Guardar preview original (izquierda)
      setUploadedImage(`data:image/jpeg;base64,${base64Compressed}`);

      // 2) Lanzar job en /api/generate-xmas
      const res = await fetch("/api/generate-xmas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_b64: base64Compressed,
          description: descripcion || "",
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data || !data.ok || !data.jobId) {
        console.error("Error al lanzar job navidad_estudio:", data);
        setErrorMsg(
          data?.error ||
            "Ocurrió un error al enviar la foto navideña. Si la tomaste en máxima resolución, intenta bajando la calidad de la cámara y vuelve a intentarlo."
        );
        return;
      }

      // 3) Polling al endpoint de status (igual que haces para /api/generate-status)
      const jobId = data.jobId;
      let done = false;
      let finalImageB64 = null;

      while (!done) {
        const statusRes = await fetch("/api/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId }),
        });

        const statusData = await statusRes.json().catch(() => null);

        if (!statusRes.ok || !statusData) {
          console.error("Error consultando status RunPod:", statusData);
          setErrorMsg(
            "Error consultando el estado del procesamiento. Si el problema continúa, intenta con una foto en calidad estándar."
          );
          return;
        }

        if (
          statusData.status === "IN_QUEUE" ||
          statusData.status === "IN_PROGRESS"
        ) {
          // Esperar un poco y seguir
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        if (statusData.status === "FAILED") {
          console.error("Job RunPod FAILED:", statusData);
          setErrorMsg(
            "El procesamiento navideño falló. Si usaste una foto muy grande, prueba tomarla en calidad estándar y vuelve a intentarlo."
          );
          return;
        }

        // status === "COMPLETED"
        finalImageB64 =
          statusData.output?.image_b64 ||
          statusData.output?.result?.image_b64 ||
          null;

        if (!finalImageB64) {
          console.error("No se encontró image_b64 en output:", statusData);
          setErrorMsg(
            "No se recibió la imagen procesada desde el servidor. Intenta con una foto un poco más ligera o en modo retrato."
          );
          return;
        }

        done = true;
      }

      const resultDataUrl = `data:image/png;base64,${finalImageB64}`;

      // Mostrar resultado (derecha)
      setNavidadImage(resultDataUrl);

      // 4) Guardar en la biblioteca
      try {
        await saveGenerationInSupabase({
          imageDataUrl: resultDataUrl,
          meta: {
            mode: "navidad_estudio",
            description: descripcion || "",
          },
          userId: currentUser?.id || null,
          prompt: "[Foto navideña de estudio – fondo reemplazado]",
        });
      } catch (err) {
        console.error("Error guardando en biblioteca:", err);
        // No rompas la experiencia si solo falla el guardado
      }
    } catch (err) {
      console.error("Error manejando archivo navideño:", err);
      setErrorMsg(
        "No se pudo procesar la imagen. Si tu foto fue tomada en resolución máxima, intenta bajando la calidad o usando modo retrato y vuelve a subirla."
      );
    } finally {
      setSubiendo(false);
    }
  };

  return (
    <div
      className="xmas-page"
      style={{ padding: "1.5rem", maxWidth: 1200, margin: "0 auto" }}
    >
      <h1 style={{ fontSize: "1.8rem", marginBottom: "0.75rem" }}>
        Foto Navideña IA de Estudio
      </h1>
      <p style={{ marginBottom: "1rem", opacity: 0.8 }}>
        Sube una foto tuya o de tu familia y IsabelaOS convierte el fondo en un
        set navideño hiperreal de estudio profesional: luces de lujo, edición
        premium y detalles como si lo hubieras hecho en un estudio fotográfico
        carísimo.
      </p>

      <div style={{ marginBottom: "1rem" }}>
        <label
          style={{
            display: "block",
            fontWeight: 600,
            marginBottom: "0.25rem",
          }}
        >
          Descripción (opcional)
        </label>
        <input
          type="text"
          placeholder="Ejemplo: familia de 4 personas, perro, etc."
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          style={{
            width: "100%",
            padding: "0.5rem 0.75rem",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.15)",
            background: "rgba(0,0,0,0.4)",
            color: "white",
          }}
        />
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <label
          style={{
            display: "block",
            fontWeight: 600,
            marginBottom: "0.25rem",
          }}
        >
          Sube tu foto
        </label>
        <input
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          disabled={subiendo}
        />
      </div>

      {/* 🔹 NUEVO: Recuadro elegante con instrucciones de tamaño/calidad */}
      <div
        style={{
          marginBottom: "1rem",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.12)",
          background:
            "linear-gradient(135deg, rgba(15,23,42,0.95), rgba(30,64,175,0.35))",
          padding: "0.85rem 1rem",
          fontSize: "0.78rem",
          color: "rgba(226,232,240,0.9)",
        }}
      >
        <div
          style={{
            fontWeight: 600,
            marginBottom: "0.35rem",
            display: "flex",
            alignItems: "center",
            gap: "0.4rem",
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "999px",
              background:
                "radial-gradient(circle, #22d3ee 0%, transparent 70%)",
            }}
          />
          Recomendaciones para que tu foto se procese bien
        </div>
        <ul style={{ margin: 0, paddingLeft: "1.1rem", lineHeight: 1.4 }}>
          <li>
            Resolución ideal: entre{" "}
            <strong>1500 y 3000 píxeles por lado</strong>.
          </li>
          <li>
            Peso sugerido: menos de <strong>4–5 MB</strong> por foto.
          </li>
          <li>
            Si tu cámara está en modo <strong>alta resolución</strong> (48MP,
            50MP, 108MP, 200MP), usa mejor modo estándar o retrato.
          </li>
          <li>
            Si el sistema detecta <strong>desnudos o ropa demasiado
            explícita</strong>, la imagen resultante puede aparecer en negro por
            seguridad automática.
          </li>
        </ul>

        {resolutionWarning && (
          <p
            style={{
              marginTop: "0.5rem",
              fontSize: "0.75rem",
              color: "#bfdbfe",
            }}
          >
            {resolutionWarning}
          </p>
        )}
      </div>

      {subiendo && (
        <p style={{ marginBottom: "0.75rem" }}>Procesando foto navideña...</p>
      )}

      {errorMsg && (
        <p style={{ marginBottom: "0.75rem", color: "#ff6b6b" }}>{errorMsg}</p>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "1rem",
          marginTop: "1rem",
        }}
      >
        <div
          style={{
            borderRadius: 12,
            padding: "0.75rem",
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(0,0,0,0.25)",
          }}
        >
          <h3 style={{ marginBottom: "0.5rem" }}>Foto original</h3>
          {uploadedImage ? (
            <img
              src={uploadedImage}
              alt="Foto original"
              style={{
                width: "100%",
                borderRadius: 12,
                objectFit: "contain",
                maxHeight: 400,
              }}
            />
          ) : (
            <p style={{ opacity: 0.6 }}>Aún no has subido ninguna foto.</p>
          )}
        </div>

        <div
          style={{
            borderRadius: 12,
            padding: "0.75rem",
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(0,0,0,0.25)",
          }}
        >
          <h3 style={{ marginBottom: "0.5rem" }}>Foto navideña de estudio</h3>
          {navidadImage ? (
            <img
              src={navidadImage}
              alt="Foto navideña IA"
              style={{
                width: "100%",
                borderRadius: 12,
                objectFit: "contain",
                maxHeight: 400,
              }}
            />
          ) : (
            <p style={{ opacity: 0.6 }}>
              Aquí aparecerá tu foto con fondo navideño de estudio.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default ChristmasStudioPage;

