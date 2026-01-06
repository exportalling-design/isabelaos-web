
// /api/jades-buy.js
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";
import { JADE_PACKS } from "../lib/pricing"; // ajusta si tu ruta real es distinta

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });

    const user_id = auth.user.id;
    const { pack, ref } = req.body || {};

    if (!pack) return res.status(400).json({ ok: false, error: "MISSING_PACK" });

    const p = JADE_PACKS[String(pack)];
    if (!p) return res.status(400).json({ ok: false, error: "INVALID_PACK" });

    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({ ok: false, error: "MISSING_ENV_VARS" });
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await sb.rpc("add_jades", {
      p_user_id: user_id,
      p_amount: Number(p.jades),
      p_reason: `jade_pack:${p.jades}`,
      p_ref: ref || null,
    });

    if (error) return res.status(500).json({ ok: false, error: "CREDIT_ERROR", detail: error.message });

    return res.status(200).json({
      ok: true,
      pack: String(pack),
      credited: p.jades,
      new_balance: data?.[0]?.new_balance ?? null,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", detail: e?.message || String(e) });
  }
}
