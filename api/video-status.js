// /api/video-status.js
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

// ============================================================
// IsabelaOS Studio — Video Status
// - Busca job por job_id (fallback por id)
// - Si TERMINATE_AFTER_JOB=1 y el job terminó:
//   => termina el pod actual en pod_state para no dejar GPUs abiertas
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY =
  process.env.VIDEO_RUNPOD_API_KEY ||
  process.env.RUNPOD_API_KEY ||
  null;

const POD_STATE_TABLE = "pod_state";
const VIDEO_JOBS_TABLE = "video_jobs";

const TERMINATE_AFTER_JOB = String(process.env.TERMINATE_AFTER_JOB || "0") === "1";

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY (set VIDEO_RUNPOD_API_KEY or RUNPOD_API_KEY)");
  return {
    Authorization: `Bearer ${RUNPOD_API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function runpodTerminatePod(podId) {
  // Intento 1
  {
    const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}/terminate`, {
      method: "POST",
      headers: runpodHeaders(),
    });
    if (r.ok) return true;
  }
  // Intento 2
  {
    const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, {
      method: "DELETE",
      headers: runpodHeaders(),
    });
    if (r.ok) return true;
    const t = await r.text().catch(() => "");
    throw new Error(`RunPod terminate failed: ${t}`);
  }
}

function isFinalStatus(status) {
  const s = String(status || "").toUpperCase();
  return ["DONE", "COMPLETED", "SUCCESS", "FAILED", "ERROR", "CANCELED", "CANCELLED"].includes(s);
}

export default async function handler(req, res) {
  try {
    const { job_id } = req.query || {};
    if (!job_id) return res.status(400).json({ ok: false, error: "Missing job_id" });

    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    const user_id = auth.user.id;

    const sb = sbAdmin();

    // 1) Buscar por job_id
    let job = null;
    {
      const { data } = await sb
        .from(VIDEO_JOBS_TABLE)
        .select("*")
        .eq("job_id", job_id)
        .eq("user_id", user_id)
        .single();
      if (data) job = data;
    }

    // 2) Fallback por id (por si frontend manda el PK uuid)
    if (!job) {
      const { data } = await sb
        .from(VIDEO_JOBS_TABLE)
        .select("*")
        .eq("id", job_id)
        .eq("user_id", user_id)
        .single();
      if (data) job = data;
    }

    if (!job) return res.status(404).json({ ok: false, error: "Job not found" });

    // Si el job ya terminó y TERMINATE_AFTER_JOB=1 => terminar pod para no dejar GPUs abiertas
    let terminated = null;
    if (TERMINATE_AFTER_JOB && isFinalStatus(job.status)) {
      try {
        const { data: podState } = await sb
          .from(POD_STATE_TABLE)
          .select("*")
          .eq("id", 1)
          .single();

        const podId = String(podState?.pod_id || "");
        if (podId) {
          await runpodTerminatePod(podId);

          // limpiamos el pod_state (para que el próximo generate cree uno nuevo)
          await sb.from(POD_STATE_TABLE).update({
            pod_id: null,
            status: "STOPPED",
            last_used_at: new Date().toISOString(),
          }).eq("id", 1);

          terminated = { ok: true, pod_id: podId };
        }
      } catch (e) {
        terminated = { ok: false, error: String(e?.message || e) };
      }
    }

    return res.status(200).json({
      ok: true,
      status: job.status || "PENDING",
      video_url: job.video_url || null,
      error: job.error || null,
      terminated, // info de limpieza si aplica
    });
  } catch (e) {
    console.error("[video-status] fatal:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}