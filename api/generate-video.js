// pages/api/generate-video.js
import { sbAdmin } from "../../lib/supabaseAdmin";
import { getUserIdFromAuthHeader } from "../../lib/getUserIdFromAuth";

// Costo fijo para T2V (ajusta si lo movés a pricing central)
const COST_T2V = 10;

/**
 * RunPod config helper
 * Requiere:
 * - RUNPOD_API_KEY
 * - RUNPOD_ENDPOINT_ID
 * Opcional:
 * - RUNPOD_BASE_URL (default v2)
 */
function getRunpodConfig() {
  return {
    apiKey: process.env.RUNPOD_API_KEY,
    endpointId: process.env.RUNPOD_ENDPOINT_ID,
    baseUrl: process.env.RUNPOD_BASE_URL || "https://api.runpod.ai/v2",
  };
}

/**
 * Lanza un job async en RunPod Serverless Endpoint:
 * POST https://api.runpod.ai/v2/{endpointId}/run
 *
 * OJO: el "input" exacto depende de tu worker.
 * Aquí mandamos un input limpio con lo mismo que tu frontend manda.
 */
async function runpodRun({ apiKey, endpointId, baseUrl, input }) {
  if (!apiKey) throw new Error("Missing RUNPOD_API_KEY");
  if (!endpointId) throw new Error("Missing RUNPOD_ENDPOINT_ID");

  const url = `${baseUrl}/${endpointId}/run`;

  const rp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input }),
  });

  const rpJson = await rp.json().catch(() => null);

  if (!rp.ok) {
    const msg = rpJson?.error || rpJson?.message || `RunPod /run failed (${rp.status})`;
    throw new Error(msg);
  }

  // Normalmente RunPod devuelve algo como:
  // { id: "xxxx", status: "IN_QUEUE" }
  // A veces: { id: "...", ... }
  const requestId = rpJson?.id || rpJson?.requestId || null;
  if (!requestId) throw new Error("RunPod did not return id/requestId");

  return { requestId, rpJson };
}

export default async function handler(req, res) {
  // Solo POST
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    // ✅ Admin supabase (service role)
    const admin = sbAdmin();

    // ✅ user_id real desde el Bearer token (tu front lo manda)
    const user_id = await getUserIdFromAuthHeader(req);

    // ✅ Body seguro
    const body = req.body && typeof req.body === "object" ? req.body : {};

    // Datos que manda tu VideoFromPromptPanel
    const {
      mode = "t2v",
      prompt,
      negative_prompt = "",
      platform_ref,
      aspect_ratio,
      width,
      height,
      duration_s,
      fps,
      num_frames,
      already_billed = false,
      used_optimized = false,
    } = body;

    // Validaciones mínimas
    if (!prompt || !String(prompt).trim()) {
      return res.status(400).json({ ok: false, error: "Missing prompt" });
    }

    // =========================================================
    // 1) Insert del job en video_jobs
    //    - NO agregamos columnas nuevas
    //    - Guardamos payload extra en provider_raw (jsonb)
    // =========================================================
    const insertPayload = {
      user_id, // ✅ CLAVE: tu tabla debe tener user_id (uuid). Si no, lo quitás.
      status: "QUEUED",
      prompt: String(prompt).trim(),

      provider: "runpod",
      provider_status: "QUEUED",

      // Aquí va TODO lo extra (sin columnas basura)
      provider_raw: {
        mode,
        negative_prompt: String(negative_prompt || ""),
        platform_ref,
        aspect_ratio,
        width,
        height,
        duration_s,
        fps,
        num_frames,
        used_optimized: !!used_optimized,
        already_billed: !!already_billed,
      },
    };

    const { data: job, error: insErr } = await admin
      .from("video_jobs")
      .insert(insertPayload)
      .select("id,status,created_at")
      .single();

    if (insErr || !job) {
      // Importante: devolvemos detalle para que NO sea "invocation failed"
      return res.status(500).json({
        ok: false,
        error: "Failed to insert video_jobs row",
        detail: insErr?.message || "insert_failed",
        code: insErr?.code || null,
      });
    }

    // =========================================================
    // 2) Cobro de jades (server-side)
    //    - Si tu RPC se llama distinto, aquí lo cambias UNA vez.
    // =========================================================
    if (!already_billed) {
      const { error: spendErr } = await admin.rpc("spend_jades", {
        p_user_id: user_id,
        p_amount: COST_T2V,
        p_reason: "t2v",
        p_job_id: job.id,
      });

      if (spendErr) {
        // Marcamos FAILED y respondemos claro
        await admin
          .from("video_jobs")
          .update({
            status: "FAILED",
            provider_status: "FAILED",
            provider_reply: { error: "jades_spend_failed", detail: spendErr.message },
            completed_at: new Date().toISOString(),
          })
          .eq("id", job.id);

        return res.status(400).json({ ok: false, error: "Jades spend failed", detail: spendErr.message });
      }
    }

    // =========================================================
    // 3) Lanzar job en RunPod y guardar provider_request_id
    // =========================================================
    const { apiKey, endpointId, baseUrl } = getRunpodConfig();

    // Input para tu worker (ajusta nombres si tu worker espera otros)
    const runpodInput = {
      mode,
      prompt: String(prompt).trim(),
      negative_prompt: String(negative_prompt || ""),

      // Metadata de formato
      platform_ref,
      aspect_ratio,
      width,
      height,
      duration_s: Number(duration_s),
      fps: Number(fps),
      num_frames: Number(num_frames),