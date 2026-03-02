import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const {
      user_id,
      avatar_id,

      // defaults
      steps = 1200,
      lr = 1e-4,
      lora_rank = 16,
      lora_alpha = 16,
      batch = 1,
      grad_acc = 4,
    } = req.body || {};

    if (!user_id || !avatar_id) {
      return res.status(400).json({ ok: false, error: "Missing user_id or avatar_id" });
    }

    // 1) Avatar
    const { data: avatar, error: avErr } = await supabase
      .from("avatars")
      .select("*")
      .eq("id", avatar_id)
      .single();

    if (avErr || !avatar) {
      return res.status(404).json({ ok: false, error: "Avatar not found" });
    }
    if (avatar.user_id !== user_id) {
      return res.status(403).json({ ok: false, error: "Not your avatar" });
    }

    // Evitar re-entrenos accidentales
    if (avatar.status === "READY" && avatar.lora_path) {
      return res.status(409).json({
        ok: false,
        error: "ALREADY_READY",
        message: "This avatar is already trained (READY). Delete/retrain explicitly if needed.",
        avatar_id,
      });
    }

    // 2) Fotos (paths internos SIN bucket, ej: user/avatar/train/x.jpg)
    const { data: photos, error: phErr } = await supabase
      .from("avatar_photos")
      .select("storage_path")
      .eq("avatar_id", avatar_id);

    if (phErr) throw phErr;

    const photoPaths = (photos || []).map((p) => p.storage_path).filter(Boolean);

    if (photoPaths.length < 5) {
      return res.status(400).json({
        ok: false,
        error: "NOT_ENOUGH_PHOTOS",
        count: photoPaths.length,
        need: 5,
      });
    }

    // 3) Crear job en DB primero
    const { data: jobRow, error: jobErr } = await supabase
      .from("avatar_jobs")
      .insert([
        {
          avatar_id,
          provider: "runpod",
          status: "QUEUED",
          progress: 0,
          result_json: {
            started_from_api: true,
            steps,
            lr,
            lora_rank,
            lora_alpha,
            batch,
            grad_acc,
            photos_count: photoPaths.length,
          },
        },
      ])
      .select("*")
      .single();

    if (jobErr) throw jobErr;

    // 4) Marcar avatar TRAINING
    await supabase
      .from("avatars")
      .update({ status: "TRAINING", last_error: null })
      .eq("id", avatar_id);

    // 5) RunPod config
    const runpodEndpoint = process.env.RUNPOD_AVATAR_ENDPOINT; // https://api.runpod.ai/v2/<id>/run
    const runpodKey = process.env.RUNPOD_API_KEY;

    if (!runpodEndpoint || !runpodKey) {
      await supabase
        .from("avatar_jobs")
        .update({ status: "FAILED", error: "RUNPOD_NOT_CONFIGURED" })
        .eq("id", jobRow.id);

      await supabase
        .from("avatars")
        .update({ status: "ERROR", last_error: "RUNPOD_NOT_CONFIGURED" })
        .eq("id", avatar_id);

      return res.status(400).json({ ok: false, error: "RUNPOD_NOT_CONFIGURED" });
    }

    // 6) Disparar RunPod
    const payload = {
      input: {
        action: "avatar_train",
        avatar_id: avatar.id,
        user_id: avatar.user_id,
        trigger: avatar.trigger,
        photos: photoPaths,

        // params
        steps,
        lr,
        lora_rank,
        lora_alpha,
        batch,
        grad_acc,
      },
    };

    const resp = await fetch(runpodEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${runpodKey}`,
      },
      body: JSON.stringify(payload),
    });

    const out = await resp.json();

    const jobId = out?.id; // RunPod returns { id: "...", ... }
    if (!jobId) {
      await supabase
        .from("avatar_jobs")
        .update({
          status: "FAILED",
          error: (JSON.stringify(out) || "RUNPOD_START_FAILED").slice(0, 2000),
          result_json: { ...(jobRow.result_json || {}), runpod_start_response: out },
        })
        .eq("id", jobRow.id);

      await supabase
        .from("avatars")
        .update({ status: "ERROR", last_error: "RUNPOD_START_FAILED" })
        .eq("id", avatar_id);

      return res.status(500).json({ ok: false, error: "RUNPOD_START_FAILED", details: out });
    }

    // 7) Guardar job_id y marcar RUNNING
    await supabase
      .from("avatar_jobs")
      .update({
        job_id: jobId,
        status: "RUNNING",
        result_json: { ...(jobRow.result_json || {}), runpod_start_response: out },
      })
      .eq("id", jobRow.id);

    return res.json({
      ok: true,
      avatar_id,
      job_db_id: jobRow.id,
      runpod_job_id: jobId,
    });
  } catch (err) {
    console.error("[avatars-train]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
