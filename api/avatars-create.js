import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const { user_id, name } = req.body || {};

    if (!user_id || !String(name || "").trim()) {
      return res.status(400).json({ ok: false, error: "Missing user_id or name" });
    }

    const { data, error } = await supabase
      .from("avatars")
      .insert([
        {
          user_id,
          name: String(name).trim(),
          trigger: null,
          status: "DRAFT",
          lora_path: null,
        },
      ])
      .select("*")
      .single();

    if (error) throw error;

    return res.json({ ok: true, avatar: data });
  } catch (err) {
    console.error("[avatars-create]", err);
    return res.status(500).json({ ok: false, error: err.message || "SERVER_ERROR" });
  }
}
