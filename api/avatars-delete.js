import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const bucket = process.env.AVATAR_BUCKET || "avatars";
    const { user_id, avatar_id } = req.body || {};
    if (!user_id || !avatar_id) return res.status(400).json({ error: "Missing user_id or avatar_id" });

    const { data: avatar } = await supabase.from("avatars").select("*").eq("id", avatar_id).single();
    if (!avatar) return res.status(404).json({ error: "Avatar not found" });
    if (avatar.user_id !== user_id) return res.status(403).json({ error: "Not your avatar" });

    // borrar archivos por prefijo (no hay API directa por prefijo; list + remove)
    const prefix = `${user_id}/${avatar_id}`;
    const { data: listed } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 });

    if (listed?.length) {
      const toRemove = listed.map(o => `${prefix}/${o.name}`);
      await supabase.storage.from(bucket).remove(toRemove);
    }

    // borrar fila avatar (cascade elimina photos/jobs)
    await supabase.from("avatars").delete().eq("id", avatar_id);

    return res.json({ ok: true });
  } catch (err) {
    console.error("[avatars-delete]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
