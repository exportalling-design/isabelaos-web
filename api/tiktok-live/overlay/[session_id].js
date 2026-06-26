// GET /api/tiktok-live/overlay/[session_id]
// Serves the overlay HTML with session data pre-injected as a JS global.
// The overlay then connects to /api/tiktok-live/events via SSE.
import { supabaseAdmin } from "../../../src/lib/supabaseAdmin.js";

export default async function handler(req, res) {
  const sessionId = req.query?.session_id;
  if (!sessionId) {
    return res.status(400).send("Missing session_id");
  }

  const { data: session, error } = await supabaseAdmin
    .from("tiktok_live_sessions")
    .select("id, tiktok_username, avatar_type, avatar_idle_url, avatar_talking_url, avatar_reaction_url, status")
    .eq("id", sessionId)
    .single();

  if (error || !session) {
    return res.status(404).send("Session not found");
  }

  const appOrigin = process.env.VITE_APP_URL || "";

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  // Inject session config as a global before overlay.js loads
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>IsabelaOS Live — @${session.tiktok_username}</title>
  <link rel="stylesheet" href="${appOrigin}/live-overlay/overlay.css"/>
  <script>
    window.LIVE_SESSION = ${JSON.stringify({
      session_id:          session.id,
      tiktok_username:     session.tiktok_username,
      avatar_type:         session.avatar_type,
      avatar_idle_url:     session.avatar_idle_url     || "",
      avatar_talking_url:  session.avatar_talking_url  || "",
      avatar_reaction_url: session.avatar_reaction_url || "",
      status:              session.status,
      events_url:          `${appOrigin}/api/tiktok-live/events?session_id=${session.id}`,
    })};
  </script>
</head>
<body>
  <div id="overlay-root">
    <div id="avatar-container">
      <video id="avatar-video" autoplay loop muted playsinline></video>
      <img  id="avatar-img"   alt="avatar" style="display:none"/>
      <div  id="lipsync-bar"></div>
    </div>
    <div id="response-bubble" class="hidden">
      <span id="response-username"></span>
      <p   id="response-text"></p>
    </div>
    <div id="chat-feed"></div>
  </div>
  <script src="${appOrigin}/live-overlay/overlay.js"></script>
</body>
</html>`;

  res.send(html);
}

export const config = { runtime: "nodejs" };
