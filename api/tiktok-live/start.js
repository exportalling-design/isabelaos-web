// POST /api/tiktok-live/start
// Creates a session in DB and signals the Railway worker to connect.
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
  const {
    tiktok_username, avatar_type = "video", avatar_idle_url, avatar_talking_url,
    avatar_reaction_url, voice_id, persona_prompt,
  } = body;

  if (!tiktok_username || !voice_id || !persona_prompt) {
    return res.status(400).json({ ok: false, error: "Missing required fields: tiktok_username, voice_id, persona_prompt" });
  }

  // Stop any existing active session for this user
  await supabaseAdmin
    .from("tiktok_live_sessions")
    .update({ status: "stopped" })
    .eq("user_id", userId)
    .eq("status", "active");

  // Create new session
  const { data: session, error: insertErr } = await supabaseAdmin
    .from("tiktok_live_sessions")
    .insert({
      user_id: userId,
      tiktok_username: tiktok_username.replace(/^@/, ""),
      avatar_type,
      avatar_idle_url:     avatar_idle_url     || null,
      avatar_talking_url:  avatar_talking_url  || null,
      avatar_reaction_url: avatar_reaction_url || null,
      voice_id,
      persona_prompt,
      status: "active",
    })
    .select()
    .single();

  if (insertErr) {
    console.error("[start] insert error:", insertErr.message);
    return res.status(500).json({ ok: false, error: insertErr.message });
  }

  // Signal Railway worker
  const workerUrl = process.env.RAILWAY_WORKER_URL;
  if (workerUrl) {
    try {
      const wRes = await fetch(`${workerUrl}/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-worker-secret": process.env.WORKER_SECRET || "",
        },
        body: JSON.stringify({ session_id: session.id }),
      });
      if (!wRes.ok) {
        const txt = await wRes.text().catch(() => "");
        console.error("[start] worker signal failed:", wRes.status, txt);
      }
    } catch (err) {
      console.error("[start] could not reach worker:", err.message);
      // Don't fail the request — worker may be starting up
    }
  }

  const overlayUrl = `${process.env.VITE_APP_URL || ""}/live-overlay/index.html?session_id=${session.id}`;

  return res.status(200).json({
    ok: true,
    session_id: session.id,
    overlay_url: overlayUrl,
  });
}

export const config = { runtime: "nodejs" };
