// /api/avatars-poll-runpod.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ID fijo de tu endpoint de RunPod
const RUNPOD_ENDPOINT_ID = "uktq024dj0d4go";

// Construye la URL de status para un job específico
function runpodStatusUrl(jobId) {
  return `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/status/${jobId}`;
}

// Normaliza estados de RunPod / DB para que el frontend siempre vea lo mismo
function normalizeStatus(raw) {
  const s = String(raw || "").toUpperCase();

  if (!s) return "IN_QUEUE";
  if (["IN_QUEUE", "QUEUED", "QUEUE", "PENDING"].includes(s)) return "IN_QUEUE";
  if (["IN_PROGRESS", "RUNNING", "PROCESSING", "STARTED", "TRAINING"].includes(s)) return "IN_PROGRESS";
  if (["COMPLETED", "SUCCEEDED", "SUCCESS", "DONE", "FINISHED", "READY"].includes(s)) return "SUCCEEDED";
  if (["FAILED", "ERROR", "CANCELLED", "CANCELED", "TIMED_OUT", "TIMEOUT"].includes(s)) return "FAILED";

  return s;
}

// Extrae un mensaje de error útil desde la respuesta de RunPod
function extractErrorMessage(st) {
  const candidates = [
    st?.output?.error,
    st?.output?.message,
    st?.error,
    st?.message,
    st?.output?.stderr,
    st?.output?.logs,
    st?.trace,
  ];

  for (const c of candidates) {
    if (c && String(c).trim()) {
      return String(c).trim().slice(0, 2000);
    }
  }

  try {
    const s = JSON.stringify(st);
    if (s && s !== "{}") return s.slice(0, 2000);
  } catch {}

  return "RUNPOD_FAILED";
}

// Intenta extraer la ruta del LoRA desde la salida del trainer
function extractLoraPath(st) {
  const out = st?.output || st?.result || st;

  let loraPath =
    out?.lora_path ||
    out?.lora_bucket_path ||
    out?.lora ||
    out?.loraBucketPath ||
    null;

  if (!loraPath) return null;

  loraPath = String(loraPath);

  // Si viene con "avatars/..." lo normalizamos
  if (loraPath.startsWith("avatars/")) {
    loraPath = loraPath.slice("avatars/".length);
  }

  return loraPath;
}

export default async function handler(req, res) {
  try {
    // Solo POST
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const runpodKey = process.env.RUNPOD_API_KEY;
    if (!runpodKey) {
      return res.status(400).json({ ok: false, error: "RUNPOD_API_KEY_MISSING" });
    }

    const {
      avatar_id, // recomendado: el frontend lo manda
      user_id,   // opcional, pero útil para validar dueño si luego quieres endurecer
      job_id,    // opcional: poll por runpod job id
      limit = 10,
    } = req.body || {};

    // ------------------------------------------------------------
    // 1) Buscar jobs activos en DB
    // ------------------------------------------------------------
    let q = supabase
      .from("avatar_jobs")
      .select("id, avatar_id, job_id, status, result_json, error, created_at")
      .in("status", ["IN_QUEUE", "IN_PROGRESS", "RUNNING", "QUEUED"])
      .order("created_at", { ascending: false })
      .limit(Number(limit));

    if (job_id) q = q.eq("job_id", job_id);
    if (avatar_id) q = q.eq("avatar_id", avatar_id);

    const { data: jobs, error: jErr } = await q;
    if (jErr) throw jErr;

    // ------------------------------------------------------------
    // 2) Si no hay jobs activos pero sí hay avatar_id,
    //    devolvemos el estado actual del avatar desde DB
    // ------------------------------------------------------------
    if ((!jobs || jobs.length === 0) && avatar_id) {
      let avQuery = supabase
        .from("avatars")
        .select("id, user_id, status, lora_path, last_error, train_error, train_job_id, train_job_db_id")
        .eq("id", avatar_id)
        .single();

      const { data: av, error: avErr } = await avQuery;
      if (avErr) throw avErr;

      // Si quieres endurecer seguridad, descomenta esto:
      // if (user_id && av.user_id !== user_id) {
      //   return res.status(403).json({ ok: false, error: "Not your avatar" });
      // }

      return res.json({
        ok: true,
        endpoint_id: RUNPOD_ENDPOINT_ID,
        checked: 0,
        results: [],
        avatar: {
          id: av.id,
          status: av.status || "—",
          lora_path: av.lora_path || null,
          train_job_id: av.train_job_id || null,
          train_job_db_id: av.train_job_db_id || null,
          train_error: av.train_error || av.last_error || null,
        },
        job: av.train_job_id
          ? {
              id: av.train_job_id,
              status: normalizeStatus(av.status),
              provider: "runpod",
              error: av.train_error || av.last_error || null,
              db_id: av.train_job_db_id || null,
            }
          : null,
      });
    }

    const results = [];
    let lastAvatar = null;
    let lastJob = null;

    // ------------------------------------------------------------
    // 3) Consultar RunPod por cada job activo
    // ------------------------------------------------------------
    for (const j of jobs || []) {
      if (!j.job_id) continue;

      const url = runpodStatusUrl(j.job_id);

      const r = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${runpodKey}`,
        },
      });

      const st = await r.json().catch(() => ({}));
      const runStatus = normalizeStatus(st?.status);

      const isRunning = runStatus === "IN_QUEUE" || runStatus === "IN_PROGRESS";
      const isDone = runStatus === "SUCCEEDED";
      const isFail = runStatus === "FAILED";

      // Job base para frontend
      lastJob = {
        id: j.job_id,
        status: runStatus,
        provider: "runpod",
        db_id: j.id,
        error: null,
      };

      // ----------------------------------------------------------
      // 3A) Sigue en cola o entrenando
      // ----------------------------------------------------------
      if (isRunning) {
        await supabase
          .from("avatar_jobs")
          .update({
            status: runStatus,
            result_json: st,
            error: null,
          })
          .eq("id", j.id);

        await supabase
          .from("avatars")
          .update({
            status: runStatus,
            train_job_id: j.job_id,
            train_job_db_id: j.id,
            train_error: null,
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", j.avatar_id);

        results.push({
          job_id: j.job_id,
          runpod_status: runStatus,
          db_status: runStatus,
        });

        lastAvatar = {
          id: j.avatar_id,
          status: runStatus,
          train_job_id: j.job_id,
          train_job_db_id: j.id,
          train_error: null,
        };

        continue;
      }

      // ----------------------------------------------------------
      // 3B) Falló
      // ----------------------------------------------------------
      if (isFail) {
        const errMsg = extractErrorMessage(st);

        await supabase
          .from("avatar_jobs")
          .update({
            status: "FAILED",
            error: errMsg,
            result_json: st,
            progress: 0,
          })
          .eq("id", j.id);

        const { data: avFailed } = await supabase
          .from("avatars")
          .update({
            status: "FAILED",
            last_error: errMsg,
            train_error: errMsg,
            train_job_id: j.job_id,
            train_job_db_id: j.id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", j.avatar_id)
          .select("id, status, lora_path, last_error, train_error, train_job_id, train_job_db_id")
          .single();

        results.push({
          job_id: j.job_id,
          runpod_status: runStatus,
          db_status: "FAILED",
          error: errMsg,
        });

        lastAvatar = avFailed
          ? {
              id: avFailed.id,
              status: avFailed.status,
              lora_path: avFailed.lora_path || null,
              train_job_id: avFailed.train_job_id,
              train_job_db_id: avFailed.train_job_db_id,
              train_error: avFailed.train_error || avFailed.last_error || errMsg,
            }
          : {
              id: j.avatar_id,
              status: "FAILED",
              train_job_id: j.job_id,
              train_job_db_id: j.id,
              train_error: errMsg,
            };

        lastJob.error = errMsg;
        lastJob.status = "FAILED";
        continue;
      }

      // ----------------------------------------------------------
      // 3C) Terminó bien
      // ----------------------------------------------------------
      if (isDone) {
        const loraPath = extractLoraPath(st);

        await supabase
          .from("avatar_jobs")
          .update({
            status: "SUCCEEDED",
            progress: 100,
            error: null,
            result_json: st,
          })
          .eq("id", j.id);

        const { data: avReady } = await supabase
          .from("avatars")
          .update({
            status: "READY",
            lora_path: loraPath,
            last_error: null,
            train_error: null,
            train_job_id: j.job_id,
            train_job_db_id: j.id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", j.avatar_id)
          .select("id, status, lora_path, last_error, train_error, train_job_id, train_job_db_id")
          .single();

        results.push({
          job_id: j.job_id,
          runpod_status: runStatus,
          db_status: "SUCCEEDED",
          lora_path: loraPath,
        });

        lastAvatar = avReady
          ? {
              id: avReady.id,
              status: avReady.status,
              lora_path: avReady.lora_path || null,
              train_job_id: avReady.train_job_id,
              train_job_db_id: avReady.train_job_db_id,
              train_error: null,
            }
          : {
              id: j.avatar_id,
              status: "READY",
              lora_path: loraPath,
              train_job_id: j.job_id,
              train_job_db_id: j.id,
              train_error: null,
            };

        lastJob.status = "SUCCEEDED";
        continue;
      }

      // ----------------------------------------------------------
      // 3D) Estado raro / desconocido
      // ----------------------------------------------------------
      await supabase
        .from("avatar_jobs")
        .update({
          result_json: st,
        })
        .eq("id", j.id);

      results.push({
        job_id: j.job_id,
        runpod_status: runStatus || "UNKNOWN",
        db_status: j.status,
      });

      lastAvatar = {
        id: j.avatar_id,
        status: runStatus || j.status,
        train_job_id: j.job_id,
        train_job_db_id: j.id,
      };
    }

    // ------------------------------------------------------------
    // 4) Si pidieron avatar específico, devolvemos avatar + job listo
    // ------------------------------------------------------------
    if (avatar_id) {
      const { data: av, error: avErr } = await supabase
        .from("avatars")
        .select("id, user_id, status, lora_path, last_error, train_error, train_job_id, train_job_db_id")
        .eq("id", avatar_id)
        .single();

      if (avErr) throw avErr;

      // Si quieres endurecer seguridad, descomenta esto:
      // if (user_id && av.user_id !== user_id) {
      //   return res.status(403).json({ ok: false, error: "Not your avatar" });
      // }

      const avatarOut = {
        id: av.id,
        status: av.status || "—",
        lora_path: av.lora_path || null,
        train_job_id: av.train_job_id || null,
        train_job_db_id: av.train_job_db_id || null,
        train_error: av.train_error || av.last_error || null,
      };

      const jobOut = av.train_job_id
        ? {
            id: av.train_job_id,
            status: normalizeStatus(av.status),
            provider: "runpod",
            error: avatarOut.train_error || null,
            db_id: av.train_job_db_id || null,
          }
        : lastJob || null;

      return res.json({
        ok: true,
        endpoint_id: RUNPOD_ENDPOINT_ID,
        checked: (jobs || []).length,
        results,
        avatar: avatarOut,
        job: jobOut,
      });
    }

    // ------------------------------------------------------------
    // 5) Respuesta general
    // ------------------------------------------------------------
    return res.json({
      ok: true,
      endpoint_id: RUNPOD_ENDPOINT_ID,
      checked: (jobs || []).length,
      results,
      avatar: lastAvatar || null,
      job: lastJob || null,
    });
  } catch (err) {
    console.error("[avatars-poll-runpod]", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "SERVER_ERROR",
    });
  }
 }
