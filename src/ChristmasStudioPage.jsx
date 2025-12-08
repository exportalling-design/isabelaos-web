import { useState } from "react";
import { saveGenerationInSupabase } from "./lib/generations"; // ajusta la ruta si es distinto

// -------------------------------------------------------------------
// Helper: comprimir/redimensionar foto a ~1600px y devolver base64
// -------------------------------------------------------------------
async function fileToCompressedBase64(file) {
  const MAX_SIZE = 1600; // lado más grande

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

        // JPEG alta calidad, peso razonable
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        const base64 = dataUrl.split(",")[1]; // quitar encabezado

        resolve(base64);
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

  const [uploadedImage, setUploadedImage] = useState(null);
  const [navidadImage, setNavidadImage] = useState(null);

  // -------------------------------------------------------------------
  // Manejar archivo subido
  // -------------------------------------------------------------------
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 🔥 NUEVO: BLOQUEO SI EL ARCHIVO ES MAYOR A 8MB
    if (file.size > 8 * 1024 * 1024) {
      setErrorMsg(
        "La foto es demasiado pesada para procesarla. Tómala en calidad estándar o baja e inténtalo de nuevo."
      );
      return;
    }

    setErrorMsg("");
    setSubiendo(true);

    try {
      // 1) Comprimir/redimensionar SIEMPRE
      let base64Compressed;
      try {
        base64Compressed = await fileToCompressedBase64(file);
      } catch (err) {
        console.error("No se pudo comprimir:", err);
        setErrorMsg(
          "No se pudo procesar esta foto. Intenta tomarla en calidad estándar o baja."
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
            "Ocurrió un error al enviar la foto. Inténtalo con otra imagen."
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
          setErrorMsg("Error consultando estado del procesamiento.");
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
          setErrorMsg(
            "El procesamiento falló. Prueba con otra foto (idealmente menos pesada)."
          );
          return;
        }

        // completo
        finalImageB64 =
          statusData.output?.image_b64 ||
          statusData.output?.result?.image_b64 ||
          null;

        if (!finalImageB64) {
          setErrorMsg("No se recibió la imagen procesada desde RunPod.");
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
        console.error("Error guardando:", err);
      }
    } catch (err) {
      setErrorMsg("No se pudo procesar la imagen. Intenta con otra foto.");
    } finally {
      setSubiendo(false);
    }
  };

  return (
    <div className="xmas-page" style={{ padding: "1.5rem", maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.8rem", marginBottom: "0.75rem" }}>
        Foto Navideña IA de Estudio
      </h1>

      <p style={{ marginBottom: "1rem", opacity: 0.8 }}>
        Sube una foto tuya o de tu familia y IsabelaOS convierte el fondo en un
        set navideño hiperreal de estudio profesional.
      </p>

      <div style={{ marginBottom: "1rem" }}>
        <label style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}>
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
        <label style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}>
          Sube tu foto
        </label>

        <input type="file" accept="image/*" onChange={handleFileChange} disabled={subiendo} />

        <p style={{ fontSize: "0.85rem", opacity: 0.6, marginTop: "0.25rem" }}>
          Para mejores resultados, usa fotos con calidad estándar.  
          Las imágenes extremadamente pesadas pueden fallar.
        </p>
      </div>

      {subiendo && <p style={{ marginBottom: "0.75rem" }}>Procesando foto navideña...</p>}

      {errorMsg && <p style={{ marginBottom: "0.75rem", color: "#ff6b6b" }}>{errorMsg}</p>}

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
