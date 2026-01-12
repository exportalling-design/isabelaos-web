import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

export default async function handler(req, res) {
  try {
    const { job_id } = req.query || {};
    if (!job_id) {
      return res.status(400).json({ ok: false, error: "Missing job_id" });
    }

    // ✅ Auth (recomendado)
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    const user_id = auth.user.id;

    const sb = sbAdmin();

    // ✅ FIX MÍNIMO:
    // En tu tabla el PK es "id" (uuid). Tu frontend manda job_id = ese uuid.
    // Entonces se busca por id. (Dejo fallback por si existe columna job_id en algún entorno.)
    let job = null;

    // 1) Buscar por id
    {
      const { data, error } = await sb
        .from("video_jobs")
        .select("*")
        .eq("id", job_id)       // ✅ CAMBIO CLAVE
        .eq("user_id", user_id) // ✅ evita que otro usuario consulte
        .single();

      if (!error && data) job = data;
    }

    // 2) Fallback: si existiera columna job_id en algún entorno viejo
    if (!job) {
      const { data } = await sb
        .from("video_jobs")
        .select("*")
        .eq("job_id", job_id)
        .eq("user_id", user_id)
        .single();
      if (data) job = data;
    }

    if (!job) {
      return res.status(404).json({ ok: false, error: "Job not found" });
    }

    // ✅ Siempre devolvemos status (aunque no haya pod/worker_url todavía)
    // ✅ Y cuando exista video_url, lo devolvemos.
    return res.status(200).json({
      ok: true,
      status: job.status || "PENDING",
      video_url: job.video_url || null,
      error: job.error || null,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      ok: false,
      error: String(e.message || e),
    });
  }
}