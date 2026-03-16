import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function preserveAnchorPhotos({ avatar_id, bucket }) {
  // 1) Buscar avatar para saber user_id
  const { data: avatar, error: avErr } = await supabase
    .from("avatars")
    .select("id,user_id")
    .eq("id", avatar_id)
    .single();

  if (avErr || !avatar) {
    throw new Error(`Avatar not found while preserving anchors: ${avErr?.message || "UNKNOWN"}`);
  }

  // 2) Tomar hasta 3 fotos de entrenamiento en orden de creación
  const { data: photos, error: phErr } = await supabase
    .from("avatar_photos")
    .select("id,storage_path,created_at")
    .eq("avatar_id", avatar_id)
    .order("created_at", { ascending: true })
    .limit(3);

  if (phErr) throw phErr;

  const anchors = photos || [];
  if (!anchors.length) {
    console.warn("[avatars-train-complete] No training photos found to preserve as anchors");
    return { preserved: 0, paths: [] };
  }

  const preservedPaths = [];

  for (let i = 0; i < anchors.length; i++) {
    const srcPath = anchors[i].storage_path;
    if (!srcPath) continue;

    // Descargar bytes del archivo original
    const { data: downloaded, error: dlErr } = await supabase.storage
      .from(bucket)
      .download(srcPath);

    if (dlErr) {
      console.error("[avatars-train-complete] download anchor source failed:", srcPath, dlErr);
      continue;
    }

    // Conservar extensión original si existe
    const parts = String(srcPath).split(".");
    const ext = parts.length > 1 ? parts.pop() : "jpg";

    // Guardar en carpeta fija de anchors
    const dstPath = `${avatar.user_id}/${avatar_id}/anchors/anchor_${i + 1}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(dstPath, downloaded, {
        upsert: true,
        contentType: downloaded.type || "image/jpeg",
      });

    if (upErr) {
      console.error("[avatars-train-complete] upload anchor failed:", dstPath, upErr);
      continue;
    }

    preservedPaths.push(dstPath);
  }

  return { preserved: preservedPaths.length, paths: preservedPaths };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const bucket = process.env.AVATAR_BUCKET || "avatars";
    const del = String(process.env.DELETE_TRAINING_PHOTOS || "true") === "true";

    const { avatar_id, runpod_job_id, lora_path, ok = true, error } = req.body || {};
    if (!avatar_id) {
      return res.status(400).json({ error: "Missing avatar_id" });
    }

    // Actualiza job
    if (runpod_job_id) {
      await supabase
        .from("avatar_jobs")
        .update({
          status: ok ? "SUCCEEDED" : "FAILED",
          progress: ok ? 100 : 0,
          error: ok ? null : (error || "FAILED"),
          result_json: req.body || null,
        })
        .eq("job_id", runpod_job_id);
    }

    if (!ok) {
      await supabase
        .from("avatars")
        .update({
          status: "ERROR",
          last_error: error || "TRAIN_FAILED",
        })
        .eq("id", avatar_id);

      return res.json({ ok: true, status: "ERROR" });
    }

    // ✅ NUEVO: preservar 3 anchors ANTES de limpiar
    let anchorsInfo = { preserved: 0, paths: [] };
    try {
      anchorsInfo = await preserveAnchorPhotos({ avatar_id, bucket });
      console.log("[avatars-train-complete] anchors preserved:", anchorsInfo);
    } catch (anchorErr) {
      // No rompemos el entrenamiento por esto
      console.error("[avatars-train-complete] preserve anchors failed:", anchorErr);
    }

    // Avatar READY
    await supabase
      .from("avatars")
      .update({
        status: "READY",
        lora_path: lora_path || null,
        last_error: null,
      })
      .eq("id", avatar_id);

    // Limpieza de training photos (fallback)
    if (del) {
      const { data: photos } = await supabase
        .from("avatar_photos")
        .select("id,storage_path")
        .eq("avatar_id", avatar_id);

      const objects = (photos || [])
        .map((p) => p.storage_path)
        .filter(Boolean)
        .map((full) =>
          full.startsWith(`${bucket}/`) ? full.slice(bucket.length + 1) : full
        );

      if (objects.length) {
        await supabase.storage.from(bucket).remove(objects);
      }

      await supabase.from("avatar_photos").delete().eq("avatar_id", avatar_id);
    }

    return res.json({
      ok: true,
      status: "READY",
      deleted_training_photos: del,
      anchors_preserved: anchorsInfo.preserved,
      anchor_paths: anchorsInfo.paths,
    });
  } catch (err) {
    console.error("[avatars-train-complete]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
