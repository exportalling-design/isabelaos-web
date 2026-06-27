// GET /api/tiktok-live/recover-avatar?session_id=xxx[&idle=task-id&talking=task-id&dancing=task-id&lipsync=task-id]
// Reads task IDs from DB (or from query params if the DB update failed),
// polls EvoLink for each, downloads completed videos, uploads to Supabase Storage,
// and updates tiktok_live_sessions with the permanent URLs.
import { supabaseAdmin }          from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

const EVOLINK_BASE = "https://api.evolink.ai/v1";

const TYPE_TO_VIDEO_COL = {
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
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
  res.setHeader("access-control-allow-headers", "authorization");
  res.setHeader("content-type",                 "application/json; charset=utf-8");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET")    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const userId = await getUserIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

  const q = req.query || {};
  const sessionId = q.session_id;
  if (!sessionId) return res.status(400).json({ ok: false, error: "Missing session_id" });

  // Load session
  const { data: session, error: fetchErr } = await supabaseAdmin
    .from("tiktok_live_sessions")
    .select("id, user_id, task_idle, task_talking, task_dancing, task_lipsync, generation_task_ids, video_idle_url, video_talking_url, video_dancing_url, video_lipsync_url")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();

  if (fetchErr || !session) {
    return res.status(404).json({ ok: false, error: "Session not found" });
  }

  // Resolve task IDs: query params override DB columns which override JSONB fallback
  const taskIds = {
    idle:    q.idle    || session.task_idle    || session.generation_task_ids?.idle    || null,
    talking: q.talking || session.task_talking || session.generation_task_ids?.talking || null,
    dancing: q.dancing || session.task_dancing || session.generation_task_ids?.dancing || null,
    lipsync: q.lipsync || session.task_lipsync || session.generation_task_ids?.lipsync || null,
  };

  // If task IDs were passed via query params, persist them so future calls don't need them
  const taskColUpdate = {};
  if (q.idle    && !session.task_idle)    taskColUpdate.task_idle    = q.idle;
  if (q.talking && !session.task_talking) taskColUpdate.task_talking = q.talking;
  if (q.dancing && !session.task_dancing) taskColUpdate.task_dancing = q.dancing;
  if (q.lipsync && !session.task_lipsync) taskColUpdate.task_lipsync = q.lipsync;

  const taskIdsForJsonb = (q.idle || q.talking || q.dancing || q.lipsync)
    ? { idle: taskIds.idle, talking: taskIds.talking, dancing: taskIds.dancing, lipsync: taskIds.lipsync }
    : null;

  if (Object.keys(taskColUpdate).length > 0) {
    await supabaseAdmin
      .from("tiktok_live_sessions")
      .update({ ...taskColUpdate, ...(taskIdsForJsonb ? { generation_task_ids: taskIdsForJsonb } : {}) })
      .eq("id", sessionId);
  }

  // Process each video type
  const types = ["idle", "talking", "dancing", "lipsync"];
  const results = {};

  for (const type of types) {
    const taskId  = taskIds[type];
    const videoCol = TYPE_TO_VIDEO_COL[type];

    // Already successfully uploaded in a previous run
    if (session[videoCol]) {
      results[type] = { status: "already_done", video_url: session[videoCol] };
      continue;
    }

    if (!taskId) {
      results[type] = { status: "no_task_id" };
      continue;
    }

    try {
      const evolinkRes = await fetch(`${EVOLINK_BASE}/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${process.env.EVOLINK_API_KEY}` },
      });
      const data = await evolinkRes.json();
      const status = data.status || "pending";

      console.log(`[recover-avatar] type=${type} task=${taskId} status=${status} progress=${data.progress}`);

      if (status === "failed" || status === "error") {
        results[type] = { status: "failed", error: data.error?.message || data.message || "EvoLink failed" };
        continue;
      }

      if (status !== "completed") {
        results[type] = { status, progress: data.progress || 0 };
        continue;
      }

      const evolinkUrl = extractVideoUrl(data);
      if (!evolinkUrl) {
        results[type] = { status: "processing" };
        continue;
      }

      const permanentUrl = await downloadAndUpload(evolinkUrl, sessionId, type);

      await supabaseAdmin
        .from("tiktok_live_sessions")
        .update({ [videoCol]: permanentUrl })
        .eq("id", sessionId);

      results[type] = { status: "completed", video_url: permanentUrl };

    } catch (err) {
      console.error(`[recover-avatar] ${type} error:`, err.message);
      results[type] = { status: "error", error: err.message };
    }
  }

  // If all 4 are now done, mark session as ready
  const { data: updated } = await supabaseAdmin
    .from("tiktok_live_sessions")
    .select("video_idle_url, video_talking_url, video_dancing_url, video_lipsync_url")
    .eq("id", sessionId)
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
      .eq("id", sessionId);
  }

  const completedCount = Object.values(results).filter(r =>
    r.status === "completed" || r.status === "already_done"
  ).length;

  return res.status(200).json({
    ok: true,
    session_id: sessionId,
    generation_status: allReady ? "ready" : "processing",
    completed: completedCount,
    total: 4,
    results,
  });
}

export const config = { runtime: "nodejs" };
