// api/generate-xmas.js
// Lanza el job de "Foto Navideña IA" en RunPod y devuelve la imagen lista.

// ---------------- CORS básico ----------------
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

// Helper: ArrayBuffer -> base64 (sirve en Edge y en Node)
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  if (typeof btoa === "function") {
    return btoa(binary);
  }

  // Fallback por si existe Buffer
  // (en Edge normalmente no se usa, pero no estorba)
  // @ts-ignore
  return Buffer.from(binary, "binary").toString("base64");
}

export default async function handler(req) {
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  // Solo aceptamos POST
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: cors });
  }

  try {
    const contentType = req.headers.get("content-type") || "";

    let imageB64 = "";
    let description = "";
    let userId = "";
    let email = "";
    let plan = "";

    // ----- Soportar FormData (web y celular) -----
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();

      const file = formData.get("file");
      description = formData.get("description") || "";
      userId = formData.get("userId") || "";
      email = formData.get("email") || "";
      plan = formData.get("plan") || "";

      if (!file || typeof file === "string") {
        return new Response(
          JSON.stringify({ error: "No file", message: "No se recibió imagen." }),
          { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
        );
      }

      const buffer = await file.arrayBuffer();
      imageB64 = arrayBufferToBase64(buffer);
    } else {
      // ----- Fallback JSON (por si algún día lo llamas así) -----
      const body = await req.json().catch(() => null);

      if (!body || !body.image_b64) {
        return new Response(
          JSON.stringify({
            error: "Missing image_b64",
            message: "Falta image_b64 en el cuerpo.",
          }),
          { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
        );
      }

      imageB64 = body.image_b64;
      description = body.description || "";
      userId = body.userId || "";
      email = body.email || "";
      plan = body.plan || "";
    }

    // ✅ MISMAS VARIABLES QUE api/generate.js
    const endpointId =
      process.env.RUNPOD_ENDPOINT_ID || process.env.RP_ENDPOINT;

    if (!process.env.RP_API_KEY || !endpointId) {
      return new Response(
        JSON.stringify({
          error:
            "Missing RP_API_KEY or endpointId (RUNPOD_ENDPOINT_ID / RP_ENDPOINT)",
        }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const base = `https://api.runpod.ai/v2/${endpointId}`;

    // 🔴 AQUÍ ESTABA EL PROBLEMA:
    // Antes: `${base}/run`  -> solo devuelve { id, status }
    // Ahora: usamos /runsync para que devuelva el output completo con image_b64
    const rp = await fetch(`${base}/runsync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RP_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
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
      }),
    });

    if (!rp.ok) {
      const txt = await rp.text();
      return new Response(
        JSON.stringify({ error: "RunPod run error", details: txt }),
        { status: rp.status, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const data = await rp.json();

    // El worker devuelve la imagen final en image_b64
    const output = data.output || data;
    const resultB64 =
      output?.image_b64 ||
      (Array.isArray(output) && output[0]?.image_b64) ||
      null;

    if (!resultB64) {
      return new Response(
        JSON.stringify({ error: "RunPod no devolvió image_b64", raw: data }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // La página de Navidad espera esto
    return new Response(
      JSON.stringify({ ok: true, image_b64: resultB64 }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Server error", details: String(e) }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
}

// Igual que generate.js
export const config = {
  runtime: "edge",
};
