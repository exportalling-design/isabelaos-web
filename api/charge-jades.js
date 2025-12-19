import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const COSTS = {
  "img_prompt": 1,
  "img_transform": 2,
  "vid_prompt": 10,
  "vid_img2vid": 12,
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  try {
    const { user_id, kind, ref } = req.body || {};
    if (!user_id || !kind) return res.status(400).json({ error: "MISSING_FIELDS" });

    const cost = COSTS[kind];
    if (!cost) return res.status(400).json({ error: "INVALID_KIND" });

    const { data, error } = await supabaseAdmin.rpc("spend_jades", {
      p_user_id: user_id,
      p_amount: cost,
      p_reason: `generation:${kind}`,
      p_ref: ref || null,
    });

    if (error) {
      if ((error.message || "").includes("INSUFFICIENT_JADES")) {
        return res.status(402).json({ error: "INSUFFICIENT_JADES" });
      }
      return res.status(500).json({ error: "RPC_ERROR", detail: error.message });
    }

    return res.status(200).json({ ok: true, cost, new_balance: data?.[0]?.new_balance ?? null });
  } catch (e) {
    return res.status(500).json({ error: "SERVER_ERROR", detail: String(e) });
  }
}
