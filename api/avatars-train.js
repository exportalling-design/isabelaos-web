// /api/avatars-train.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ✅ Tu endpoint ID fijo (si prefieres env var, lo cambias luego)
const RUNPOD_ENDPOINT_ID = "uktq024dj0d4go";

function runpodRunUrl() {
  return `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/run`;
}

// Normaliza estados para que el frontend no se quede pegado
function normalizeJobStatus(s) {
  const raw = String(s || "").toUpperCase();
  if (!raw) return "IN_QUEUE";
  if (["IN_QUEUE", "QUEUED", "QUEUE", "PENDING"].includes(raw)) return "IN_QUEUE";
  if (["IN_PROGRESS", "RUNNING", "PROCESSING", "STARTED"].includes(raw)) return "IN_PROGRESS";
  if (["SUCCEEDED", "COMPLETED", "DONE", "SUCCESS", "FINISHED"].includes(raw)) return "SUCCEEDED";
  if (["FAILED", "ERROR", "CANCELLED", "CANCELED"].includes(raw)) return "FAILED";
  return raw;
}

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
    // (si tú quieres permitir “retrain”, quita esto)
    if (String(avatar.status || "").toUpperCase() === "READY" && avatar.lora_path) {
      return res.status(409).json({
        ok: false,
        error: "ALREADY_READY",
        message: "This avatar is already trained (READY). Delete/retrain explicitly if needed.",
        avatar_id,
      });
    }

    // Bloqueo simple: si ya está entrenando, no dispares otro job
    if (["TRAINING", "IN_QUEUE", "IN_PROGRESS"].includes(String(avatar.status || "").toUpperCase())) {
      return res.status(409).json({
        ok: false,
        error: "ALREADY_TRAINING",
        message: "This avatar already has a training in progress.",
        avatar_id,
      });
    }

    // 2) Fotos (paths internos SIN bucket)
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
          status: "IN_QUEUE", // ✅ alineado con frontend
          progress: 0,
          job_id: null,
          error: null,
          result_json: {
            started_from_api: true,
            steps,
            lr,
            lora_rank,
            lora_alpha,
            batch,
            grad_acc,
            photos_count: photoPaths.length,
            endpoint_id: RUNPOD_ENDPOINT_ID,
          },
        },
      ])
      .select("*")
      .single();

    if (jobErr) throw jobErr;

    // 4) Marcar avatar en cola (y limpiar error viejo)
    // ✅ Importante: guardamos también "train_job_db_id" para rastrear el último job
    const { data: avatarQueued, error: avUp1Err } = await supabase
      .from("avatars")
      .update({
        status: "IN_QUEUE",
        last_error: null,
        train_error: null,
        train_job_id: null,       // se llenará cuando RunPod responda id
        train_job_db_id: jobRow.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", avatar_id)
      .select("*")
      .single();

    if (avUp1Err) throw avUp1Err;

    // 5) RunPod key
    const runpodKey = process.env.RUNPOD_API_KEY;
    if (!runpodKey) {
      await supabase
        .from("avatar_jobs")
        .update({ status: "FAILED", error: "RUNPOD_API_KEY_MISSING" })
        .eq("id", jobRow.id);

      const { data: avatarFailed } = await supabase
        .from("avatars")
        .update({
          status: "FAILED",
          last_error: "RUNPOD_API_KEY_MISSING",
          train_error: "RUNPOD_API_KEY_MISSING",
          updated_at: new Date().toISOString(),
        })
        .eq("id", avatar_id)
        .select("*")
        .single();

      return res.status(400).json({
        ok: false,
        error: "RUNPOD_API_KEY_MISSING",
        avatar: avatarFailed || { id: avatar_id, status: "FAILED", train_error: "RUNPOD_API_KEY_MISSING" },
        job: { id: null, status: "FAILED", error: "RUNPOD_API_KEY_MISSING" },
      });
    }

    // 6) Disparar RunPod
    const payload = {
      input: {
        action: "avatar_train",
        avatar_id: avatarQueued.id,
        user_id: avatarQueued.user_id,
        trigger: avatarQueued.trigger,
        photos: photoPaths,

        // params para tu trainer
        steps,
        lr,
        lora_rank,
        lora_alpha,
        batch,
        grad_acc,
      },
    };

    const resp = await fetch(runpodRunUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${runpodKey}`,
      },
      body: JSON.stringify(payload),
    });

    const out = await resp.json().catch(() => ({}));
    const runpodJobId = out?.id;

    if (!resp.ok || !runpodJobId) {
      const failMsg =
        (out?.error || out?.message || JSON.stringify(out) || "RUNPOD_START_FAILED").slice(0, 2000);

      await supabase
        .from("avatar_jobs")
        .update({
          status: "FAILED",
          error: failMsg,
          result_json: { ...(jobRow.result_json || {}), runpod_start_response: out },
        })
        .eq("id", jobRow.id);

      const { data: avatarFailed } = await supabase
        .from("avatars")
        .update({
          status: "FAILED",
          last_error: "RUNPOD_START_FAILED",
          train_error: failMsg,
          updated_at: new Date().toISOString(),
        })
        .eq("id", avatar_id)
        .select("*")
        .single();

      return res.status(500).json({
        ok: false,
        error: "RUNPOD_START_FAILED",
        details: out,
        avatar: avatarFailed || { id: avatar_id, status: "FAILED", train_error: failMsg },
        job: { id: null, status: "FAILED", error: failMsg },
      });
    }

    // 7) Guardar job_id y marcar IN_PROGRESS
    await supabase
      .from("avatar_jobs")
      .update({
        job_id: runpodJobId,
        status: "IN_PROGRESS",
        error: null,
        result_json: { ...(jobRow.result_json || {}), runpod_start_response: out },
      })
      .eq("id", jobRow.id);

    const { data: avatarRunning } = await supabase
      .from("avatars")
      .update({
        status: "IN_PROGRESS",
        train_job_id: runpodJobId,
        train_error: null,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", avatar_id)
      .select("*")
      .single();

    // ✅ RESPUESTA NUEVA: job + avatar (esto arregla “se queda entrenando” en el frontend)
    return res.json({
      ok: true,
      avatar_id,
      job_db_id: jobRow.id,
      runpod_job_id: runpodJobId,
      runpod_run_url: runpodRunUrl(),

      // Para el frontend
      avatar: avatarRunning || { id: avatar_id, status: "IN_PROGRESS", train_job_id: runpodJobId },
      job: {
        id: runpodJobId,
        status: normalizeJobStatus(out?.status || "IN_PROGRESS"),
        provider: "runpod",
        db_id: jobRow.id,
      },
    });
  } catch (err) {
    console.error("[avatars-train]", err);

    // Importante: el frontend apaga polling si recibe error en /poll,
    // pero aquí igual devolvemos estructura consistente cuando se pueda.
    return res.status(500).json({ ok: false, error: err?.message || "SERVER_ERROR" });
  }
}
