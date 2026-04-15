// api/plantillas-status.js
// ─────────────────────────────────────────────────────────────
// Polling del status de un job de plantilla (Seedance via PiAPI).
// Cuando el job termina:
//   1. Descarga el video de PiAPI
//   2. Lo sube a Supabase Storage (bucket "videos")
//   3. Actualiza video_jobs con status COMPLETED + videoUrl
//   4. Devuelve { status, videoUrl } al frontend
//
// El frontend hace polling cada 8s llamando a este endpoint.
// ─────────────────────────────────────────────────────────────
import { requireUser }  from "./_auth.js";
import { createClient } from "@supabase/supabase-js";

const PIAPI_TASK_URL = "https://api.piapi.ai/api/v1/task";
const VIDEO_BUCKET   = "videos";

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("MISSING_SUPABASE_ENV");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ── Descargar video y subir a Supabase Storage ─────────────────
async function downloadAndSave(userId, videoUrl, plantillaId) {
  try {
    const res = await fetch(videoUrl);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);

    const buf      = await res.arrayBuffer();
    const buffer   = Buffer.from(buf);
    const filename = `plantilla-${plantillaId}-${Date.now()}.mp4`;
    const path     = `${userId}/${filename}`;

    const sb = getSupabaseAdmin();
    const { error } = await sb.storage
      .from(VIDEO_BUCKET)
      .upload(path, buffer, { contentType: "video/mp4", upsert: false });

    if (error) {
      console.error("[plantillas-status] storage upload:", error.message);
      return videoUrl; // devolver URL de PiAPI como fallback
    }

    const { data } = sb.storage.from(VIDEO_BUCKET).getPublicUrl(path);
    console.log(`[plantillas-status] ✅ guardado: ${path}`);
    return data?.publicUrl || videoUrl;
  } catch (e) {
    console.error("[plantillas-status] downloadAndSave:", e?.message);
    return videoUrl; // fallback: URL directa de PiAPI
  }
}

// ── Handler ───────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(401).json({ ok: false, error: auth.error });
    const user = auth.user;

    const jobId = req.query?.jobId || (typeof req.url === "string" && new URL(req.url, "http://x").searchParams.get("jobId"));
    if (!jobId) return res.status(400).json({ ok: false, error: "MISSING_JOB_ID" });

    const sb = getSupabaseAdmin();

    // Buscar el job en video_jobs
    const { data: job, error: fetchErr } = await sb
      .from("video_jobs")
      .select("*")
      .eq("id", jobId)
      .eq("user_id", user.id)
      .single();

    if (fetchErr || !job) return res.status(404).json({ ok: false, error: "JOB_NOT_FOUND" });

    // Si ya está completado, devolver directamente
    if (job.status === "COMPLETED") {
      return res.status(200).json({
        ok:       true,
        status:   "COMPLETED",
        videoUrl: job.output_url || job.payload?.video_url || null,
      });
    }

    // Si ya falló
    if (job.status === "FAILED") {
      return res.status(200).json({
        ok:     false,
        status: "FAILED",
        error:  job.provider_error || "El video falló.",
      });
    }

    // Consultar PiAPI por el taskId
    const taskId = job.provider_request_id || job.payload?.task_id;
    if (!taskId) return res.status(200).json({ ok: true, status: "IN_PROGRESS" });

    const piKey = process.env.PIAPI_KEY;
    if (!piKey) return res.status(200).json({ ok: true, status: "IN_PROGRESS" });

    const piRes = await fetch(`${PIAPI_TASK_URL}/${taskId}`, {
      headers: { "x-api-key": piKey },
    });

    if (!piRes.ok) return res.status(200).json({ ok: true, status: "IN_PROGRESS" });

    const piData = await piRes.json();
    const piStatus = piData?.data?.status || piData?.status || "";

    console.log(`[plantillas-status] jobId=${jobId} taskId=${taskId} piStatus=${piStatus}`);

    // ── COMPLETADO ────────────────────────────────────────────
    if (piStatus === "completed" || piStatus === "COMPLETED" || piStatus === "success") {
      // Extraer URL del video de PiAPI
      const rawVideoUrl =
        piData?.data?.output?.video_url ||
        piData?.data?.output?.url ||
        piData?.data?.output?.video ||
        piData?.output?.video_url ||
        null;

      if (!rawVideoUrl) {
        await sb.from("video_jobs").update({ status: "FAILED", provider_error: "PiAPI completado sin video URL" }).eq("id", jobId);
        return res.status(200).json({ ok: false, status: "FAILED", error: "Video no disponible." });
      }

      // Descargar y guardar en biblioteca
      const plantillaId = job.payload?.plantilla_id || "plantilla";
      const finalUrl    = await downloadAndSave(user.id, rawVideoUrl, plantillaId);

      // Actualizar video_jobs
      await sb.from("video_jobs").update({
        status:          "COMPLETED",
        provider_status: "completed",
        output_url:      finalUrl,
        completed_at:    new Date().toISOString(),
        payload: { ...(job.payload || {}), video_url: finalUrl, piapi_video_url: rawVideoUrl },
      }).eq("id", jobId);

      return res.status(200).json({
        ok:       true,
        status:   "COMPLETED",
        videoUrl: finalUrl,
      });
    }

    // ── FALLIDO ───────────────────────────────────────────────
    if (piStatus === "failed" || piStatus === "FAILED" || piStatus === "error") {
      const errMsg = piData?.data?.error || piData?.error || "Error en el generador de video.";
      await sb.from("video_jobs").update({
        status:          "FAILED",
        provider_status: "failed",
        provider_error:  errMsg,
      }).eq("id", jobId);

      return res.status(200).json({ ok: false, status: "FAILED", error: errMsg });
    }

    // ── EN PROGRESO ───────────────────────────────────────────
    return res.status(200).json({ ok: true, status: "IN_PROGRESS" });

  } catch (e) {
    console.error("[plantillas-status] ERROR:", e?.message || e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
}

export const config = { runtime: "nodejs" };