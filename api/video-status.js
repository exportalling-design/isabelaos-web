// /api/video-status.js
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { requireUser } from "./_auth";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ✅ Bucket donde guardas los videos (confirmaste "generations")
const SUPABASE_BUCKET =
  process.env.SUPABASE_BUCKET || process.env.SUPABASE_STORAGE_BUCKET || "generations";

// Worker timeout (ms)
const WORKER_TIMEOUT_MS = Number(process.env.WORKER_TIMEOUT_MS || 15 * 60 * 1000);

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL (o VITE_SUPABASE_URL)");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function normalizeBaseUrl(u) {
  if (!u) return "";
  let s = String(u).trim();
  s = s.replace(/\/+$/, ""); // remove trailing slashes
  // si viene sin protocolo, intenta https
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s;
}

function computeWorkerBaseFromRow(row) {
  // Prioridad:
  // 1) worker_url (si guardas https://{podId}-8000.proxy.runpod.net)
  // 2) worker_base
  // 3) pod_id -> https://{podId}-8000.proxy.runpod.net
  const direct =
    row.worker_url ||
    row.worker_base ||
    row.workerBase ||
    row.workerbase ||
    row.worker;

  if (direct) return normalizeBaseUrl(direct);

  if (row.pod_id) {
    return `https://${row.pod_id}-8000.proxy.runpod.net`;
  }

  return "";
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...options, signal: ac.signal });
    return r;
  } finally {
    clearTimeout(t);
  }
}

async function uploadMp4ToSupabase(sb, user_id, mp4Bytes) {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const key = `${user_id}/${yyyy}/${mm}/${crypto.randomUUID()}.mp4`;

  const up = await sb.storage.from(SUPABASE_BUCKET).upload(key, mp4Bytes, {
    contentType: "video/mp4",
    upsert: false,
  });

  if (up.error) throw new Error(`Supabase upload failed: ${up.error.message}`);

  // signed url 7 days
  const signed = await sb.storage.from(SUPABASE_BUCKET).createSignedUrl(key, 60 * 60 * 24 * 7);

  let video_url = null;
  if (signed?.data?.signedUrl) {
    video_url = signed.data.signedUrl;
  } else {
    const pub = sb.storage.from(SUPABASE_BUCKET).getPublicUrl(key);
    video_url = pub?.data?.publicUrl || null;
  }

  if (!video_url) throw new Error("Could not produce a video_url (signed or public)");

  return { key, video_url };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Método no permitido" });
    }

    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    const user_id = auth.user.id;

    const job_id = req.query.job_id;
    if (!job_id) return res.status(400).json({ ok: false, error: "Missing job_id" });

    const sb = sbAdmin();

    // Trae TODO para que no dependamos de columnas exactas
    const { data: job, error } = await sb
      .from("video_jobs")
      .select("*")
      .eq("job_id", job_id)
      .single();

    if (error) throw error;

    if (!job?.user_id || job.user_id !== user_id) {
      return res.status(403).json({ ok: false, error: "FORBIDDEN" });
    }

    // Si ya está listo y tiene URL, devolvemos de una vez
    const doneStatuses = ["COMPLETED", "DONE", "SUCCESS", "FINISHED"];
    if (job.video_url && doneStatuses.includes(String(job.status || "").toUpperCase())) {
      return res.status(200).json({
        ok: true,
        job_id: job.job_id,
        status: job.status,
        video_url: job.video_url,
        error: job.error || null,
        pod_id: job.pod_id || null,
        worker_url: job.worker_url || null,
        updated_at: job.updated_at,
      });
    }

    // Si ya está en ERROR, devolvemos el error
    if (String(job.status || "").toUpperCase() === "ERROR") {
      return res.status(200).json({
        ok: true,
        job_id: job.job_id,
        status: job.status,
        video_url: job.video_url || null,
        error: job.error || "ERROR",
        pod_id: job.pod_id || null,
        worker_url: job.worker_url || null,
        updated_at: job.updated_at,
      });
    }

    // ---------------------------------------------------------
    // ✅ Opción A: video-status dispara el render si aún no hay video_url
    // - Hace "lock" actualizando status->RUNNING solo si estaba en cola
    // - Llama worker (/api/video_async) -> recibe MP4 bytes
    // - Sube a Supabase Storage
    // - Actualiza video_jobs (COMPLETED + video_url)
    // ---------------------------------------------------------
    const statusUpper = String(job.status || "").toUpperCase();
    const runnableStatuses = ["IN_QUEUE", "QUEUED", "DISPATCHED", "PENDING"];

    let becameLeader = false;

    if (runnableStatuses.includes(statusUpper) && !job.video_url) {
      // Intento de lock: solo 1 request lo logra
      const { data: locked, error: lockErr } = await sb
        .from("video_jobs")
        .update({ status: "RUNNING", error: null })
        .eq("job_id", job_id)
        .in("status", runnableStatuses)
        .is("video_url", null)
        .select("job_id,status")
        .maybeSingle();

      if (lockErr) {
        // Si falla lock, igual seguimos devolviendo el status actual
        return res.status(200).json({
          ok: true,
          job_id: job.job_id,
          status: job.status,
          video_url: job.video_url || null,
          error: `Lock failed: ${lockErr.message}`,
          pod_id: job.pod_id || null,
          worker_url: job.worker_url || null,
          updated_at: job.updated_at,
        });
      }

      if (locked?.status === "RUNNING") becameLeader = true;
    }

    // Si no somos líder (otro request lo está procesando), devolvemos status
    if (!becameLeader) {
      return res.status(200).json({
        ok: true,
        job_id: job.job_id,
        status: job.status,
        video_url: job.video_url || null,
        error: job.error || null,
        pod_id: job.pod_id || null,
        worker_url: job.worker_url || null,
        updated_at: job.updated_at,
      });
    }

    // -----------------------------
    // Construir workerBase
    // -----------------------------
    const workerBase = computeWorkerBaseFromRow(job);
    if (!workerBase) {
      await sb.from("video_jobs").update({ status: "ERROR", error: "Missing worker url/base or pod_id" }).eq("job_id", job_id);
      return res.status(200).json({
        ok: true,
        job_id,
        status: "ERROR",
        video_url: null,
        error: "Missing worker url/base or pod_id",
      });
    }

    const workerUrl = `${workerBase}/api/video_async`;

    // -----------------------------
    // Payload hacia el worker
    // (si alguna columna no existe, mandamos defaults)
    // -----------------------------
    const payload = {
      mode: job.mode || "t2v",
      user_id: job.user_id,
      prompt: job.prompt || job.prompt_text || "",
      negative_prompt: job.negative_prompt || "",
      height: job.height,
      width: job.width,
      num_frames: job.num_frames,
      fps: job.fps,
      steps: job.steps,
      guidance_scale: job.guidance_scale,
      image_base64: job.image_base64 || null,
    };

    // Validaciones mínimas
    if (!payload.prompt) {
      await sb.from("video_jobs").update({ status: "ERROR", error: "Job has no prompt in DB" }).eq("job_id", job_id);
      return res.status(200).json({
        ok: true,
        job_id,
        status: "ERROR",
        video_url: null,
        error: "Job has no prompt in DB",
      });
    }

    // -----------------------------
    // Ejecutar worker -> MP4 bytes
    // -----------------------------
    let mp4Bytes;
    try {
      const r = await fetchWithTimeout(
        workerUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        WORKER_TIMEOUT_MS
      );

      if (!r.ok) {
        const detail = await r.text().catch(() => "");
        throw new Error(`Worker error (${r.status}): ${detail || "no detail"}`);
      }

      const ab = await r.arrayBuffer();
      mp4Bytes = Buffer.from(ab);

      if (!mp4Bytes || mp4Bytes.length < 200) {
        throw new Error(`Worker returned empty/too small MP4 (${mp4Bytes?.length || 0} bytes)`);
      }
    } catch (e) {
      const msg = String(e?.message || e);
      await sb.from("video_jobs").update({ status: "ERROR", error: msg, worker_url: workerBase }).eq("job_id", job_id);
      return res.status(200).json({
        ok: true,
        job_id,
        status: "ERROR",
        video_url: null,
        error: msg,
        worker_url: workerBase,
      });
    }

    // -----------------------------
    // Upload a Supabase + update video_jobs
    // -----------------------------
    try {
      const { video_url } = await uploadMp4ToSupabase(sb, user_id, mp4Bytes);

      await sb
        .from("video_jobs")
        .update({
          status: "COMPLETED",
          video_url,
          error: null,
          worker_url: workerBase,
        })
        .eq("job_id", job_id);

      return res.status(200).json({
        ok: true,
        job_id,
        status: "COMPLETED",
        video_url,
        error: null,
        worker_url: workerBase,
      });
    } catch (e) {
      const msg = String(e?.message || e);
      await sb.from("video_jobs").update({ status: "ERROR", error: msg, worker_url: workerBase }).eq("job_id", job_id);
      return res.status(200).json({
        ok: true,
        job_id,
        status: "ERROR",
        video_url: null,
        error: msg,
        worker_url: workerBase,
      });
    }
  } catch (e) {
    const msg = String(e?.message || e);

    // timeout del worker (AbortController)
    if (msg.toLowerCase().includes("aborted") || msg.toLowerCase().includes("abort")) {
      return res.status(504).json({ ok: false, error: "Worker timeout", detail: msg });
    }

    return res.status(500).json({ ok: false, error: msg });
  }
}