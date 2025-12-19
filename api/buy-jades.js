import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PACKS = { "100": 100, "300": 300 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  try {
    const { user_id, pack, ref } = req.body || {};
    if (!user_id || !pack) return res.status(400).json({ error: "MISSING_FIELDS" });

    const amount = PACKS[String(pack)];
    if (!amount) return res.status(400).json({ error: "INVALID_PACK" });

    const { data, error } = await supabaseAdmin.rpc("add_jades", {
      p_user_id: user_id,
      p_amount: amount,
      p_reason: `jade_pack:${amount}`,
      p_ref: ref || null,
    });

    if (error) return res.status(500).json({ error: "CREDIT_ERROR", detail: error.message });

    return res.status(200).json({ ok: true, pack: amount, new_balance: data?.[0]?.new_balance ?? null });
  } catch (e) {
    return res.status(500).json({ error: "SERVER_ERROR", detail: String(e) });
  }
}
