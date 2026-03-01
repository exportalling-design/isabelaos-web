// api/headshot-status.js
// Consulta el status del job en RunPod y devuelve imagen cuando esté COMPLETED.
// Mantiene AUTH unificado (requireUser). No cobra aquí.

import { requireUser } from "./_auth.js";

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

export default async function handler(req, res) {
  // CORS básico
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method Not Allowed" });

  try {
    // AUTH
    const auth = await requireUser(req);
    if (!auth.ok) return json(res, auth.code || 401, { ok: false, error: auth.error });

    const body = req.body || {};
    const jobId = body.jobId || body.id;
    if (!jobId) return json(res, 400, { ok: false, error: "MISSING_JOB_ID" });

    const endpointId =
      process.env.RUNPOD_HEADSHOT_ENDPOINT_ID ||
      process.env.RUNPOD_ENDPOINT_ID;

    const apiKey = process.env.RUNPOD_API_KEY;

    if (!endpointId || !apiKey) {
      return json(res, 500, { ok: false, error: "Faltan RUNPOD_ENDPOINT_ID (o RUNPOD_HEADSHOT_ENDPOINT_ID) o RUNPOD_API_KEY." });
    }

    const url = `https://api.runpod.ai/v2/${endpointId}/status/${jobId}`;

    const rpRes = await fetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${apiKey}` },
    });

    const data = await rpRes.json().catch(() => null);
    if (!rpRes.ok || !data) {
      return json(res, 500, { ok: false, error: "RUNPOD_STATUS_ERROR", detail: data || null });
    }

    // RunPod suele devolver: { status: "COMPLETED"|"IN_PROGRESS"|"FAILED", output: {...} }
    const status = data.status || data?.output?.status || "UNKNOWN";

    if (status === "FAILED") {
      return json(res, 500, { ok: false, status, error: data?.error || "RUNPOD_JOB_FAILED", raw: data });
    }

    if (status !== "COMPLETED") {
      return json(res, 200, { ok: true, status, done: false });
    }

    // COMPLETED → sacar imagen del output
    const out = data.output || {};
    const imageDataUrl = out.image_data_url || "";
    const imageB64 = out.image_b64 || "";
    const mime = out.mime || "image/jpeg";

    if (imageDataUrl) {
      return json(res, 200, { ok: true, status, done: true, image_data_url: imageDataUrl, mime });
    }

    if (imageB64) {
      return json(res, 200, {
        ok: true,
        status,
        done: true,
        image_data_url: `data:${mime};base64,${imageB64}`,
        mime,
      });
    }

    // Si no vino imagen, igual devolvemos raw para debug
    return json(res, 200, { ok: true, status, done: true, error: "NO_IMAGE_IN_OUTPUT", raw: data });
  } catch (err) {
    console.error("Error en /api/headshot-status:", err);
    return json(res, 500, { ok: false, error: err?.message || String(err) });
  }
}
