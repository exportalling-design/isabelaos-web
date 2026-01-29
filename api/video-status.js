// api/video-status.js
export const runtime = "nodejs";

import { getSupabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} missing`);
  return v;
}

async function runpodStatus({ endpointId, apiKey, requestId }) {
  const url = `https://api.runpod.ai/v2/${endpointId}/status/${requestId}`;
  const r = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`RunPod /status failed: ${r.status} ${JSON.stringify(data)}`);
  return data;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const admin = getSupabaseAdmin();
    const user_id = await getUserIdFromAuthHeader(req);
    if (!user_id) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const job_id = String(req.query?.job_id || "").trim();
    if (!job_id) return res.status(400).json({ ok: false, error: "Missing job_id" });

    const { data: job, error: jobErr } = await admin
      .from("video_jobs")
      .select("*")
      .eq("id", job_id)
      .single();

    if (jobErr || !job) return res.status(404).json({ ok: false, error: "Job not found" });
    if (job.user_id !== user_id) return res.status(403).json({ ok: false, error: "Forbidden" });

    // Si ya tenemos video_url, listo
    if (job.video_url) {
      return res.status(200).json({ ok: true, status: job.status, video_url: job.video_url, job });
    }

    const provider_request_id = job.provider_request_id;
    if (!provider_request_id) {
      return res.status(200).json({
        ok: true,
        status: job.status || "QUEUED",
        message: "No provider_request_id yet (RunPod not started)",
        job,
      });
    }

    const endpointId = mustEnv("RUNPOD_VIDEO_ENDPOINT_ID");
    const apiKey = mustEnv("RUNPOD_API_KEY");

    const st = await runpodStatus({ endpointId, apiKey, requestId: provider_request_id });

    // st.status suele ser: IN_QUEUE / IN_PROGRESS / COMPLETED / FAILED
    const rpStatus = st?.status || "UNKNOWN";

    // guarda provider_status siempre
    await admin.from("video_jobs").update({ provider_status: rpStatus }).eq("id", job_id);

    if (rpStatus === "FAILED") {
      await admin.from("video_jobs").update({ status: "FAILED" }).eq("id", job_id);
      return res.status(200).json({ ok: true, status: "FAILED", runpod: st });
    }

    if (rpStatus !== "COMPLETED") {
      // sigue en proceso
      return res.status(200).json({ ok: true, status: "IN_PROGRESS", runpod_status: rpStatus, runpod: st });
    }

    // COMPLETED
    const out = st?.output || {};
    const video_url = out.video_url || out.url || null;

    if (video_url) {
      await admin
        .from("video_jobs")
        .update({ status: "COMPLETED", video_url })
        .eq("id", job_id);

      return res.status(200).json({ ok: true, status: "COMPLETED", video_url, runpod: st });
    }

    // si tu worker devuelve base64, aquí lo capturas (si quieres luego lo subimos a Storage)
    const video_b64 = out.video_b64 || out.base64 || null;

    // si no hay nada, es que tu worker no está devolviendo output como esperas
    await admin
      .from("video_jobs")
      .update({ status: "COMPLETED" })
      .eq("id", job_id);

    return res.status(200).json({
      ok: true,
      status: "COMPLETED",
      warning: "No video_url/video_b64 in RunPod output",
      runpod: st,
    });
  } catch (err) {
    console.error("video-status fatal:", err);
    return res.status(500).json({ ok: false, error: err?.message || "server_error" });
  }
}