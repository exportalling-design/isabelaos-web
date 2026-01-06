
// /api/jades-spend.js
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });

    const user_id = auth.user.id;

    const { amount, reason, ref } = req.body || {};
    const p_amount = Number(amount);

    if (!p_amount || p_amount <= 0) {
      return res.status(400).json({ ok: false, error: "INVALID_AMOUNT" });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({ ok: false, error: "MISSING_ENV_VARS" });
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await sb.rpc("spend_jades", {
      p_user_id: user_id,
      p_amount,
      p_reason: String(reason || "spend"),
      p_ref: ref || null,
    });

    if (error) {
      if ((error.message || "").includes("INSUFFICIENT_JADES")) {
        return res.status(402).json({ ok: false, error: "INSUFFICIENT_JADES" });
      }
      return res.status(500).json({ ok: false, error: "RPC_ERROR", detail: error.message });
    }

    return res.status(200).json({
      ok: true,
      spent: p_amount,
      new_balance: data?.[0]?.new_balance ?? null,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", detail: e?.message || String(e) });
  }
}
