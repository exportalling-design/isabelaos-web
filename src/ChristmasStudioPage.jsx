import { useState } from "react";
import { saveGenerationInSupabase } from "./lib/generations"; // ajusta la ruta si es distinto

// -------------------------------------------------------------------
// NUEVO compresor seguro compatible con fotos gigantes de celular
// -------------------------------------------------------------------
async function fileToCompressedBase64(file) {
  const MAX_SIZE = 1600; // tamaño final deseado

  // Si el navegador soporta createImageBitmap (Chrome/Android, etc.)
  if (typeof createImageBitmap === "function") {
    const imgBitmap = await createImageBitmap(file);

    let { width, height } = imgBitmap;

    // Redimensionar manteniendo proporción
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

    // Canvas pequeño y seguro
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(imgBitmap, 0, 0, width, height);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    return dataUrl.split(",")[1];
  }

  // 🔙 Fallback para navegadores que no tengan createImageBitmap
  const MAX_SIZE = 1600;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

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

        const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
        const base64 = dataUrl.split(",")[1];

        resolve(base64);
      };

      img.onerror = reject;
      img.src = e.target.result;
    };

    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// 🔹 Fallback: usar la imagen original en base64 si todo lo demás falla
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

function ChristmasStudioPage({ currentUser }) {
  const [subiendo, setSubiendo] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [descripcion, setDescripcion] = useState("");

  const [uploadedImage, setUploadedImage] = useState(null); // preview original
  const [navidadImage, setNavidadImage] = useState(null);   // resultado estudio

  // -------------------------------------------------------------------
  // Manejar archivo subido
  // -------------------------------------------------------------------
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg("");
    setSubiendo(true);

    try {
      // 1) Comprimir/redimensionar con createImageBitmap
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
            "Ocurrió un error al enviar la foto navideña. Inténtalo de nuevo."
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
          setErrorMsg("Error consultando el estado del procesamiento.");
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
          setErrorMsg("El procesamiento navideño falló. Intenta con otra foto.");
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
            "No se recibió la imagen procesada desde RunPod, revisa el worker."
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
