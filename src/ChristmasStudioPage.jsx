import { useState } from "react";
import { saveGenerationInSupabase } from "./lib/generations";

// Helper: comprimir y redimensionar foto
async function fileToCompressedBase64(file) {
  const MAX_SIZE = 1600;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        const maxSide = Math.max(width, height);
        let targetMax = MAX_SIZE;
        let quality = 0.9;

        if (maxSide > 7000) {
          targetMax = 1280;
          quality = 0.72;
        } else if (maxSide > 5000) {
          targetMax = 1400;
          quality = 0.78;
        }

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

        const dataUrl = canvas.toDataURL("image/jpeg", quality);
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

// Fallback: usar la foto original
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

// Leer dimensiones reales
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
  const [uploadedImage, setUploadedImage] = useState(null);
  const [navidadImage, setNavidadImage] = useState(null);
  const [resolutionWarning, setResolutionWarning] = useState("");

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg("");
    setResolutionWarning("");
    setSubiendo(true);

    try {
      try {
        const megaBytes = file.size / (1024 * 1024);
        let warning = "";

        if (megaBytes > 8) {
          warning = "Tu foto pesa " + megaBytes.toFixed(1) + " MB. Si ves errores al procesar, prueba bajando la calidad de la cámara.";
        }

        const dims = await getImageDimensions(file).catch(() => null);
        if (dims) {
          const width = dims.width;
          const height = dims.height;
          const maxSide = Math.max(width, height);

          if (maxSide > 5000) {
            warning = (warning ? warning + " " : "") +
              "Detectamos una resolución muy alta (" +
              width +
              " x " +
              height +
              "). Si tu foto no se procesa correctamente, usa calidad estándar o retrato.";
          }
        }

        if (warning) {
          setResolutionWarning(warning);
        }
      } catch (_) {}

      let base64Compressed;
      try {
        base64Compressed = await fileToCompressedBase64(file);
      } catch (_) {
        base64Compressed = await fileToRawBase64(file);
      }

      setUploadedImage("data:image/jpeg;base64," + base64Compressed);

      const res = await fetch("/api/generate-xmas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_b64: base64Compressed,
          description: descripcion
        })
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data || !data.ok || !data.jobId) {
        setErrorMsg(
          data?.error ||
            "Error al enviar la foto. Si la tomaste en resolución muy alta, intenta bajarla."
        );
        return;
      }

      const jobId = data.jobId;
      let done = false;
      let finalImageB64 = null;

      while (!done) {
        const statusRes = await fetch("/api/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId })
        });

        const statusData = await statusRes.json().catch(() => null);

        if (!statusRes.ok || !statusData) {
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
          setErrorMsg("El procesamiento falló. Intenta una foto más ligera.");
          return;
        }

        finalImageB64 =
          statusData.output?.image_b64 ||
          statusData.output?.result?.image_b64 ||
          null;

        if (!finalImageB64) {
          setErrorMsg("No se recibió la imagen procesada.");
          return;
        }

        done = true;
      }

      const resultDataUrl = "data:image/png;base64," + finalImageB64;

      setNavidadImage(resultDataUrl);

      try {
        await saveGenerationInSupabase({
          imageDataUrl: resultDataUrl,
          meta: {
            mode: "navidad_estudio",
            description: descripcion
          },
          userId: currentUser?.id || null,
          prompt: "[Foto navideña de estudio]"
        });
      } catch (_) {}
    } catch (err) {
      setErrorMsg(
        "No se pudo procesar la imagen. Si fue tomada en resolución máxima, usa calidad estándar y vuelve a intentar."
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
        Sube una foto y el sistema reemplaza el fondo por un set navideño profesional.
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
            color: "white"
          }}
        />
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <label style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}>
          Sube tu foto
        </label>
        <input
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          disabled={subiendo}
        />
      </div>

      <div
        style={{
          marginBottom: "1rem",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "linear-gradient(135deg, rgba(15,23,42,0.95), rgba(30,64,175,0.35))",
          padding: "0.85rem 1rem",
          fontSize: "0.78rem",
          color: "rgba(226,232,240,0.9)"
        }}
      >
        <div
          style={{
            fontWeight: 600,
            marginBottom: "0.35rem",
            display: "flex",
            alignItems: "center",
            gap: "0.4rem"
          }}
        >
          Recomendaciones
        </div>
        <ul style={{ margin: 0, paddingLeft: "1.1rem", lineHeight: 1.4 }}>
          <li>Resolución ideal: entre 1500 y 3000 px por lado.</li>
          <li>Peso sugerido: menos de 4 a 5 MB.</li>
          <li>Evitar modo alta resolución (48MP, 50MP, 108MP, 200MP).</li>
          <li>Fotos explícitas pueden generar resultados en negro por seguridad.</li>
        </ul>

        {resolutionWarning && (
          <p style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#bfdbfe" }}>
            {resolutionWarning}
          </p>
        )}
      </div>

      {subiendo && (
        <p style={{ marginBottom: "0.75rem" }}>Procesando foto...</p>
      )}

      {errorMsg && (
        <p style={{ marginBottom: "0.75rem", color: "#ff6b6b" }}>{errorMsg}</p>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "1rem",
          marginTop: "1rem"
        }}
      >
        <div
          style={{
            borderRadius: 12,
            padding: "0.75rem",
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(0,0,0,0.25)"
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
                maxHeight: 400
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
            background: "rgba(0,0,0,0.25)"
          }}
        >
          <h3 style={{ marginBottom: "0.5rem" }}>Foto navideña de estudio</h3>
          {navidadImage ? (
            <img
              src={navidadImage}
              alt="Foto navideña"
              style={{
                width: "100%",
                borderRadius: 12,
                objectFit: "contain",
                maxHeight: 400
              }}
            />
          ) : (
            <p style={{ opacity: 0.6 }}>
              Aquí aparecerá tu foto procesada.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default ChristmasStudioPage;
