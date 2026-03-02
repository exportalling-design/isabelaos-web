import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function parseBase64(input) {
  const str = String(input || "");
  const m = str.match(/^data:(.+);base64,(.*)$/);
  if (m) return { mime: m[1], b64: m[2] };
  return { mime: "image/jpeg", b64: str };
}

async function getAuthUserId(req) {
  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1];
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error) return null;

  return data?.user?.id || null;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const bucket = process.env.AVATAR_BUCKET || "avatars";
    const user_id = await getAuthUserId(req);
    if (!user_id) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    const { avatar_id, image_b64, filename, is_thumbnail } = req.body || {};

    if (!avatar_id || !image_b64) {
      return res.status(400).json({ ok: false, error: "Missing avatar_id or image_b64" });
    }

    // Validar avatar + dueño
    const { data: avatar, error: avErr } = await supabase
      .from("avatars")
      .select("id,user_id,status,ref_image_path")
      .eq("id", avatar_id)
      .single();

    if (avErr || !avatar) return res.status(404).json({ ok: false, error: "Avatar not found" });
    if (avatar.user_id !== user_id) return res.status(403).json({ ok: false, error: "Not your avatar" });

    // Convertir base64 a bytes
    const { mime, b64 } = parseBase64(image_b64);
    const bytes = Buffer.from(b64, "base64");

    const ext =
      (filename && String(filename).split(".").pop()) ||
      (mime.includes("png") ? "png" : "jpg");

    const key = crypto.randomUUID();

    // ✅ path interno SIN bucket
    const storage_path = `${user_id}/${avatar_id}/train/${key}.${ext}`;

    // Subir al bucket
    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(storage_path, bytes, { contentType: mime, upsert: true });

    if (upErr) throw upErr;

    // Insert en avatar_photos
    const { data: photoRow, error: insErr } = await supabase
      .from("avatar_photos")
      .insert([{ avatar_id, storage_path }])
      .select("*")
      .single();

    if (insErr) throw insErr;

    // ✅ Miniatura:
    // - Si viene is_thumbnail=true -> sobreescribe ref_image_path con esta
    // - Si no hay ref_image_path -> la primera que suba se vuelve miniatura
    const wantsThumb = String(is_thumbnail || "").toLowerCase() === "true";
    if (wantsThumb || !avatar.ref_image_path) {
      await supabase
        .from("avatars")
        .update({ ref_image_path: storage_path })
        .eq("id", avatar_id);
    }

    // actualizar status
    if (avatar.status === "DRAFT") {
      await supabase.from("avatars").update({ status: "UPLOADING" }).eq("id", avatar_id);
    }

    // devolver signed url para preview inmediato
    const { data: signed, error: sErr } = await supabase.storage
      .from(bucket)
      .createSignedUrl(storage_path, 3600);

    if (sErr) throw sErr;

    return res.json({
      ok: true,
      storage_path,
      signed_url: signed?.signedUrl || null,
      photo: photoRow,
      set_as_ref: wantsThumb || !avatar.ref_image_path,
    });
  } catch (err) {
    console.error("[avatars-upload-photo]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
