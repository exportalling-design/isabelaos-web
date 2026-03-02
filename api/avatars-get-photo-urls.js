import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

    const bucket = process.env.AVATAR_BUCKET || "avatars";
    const avatar_id = String(req.query.avatar_id || "");
    const user_id = String(req.query.user_id || "");
    const expires_in = Number(req.query.expires_in || 3600);

    if (!avatar_id || !user_id) {
      return res.status(400).json({ ok: false, error: "Missing avatar_id or user_id" });
    }

    // validar dueño
    const { data: avatar, error: avErr } = await supabase
      .from("avatars")
      .select("id,user_id")
      .eq("id", avatar_id)
      .single();

    if (avErr || !avatar) return res.status(404).json({ ok: false, error: "Avatar not found" });
    if (avatar.user_id !== user_id) return res.status(403).json({ ok: false, error: "Not your avatar" });

    const { data: photos, error: pErr } = await supabase
      .from("avatar_photos")
      .select("id,storage_path,created_at")
      .eq("avatar_id", avatar_id)
      .order("created_at", { ascending: true });

    if (pErr) throw pErr;

    const items = [];
    for (const p of photos || []) {
      const { data: signed, error: sErr } = await supabase.storage
        .from(bucket)
        .createSignedUrl(p.storage_path, expires_in);
      if (sErr) throw sErr;

      items.push({
        id: p.id,
        storage_path: p.storage_path,
        url: signed?.signedUrl || null,
        created_at: p.created_at
      });
    }

    return res.json({ ok: true, avatar_id, expires_in, photos: items });
  } catch (err) {
    console.error("[avatars-get-photo-urls]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
