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
      job_id,          // opcional: poll de un job específico
      limit = 10,      // opcional: cuántos jobs activos revisar
    } = req.body || {};

    // 1) Traer jobs activos desde DB (o uno específico)
    let q = supabase
      .from("avatar_jobs")
      .select("id, avatar_id, job_id, status, result_json, error")
      .in("status", ["QUEUED", "RUNNING"])
      .order("created_at", { ascending: false })
      .limit(Number(limit));

    if (job_id) q = q.eq("job_id", job_id);

    const { data: jobs, error: jErr } = await q;
    if (jErr) throw jErr;

    const results = [];

    for (const j of jobs || []) {
      if (!j.job_id) continue;

      // 2) Consultar RunPod status
      const url = runpodStatusUrl(j.job_id);

      const r = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${runpodKey}` },
      });

      const st = await r.json();
      const status = String(st?.status || "").toUpperCase();

      // RunPod típicos:
      // IN_QUEUE, IN_PROGRESS, COMPLETED, FAILED, CANCELLED, TIMED_OUT
      const isRunning = ["IN_QUEUE", "IN_PROGRESS", "RUNNING", "QUEUED"].includes(status);
      const isDone = ["COMPLETED", "SUCCEEDED", "SUCCESS"].includes(status);
      const isFail = ["FAILED", "CANCELLED", "TIMED_OUT", "ERROR"].includes(status);

      if (isRunning) {
        // Mantener RUNNING y guardar snapshot
        await supabase
          .from("avatar_jobs")
          .update({
            status: "RUNNING",
            result_json: st,
          })
          .eq("id", j.id);

        results.push({
          job_id: j.job_id,
          runpod_status: status,
          db_status: "RUNNING",
        });
        continue;
      }

      if (isFail) {
        const errMsg = (st?.error ? String(st.error) : "RUNPOD_FAILED").slice(0, 2000);

        await supabase
          .from("avatar_jobs")
          .update({
            status: "FAILED",
            error: errMsg,
            result_json: st,
          })
          .eq("id", j.id);

        await supabase
          .from("avatars")
          .update({
            status: "ERROR",
            last_error: errMsg,
          })
          .eq("id", j.avatar_id);

        results.push({
          job_id: j.job_id,
          runpod_status: status,
          db_status: "FAILED",
          error: errMsg,
        });
        continue;
      }

      if (isDone) {
        // 3) Extraer resultado del trainer
        // Tu trainer devuelve (en output):
        // { ok:true, lora_bucket_path: "avatars/.../avatar_lora.safetensors" }  o sin "avatars/"
        const out = st?.output || st?.result || st;

        let loraPath =
          out?.lora_path ||
          out?.lora_bucket_path ||
          out?.lora ||
          null;

        // Normalizar si viene con "avatars/..."
        if (loraPath && String(loraPath).startsWith("avatars/")) {
          loraPath = String(loraPath).slice("avatars/".length);
        }

        await supabase
          .from("avatar_jobs")
          .update({
            status: "SUCCEEDED",
            progress: 100,
            error: null,
            result_json: st,
          })
          .eq("id", j.id);

        await supabase
          .from("avatars")
          .update({
            status: "READY",
            lora_path: loraPath,
            last_error: null,
          })
          .eq("id", j.avatar_id);

        results.push({
          job_id: j.job_id,
          runpod_status: status,
          db_status: "SUCCEEDED",
          lora_path: loraPath,
        });
        continue;
      }

      // 4) Status desconocido: guardar raw
      await supabase
        .from("avatar_jobs")
        .update({ result_json: st })
        .eq("id", j.id);

      results.push({
        job_id: j.job_id,
        runpod_status: status || "UNKNOWN",
        db_status: j.status,
      });
    }

    return res.json({
      ok: true,
      endpoint_id: RUNPOD_ENDPOINT_ID,
      checked: (jobs || []).length,
      results,
    });
  } catch (err) {
    console.error("[avatars-poll-runpod]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
