// ============================================================
// /api/video-status.js
// IsabelaOS Studio
// Endpoint para consultar el estado REAL de un video async
// Funciona para:
// - video desde prompt (t2v)
// - video desde imagen (i2v)
// ============================================================

// Cliente Supabase
import { createClient } from "@supabase/supabase-js";

// Middleware de auth (usuario logueado)
import { requireUser } from "./_auth.js";

// Variables de entorno
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Tabla donde viven los jobs
const VIDEO_JOBS_TABLE = process.env.VIDEO_JOBS_TABLE || "video_jobs";

// Estados que indican que el job sigue en cola
const QUEUE_STATUSES = [
  "PENDING",
  "IN_QUEUE",
  "QUEUED",
  "DISPATCHED",
  "IN_PROGRESS",
];

// Estados activos (cola + ejecutando)
const ACTIVE_STATUSES = [...QUEUE_STATUSES, "RUNNING"];

// ------------------------------------------------------------
// Cliente admin de Supabase (sin sesión persistente)
// ------------------------------------------------------------
function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// Normaliza el status (mayúsculas y fallback)
function normStatus(s) {
  return String(s || "PENDING").toUpperCase();
}

// Da forma estándar a la respuesta del job
function shape(job) {
  const status = normStatus(job.status);

  let queue_position = job.queue_position ?? null;
  let eta_seconds = job.eta_seconds ?? null;

  // Si ya está corriendo → posición 0
  if (status === "RUNNING") queue_position = 0;

  return {
    ok: true,
    id: job.id ?? null,             // PK de la tabla
    job_id: job.job_id ?? null,     // UUID real del flujo
    status,
    progress: Math.max(0, Math.min(100, Number(job.progress || 0))),
    queue_position,
    eta_seconds,
    video_url: job.video_url || null,
    error: job.error || null,
    created_at: job.created_at,
    updated_at: job.updated_at,
    mode: job.mode || job.payload?.mode || null,
  };
}

// ============================================================
// HANDLER PRINCIPAL
// ============================================================
export default async function handler(req, res) {
  try {
    // 1️⃣ Verificar usuario autenticado
    const auth = await requireUser(req);
    if (!auth.ok) {
      return res.status(auth.code || 401).json({
        ok: false,
        error: auth.error,
      });
    }

    const user_id = auth.user.id;
    const sb = sbAdmin();

    // job_id opcional por query
    const jobId = String(
      req.query?.job_id ||
      req.query?.jobId ||
      req.query?.id ||
      ""
    ).trim();

    // modo opcional (t2v / i2v)
    const mode = String(req.query?.mode || "").trim() || null;

    // --------------------------------------------------------
    // CASO A: NO viene job_id → devolver job activo más reciente
    // --------------------------------------------------------
    if (!jobId) {
      let q = sb
        .from(VIDEO_JOBS_TABLE)
        .select("*")
        .eq("user_id", user_id)
        .in("status", ACTIVE_STATUSES)
        .order("created_at", { ascending: false })
        .limit(1);

      // Si viene modo, filtra
      if (mode) q = q.eq("mode", mode);

      const { data, error } = await q;
      if (error) throw error;

      const job = data?.[0];

      // Si no hay job → sistema idle
      if (!job) {
        return res.status(200).json({
          ok: true,
          status: "IDLE",
          progress: 0,
          queue_position: null,
          eta_seconds: null,
          video_url: null,
          error: null,
        });
      }

      return res.status(200).json(shape(job));
    }

    // --------------------------------------------------------
    // CASO B: viene job_id → buscar ese job
    // --------------------------------------------------------
    const { data: job, error } = await sb
      .from(VIDEO_JOBS_TABLE)
      .select("*")
      .eq("job_id", jobId)
      .eq("user_id", user_id)
      .maybeSingle();

    if (error) throw error;
    if (!job) {
      return res.status(404).json({
        ok: false,
        error: "Job not found",
      });
    }

    // --------------------------------------------------------
    // Fallback: calcular posición en cola si no existe
    // --------------------------------------------------------
    if (
      job.queue_position == null &&
      QUEUE_STATUSES.includes(normStatus(job.status))
    ) {
      const { count } = await sb
        .from(VIDEO_JOBS_TABLE)
        .select("id", { count: "exact", head: true })
        .in("status", QUEUE_STATUSES)
        .lt("created_at", job.created_at);

      if (typeof count === "number") {
        job.queue_position = count + 1;
      }
    }

    return res.status(200).json(shape(job));
  } catch (e) {
    console.error("[video-status]", e);
    return res.status(500).json({
      ok: false,
      error: String(e?.message || e),
    });
  }
}