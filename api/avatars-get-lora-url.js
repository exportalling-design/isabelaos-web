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

    const { data: avatar, error: avErr } = await supabase
      .from("avatars")
      .select("id,user_id,lora_path,name,status")
      .eq("id", avatar_id)
      .single();

    if (avErr || !avatar) return res.status(404).json({ ok: false, error: "Avatar not found" });
    if (avatar.user_id !== user_id) return res.status(403).json({ ok: false, error: "Not your avatar" });

    if (!avatar.lora_path) {
      return res.json({ ok: true, avatar_id, name: avatar.name, status: avatar.status, lora_url: null });
    }

    const { data: signed, error: sErr } = await supabase.storage
      .from(bucket)
      .createSignedUrl(avatar.lora_path, expires_in);

    if (sErr) throw sErr;

    return res.json({
      ok: true,
      avatar_id,
      name: avatar.name,
      status: avatar.status,
      lora_path: avatar.lora_path,
      lora_url: signed?.signedUrl || null,
      expires_in
    });
  } catch (err) {
    console.error("[avatars-get-lora-url]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
