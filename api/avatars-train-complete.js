import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const bucket = process.env.AVATAR_BUCKET || "avatars";
    const del = String(process.env.DELETE_TRAINING_PHOTOS || "true") === "true";

    const { avatar_id, runpod_job_id, lora_path, ok = true, error } = req.body || {};
    if (!avatar_id) return res.status(400).json({ error: "Missing avatar_id" });

    // Actualiza job
    if (runpod_job_id) {
      await supabase
        .from("avatar_jobs")
        .update({
          status: ok ? "SUCCEEDED" : "FAILED",
          progress: ok ? 100 : 0,
          error: ok ? null : (error || "FAILED"),
          result_json: req.body || null
        })
        .eq("job_id", runpod_job_id);
    }

    if (!ok) {
      await supabase.from("avatars").update({ status: "ERROR", last_error: error || "TRAIN_FAILED" }).eq("id", avatar_id);
      return res.json({ ok: true, status: "ERROR" });
    }

    // Avatar READY
    await supabase
      .from("avatars")
      .update({ status: "READY", lora_path: lora_path || null, last_error: null })
      .eq("id", avatar_id);

    // Limpieza (fallback) - si tu trainer ya borra, esto no estorba
    if (del) {
      const { data: photos } = await supabase
        .from("avatar_photos")
        .select("id,storage_path")
        .eq("avatar_id", avatar_id);

      const objects = (photos || [])
        .map(p => p.storage_path)
        .filter(Boolean)
        .map(full => full.startsWith(`${bucket}/`) ? full.slice(bucket.length + 1) : full); // quita "avatars/"

      if (objects.length) {
        await supabase.storage.from(bucket).remove(objects);
      }

      await supabase.from("avatar_photos").delete().eq("avatar_id", avatar_id);
    }

    return res.json({ ok: true, status: "READY", deleted_training_photos: del });
  } catch (err) {
    console.error("[avatars-train-complete]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
