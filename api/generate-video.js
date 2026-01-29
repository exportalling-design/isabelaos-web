export const config = { runtime: "nodejs" };

import { sbAdmin } from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

const COST_T2V = 10;

function getRunpodConfig() {
  const apiKey = process.env.RUNPOD_API_KEY || process.env.VIDEO_RUNPOD_API_KEY || null;
  const endpointId = process.env.RUNPOD_ENDPOINT_ID || null;
  const baseUrl = process.env.RUNPOD_BASE_URL || "https://api.runpod.ai/v2";
  if (!apiKey) throw new Error("Missing RUNPOD_API_KEY");
  if (!endpointId) throw new Error("Missing RUNPOD_ENDPOINT_ID");
  return { apiKey, endpointId, baseUrl };
}

async function runpodRun({ apiKey, endpointId, baseUrl, input }) {
  const url = `${baseUrl}/${endpointId}/run`;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.id) {
    const detail = j ? JSON.stringify(j).slice(0, 600) : "no_json";
    throw new Error(`RunPod run failed: ${r.status} ${detail}`);
  }
  return j;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const admin = sbAdmin();

    const user_id = await getUserIdFromAuthHeader(req);
    if (!user_id) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    const {
      mode = "t2v",
      prompt,
      negative_prompt = "",
      platform_ref,
      aspect_ratio,
      width,
      height,
      duration_s,
      fps,
      num_frames,
      already_billed = false,
      used_optimized = false,
    } = req.body || {};

    if (!prompt || !String(prompt).trim()) {
      return res.status(400).json({ ok: false, error: "Missing prompt" });
    }

    const insertPayload = {
      user_id,
      status: "QUEUED",
      prompt: String(prompt).trim(),
      provider: "runpod",
      provider_status: "QUEUED",
      provider_raw: {
        mode,
        negative_prompt: String(negative_prompt || ""),
        platform_ref,
        aspect_ratio,
        width,
        height,
        duration_s,
        fps,
        num_frames,
        used_optimized: !!used_optimized,
      },
    };

    const { data: job, error: insErr } = await admin
      .from("video_jobs")
      .insert(insertPayload)
      .select("id,status,created_at")
      .single();

    if (insErr || !job?.id) {
      return res.status(500).json({
        ok: false,
        error: "Failed to insert video_jobs row",
        detail: insErr?.message || "unknown_insert_error",
        code: insErr?.code || null,
      });
    }

    if (!already_billed) {
      const { error: spendErr } = await admin.rpc("spend_jades", {
        p_user_id: user_id,
        p_amount: COST_T2V,
        p_reason: "t2v",
        p_job_id: job.id,
      });

      if (spendErr) {
        await admin
          .from("video_jobs")
          .update({
            status: "FAILED",
            provider_status: "FAILED",
            provider_reply: { error: "jades_spend_failed", detail: spendErr.message },
            completed_at: new Date().toISOString(),
          })
          .eq("id", job.id);

        return res.status(400).json({ ok: false, error: "Jades spend failed", detail: spendErr.message });
      }
    }

    const { apiKey, endpointId, baseUrl } = getRunpodConfig();

    const runInput = {
      mode,
      prompt: String(prompt).trim(),
      negative_prompt: String(negative_prompt || ""),
      platform_ref,
      aspect_ratio,
      width,
      height,
      duration_s,
      fps,
      num_frames,
      job_id: job.id,
      user_id,
    };

    const rpJson = await runpodRun({ apiKey, endpointId, baseUrl, input: runInput });

    await admin
      .from("video_jobs")
      .update({
        status: "RUNNING",
        provider_status: rpJson.status || "IN_QUEUE",
        provider_request_id: rpJson.id,
        provider_reply: rpJson,
      })
      .eq("id", job.id);

    return res.status(200).json({ ok: true, job_id: job.id, status: "RUNNING" });
  } catch (e) {
    console.log("❌ generate-video fatal:", e);
    return res.status(500).json({ ok: false, error: e?.message || "server_error" });
  }
}