// pages/api/generate-video.js
import { getSupabaseAdmin } from "../../lib/supabaseAdmin";

// ✅ costo (ajustalo a tu lógica real)
const COST_VIDEO = 10;

// RunPod helpers
function getRunpodConfig() {
  return {
    apiKey: process.env.RUNPOD_API_KEY,
    endpointId: process.env.RUNPOD_ENDPOINT_ID,
    baseUrl: process.env.RUNPOD_BASE_URL || "https://api.runpod.ai/v2",
  };
}

// Calcula frames desde UI (fps * seconds)
function secondsToFrames(seconds, fps) {
  const s = Math.max(1, Number(seconds || 3));
  const f = Math.max(1, Number(fps || 24));
  return s * f;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const supabaseAdmin = getSupabaseAdmin();

    // -----------------------------
    // 1) Parse input
    // -----------------------------
    const {
      user_id,           // uuid del usuario (desde tu auth)
      prompt,
      negative = "",
      seconds = 3,
      fps = 24,
      width = 576,
      height = 1024,
      usePromptOptimizer = false,
      optimizedPrompt = null, // si tu front ya trae el optimizado
      engine = "wan22",        // etiqueta
    } = req.body || {};

    if (!user_id) return res.status(400).json({ ok: false, error: "Missing user_id" });
    if (!prompt || String(prompt).trim().length < 2) return res.status(400).json({ ok: false, error: "Missing prompt" });

    const frames = secondsToFrames(seconds, fps);
    const finalPrompt = (usePromptOptimizer && optimizedPrompt) ? optimizedPrompt : prompt;

    // -----------------------------
    // 2) Insert job en video_jobs (STATUS QUEUED)
    //    IMPORTANTE: id es UUID default (ya lo dejaste)
    // -----------------------------
    const { data: job, error: jobErr } = await supabaseAdmin
      .from("video_jobs")
      .insert({
        user_id,
        status: "QUEUED",
        prompt: finalPrompt,
        negative,
        seconds,
        fps,
        frames,
        width,
        height,
        provider: "runpod",
        provider_status: "QUEUED",
        engine,
      })
      .select("id,status,created_at")
      .single();

    if (jobErr) {
      console.log("❌ insert video_jobs failed:", jobErr);
      return res.status(500).json({ ok: false, error: "Failed to insert video_jobs row", detail: jobErr.message, code: jobErr.code });
    }

    // -----------------------------
    // 3) Cobro de jades (NO lo quito)
    //    Si tu RPC se llama distinto, ajustás aquí.
    // -----------------------------
    // Opción A: RPC (recomendado)
    // Debe existir: spend_jades(user_id uuid, amount int, reason text, job_id uuid)
    const { error: spendErr } = await supabaseAdmin.rpc("spend_jades", {
      p_user_id: user_id,
      p_amount: COST_VIDEO,
      p_reason: "video_generation",
      p_job_id: job.id,
    });

    if (spendErr) {
      // Si no existe tu RPC, no te trono el sistema, pero te lo reporto.
      console.log("⚠️ spend_jades RPC failed:", spendErr);
      // Marcamos job como FAILED por cobro, para no dejarlo colgado.
      await supabaseAdmin.from("video_jobs").update({
        status: "FAILED",
        error: "jades_spend_failed",
        provider_status: "FAILED",
        completed_at: new Date().toISOString(),
      }).eq("id", job.id);

      return res.status(400).json({ ok: false, error: "Jades spend failed (RPC)", detail: spendErr.message });
    }

    // -----------------------------
    // 4) Mandar a RunPod (serverless)
    // -----------------------------
    const { apiKey, endpointId, baseUrl } = getRunpodConfig();
    if (!apiKey || !endpointId) {
      await supabaseAdmin.from("video_jobs").update({
        status: "FAILED",
        error: "missing_runpod_config",
        provider_status: "FAILED",
        completed_at: new Date().toISOString(),
      }).eq("id", job.id);

      return res.status(500).json({ ok: false, error: "Missing RUNPOD_API_KEY or RUNPOD_ENDPOINT_ID" });
    }

    // Payload para tu worker (ajustá nombres si tu worker usa otros)
    const input = {
      prompt: finalPrompt,
      negative,
      fps,
      frames,
      width,
      height,
      job_id: job.id, // importante para trazabilidad
    };

    const runpodUrl = `${baseUrl}/${endpointId}/run`;

    const rp = await fetch(runpodUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ input }),
    });

    const rpJson = await rp.json().catch(() => null);

    if (!rp.ok) {
      console.log("❌ runpod /run failed:", rp.status, rpJson);

      await supabaseAdmin.from("video_jobs").update({
        status: "FAILED",
        provider_status: "FAILED",
        provider_raw: rpJson,
        error: "runpod_run_failed",
        completed_at: new Date().toISOString(),
      }).eq("id", job.id);

      return res.status(500).json({ ok: false, error: "RunPod run failed", detail: rpJson || rp.statusText });
    }

    // RunPod devuelve algo como { id: "xyz", status: "IN_QUEUE" }
    const provider_request_id = rpJson?.id || null;

    await supabaseAdmin.from("video_jobs").update({
      status: "RUNNING",
      provider_status: rpJson?.status || "RUNNING",
      provider_request_id,
      provider_raw: rpJson,
    }).eq("id", job.id);

    // ✅ respuesta al front
    return res.status(200).json({
      ok: true,
      job_id: job.id,
      provider_request_id,
      status: "RUNNING",
    });
  } catch (e) {
    console.log("❌ generate-video fatal:", e);
    return res.status(500).json({ ok: false, error: e?.message || "server_error" });
  }
}