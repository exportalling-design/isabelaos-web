// GET /api/tiktok-live/seed-session?session_id=xxx
// ONE-TIME script: manually inserts a session row with known task IDs
// when generate-avatar.js crashed before persisting the session.
import { supabaseAdmin }          from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

// Hard-coded task IDs for the known crashed generation
const KNOWN_TASKS = {
  "c4187aa7-05d8-4dda-8d90-c0dac30c72d6": {
    task_idle:    "task-unified-1782521211-waa1mwei",
    task_talking: "task-unified-1782521211-kvs3qoye",
    task_dancing: "task-unified-1782521211-yazf17e0",
    task_lipsync: "task-unified-1782521211-77rt19cy",
  },
};

export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin",  "*");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
  res.setHeader("access-control-allow-headers", "authorization");
  res.setHeader("content-type",                 "application/json; charset=utf-8");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET")    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const userId = await getUserIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

  const sessionId = req.query?.session_id;
  if (!sessionId) return res.status(400).json({ ok: false, error: "Missing session_id" });

  const tasks = KNOWN_TASKS[sessionId];
  if (!tasks) {
    return res.status(400).json({ ok: false, error: `No known tasks for session_id ${sessionId}` });
  }

  // Check if already exists
  const { data: existing } = await supabaseAdmin
    .from("tiktok_live_sessions")
    .select("id, generation_status")
    .eq("id", sessionId)
    .single();

  if (existing) {
    // Already exists — just patch the task columns in case they're missing
    await supabaseAdmin
      .from("tiktok_live_sessions")
      .update({
        ...tasks,
        generation_task_ids: {
          idle:    tasks.task_idle,
          talking: tasks.task_talking,
          dancing: tasks.task_dancing,
          lipsync: tasks.task_lipsync,
        },
      })
      .eq("id", sessionId);

    return res.status(200).json({
      ok: true,
      action: "patched",
      session_id: sessionId,
      message: "Session already existed — task IDs patched.",
    });
  }

  // Insert the session manually with the known task IDs
  const { error: insertErr } = await supabaseAdmin
    .from("tiktok_live_sessions")
    .insert({
      id:               sessionId,
      user_id:          userId,
      tiktok_username:  "unknown",
      voice_id:         "21m00Tcm4TlvDq8ikWAM",
      persona_prompt:   "",
      status:           "pending",
      avatar_type:      "video",
      generation_status: "pending",
      ...tasks,
      generation_task_ids: {
        idle:    tasks.task_idle,
        talking: tasks.task_talking,
        dancing: tasks.task_dancing,
        lipsync: tasks.task_lipsync,
      },
    });

  if (insertErr) {
    console.error("[seed-session] insert error:", insertErr.message);
    return res.status(500).json({ ok: false, error: insertErr.message });
  }

  return res.status(200).json({
    ok: true,
    action: "inserted",
    session_id: sessionId,
    message: "Session seeded. Now call /api/tiktok-live/recover-avatar?session_id=" + sessionId,
    task_ids: tasks,
  });
}

export const config = { runtime: "nodejs" };
