// api/generate-xmas.js
//
// Lanza un job ESPECIAL de "foto navideña" en RunPod.
// NO toca nada del generador normal de imágenes.

const RUNPOD_ENDPOINT_ID = process.env.RP_ENDPOINT_ID;
const RUNPOD_API_KEY = process.env.RP_API_KEY;

// CORS básico (igual estilo que api/generate.js)
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export default async function handler(req) {
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  // Solo aceptamos POST
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  if (!RUNPOD_ENDPOINT_ID || !RUNPOD_API_KEY) {
    return new Response(
      JSON.stringify({
        ok: false,
        error:
          "Falta configuración de RunPod (RP_ENDPOINT_ID o RP_API_KEY).",
      }),
      {
        status: 500,
        headers: {
          ...CORS_HEADERS,
          "content-type": "application/json",
        },
      }
    );
  }

  try {
    const body = await req.json().catch(() => null);

    if (!body) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Cuerpo de la petición vacío.",
        }),
        {
          status: 400,
          headers: {
            ...CORS_HEADERS,
            "content-type": "application/json",
          },
        }
      );
    }

    // 👇 AQUÍ el cambio importante:
    // aceptamos tanto image_b64 como init_image_b64
    const image_b64 =
      body.image_b64 || body.init_image_b64 || null;

    if (!image_b64) {
      return new Response(
        JSON.stringify({
          ok: false,
          error:
            "Falta image_b64/init_image_b64 en el cuerpo de la petición.",
        }),
        {
          status: 400,
          headers: {
            ...CORS_HEADERS,
            "content-type": "application/json",
          },
        }
      );
    }

    // También aceptamos description o extra_prompt
    const description = body.description || body.extra_prompt || "";

    // Construimos el input para el worker
    const input = {
      action: "xmas_photo",
      image_b64,        // <- lo que espera generate_xmas_photo en rp_handler.py
      description,
      // Puedes dejar este prompt base para cuando metas el pipeline real
      prompt: "studio christmas portrait, soft light, high quality",
    };

    const url = `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/run`;

    const rpRes = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${RUNPOD_API_KEY}`,
      },
      body: JSON.stringify({ input }),
    });

    const rpData = await rpRes.json().catch(() => null);

    if (!rpRes.ok || !rpData || !rpData.id) {
      console.error("Error RunPod Xmas:", rpRes.status, rpData);
      return new Response(
        JSON.stringify({
          ok: false,
          error:
            rpData?.error ||
            "No se pudo lanzar el job navideño en RunPod (sin id).",
        }),
        {
          status: 500,
          headers: {
            ...CORS_HEADERS,
            "content-type": "application/json",
          },
        }
      );
    }

    // Igual que api/generate: devolvemos el jobId
    return new Response(
      JSON.stringify({
        ok: true,
        jobId: rpData.id,
      }),
      {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "content-type": "application/json",
        },
      }
    );
  } catch (err) {
    console.error("Error en /api/generate-xmas:", err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: err?.message || String(err),
      }),
      {
        status: 500,
        headers: {
          ...CORS_HEADERS,
          "content-type": "application/json",
        },
      }
    );
  }
}

