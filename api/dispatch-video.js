// api/dispatch-video.js
import { supabaseAdmin } from "../src/lib/supabaseAdmin.js";

const RUNPOD_API_KEY =
  process.env.RP_API_KEY ||
  process.env.RUNPOD_API_KEY ||
  process.env.VIDEO_RUNPOD_API_KEY ||
  null;

function pickEndpointIdByMode(mode) {
  if (mode === "i2v") {
    return (
      process.env.IMG2VIDEO_RUNPOD_ENDPOINT_ID ||
      process.env.VIDEO_RUNPOD_ENDPOINT_ID ||
      process.env.VIDEO_RUNPOD_ENDPOINT ||
      null
    );
  }
  // default t2v
  return (
    process.env.RP_WAN22_T2V_ENDPOINT ||
    process.env.VIDEO_RUNPOD_ENDPOINT_ID ||
    process.env.VIDEO_RUNPOD_ENDPOINT ||
    null
  );
}

async function runpodRun({ endpointId, input }) {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY / RP_API_KEY");
  if (!endpointId) throw new Error("Missing RunPod endpoint id");

  const url = `https://api.runpod.ai/v2/${endpointId}/run`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RUNPOD_API_KEY}`,
    },
    body: JSON.stringify({ input }),
  });

  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = data?.error || data?.message || JSON.stringify(data);
    throw new Error(`RunPod /run failed: ${r.status} ${msg}`);
  }
  return data;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    // 1) Claim job atomically
    const { data: claimed, error: claimErr } = await supabaseAdmin.rpc("claim_next_video_job");
    if (claimErr) return res.status(500).json({ ok: false, error: claimErr.message });

    const job = Array.isArray(claimed) ? claimed[0] : claimed;
    if (!job?.id) return res.status(200).json({ ok: true, dispatched: false, reason: "no_jobs" });

    const endpointId = pickEndpointIdByMode(job.mode);

    // 2) Build rpInput from job row (reconstruye lo mínimo necesario)
    const rpInput = {
      mode: job.mode,                 // "t2v" | "i2v"
      job_id: job.id,
      user_id: job.user_id,
      prompt: job.prompt,
      negative_prompt: job.negative_prompt || "",
      width: job.width,
      height: job.height,
      fps: job.fps,
      num_frames: job.num_frames,
      steps: job.steps,
      guidance_scale: job.guidance_scale,
      // Si guardaste payload original, podés parsearlo y sumar fields extra:
      ...(job.payload ? (() => { try { return JSON.parse(job.payload); } catch { return {}; } })() : {}),
    };

    // 3) Dispatch to RunPod
    const rp = await runpodRun({ endpointId, input: rpInput });
    const runpodId = rp?.id || rp?.jobId || rp?.request_id || null;

    // 4) Update job
    await supabaseAdmin
      .from("video_jobs")
      .update({
        provider: "runpod",
        provider_request_id: runpodId ? String(runpodId) : null,
        provider_status: "submitted",
        status: "IN_PROGRESS",
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    return res.status(200).json({ ok: true, dispatched: true, job_id: job.id, provider_request_id: runpodId });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}
