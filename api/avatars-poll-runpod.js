// /api/avatars-poll-runpod.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ✅ Tu endpoint ID fijo
const RUNPOD_ENDPOINT_ID = "uktq024dj0d4go";

function runpodStatusUrl(jobId) {
  return `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/status/${jobId}`;
}

function normalizeStatus(raw) {
  const s = String(raw || "").toUpperCase();
  if (!s) return "IN_QUEUE";
  if (["IN_QUEUE", "QUEUED", "QUEUE", "PENDING"].includes(s)) return "IN_QUEUE";
  if (["IN_PROGRESS", "RUNNING", "PROCESSING", "STARTED"].includes(s)) return "IN_PROGRESS";
  if (["COMPLETED", "SUCCEEDED", "SUCCESS", "DONE", "FINISHED"].includes(s)) return "SUCCEEDED";
  if (["FAILED", "ERROR", "CANCELLED", "CANCELED", "TIMED_OUT", "TIMEOUT"].includes(s)) return "FAILED";
  return s;
}

// Saca un mensaje de error útil del payload de RunPod (tu log venía en st.output.error / st.error)
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
    if (c && String(c).trim()) return String(c).trim().slice(0, 2000);
  }
  // fallback: si el output trae algo grande
  try {
    const s = JSON.stringify(st);
    if (s && s !== "{}") return s.slice(0, 2000);
  } catch {}
  return "RUNPOD_FAILED";
}

// Intenta encontrar lora path desde la salida del trainer
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

  // Normalizar si viene con "avatars/..."
  if (loraPath.startsWith("avatars/")) loraPath = loraPath.slice("avatars/".length);

  return loraPath;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const runpodKey = process.env.RUNPOD_API_KEY;
    if (!runpodKey) {
      return res.status(400).json({ ok: false, error: "RUNPOD_API_KEY_MISSING" });
    }

    const {
      avatar_id,       // ✅ recomendado (lo usa tu frontend)
      job_id,          // opcional: poll de un job específico (runpod job id)
      limit = 10,      // fallback: cuántos jobs activos revisar si no pasas avatar_id
    } = req.body || {};

    // 1) Traer jobs activos desde DB (por avatar o por job_id o general)
    let q = supabase
      .from("avatar_jobs")
      .select("id, avatar_id, job_id, status, result_json, error, created_at")
      // ✅ ahora usamos los estados alineados con frontend
      .in("status", ["IN_QUEUE", "IN_PROGRESS", "RUNNING", "QUEUED"])
      .order("created_at", { ascending: false })
      .limit(Number(limit));

    if (job_id) q = q.eq("job_id", job_id);
    if (avatar_id) q = q.eq("avatar_id", avatar_id);

    const { data: jobs, error: jErr } = await q;
    if (jErr) throw jErr;

    // Si el frontend te llama con avatar_id y no hay jobs activos,
    // igual devolvemos estado coherente leyendo avatars.
    if ((!jobs || jobs.length === 0) && avatar_id) {
      const { data: av, error: avErr } = await supabase
        .from("avatars")
        .select("id, status, lora_path, last_error, train_error, train_job_id, train_job_db_id")
        .eq("id", avatar_id)
        .single();

      if (avErr) throw avErr;

      return res.json({
        ok: true,
        endpoint_id: RUNPOD_ENDPOINT_ID,
        checked: 0,
        results: [],
        // ✅ forma que tu frontend puede usar directo
        avatar: {
          id: av.id,
          status: av.status || "—",
          lora_path: av.lora_path || null,
          train_job_id: av.train_job_id || null,
          train_error: av.train_error || av.last_error || null,
          train_job_db_id: av.train_job_db_id || null,
        },
        job: av.train_job_id
          ? { id: av.train_job_id, status: av.status || "—", error: av.train_error || av.last_error || null }
          : null,
      });
    }

    const results = [];
    let lastAvatar = null;
    let lastJob = null;

    for (const j of jobs || []) {
      if (!j.job_id) continue;

      // 2) Consultar RunPod status
      const url = runpodStatusUrl(j.job_id);

      const r = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${runpodKey}` },
      });

      const st = await r.json().catch(() => ({}));
      const runStatus = normalizeStatus(st?.status);

      const isRunning = runStatus === "IN_QUEUE" || runStatus === "IN_PROGRESS";
      const isDone = runStatus === "SUCCEEDED";
      const isFail = runStatus === "FAILED";

      // Para devolver al frontend SIEMPRE un "job" claro
      lastJob = {
        id: j.job_id,
        status: runStatus,
        provider: "runpod",
        db_id: j.id,
        error: null,
      };

      if (isRunning) {
        // Mantener IN_PROGRESS y guardar snapshot
        await supabase
          .from("avatar_jobs")
          .update({
            status: "IN_PROGRESS",
            result_json: st,
            error: null,
          })
          .eq("id", j.id);

        await supabase
          .from("avatars")
          .update({
            status: runStatus,          // IN_QUEUE o IN_PROGRESS
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
          db_status: "IN_PROGRESS",
        });

        lastAvatar = { id: j.avatar_id, status: runStatus, train_job_id: j.job_id, train_job_db_id: j.id };
        continue;
      }

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
            status: "FAILED",           // ✅ no "ERROR" para que el frontend lo detecte claro
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
          : { id: j.avatar_id, status: "FAILED", train_job_id: j.job_id, train_job_db_id: j.id, train_error: errMsg };

        lastJob.error = errMsg;
        continue;
      }

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
          : { id: j.avatar_id, status: "READY", lora_path: loraPath, train_job_id: j.job_id, train_job_db_id: j.id };

        lastJob.status = "SUCCEEDED";
        continue;
      }

      // Status desconocido: guardar raw y no romper
      await supabase
        .from("avatar_jobs")
        .update({ result_json: st })
        .eq("id", j.id);

      results.push({
        job_id: j.job_id,
        runpod_status: runStatus || "UNKNOWN",
        db_status: j.status,
      });

      lastAvatar = { id: j.avatar_id, status: runStatus || j.status, train_job_id: j.job_id, train_job_db_id: j.id };
    }

    // ✅ Si te pidieron avatar_id, devolvemos "avatar" y "job" (lo usa tu frontend)
    if (avatar_id) {
      const { data: av, error: avErr } = await supabase
        .from("avatars")
        .select("id, status, lora_path, last_error, train_error, train_job_id, train_job_db_id")
        .eq("id", avatar_id)
        .single();

      if (avErr) throw avErr;

      const avatarOut = {
        id: av.id,
        status: av.status || "—",
        lora_path: av.lora_path || null,
        train_job_id: av.train_job_id || null,
        train_job_db_id: av.train_job_db_id || null,
        train_error: av.train_error || av.last_error || null,
      };

      const jobOut =
        av.train_job_id
          ? {
              id: av.train_job_id,
              status: normalizeStatus(av.status),
              provider: "runpod",
              error: avatarOut.train_error || null,
              db_id: av.train_job_db_id || null,
            }
          : (lastJob || null);

      return res.json({
        ok: true,
        endpoint_id: RUNPOD_ENDPOINT_ID,
        checked: (jobs || []).length,
        results,
        avatar: avatarOut,
        job: jobOut,
      });
    }

    // ✅ respuesta general (si no pasaste avatar_id)
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
    return res.status(500).json({ ok: false, error: err?.message || "SERVER_ERROR" });
  }
}
