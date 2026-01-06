// pages/api/charge-jades.js
import { requireUser } from "../../api/_auth.js"; // ajusta si tu _auth está en otra ruta
import { sbAdmin } from "../../lib/supabaseAdmin";
import { COSTS } from "../../lib/pricing";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ error: auth.error });

    const user_id = auth.user.id;

    const { kind, ref } = req.body || {};
    if (!kind) return res.status(400).json({ error: "MISSING_FIELDS" });

    const cost = COSTS[kind];
    if (!cost) return res.status(400).json({ error: "INVALID_KIND" });

    const sb = sbAdmin();

    const { data, error } = await sb.rpc("spend_jades", {
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
