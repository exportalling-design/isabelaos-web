// ─────────────────────────────────────────────────────────────
// Recibe los clips y audios ya generados por comercial-generate
// y los envía al worker RunPod FFmpeg para ensamblar el video final.
//
// Flujo:
//   1. Frontend envía scenes[] con video_b64 + audio_b64
//   2. Este endpoint llama al worker RunPod /run (async)
//   3. Polling cada 3s hasta que el job termine
//   4. Devuelve el video final en base64
//
// Costo adicional: 0 Jades (incluido en los 120J del comercial)
// ─────────────────────────────────────────────────────────────
import { requireUser } from "./_auth.js";
 
const RUNPOD_API_BASE  = "https://api.runpod.ai/v2";
const RUNPOD_ENDPOINT  = process.env.RUNPOD_ASSEMBLER_ENDPOINT_ID; // ID del endpoint en RunPod
const RUNPOD_API_KEY   = process.env.RUNPOD_API_KEY;
 
// Timeout total de polling: 8 minutos
const POLL_TIMEOUT_MS  = 8 * 60 * 1000;
const POLL_INTERVAL_MS = 3000; // cada 3 segundos
 
// ── Enviar job al worker RunPod ───────────────────────────────
async function submitJob(payload) {
  const url = `${RUNPOD_API_BASE}/${RUNPOD_ENDPOINT}/run`;
 
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${RUNPOD_API_KEY}`,
    },
    body: JSON.stringify({ input: payload }),
  });
 
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`RunPod submit error ${r.status}: ${txt.slice(0, 200)}`);
  }
 
  const data = await r.json();
  const jobId = data?.id;
  if (!jobId) throw new Error("RunPod no devolvió job ID.");
 
  console.log(`[assemble] Job enviado a RunPod: ${jobId}`);
  return jobId;
}
 
// ── Polling del status del job ────────────────────────────────
async function pollJob(jobId) {
  const statusUrl = `${RUNPOD_API_BASE}/${RUNPOD_ENDPOINT}/status/${jobId}`;
  const deadline  = Date.now() + POLL_TIMEOUT_MS;
 
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
 
    const r = await fetch(statusUrl, {
      headers: { "Authorization": `Bearer ${RUNPOD_API_KEY}` },
    });
 
    if (!r.ok) {
      console.warn(`[assemble] Polling error ${r.status} — reintentando`);
      continue;
    }
 
    const data   = await r.json();
    const status = data?.status;
 
    console.log(`[assemble] Job ${jobId} status: ${status}`);
 
    if (status === "COMPLETED") {
      const output = data?.output;
      if (!output?.ok) {
        throw new Error(output?.error || output?.detail || "Worker devolvió error.");
      }
      return output;
    }
 
    if (status === "FAILED") {
      const err = data?.error || "Job fallido en RunPod.";
      throw new Error(`RunPod job FAILED: ${err}`);
    }
 
    if (status === "CANCELLED") {
      throw new Error("Job cancelado en RunPod.");
    }
 
    // Si está IN_QUEUE o IN_PROGRESS, seguir esperando
  }
 
  throw new Error("Timeout: el ensamble tardó más de 8 minutos.");
}
 
// ── Handler principal ─────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }
 
  try {
    // Auth
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(401).json({ ok: false, error: auth.error });
 
    // Verificar config de RunPod
    if (!RUNPOD_ENDPOINT || !RUNPOD_API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "RUNPOD_NOT_CONFIGURED",
        detail: "RUNPOD_ASSEMBLER_ENDPOINT_ID o RUNPOD_API_KEY no configurados en Vercel.",
      });
    }
 
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
 
    const scenes     = Array.isArray(body?.scenes) ? body.scenes : [];
    const title      = String(body?.title      || "comercial");
    const transition = String(body?.transition || "fade");
 
    if (!scenes.length) {
      return res.status(400).json({ ok: false, error: "MISSING_SCENES" });
    }
 
    // Filtrar solo escenas con video
    const validScenes = scenes.filter(s => s?.video_b64);
    if (!validScenes.length) {
      return res.status(400).json({ ok: false, error: "NO_VALID_SCENES", detail: "Ninguna escena tiene video." });
    }
 
    console.log(`[assemble] user=${auth.user.id} scenes=${validScenes.length} transition=${transition}`);
 
    // Enviar al worker
    const jobId = await submitJob({ scenes: validScenes, title, transition });
 
    // Polling hasta completar
    const result = await pollJob(jobId);
 
    console.log(`[assemble] ✅ Video final listo — ${result.duration_total?.toFixed(1)}s`);
 
    return res.status(200).json({
      ok:             true,
      video_b64:      result.video_b64,
      video_mime:     result.video_mime || "video/mp4",
      duration_total: result.duration_total,
      scenes_count:   result.scenes_count,
      title,
      transition,
    });
 
  } catch (e) {
    console.error("[assemble] ERROR:", e?.message || e);
    return res.status(500).json({
      ok: false, error: "ASSEMBLE_FAILED", detail: String(e?.message || e)
    });
  }
}
 
// Timeout extendido — el ensamble puede tomar varios minutos
export const config = {
  runtime: "nodejs",
  maxDuration: 540, // 9 minutos (máximo en Vercel Pro)
};
