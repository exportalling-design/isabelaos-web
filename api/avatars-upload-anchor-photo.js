import { createClient } from "@supabase/supabase-js";

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
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const bucket =
      process.env.SUPABASE_AVATAR_BUCKET ||
      process.env.AVATAR_BUCKET ||
      "avatars";

    const user_id = await getAuthUserId(req);

    if (!user_id) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }

    const { avatar_id, image_b64, anchor_index } = req.body || {};

    if (!avatar_id || !image_b64 || anchor_index == null) {
      return res.status(400).json({
        ok: false,
        error: "Missing avatar_id, image_b64 or anchor_index",
      });
    }

    const idx = Number(anchor_index);
    if (![1, 2, 3].includes(idx)) {
      return res.status(400).json({
        ok: false,
        error: "anchor_index must be 1, 2 or 3",
      });
    }

    const { data: avatar, error: avErr } = await supabase
      .from("avatars")
      .select("id,user_id,ref_image_path")
      .eq("id", avatar_id)
      .single();

    if (avErr || !avatar) {
      return res.status(404).json({ ok: false, error: "Avatar not found" });
    }

    if (avatar.user_id !== user_id) {
      return res.status(403).json({ ok: false, error: "Not your avatar" });
    }

    const { mime, b64 } = parseBase64(image_b64);
    const bytes = Buffer.from(b64, "base64");

    const ext =
      mime.includes("png") ? "png" :
      mime.includes("webp") ? "webp" :
      mime.includes("jpeg") ? "jpg" :
      mime.includes("jpg") ? "jpg" : "jpg";

    const storage_path = `${user_id}/${avatar_id}/anchors/anchor_${idx}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(storage_path, bytes, {
        contentType: mime,
        upsert: true,
      });

    if (upErr) throw upErr;

    const { error: dbErr } = await supabase
      .from("avatar_anchor_photos")
      .upsert(
        [{
          avatar_id,
          user_id,
          anchor_index: idx,
          storage_path,
        }],
        { onConflict: "avatar_id,anchor_index" }
      );

    if (dbErr) throw dbErr;

    const updatePayload = {
      status: "READY",
      updated_at: new Date().toISOString(),
    };

    if (idx === 1 || !avatar.ref_image_path) {
      updatePayload.ref_image_path = storage_path;
    }

    const { error: upAvatarErr } = await supabase
      .from("avatars")
      .update(updatePayload)
      .eq("id", avatar_id);

    if (upAvatarErr) throw upAvatarErr;

    const { data: signed, error: sErr } = await supabase.storage
      .from(bucket)
      .createSignedUrl(storage_path, 3600);

    if (sErr) throw sErr;

    return res.json({
      ok: true,
      avatar_id,
      anchor_index: idx,
      storage_path,
      signed_url: signed?.signedUrl || null,
    });
  } catch (err) {
    console.error("[avatars-upload-anchor-photo]", err);
    return res.status(500).json({ ok: false, error: err.message || "SERVER_ERROR" });
  }
}
