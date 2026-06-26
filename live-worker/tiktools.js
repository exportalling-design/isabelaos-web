// tik.tools WebSocket client
// wss://ws.tik.tools/v1?apiKey=KEY&username=USERNAME
import WebSocket from "ws";

const WS_BASE      = "wss://ws.tik.tools/v1";
const MIN_BACKOFF  = 2_000;
const MAX_BACKOFF  = 60_000;

export function createConnection(tiktokUsername, handlers) {
  let ws          = null;
  let destroyed   = false;
  let backoff     = MIN_BACKOFF;
  let pingTimer   = null;

  function buildUrl() {
    const key = process.env.TIKTOOLS_API_KEY || "";
    return `${WS_BASE}?apiKey=${encodeURIComponent(key)}&username=${encodeURIComponent(tiktokUsername)}`;
  }

  function stopPing() {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  }

  function startPing() {
    stopPing();
    // Send ping every 25s to keep the connection alive
    pingTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) ws.ping();
    }, 25_000);
  }

  function dispatch(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const type     = (msg.type || msg.event || "").toLowerCase();
    const username = msg.uniqueId || msg.nickname || msg.username || "anon";
    const userId   = msg.userId   || msg.uid      || null;

    switch (type) {
      case "chat":
      case "comment":
        handlers.onComment?.({
          type: "comment",
          username,
          message: msg.comment || msg.message || msg.text || "",
          userId,
        });
        break;

      case "gift":
        // Skip mid-streak updates — fire only on final count or non-repeating gifts
        if (msg.repeatEnd === false && msg.giftType === 1) break;
        handlers.onGift?.({
          type:         "gift",
          username,
          giftName:     msg.giftName   || msg.gift_name  || "gift",
          giftCount:    msg.repeatCount || msg.count      || 1,
          diamondCount: msg.diamondCount || msg.diamonds  || 0,
          userId,
        });
        break;

      case "follow":
      case "subscribe":
        handlers.onFollow?.({
          type: "follow",
          username,
          userId,
        });
        break;

      case "share":
        handlers.onComment?.({
          type:    "comment",
          username,
          message: `${username} compartió el live 🔁`,
          userId,
        });
        break;

      case "like":
        // Likes only trigger a response if the count is high enough to be notable
        if ((msg.likeCount || msg.count || 0) >= 100) {
          handlers.onComment?.({
            type:    "comment",
            username,
            message: `${username} envió muchos ❤️ (${msg.likeCount || msg.count || ""})`,
            userId,
          });
        }
        break;

      case "connected":
      case "ready":
        handlers.onConnected?.();
        break;

      case "error":
        handlers.onError?.(new Error(msg.message || msg.error || "unknown"));
        break;

      default:
        // Ignore unknown event types silently
        break;
    }
  }

  function connect() {
    if (destroyed) return;

    const url = buildUrl();
    console.log(`[tiktools] connecting → @${tiktokUsername}`);

    ws = new WebSocket(url);

    ws.on("open", () => {
      console.log(`[tiktools] connected → @${tiktokUsername}`);
      backoff = MIN_BACKOFF; // reset on successful connect
      startPing();
      handlers.onConnected?.();
    });

    ws.on("message", (data) => {
      dispatch(typeof data === "string" ? data : data.toString());
    });

    ws.on("pong", () => {
      // Connection is alive — no action needed
    });

    ws.on("close", (code, reason) => {
      stopPing();
      const msg = reason?.toString() || `code ${code}`;
      console.warn(`[tiktools] disconnected (${msg}) — reconnecting in ${backoff}ms`);
      handlers.onDisconnected?.(msg);

      if (!destroyed) {
        setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF);
      }
    });

    ws.on("error", (err) => {
      console.error("[tiktools] ws error:", err.message);
      handlers.onError?.(err);
      // "close" event fires after "error", reconnect handled there
    });
  }

  function disconnect() {
    destroyed = true;
    stopPing();
    if (ws) {
      ws.removeAllListeners();
      ws.close();
      ws = null;
    }
  }

  return { connect, disconnect };
}
