// IsabelaOS TikTok Live Worker — runs on Railway
// HTTP server: Railway health check + /start + /stop commands
import http from "http";
import { createClient } from "@supabase/supabase-js";
import { PriorityQueue } from "./queue.js";
import { generateResponse } from "./gemini.js";
import { synthesizeAndUpload } from "./elevenlabs.js";
import { createConnection } from "./tiktools.js";

const WORKER_SECRET = process.env.WORKER_SECRET;
const PORT = process.env.PORT || 3100;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Active sessions: Map<sessionId, SessionState>
const sessions = new Map();

// ── Session lifecycle ────────────────────────────────────────────────────────

async function loadSession(sessionId) {
  const { data, error } = await supabase
    .from("tiktok_live_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("status", "active")
    .single();
  if (error || !data) throw new Error("Session not found or not active");
  return data;
}

async function emitEvent(sessionId, eventPayload) {
  const { error } = await supabase.from("tiktok_live_events").insert({
    session_id: sessionId,
    event_type:    eventPayload.event_type,
    username:      eventPayload.username,
    message:       eventPayload.message || null,
    audio_url:     eventPayload.audio_url || null,
    response_text: eventPayload.response_text || null,
    priority:      eventPayload.priority,
  });
  if (error) console.error("[emit] DB error:", error.message);
}

async function processNext(session) {
  if (session.processing || session.queue.size === 0) return;
  session.processing = true;

  const event = session.queue.dequeue();
  console.log(`[session:${session.id}] processing ${event.type} from ${event.username}`);

  try {
    // Emit raw chat event so overlay shows it immediately
    await emitEvent(session.id, {
      event_type: event.type,
      username: event.username,
      message: event.message || null,
      priority: event.type === "gift" ? 1 : event.type === "follow" ? 2 : 3,
    });

    // Generate Gemini response
    const responseText = await generateResponse(session.persona_prompt, event);

    // Synthesize audio + upload
    const audioUrl = await synthesizeAndUpload(
      responseText,
      session.voice_id,
      session.id
    );

    // Emit response event (overlay will play audio + animate)
    await emitEvent(session.id, {
      event_type: "response",
      username: event.username,
      message: event.message || null,
      audio_url: audioUrl,
      response_text: responseText,
      priority: event.type === "gift" ? 1 : event.type === "follow" ? 2 : 3,
    });

    console.log(`[session:${session.id}] response emitted for ${event.username}`);
  } catch (err) {
    console.error(`[session:${session.id}] process error:`, err.message);
  } finally {
    session.processing = false;
    // Process next in queue with small delay
    setTimeout(() => processNext(session), 500);
  }
}

function startSession(sessionId, sessionData) {
  if (sessions.has(sessionId)) {
    console.warn(`[worker] session ${sessionId} already active`);
    return;
  }

  const queue = new PriorityQueue();
  const state = {
    id: sessionId,
    persona_prompt: sessionData.persona_prompt,
    voice_id: sessionData.voice_id,
    queue,
    processing: false,
    connection: null,
  };
  sessions.set(sessionId, state);

  const enqueue = (event, priority) => {
    queue.enqueue(event, priority);
    processNext(state);
  };

  const conn = createConnection(sessionData.tiktok_username, {
    onComment: (ev) => enqueue(ev, 3),
    onGift:    (ev) => enqueue(ev, 1),
    onFollow:  (ev) => enqueue(ev, 2),
    onConnected: () =>
      console.log(`[session:${sessionId}] TikTok connected`),
    onDisconnected: (reason) =>
      console.warn(`[session:${sessionId}] disconnected: ${reason}`),
    onError: (err) =>
      console.error(`[session:${sessionId}] tiktools error:`, err.message || err),
  });

  state.connection = conn;
  conn.connect();
  console.log(`[worker] session ${sessionId} started → @${sessionData.tiktok_username}`);
}

async function stopSession(sessionId) {
  const state = sessions.get(sessionId);
  if (!state) return;

  try {
    state.connection?.disconnect();
    state.queue.clear();
  } catch {}

  sessions.delete(sessionId);

  await supabase
    .from("tiktok_live_sessions")
    .update({ status: "stopped" })
    .eq("id", sessionId);

  console.log(`[worker] session ${sessionId} stopped`);
}

// ── HTTP server ──────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); }
    });
    req.on("error", reject);
  });
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(json);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Health check — Railway uses this
  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, { ok: true, sessions: sessions.size });
  }

  // Auth guard for management endpoints
  const secret = req.headers["x-worker-secret"];
  if (secret !== WORKER_SECRET) {
    return send(res, 401, { ok: false, error: "UNAUTHORIZED" });
  }

  if (req.method === "POST" && url.pathname === "/start") {
    const body = await readBody(req);
    const { session_id } = body;
    if (!session_id) return send(res, 400, { ok: false, error: "missing session_id" });
    try {
      const sessionData = await loadSession(session_id);
      startSession(session_id, sessionData);
      return send(res, 200, { ok: true, session_id });
    } catch (err) {
      console.error("[/start]", err.message);
      return send(res, 500, { ok: false, error: err.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/stop") {
    const body = await readBody(req);
    const { session_id } = body;
    if (!session_id) return send(res, 400, { ok: false, error: "missing session_id" });
    await stopSession(session_id);
    return send(res, 200, { ok: true });
  }

  send(res, 404, { ok: false, error: "NOT_FOUND" });
});

server.listen(PORT, () =>
  console.log(`[worker] HTTP server listening on :${PORT}`)
);

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("[worker] SIGTERM — stopping all sessions");
  for (const id of sessions.keys()) await stopSession(id);
  server.close(() => process.exit(0));
});
