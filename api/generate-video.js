// pages/api/generate-video.js
import { sbAdmin } from "../../lib/supabaseAdmin";
import { getUserIdFromAuthHeader } from "../../lib/getUserIdFromAuth";

// Ajusta si tu costo está en otro lado
const COST_T2V = 10;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const admin = sbAdmin();

    // ✅ user_id real desde el Bearer token (tu front ya lo manda)
    const user_id = await getUserIdFromAuthHeader(req);

    // Body tal como lo manda tu VideoFromPromptPanel
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
    } = req.body || {};

    if (!prompt || !String(prompt).trim()) {
      return res.status(400).json({ ok: false, error: "Missing prompt" });
    }

    // =========================================================
    // 1) Insert del job en video_jobs (SIN crear columnas nuevas)
    //    Guardamos TODO el payload extra en provider_raw (jsonb)
    // =========================================================
    const insertPayload = {
      user_id,                 // <- este era el punto crítico
      status: "QUEUED",
      prompt: String(prompt).trim(),
      provider: "runpod",
      provider_status: "QUEUED",
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
        used_optimized,
        already_billed,
      },
    };

    const { data: job, error: insErr } = await admin
      .from("video_jobs")
      .insert(insertPayload)
      .select("id,status,created_at")
      .single();

    if (insErr) {
      // Si falla aquí, ahora SÍ verás el error real
      return res.status(500).json({ ok: false, error: "Failed to insert video_jobs row", detail: insErr.message, code: insErr.code });
    }

    // =========================================================
    // 2) Cobro de jades (server-side) - NO lo quitamos
    //    Si tu RPC se llama distinto, ajusto a tu nombre exacto
    // =========================================================
    if (!already_billed) {
      const { error: spendErr } = await admin.rpc("spend_jades", {
        p_user_id: user_id,
        p_amount: COST_T2V,
        p_reason: "t2v",
        p_job_id: job.id,
      });

      if (spendErr) {
        // Si no pudo cobrar, marcamos FAILED y devolvemos error
        await admin.from("video_jobs").update({
          status: "FAILED",
          provider_status: "FAILED",
          provider_reply: { error: "jades_spend_failed", detail: spendErr.message },
          completed_at: new Date().toISOString(),
        }).eq("id", job.id);

        return res.status(400).json({ ok: false, error: "Jades spend failed", detail: spendErr.message });
      }
    }

    // =========================================================
    // 3) Aquí llamas a RunPod (o tu worker) y guardas provider_request_id
    //    (No te lo invento sin ver tu worker actual, pero el patrón es:)
    // =========================================================
    // const rp = await fetch(.../runpod/run...)
    // const rpJson = await rp.json()
    // await admin.from("video_jobs").update({
    //   status: "RUNNING",
    //   provider_status: rpJson.status,
    //   provider_request_id: rpJson.id,
    //   provider_raw: { ...insertPayload.provider_raw, runpod: rpJson }
    // }).eq("id", job.id);

    // Por ahora: devolvemos el job_id para que tu UI deje de romperse
    return res.status(200).json({ ok: true, job_id: job.id, status: "QUEUED" });

  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "server_error" });
  }
}