// pages/api/buy-jades.js
import { requireUser } from "../../api/_auth.js"; // ajusta si tu _auth está en otra ruta
import { sbAdmin } from "../../lib/supabaseAdmin";
import { JADE_PACKS } from "../../lib/pricing";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ error: auth.error });

    const user_id = auth.user.id;

    const { pack, ref } = req.body || {};
    if (!pack) return res.status(400).json({ error: "MISSING_FIELDS" });

    const p = JADE_PACKS[String(pack)];
    if (!p) return res.status(400).json({ error: "INVALID_PACK" });

    const sb = sbAdmin();

    const { data, error } = await sb.rpc("add_jades", {
      p_user_id: user_id,
      p_amount: p.jades,
      p_reason: `jade_pack:${p.jades}`,
      p_ref: ref || null,
    });

    if (error) return res.status(500).json({ error: "CREDIT_ERROR", detail: error.message });

    return res.status(200).json({
      ok: true,
      pack: String(pack),
      credited: p.jades,
      new_balance: data?.[0]?.new_balance ?? null,
    });
  } catch (e) {
    return res.status(500).json({ error: "SERVER_ERROR", detail: String(e) });
  }
}