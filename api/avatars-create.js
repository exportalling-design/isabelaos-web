import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { user_id, name } = req.body;

    if (!user_id || !name) {
      return res.status(400).json({ error: "Missing user_id or name" });
    }

    // Generar trigger único tipo iso_ab12cd
    const random = crypto.randomBytes(3).toString("hex");
    const trigger = `iso_${random}`;

    const { data, error } = await supabase
      .from("avatars")
      .insert([
        {
          user_id,
          name,
          trigger,
          status: "DRAFT"
        }
      ])
      .select()
      .single();

    if (error) throw error;

    return res.json({
      ok: true,
      avatar: data
    });

  } catch (err) {
    console.error("AVATAR CREATE ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}
