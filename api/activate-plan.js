import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PLAN_JADES = { basic: 100, pro: 300 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  try {
    const { user_id, plan, ref } = req.body || {};
    if (!user_id || !plan) return res.status(400).json({ error: "MISSING_FIELDS" });
    if (!PLAN_JADES[plan]) return res.status(400).json({ error: "INVALID_PLAN" });

    // 1) upsert subscription
    const { error: subErr } = await supabaseAdmin
      .from("user_subscription")
      .upsert({
        user_id,
        plan,
        status: "active",
        updated_at: new Date().toISOString(),
      });

    if (subErr) return res.status(500).json({ error: "SUBSCRIPTION_SAVE_ERROR", detail: subErr.message });

    // 2) credit monthly included jades (beta: lo haces al activar)
    const { data, error } = await supabaseAdmin.rpc("add_jades", {
      p_user_id: user_id,
      p_amount: PLAN_JADES[plan],
      p_reason: `subscription:${plan}`,
      p_ref: ref || null,
    });

    if (error) return res.status(500).json({ error: "CREDIT_ERROR", detail: error.message });

    return res.status(200).json({ ok: true, plan, credited: PLAN_JADES[plan], new_balance: data?.[0]?.new_balance ?? null });
  } catch (e) {
    return res.status(500).json({ error: "SERVER_ERROR", detail: String(e) });
  }
}
