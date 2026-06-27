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
    session_id: existingSessionId,
    tiktok_username, avatar_type = "video", avatar_idle_url, avatar_talking_url,
    avatar_reaction_url, voice_id, persona_prompt = "",
    video_idle_url, video_talking_url, video_dancing_url, video_lipsync_url,
  } = body;

  // ── Jade check & deduct (10 Jades per live hour) ───────────────────────────
  const JADE_COST_LIVE = 10;
  const username       = (tiktok_username || "").replace(/^@/, "") || existingSessionId || "user";
  const jadeRef        = `live-avatar-start-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const { error: spendErr } = await supabaseAdmin.rpc("spend_jades", {
    p_user_id: userId,
    p_amount:  JADE_COST_LIVE,
    p_reason:  `live_avatar_start_@${username}`,
    p_ref:     jadeRef,
  });

  if (spendErr) {
    if ((spendErr.message || "").includes("INSUFFICIENT_JADES"))
      return res.status(402).json({
        ok: false, error: "INSUFFICIENT_JADES", required: JADE_COST_LIVE,
        detail: "Necesitas 10 Jades por hora de live. Recarga tu cuenta.",
      });
    return res.status(400).json({ ok: false, error: spendErr.message });
  }

  let session;

  if (existingSessionId) {
    // Activate a session already created by generate-avatar
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from("tiktok_live_sessions")
      .select("*")
      .eq("id", existingSessionId)
      .eq("user_id", userId)
      .single();

    if (fetchErr || !existing) {
      return res.status(404).json({ ok: false, error: "Session not found" });
    }

    // Stop any other active sessions for this user
    await supabaseAdmin
      .from("tiktok_live_sessions")
      .update({ status: "stopped" })
      .eq("user_id", userId)
      .eq("status", "active")
      .neq("id", existingSessionId);

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("tiktok_live_sessions")
      .update({ status: "active" })
      .eq("id", existingSessionId)
      .select()
      .single();

    if (updateErr) {
      return res.status(500).json({ ok: false, error: updateErr.message });
    }
    session = updated;

  } else {
    // Legacy path: create new session from scratch
    if (!tiktok_username || !voice_id) {
      return res.status(400).json({ ok: false, error: "Missing required fields: tiktok_username, voice_id" });
    }

    await supabaseAdmin
      .from("tiktok_live_sessions")
      .update({ status: "stopped" })
      .eq("user_id", userId)
      .eq("status", "active");

    const { data: created, error: insertErr } = await supabaseAdmin
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
        video_idle_url:    video_idle_url    || null,
        video_talking_url: video_talking_url || null,
        video_dancing_url: video_dancing_url || null,
        video_lipsync_url: video_lipsync_url || null,
        generation_status: (video_idle_url && video_talking_url && video_dancing_url && video_lipsync_url)
          ? "completed" : null,
      })
      .select()
      .single();

    if (insertErr) {
      console.error("[start] insert error:", insertErr.message);
      return res.status(500).json({ ok: false, error: insertErr.message });
    }
    session = created;
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
