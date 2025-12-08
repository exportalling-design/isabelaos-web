// api/generate-xmas.js
// Endpoint para "Foto Navideña IA" usando el mismo endpoint de RunPod
// que el generador normal, con soporte para FormData (archivo) y mobile.

// ----------------------------------------------------
// CORS básico
// ----------------------------------------------------
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

// ----------------------------------------------------
// Config de RunPod – usamos las MISMAS env que el generador normal
// ----------------------------------------------------
const ENDPOINT_ID = process.env.RP_ENDPOINT_ID;   // <-- ya existe
const RUNPOD_API_KEY = process.env.RP_API_KEY;    // <-- ya existe

// Pequeño helper para pasar ArrayBuffer a base64 que sirve en Edge y Node
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  if (typeof btoa === "function") {
    return btoa(binary);
  }

  // Fallback para Node (por si no estamos en Edge)
  return Buffer.from(binary, "binary").toString("base64");
}

// ----------------------------------------------------
// Handler principal
// ----------------------------------------------------
export const config = {
  runtime: "edge", // para poder usar req.formData()
};

export default async function handler(req) {
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  // Solo POST
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  // Validar que la config de RunPod exista
  if (!ENDPOINT_ID || !RUNPOD_API_KEY) {
    console.error(
      "[generate-xmas] Faltan RP_ENDPOINT_ID o RP_API_KEY en las variables de entorno."
    );
    return new Response(
      JSON.stringify({
        error: "CONFIG_RUNPOD",
        message: "Configuración de RunPod incompleta en el servidor.",
      }),
      {
        status: 500,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json",
        },
      }
    );
  }

  try {
    const contentType = req.headers.get("content-type") || "";

    let imageB64 = "";
    let description = "";
    let userId = "";
    let email = "";
    let plan = "";

    // ----------------------------------------
    // Soportar FormData (desde web / celular)
    // ----------------------------------------
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();

      const file = formData.get("file");
      description = formData.get("description") || "";
      userId = formData.get("userId") || "";
      email = formData.get("email") || "";
      plan = formData.get("plan") || "";

      if (!file || typeof file === "string") {
        return new Response(
          JSON.stringify({
            error: "NO_FILE",
            message: "No se recibió ninguna imagen.",
          }),
          {
            status: 400,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      imageB64 = arrayBufferToBase64(arrayBuffer);
    } else {
      // ----------------------------------------
      // Fallback: JSON (por si alguna vez llamas con JSON)
      // ----------------------------------------
      const body = await req.json().catch(() => null);

      if (!body || !body.image_b64) {
        return new Response(
          JSON.stringify({
            error: "MISSING_IMAGE",
            message: "Falta image_b64 en el cuerpo de la petición.",
          }),
          {
            status: 400,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "application/json",
            },
          }
        );
      }

      imageB64 = body.image_b64;
      description = body.description || "";
      userId = body.userId || "";
      email = body.email || "";
      plan = body.plan || "";
    }

    // ----------------------------------------
    // Llamar al worker de RunPod
    // ----------------------------------------
    const payload = {
      input: {
        action: "navidad_estudio",
        image_b64: imageB64,
        description,
        meta: {
          userId,
          email,
          plan,
          from: "xmas_photo",
        },
      },
    };

    const rpRes = await fetch(
      `https://api.runpod.ai/v2/${ENDPOINT_ID}/run`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RUNPOD_API_KEY}`,
        },
        body: JSON.stringify(payload),
      }
    );

    const json = await rpRes.json().catch(() => null);

    if (!rpRes.ok || !json) {
      console.error("[generate-xmas] Error HTTP desde RunPod:", rpRes.status);
      return new Response(
        JSON.stringify({
          error: "RUNPOD_ERROR",
          message: "Error al conectar con RunPod.",
        }),
        {
          status: 500,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const output = json.output || json;
    const resultB64 =
      output?.image_b64 ||
      (Array.isArray(output) && output[0]?.image_b64) ||
      null;

    if (!resultB64) {
      console.error(
        "[generate-xmas] Respuesta de RunPod sin image_b64:",
        JSON.stringify(json).slice(0, 400)
      );
      return new Response(
        JSON.stringify({
          error: "NO_IMAGE_IN_OUTPUT",
          message: "La respuesta de RunPod no contiene imagen.",
        }),
        {
          status: 500,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // ÉXITO: devolvemos la imagen navideña
    return new Response(
      JSON.stringify({
        image_b64: resultB64,
      }),
      {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    console.error("[generate-xmas] ERROR inesperado:", err);
    return new Response(
      JSON.stringify({
        error: "SERVER_ERROR",
        message: "Error inesperado en el servidor.",
      }),
      {
        status: 500,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json",
        },
      }
    );
  }
}

