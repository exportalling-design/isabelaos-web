// POST /api/tiktok-live/poll-avatar
// Polls a single EvoLink task for one video type.
// When completed: downloads video, uploads to live-avatars bucket, updates session.
// Body: { session_id, task_id, video_type: "idle"|"talking"|"dancing"|"lipsync" }
import { supabaseAdmin }          from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

const EVOLINK_BASE = "https://api.evolink.ai/v1";

const TYPE_TO_COLUMN = {
  idle:    "video_idle_url",
  talking: "video_talking_url",
  dancing: "video_dancing_url",
  lipsync: "video_lipsync_url",
};

function extractVideoUrl(data) {
  if (Array.isArray(data?.results) && data.results.length > 0) {
    const first = data.results[0];
    if (typeof first === "string" && first.startsWith("http")) return first;
    if (typeof first === "object") return first?.url || first?.video_url || null;
  }
  return data?.result?.url || data?.result?.video_url || data?.video_url || null;
}

async function downloadAndUpload(videoUrl, sessionId, videoType) {
  const res = await fetch(videoUrl);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const path = `${sessionId}/${videoType}.mp4`;
  const { error } = await supabaseAdmin.storage
    .from("live-avatars")
    .upload(path, buf, { contentType: "video/mp4", upsert: true });
  if (error) throw new Error(`Storage upload: ${error.message}`);

  const { data } = supabaseAdmin.storage.from("live-avatars").getPublicUrl(path);
  return data.publicUrl;
}

export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin",  "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("content-type",                 "application/json; charset=utf-8");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const userId = await getUserIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  const { session_id, task_id, video_type } = body;

  if (!session_id || !task_id || !video_type)
    return res.status(400).json({ ok: false, error: "Missing session_id, task_id, or video_type" });

  const column = TYPE_TO_COLUMN[video_type];
  if (!column) return res.status(400).json({ ok: false, error: "Invalid video_type" });

  // Verify ownership and check if already uploaded
  const { data: session } = await supabaseAdmin
    .from("tiktok_live_sessions")
    .select(`id, user_id, ${column}`)
    .eq("id", session_id)
    .eq("user_id", userId)
    .single();

  if (!session) return res.status(404).json({ ok: false, error: "Session not found" });

  if (session[column]) {
    return res.status(200).json({ ok: true, status: "completed", video_url: session[column] });
  }

  try {
    const evolinkRes = await fetch(`${EVOLINK_BASE}/tasks/${task_id}`, {
      headers: { Authorization: `Bearer ${process.env.EVOLINK_API_KEY}` },
    });
    const data = await evolinkRes.json();
    const status = data.status || "pending";

    console.log(`[poll-avatar] task=${task_id} type=${video_type} status=${status}`);

    if (status === "failed" || status === "error") {
      const errMsg = data.error?.message || data.message || "EvoLink generation failed";
      return res.status(200).json({ ok: true, status: "failed", error: errMsg });
    }

    if (status !== "completed") {
      return res.status(200).json({ ok: true, status: "processing", progress: data.progress || 0 });
    }

    const evolinkUrl = extractVideoUrl(data);
    if (!evolinkUrl) {
      return res.status(200).json({ ok: true, status: "processing" });
    }

    const permanentUrl = await downloadAndUpload(evolinkUrl, session_id, video_type);

    await supabaseAdmin
      .from("tiktok_live_sessions")
      .update({ [column]: permanentUrl })
      .eq("id", session_id);

    // Check if all 4 videos are now ready
    const { data: updated } = await supabaseAdmin
      .from("tiktok_live_sessions")
      .select("video_idle_url, video_talking_url, video_dancing_url, video_lipsync_url")
      .eq("id", session_id)
      .single();

    const allReady = !!(
      updated?.video_idle_url &&
      updated?.video_talking_url &&
      updated?.video_dancing_url &&
      updated?.video_lipsync_url
    );

    if (allReady) {
      await supabaseAdmin
        .from("tiktok_live_sessions")
        .update({ generation_status: "ready" })
        .eq("id", session_id);
    }

    return res.status(200).json({ ok: true, status: "completed", video_url: permanentUrl });

  } catch (err) {
    console.error("[poll-avatar] error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

export const config = { runtime: "nodejs" };
