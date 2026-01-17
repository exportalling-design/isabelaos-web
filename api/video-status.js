// /api/video-status.js
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const VIDEO_JOBS_TABLE = process.env.VIDEO_JOBS_TABLE || "video_jobs";

// Para fallback si queue_position no está guardado (calcula vivo)
const QUEUE_STATUSES = ["PENDING", "IN_QUEUE", "QUEUED", "DISPATCHED", "IN_PROGRESS"];
const ACTIVE_STATUSES = [...QUEUE_STATUSES, "RUNNING"];

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function normStatus(s) {
  const t = String(s || "").trim();
  if (!t) return "PENDING";
  return t.toUpperCase();
}

function shapeResponseFromJob(job) {
  const status = normStatus(job.status);

  const progress =
    typeof job.progress === "number"
      ? job.progress
      : job.progress != null
      ? Number(job.progress)
      : 0;

  let queue_position =
    typeof job.queue_position === "number"
      ? job.queue_position
      : job.queue_position != null
      ? Number(job.queue_position)
      : null;

  let eta_seconds =
    typeof job.eta_seconds === "number"
      ? job.eta_seconds
      : job.eta_seconds != null
      ? Number(job.eta_seconds)
      : null;

  if (status === "RUNNING") queue_position = 0;

  return {
    ok: true,
    // ✅ devolvemos ambos IDs para que el frontend sea consistente
    id: job.id ?? null,        // PK (si existe)
    job_id: job.job_id ?? null, // ✅ el que tú usas en el flujo
    status,
    progress: Math.max(0, Math.min(100, Number(progress || 0))),
    queue_position: queue_position != null ? Math.max(0, Number(queue_position)) : null,
    eta_seconds: eta_seconds != null ? Math.max(0, Number(eta_seconds)) : null,
    video_url: job.video_url || null,
    error: job.error || null,
    created_at: job.created_at || null,
    updated_at: job.updated_at || null,
  };
}

export default async function handler(req, res) {
  try {
    // ✅ Auth primero (soporta llamada sin jobId)
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    const user_id = auth.user.id;

    const sb = sbAdmin();

    const jobIdRaw =
      (req.query?.jobId ||
        req.query?.job_id ||
        req.query?.jobID ||
        req.query?.id ||
        "").toString().trim();

    // ✅ Nuevo: mode opcional para el fallback sin jobId ("i2v" o "t2v")
    const mode = String(req.query?.mode || "").trim() || null;

    // -------------------------------------------------------
    // 0) Si NO viene jobId -> devolver job activo más reciente
    // -------------------------------------------------------
    if (!jobIdRaw) {
      let q = sb
        .from(VIDEO_JOBS_TABLE)
        .select("*")
        .eq("user_id", user_id)
        .in("status", ACTIVE_STATUSES)
        .order("created_at", { ascending: false })
        .limit(1);

      // Filtro opcional por payload.mode (JSONB)
      if (mode) q = q.eq("payload->>mode", mode);

      const { data, error } = await q;

      if (error) {
        return res.status(500).json({ ok: false, error: error.message || "DB error" });
      }

      const job = data?.[0] || null;

      // Si no hay job activo, responde IDLE (sin romper UI)
      if (!job) {
        return res.status(200).json({
          ok: true,
          id: null,
          job_id: null,
          status: "IDLE",
          progress: 0,
          queue_position: null,
          eta_seconds: null,
          video_url: null,
          error: null,
          created_at: null,
          updated_at: null,
        });
      }

      return res.status(200).json(shapeResponseFromJob(job));
    }

    // -------------------------------------------------------
    // 1) ✅ Buscar por job_id primero (TU FLUJO REAL)
    // 2) Fallback: buscar por id (compatibilidad)
    // -------------------------------------------------------
    let job = null;

    // 1) job_id
    {
      const r1 = await sb
        .from(VIDEO_JOBS_TABLE)
        .select("*")
        .eq("job_id", jobIdRaw)
        .eq("user_id", user_id)
        .maybeSingle();

      if (!r1.error && r1.data) job = r1.data;
    }

    // 2) id (fallback)
    if (!job) {
      const r2 = await sb
        .from(VIDEO_JOBS_TABLE)
        .select("*")
        .eq("id", jobIdRaw)
        .eq("user_id", user_id)
        .maybeSingle();

      if (!r2.error && r2.data) job = r2.data;
    }

    if (!job) return res.status(404).json({ ok: false, error: "Job not found" });

    const status = normStatus(job.status);

    const progress =
      typeof job.progress === "number"
        ? job.progress
        : job.progress != null
        ? Number(job.progress)
        : 0;

    let queue_position =
      typeof job.queue_position === "number"
        ? job.queue_position
        : job.queue_position != null
        ? Number(job.queue_position)
        : null;

    let eta_seconds =
      typeof job.eta_seconds === "number"
        ? job.eta_seconds
        : job.eta_seconds != null
        ? Number(job.eta_seconds)
        : null;

    // Fallback: si no está guardado queue_position, lo calculamos en vivo
    if (
      (queue_position == null || Number.isNaN(queue_position)) &&
      QUEUE_STATUSES.includes(status) &&
      job.created_at
    ) {
      const { count } = await sb
        .from(VIDEO_JOBS_TABLE)
        .select("id", { count: "exact", head: true })
        .in("status", QUEUE_STATUSES)
        .lt("created_at", job.created_at);

      if (typeof count === "number") queue_position = count + 1;
    }

    if (status === "RUNNING") queue_position = 0;

    return res.status(200).json({
      ok: true,
      id: job.id ?? null,
      job_id: job.job_id ?? null, // ✅ clave para tu frontend
      status,
      progress: Math.max(0, Math.min(100, Number(progress || 0))),
      queue_position: queue_position != null ? Math.max(0, Number(queue_position)) : null,
      eta_seconds: eta_seconds != null ? Math.max(0, Number(eta_seconds)) : null,
      video_url: job.video_url || null,
      error: job.error || null,
      created_at: job.created_at || null,
      updated_at: job.updated_at || null,
    });
  } catch (e) {
    console.error("[video-status] fatal:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}