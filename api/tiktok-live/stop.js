// POST /api/tiktok-live/stop
import { supabaseAdmin }          from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

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
  const { session_id } = body;

  // Verify ownership
  const { data: session, error } = await supabaseAdmin
    .from("tiktok_live_sessions")
    .select("id, status")
    .eq("id", session_id)
    .eq("user_id", userId)
    .single();

  if (error || !session) {
    return res.status(404).json({ ok: false, error: "Session not found" });
  }

  // Update DB
  await supabaseAdmin
    .from("tiktok_live_sessions")
    .update({ status: "stopped" })
    .eq("id", session_id);

  // Signal Railway worker
  const workerUrl = process.env.RAILWAY_WORKER_URL;
  if (workerUrl) {
    try {
      await fetch(`${workerUrl}/stop`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-worker-secret": process.env.WORKER_SECRET || "",
        },
        body: JSON.stringify({ session_id }),
      });
    } catch (err) {
      console.error("[stop] could not reach worker:", err.message);
    }
  }

  return res.status(200).json({ ok: true });
}

export const config = { runtime: "nodejs" };
