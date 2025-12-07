// api/generate-xmas.js
//
// Lanza un job ESPECIAL de "foto navideña" en RunPod.
// NO toca nada del generador normal de imágenes.

// Igual que generate.js: primero RUNPOD_ENDPOINT_ID, luego RP_ENDPOINT
const ENDPOINT_ID =
  process.env.RUNPOD_ENDPOINT_ID || process.env.RP_ENDPOINT;

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

  if (!ENDPOINT_ID || !RUNPOD_API_KEY) {
    return new Response(
      JSON.stringify({
        ok: false,
        error:
          "Falta configuración de RunPod (RUNPOD_ENDPOINT_ID / RP_ENDPOINT o RP_API_KEY).",
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

    // Aceptamos tanto image_b64 como init_image_b64 (como lo mandas desde React)
    const image_b64 = body.image_b64 || body.init_image_b64 || null;

    if (!image_b64) {
      return new Response(
        JSON.stringify({
          ok: false,
          error:
            "Falta image_b64 / init_image_b64 en el cuerpo de la petición.",
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
      action: "xmas_photo", // lo que espera rp_handler.py
      image_b64,
      description,
      // Estos los puedes usar después cuando metas el pipeline real
      width: body.width || 768,
      height: body.height || 1024,
      steps: body.steps || 30,
      strength: body.strength ?? 0.6,
      guidance_scale: body.guidance_scale ?? 7.5,
      prompt: "studio christmas portrait, soft light, high quality",
    };

    const base = `https://api.runpod.ai/v2/${ENDPOINT_ID}`;

    const rpRes = await fetch(`${base}/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${RUNPOD_API_KEY}`,
      },
      body: JSON.stringify({ input }),
    });

    const rpData = await rpRes.json().catch(() => null);

    if (!rpRes.ok || !rpData) {
      console.error("Error RunPod Xmas:", rpRes.status, rpData);
      return new Response(
        JSON.stringify({
          ok: false,
          error:
            rpData?.error ||
            "No se pudo lanzar el job navideño en RunPod (respuesta no válida).",
        }),
        {
          status: rpRes.status || 500,
          headers: {
            ...CORS_HEADERS,
            "content-type": "application/json",
          },
        }
      );
    }

    const jobId =
      rpData.id || rpData.requestId || rpData.jobId || rpData.data?.id;

    if (!jobId) {
      console.error("RunPod Xmas sin id:", rpData);
      return new Response(
        JSON.stringify({
          ok: false,
          error: "RunPod no devolvió ID para la foto navideña.",
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
        jobId,
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

// Igual que generate.js -> Edge Function
export const config = {
  runtime: "edge",
};
