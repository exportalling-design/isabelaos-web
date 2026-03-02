import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function parseBase64(input) {
  // soporta "data:image/jpeg;base64,...." o solo "...."
  const str = String(input || "");
  const m = str.match(/^data:(.+);base64,(.*)$/);
  if (m) return { mime: m[1], b64: m[2] };
  return { mime: "image/jpeg", b64: str };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const bucket = process.env.AVATAR_BUCKET || "avatars";
    const { user_id, avatar_id, image_b64, filename } = req.body || {};

    if (!user_id || !avatar_id || !image_b64) {
      return res.status(400).json({ error: "Missing user_id, avatar_id, image_b64" });
    }

    // valida que el avatar exista y pertenezca al user
    const { data: avatar, error: avErr } = await supabase
      .from("avatars")
      .select("id,user_id,status")
      .eq("id", avatar_id)
      .single();

    if (avErr || !avatar) return res.status(404).json({ error: "Avatar not found" });
    if (avatar.user_id !== user_id) return res.status(403).json({ error: "Not your avatar" });

    const { mime, b64 } = parseBase64(image_b64);
    const bytes = Buffer.from(b64, "base64");

    const ext = (filename && String(filename).split(".").pop()) || (mime.includes("png") ? "png" : "jpg");
    const key = crypto.randomUUID();
    const storage_path = `${user_id}/${avatar_id}/train/${key}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(storage_path, bytes, { contentType: mime, upsert: true });

    if (upErr) throw upErr;

    // registrar foto en DB
    const { data: row, error: insErr } = await supabase
      .from("avatar_photos")
      .insert([{ avatar_id, storage_path: `${bucket}/${storage_path}` }])
      .select("*")
      .single();

    if (insErr) throw insErr;

    // marcar avatar como UPLOADING si estaba DRAFT
    if (avatar.status === "DRAFT") {
      await supabase.from("avatars").update({ status: "UPLOADING" }).eq("id", avatar_id);
    }

    // opcional: guardar una miniatura de referencia (la 1era)
    // si no tiene ref_image_path, setéala a esta foto
    await supabase
      .from("avatars")
      .update({ ref_image_path: supabase.rpc ? undefined : undefined }) // no-op seguro
      .eq("id", avatar_id);

    return res.json({ ok: true, photo: row, storage_path: `${bucket}/${storage_path}` });
  } catch (err) {
    console.error("[avatars-upload-photo]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
