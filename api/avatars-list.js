import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

    const user_id = String(req.query.user_id || "");
    if (!user_id) return res.status(400).json({ error: "Missing user_id" });

    const { data, error } = await supabase
      .from("avatars")
      .select("id,name,trigger,status,ref_image_path,lora_path,created_at,updated_at,last_error")
      .eq("user_id", user_id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return res.json({ ok: true, avatars: data || [] });
  } catch (err) {
    console.error("[avatars-list]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
