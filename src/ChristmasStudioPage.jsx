import { useState } from "react";
import { saveGenerationInSupabase } from "./lib/generations"; // ajusta la ruta si es distinto

// -------------------------------------------------------------------
// Helper: comprimir/redimensionar foto y devolver base64
// - Normal: 1600px, calidad 0.85
// - Súper pesada (>5MB): 1280px, calidad 0.7 (más agresiva)
// -------------------------------------------------------------------
async function fileToCompressedBase64(file) {
  const isHuge = file.size > 5 * 1024 * 1024; // >5MB = súper pesada
  const MAX_SIZE = isHuge ? 1280 : 1600;
  const QUALITY = isHuge ? 0.7 : 0.85;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        // Mantener proporción y limitar tamaño
        if (width > height) {
          if (width > MAX_SIZE) {
            height = Math.round((height * MAX_SIZE) / width);
            width = MAX_SIZE;
          }
        } else {
          if (height > MAX_SIZE) {
            width = Math.round((width * MAX_SIZE) / height);
            height = MAX_SIZE;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");

        ctx.drawImage(img, 0, 0, width, height);

        // JPEG con calidad variable según tamaño original
        const dataUrl = canvas.toDataURL("image/jpeg", QUALITY);
        const base64 = dataUrl.split(",")[1]; // quitar encabezado

        resolve(base64);
      };

      img.onerror = (err) => {
        console.error("Error cargando imagen para compresión:", err);
        reject(err);
      };
      img.src = e.target.result;
    };

    reader.onerror = (err) => {
      console.error("Error leyendo archivo para compresión:", err);
      reject(err);
    };
    reader.readAsDataURL(file);
  });
}

function ChristmasStudioPage({ currentUser }) {
  const [subiendo, setSubiendo] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [descripcion, setDescripcion] = useState("");

  const [uploadedImage, setUploadedImage] = useState(null);
  const [navidadImage, setNavidadImage] = useState(null);

  // -------------------------------------------------------------------
  // Manejar archivo subido
  // -------------------------------------------------------------------
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // ⛔️ BLOQUEO SI EL ARCHIVO ES MAYOR A 8MB (demasiado para el flujo actual)
    if (file.size > 8 * 1024 * 1024) {
      setErrorMsg(
        "Esta foto es demasiado pesada para procesarla. Tómala en calidad estándar o baja en la cámara (no en alta resolución) e inténtalo de nuevo."
      );
      return;
    }

    setErrorMsg("");
    setSubiendo(true);

    try {
      // 1) Comprimir/redimensionar SIEMPRE (con modo agresivo si es muy pesada)
      let base64Compressed;
      try {
        base64Compressed = await fileToCompressedBase64(file);
      } catch (err) {
        console.error("No se pudo comprimir:", err);
        setErrorMsg(
          "No se pudo procesar esta foto en el navegador. Intenta tomarla en calidad estándar o baja."
        );
        setSubiendo(false);
        return;
      }

      // Guardar preview
      setUploadedImage(`data:image/jpeg;base64,${base64Compressed}`);

      // 2) Enviar a RunPod
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
            "Ocurrió un error al enviar la foto. Intenta con otra imagen o baja un poco la calidad desde la cámara."
        );
        return;
      }

      // 3) Polling al status
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
          setErrorMsg("Error consultando el estado del procesamiento. Intenta de nuevo.");
          return;
        }

        if (
          statusData.status === "IN_QUEUE" ||
          statusData.status === "IN_PROGRESS"
        ) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        if (statusData.status === "FAILED") {
          console.error("Job RunPod FAILED:", statusData);
          setErrorMsg(
            "El procesamiento navideño falló. Prueba con otra foto (mejor en calidad estándar)."
          );
          return;
        }

        // COMPLETED
        finalImageB64 =
          statusData.output?.image_b64 ||
          statusData.output?.result?.image_b64 ||
          null;

        if (!finalImageB64) {
          console.error("No se encontró image_b64 en output:", statusData);
          setErrorMsg(
            "No se recibió la imagen procesada desde RunPod. Intenta de nuevo con otra foto."
          );
          return;
        }

        done = true;
      }

      const resultDataUrl = `data:image/png;base64,${finalImageB64}`;

      setNavidadImage(resultDataUrl);

      // 4) Guardar en Supabase
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
      }
    } catch (err) {
      console.error("Error manejando archivo navideño:", err);
      setErrorMsg("No se pudo procesar la imagen. Intenta con otra foto.");
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
        set navideño hiperreal de estudio profesional.
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

      <div style={{ marginBottom: "0.5rem" }}>
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

        <p
          style={{
            fontSize: "0.85rem",
            opacity: 0.7,
            marginTop: "0.35rem",
          }}
        >
          Recomendado: fotos en formato JPG/PNG y calidad{" "}
          <strong>estándar</strong> (no alta resolución).  
          En celulares muy nuevos (Xiaomi, iPhone, etc.) evita el modo de
          máxima calidad para esta función.
        </p>
      </div>

      {subiendo && (
        <p style={{ marginBottom: "0.75rem" }}>
          Procesando foto navideña...
        </p>
      )}

      {errorMsg && (
        <div
          style={{
            marginBottom: "0.9rem",
            padding: "0.75rem 1rem",
            borderRadius: 10,
            border: "1px solid rgba(255,120,120,0.8)",
            background: "rgba(255,60,60,0.12)",
            display: "flex",
            gap: "0.6rem",
            alignItems: "flex-start",
          }}
        >
          <span
            style={{
              fontSize: "1.1rem",
              lineHeight: 1.2,
            }}
          >
            ⚠️
          </span>
          <div>
            <div
              style={{
                fontWeight: 600,
                marginBottom: "0.15rem",
                fontSize: "0.9rem",
              }}
            >
              No pudimos procesar esta foto
            </div>
            <div
              style={{
                fontSize: "0.86rem",
                opacity: 0.9,
              }}
            >
              {errorMsg}
            </div>
          </div>
        </div>
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
