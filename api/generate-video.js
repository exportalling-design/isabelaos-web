// pages/api/generate-video.js
import { sbAdmin } from "../../src/lib/supabaseAdmin";
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth";

// Ajusta si tu costo está en otro lado
const COST_T2V = 10;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const admin = sbAdmin();

    // ✅ user_id real desde el Bearer token (tu front ya lo manda)
    const user_id = await getUserIdFromAuthHeader(req);
    if (!user_id) {
      return res.status(401).json({ ok: false, error: "Unauthorized (missing/invalid token)" });
    }

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
      user_id,
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

    if (insErr || !job?.id) {
      return res.status(500).json({
        ok: false,
        error: "Failed to insert video_jobs row",
        detail: insErr?.message || "insert_failed",
        code: insErr?.code || null,
      });
    }

    // =========================================================
    // 2) Cobro de jades (server-side)
    //    ✅ TU FUNCIÓN ES: spend_jades(uuid, integer, text, text)
    //    => RPC POSICIONAL (array), NO con objeto con keys
    // =========================================================
    if (!already_billed) {
      // firma confirmada: spend_jades(uuid, integer, text, text)
      const rpcArgs = [
        user_id,            // uuid
        COST_T2V,           // integer
        "t2v",              // text (reason)
        String(job.id),     // text (job_id)
      ];

      const { error: spendErr } = await admin.rpc("spend_jades", rpcArgs);

      if (spendErr) {
        // Si no pudo cobrar, marcamos FAILED y devolvemos error
        await admin
          .from("video_jobs")
          .update({
            status: "FAILED",
            provider_status: "FAILED",
            provider_reply: { error: "jades_spend_failed", detail: spendErr.message },
            completed_at: new Date().toISOString(),
          })
          .eq("id", job.id);

        return res.status(400).json({
          ok: false,
          error: "Jades spend failed",
          detail: spendErr.message,
        });
      }
    }

    // =========================================================
    // 3) Aquí llamarás a RunPod y guardarás provider_request_id
    //    (lo dejamos sin inventar, como lo tenías)
    // =========================================================

    // Por ahora: devolvemos el job_id para que tu UI no se rompa
    return res.status(200).json({ ok: true, job_id: job.id, status: "QUEUED" });
  } catch (e) {
    console.log("❌ generate-video fatal:", e);
    return res.status(500).json({ ok: false, error: e?.message || "server_error" });
  }
}