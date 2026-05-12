// api/templates/poll-video.js
import { supabaseAdmin }          from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("content-type", "application/json; charset=utf-8");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const userId = await getUserIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  const { taskId } = body;

  if (!taskId) return res.status(400).json({ ok: false, error: "Missing taskId" });

  try {
    const piRes = await fetch(`https://api.piapi.ai/api/v1/task/${taskId}`, {
      headers: { "x-api-key": process.env.PIAPI_KEY },
    });

    const data = await piRes.json();
    const status   = data.data?.status   || data.status;
    const videoUrl = data.data?.output?.video_url || data.output?.video_url || null;

    // Update DB if done
    if (status === "completed" || status === "succeed") {
      await supabaseAdmin
        .from("video_jobs")
        .update({ status: "COMPLETED", provider_status: "completed", output_url: videoUrl })
        .eq("provider_request_id", taskId);
    } else if (status === "failed" || status === "error") {
      await supabaseAdmin
        .from("video_jobs")
        .update({ status: "FAILED", provider_status: "failed" })
        .eq("provider_request_id", taskId);
    }

    return res.status(200).json({ ok: true, status, videoUrl });

  } catch (err) {
    console.error("[poll-video] error:", err.message);
    return res.status(500).json({ ok: false, error: "Error polling video status" });
  }
}

export const config = { runtime: "nodejs" };
