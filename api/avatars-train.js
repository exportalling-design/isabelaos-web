import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { user_id, avatar_id, steps = 1200, lr = 1e-4, lora_rank = 16, lora_alpha = 16 } = req.body || {};
    if (!user_id || !avatar_id) return res.status(400).json({ error: "Missing user_id or avatar_id" });

    const { data: avatar } = await supabase.from("avatars").select("*").eq("id", avatar_id).single();
    if (!avatar) return res.status(404).json({ error: "Avatar not found" });
    if (avatar.user_id !== user_id) return res.status(403).json({ error: "Not your avatar" });

    const { data: photos } = await supabase
      .from("avatar_photos")
      .select("storage_path")
      .eq("avatar_id", avatar_id);

    const photoPaths = (photos || []).map(p => p.storage_path);
    if (photoPaths.length < 5) {
      return res.status(400).json({ error: "Not enough photos", count: photoPaths.length, need: 5 });
    }

    // crear job en DB primero
    const { data: jobRow, error: jobErr } = await supabase
      .from("avatar_jobs")
      .insert([{ avatar_id, provider: "runpod", status: "QUEUED", progress: 0 }])
      .select("*")
      .single();

    if (jobErr) throw jobErr;

    // marcar avatar TRAINING
    await supabase.from("avatars").update({ status: "TRAINING", last_error: null }).eq("id", avatar_id);

    // si aún no quieres pegarle a RunPod, setea RUNPOD_AVATAR_ENDPOINT vacío
    const runpodEndpoint = process.env.RUNPOD_AVATAR_ENDPOINT;
    const runpodKey = process.env.RUNPOD_API_KEY;

    if (!runpodEndpoint || !runpodKey) {
      // dejamos job creado pero sin ejecutar
      await supabase.from("avatar_jobs").update({
        status: "FAILED",
        error: "RUNPOD_NOT_CONFIGURED"
      }).eq("id", jobRow.id);

      await supabase.from("avatars").update({
        status: "ERROR",
        last_error: "RUNPOD_NOT_CONFIGURED"
      }).eq("id", avatar_id);

      return res.status(400).json({ ok: false, error: "RUNPOD_NOT_CONFIGURED" });
    }

    const resp = await fetch(runpodEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${runpodKey}`
      },
      body: JSON.stringify({
        input: {
          action: "avatar_train",
          avatar_id: avatar.id,
          user_id: avatar.user_id,
          trigger: avatar.trigger,
          photos: photoPaths,
          steps,
          lr,
          lora_rank,
          lora_alpha,
        }
      })
    });

    const out = await resp.json();

    // RunPod normalmente devuelve { id: "jobid", status: ...}
    const jobId = out?.id;
    if (!jobId) {
      await supabase.from("avatar_jobs").update({
        status: "FAILED",
        error: JSON.stringify(out).slice(0, 2000)
      }).eq("id", jobRow.id);

      await supabase.from("avatars").update({
        status: "ERROR",
        last_error: "RUNPOD_START_FAILED"
      }).eq("id", avatar_id);

      return res.status(500).json({ ok: false, error: "RUNPOD_START_FAILED", details: out });
    }

    await supabase.from("avatar_jobs").update({ job_id: jobId, status: "RUNNING" }).eq("id", jobRow.id);

    return res.json({ ok: true, avatar_id, job_db_id: jobRow.id, runpod_job_id: jobId });
  } catch (err) {
    console.error("[avatars-train]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
