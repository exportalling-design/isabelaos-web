// GET /api/tiktok-live/status?session_id=xxx
import { supabaseAdmin }          from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin",  "*");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("content-type",                 "application/json; charset=utf-8");

  if (req.method === "OPTIONS") return res.status(204).end();

  const userId = await getUserIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

  const sessionId = req.query?.session_id;

  // Get the user's active session (or specific one)
  let query = supabaseAdmin
    .from("tiktok_live_sessions")
    .select("id, tiktok_username, avatar_type, avatar_idle_url, avatar_talking_url, status, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (sessionId) query = query.eq("id", sessionId);

  const { data, error } = await query.single();

  if (error || !data) {
    return res.status(200).json({ ok: true, session: null });
  }

  // Count events in last 60s
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await supabaseAdmin
    .from("tiktok_live_events")
    .select("id", { count: "exact", head: true })
    .eq("session_id", data.id)
    .gte("created_at", since);

  return res.status(200).json({ ok: true, session: data, events_last_minute: count || 0 });
}

export const config = { runtime: "nodejs" };
