// api/templates/poll-video.js
// Polling para EvoLink Seedance 2.0
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
    // EvoLink poll endpoint
    const evolinkRes = await fetch(`https://api.evolink.ai/v1/tasks/${taskId}`, {
      headers: { "Authorization": `Bearer ${process.env.EVOLINK_API_KEY}` },
    });

    const data = await evolinkRes.json();
    console.log(`[poll-video] EvoLink raw response:`, JSON.stringify(data).slice(0, 300));

    // EvoLink status: pending | processing | completed | failed
    const status = data.status || "pending";

    // Según docs oficiales EvoLink: video URL viene en results[] array
    const videoUrl =
      data.results?.[0]?.url        ||
      data.results?.[0]?.video_url  ||
      data.result?.url              ||
      data.result?.video_url        ||
      data.video_url                ||
      data.output?.video_url        ||
      null;

    console.log(`[poll-video] taskId=${taskId} status=${status} videoUrl=${videoUrl ? "✓" : "null"}`);

    if (status === "completed" && videoUrl) {
      await supabaseAdmin
        .from("video_jobs")
        .update({ status: "COMPLETED", provider_status: "completed", output_url: videoUrl })
        .eq("provider_request_id", taskId);
    } else if (status === "failed" || status === "error") {
      const errMsg = data.error?.message || data.message || "EvoLink generation failed";
      await supabaseAdmin
        .from("video_jobs")
        .update({ status: "FAILED", provider_status: "failed", error: errMsg })
        .eq("provider_request_id", taskId);
    }

    return res.status(200).json({ ok: true, status, videoUrl });

  } catch (err) {
    console.error("[poll-video] error:", err.message);
    return res.status(500).json({ ok: false, error: "Error polling video status" });
  }
}

export const config = { runtime: "nodejs" };
