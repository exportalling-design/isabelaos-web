import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { user_id, avatar_id, min_photos = 5 } = req.body || {};
    if (!user_id || !avatar_id) return res.status(400).json({ error: "Missing user_id or avatar_id" });

    const { data: avatar } = await supabase.from("avatars").select("*").eq("id", avatar_id).single();
    if (!avatar) return res.status(404).json({ error: "Avatar not found" });
    if (avatar.user_id !== user_id) return res.status(403).json({ error: "Not your avatar" });

    const { data: photos } = await supabase
      .from("avatar_photos")
      .select("storage_path")
      .eq("avatar_id", avatar_id);

    const count = photos?.length || 0;
    if (count < Number(min_photos)) {
      return res.status(400).json({ ok: false, error: "NOT_ENOUGH_PHOTOS", count, need: Number(min_photos) });
    }

    await supabase.from("avatars").update({ status: "UPLOADING" }).eq("id", avatar_id);

    return res.json({ ok: true, count, status: "UPLOADING" });
  } catch (err) {
    console.error("[avatars-ready-to-train]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
