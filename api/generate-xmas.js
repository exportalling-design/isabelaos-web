// pages/api/generate-xmas.js
// Lanza el job navideño en RunPod a partir de una foto subida (FormData)

export const config = {
  runtime: "edge",
};

async function fileToBase64(file) {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  // btoa está disponible en runtime Edge
  return btoa(binary);
}

export default async function handler(req) {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };

  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  // Solo POST
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: cors,
    });
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    let imageBase64 = "";
    let description = "";
    let userId = null;

    // -----------------------------------------
    // 1) LECTURA DEL CUERPO
    //    Acepta multipart/form-data (desde el navegador)
    //    y también JSON por si algún cliente viejo la usa.
    // -----------------------------------------
    if (contentType.startsWith("multipart/form-data")) {
      const formData = await req.formData();

      const file = formData.get("file");
      if (!file) {
        return new Response(
          JSON.stringify({ error: "Falta archivo de imagen (file)" }),
          {
            status: 400,
            headers: {
              ...cors,
              "content-type": "application/json",
            },
          }
        );
      }

      imageBase64 = await fileToBase64(file);
      description = formData.get("description") || "";
      userId = formData.get("userId") || null;
    } else {
      // Modo JSON (por si algún cliente lo usa)
      const body = await req.json().catch(() => null);
      if (!body || !body.image_b64) {
        return new Response(
          JSON.stringify({
            error:
              "Falta image_b64 en el cuerpo de la petición (JSON) o multipart/form-data.",
          }),
          {
            status: 400,
            headers: {
              ...cors,
              "content-type": "application/json",
            },
          }
        );
      }
      imageBase64 = body.image_b64;
      description = body.description || "";
      userId = body.userId || null;
    }

    // -----------------------------------------
    // 2) VALIDACIONES BÁSICAS
    // -----------------------------------------
    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: "No se pudo convertir la imagen a base64." }),
        {
          status: 400,
          headers: {
            ...cors,
            "content-type": "application/json",
          },
        }
      );
    }

    const endpointId =
      process.env.RP_ENDPOINT_XMAS_ID || process.env.RP_ENDPOINT_ID;
    const apiKey = process.env.RP_API_KEY;

    if (!endpointId || !apiKey) {
      console.error(
        "[generate-xmas] Falta RP_ENDPOINT_XMAS_ID/RP_ENDPOINT_ID o RP_API_KEY"
      );
      return new Response(
        JSON.stringify({
          error: "Configuración de RunPod incompleta en el servidor.",
        }),
        {
          status: 500,
          headers: {
            ...cors,
            "content-type": "application/json",
          },
        }
      );
    }

    // -----------------------------------------
    // 3) LLAMADA A RUNPOD
    // -----------------------------------------
    const url = `https://api.runpod.ai/v2/${endpointId}/run`;

    const payload = {
      input: {
        action: "navidad_estudio",
        image_b64: imageBase64,
        description: description,
        userId: userId,
      },
    };

    const rpRes = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!rpRes.ok) {
      const text = await rpRes.text();
      console.error("[generate-xmas] Error RunPod:", rpRes.status, text);
      return new Response(
        JSON.stringify({ error: "Error al lanzar job en RunPod." }),
        {
          status: 500,
          headers: {
            ...cors,
            "content-type": "application/json",
          },
        }
      );
    }

    const rpJson = await rpRes.json();
    const jobId = rpJson.id || rpJson.jobId || rpJson.requestId || null;

    if (!jobId) {
      console.error("[generate-xmas] Respuesta RunPod sin jobId:", rpJson);
      return new Response(
        JSON.stringify({
          error: "RunPod no devolvió un ID de job válido.",
        }),
        {
          status: 500,
          headers: {
            ...cors,
            "content-type": "application/json",
          },
        }
      );
    }

    // -----------------------------------------
    // 4) RESPUESTA OK
    // -----------------------------------------
    return new Response(JSON.stringify({ jobId }), {
      status: 200,
      headers: {
        ...cors,
        "content-type": "application/json",
      },
    });
  } catch (err) {
    console.error("[generate-xmas] ERROR general:", err);
    return new Response(
      JSON.stringify({ error: "Error interno en generate-xmas." }),
      {
        status: 500,
        headers: {
          ...cors,
          "content-type": "application/json",
        },
      }
    );
  }
}

