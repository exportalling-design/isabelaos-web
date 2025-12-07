// api/generate-xmas.js
//
// Lanza un job ESPECIAL de "foto navideña" en RunPod.
// NO toca nada del generador normal de imágenes.

// Igual que api/generate.js: aceptamos RP_IMAGE_ENDPOINT_ID o RP_ENDPOINT_ID
const RUNPOD_ENDPOINT_ID =
  process.env.RP_IMAGE_ENDPOINT_ID || process.env.RP_ENDPOINT_ID;

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

  // Validar envs
  if (!RUNPOD_ENDPOINT_ID || !RUNPOD_API_KEY) {
    return new Response(
      JSON.stringify({
        ok: false,
        error:
          "Falta configuración de RunPod (RP_IMAGE_ENDPOINT_ID / RP_ENDPOINT_ID o RP_API_KEY).",
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
