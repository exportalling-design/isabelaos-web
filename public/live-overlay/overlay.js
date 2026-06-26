// IsabelaOS Live Overlay — SSE listener, avatar control, lip-sync, chat feed
(function () {
  "use strict";

  const cfg = window.LIVE_SESSION || {};
  // Fallback: read session_id from URL param (when using static index.html)
  const urlParams   = new URLSearchParams(location.search);
  const sessionId   = cfg.session_id   || urlParams.get("session_id") || "";
  const eventsUrl   = cfg.events_url   || `/api/tiktok-live/events?session_id=${sessionId}`;
  const avatarType  = cfg.avatar_type  || "video";
  const idleUrl     = cfg.avatar_idle_url    || "";
  const talkingUrl  = cfg.avatar_talking_url || "";
  const reactionUrl = cfg.avatar_reaction_url || "";

  if (!sessionId) {
    console.error("[overlay] no session_id — add ?session_id= to URL");
    return;
  }

  // DOM refs
  const avatarVideo   = document.getElementById("avatar-video");
  const avatarImg     = document.getElementById("avatar-img");
  const lipsyncBar    = document.getElementById("lipsync-bar");
  const responseBubble= document.getElementById("response-bubble");
  const responseUser  = document.getElementById("response-username");
  const responseText  = document.getElementById("response-text");
  const chatFeed      = document.getElementById("chat-feed");

  let isTalking     = false;
  let bubbleTimeout = null;
  const chatQueue   = [];

  // ── Avatar helpers ──────────────────────────────────────────────────────────

  function setAvatarIdle() {
    if (avatarType === "png") {
      avatarVideo.style.display = "none";
      avatarImg.style.display   = "block";
      avatarImg.src = idleUrl || "";
      lipsyncBar.classList.remove("talking");
    } else {
      avatarImg.style.display   = "none";
      avatarVideo.style.display = "block";
      avatarVideo.src  = idleUrl || "";
      avatarVideo.loop = true;
      avatarVideo.play().catch(() => {});
    }
    isTalking = false;
  }

  function setAvatarTalking() {
    if (avatarType === "png") {
      avatarImg.src = talkingUrl || idleUrl || "";
      lipsyncBar.classList.add("talking");
    } else {
      avatarVideo.src  = talkingUrl || idleUrl || "";
      avatarVideo.loop = true;
      avatarVideo.play().catch(() => {});
    }
    isTalking = true;
  }

  function setAvatarReaction() {
    if (!reactionUrl) return;
    if (avatarType === "png") {
      avatarImg.src = reactionUrl;
    } else {
      avatarVideo.src  = reactionUrl;
      avatarVideo.loop = false;
      avatarVideo.play().catch(() => {});
      avatarVideo.onended = () => { setAvatarIdle(); avatarVideo.onended = null; };
    }
  }

  // ── Audio playback + state machine ─────────────────────────────────────────

  function playResponse(event) {
    if (!event.audio_url) return;

    const audio = new Audio(event.audio_url);
    setAvatarTalking();

    // Show response bubble
    clearTimeout(bubbleTimeout);
    responseUser.textContent = "@" + (event.username || "");
    responseText.textContent = event.response_text || "";
    responseBubble.classList.remove("hidden");

    audio.onended = () => {
      setAvatarIdle();
      bubbleTimeout = setTimeout(() => responseBubble.classList.add("hidden"), 2500);
    };

    audio.onerror = () => {
      setAvatarIdle();
      responseBubble.classList.add("hidden");
    };

    audio.play().catch((err) => {
      console.warn("[overlay] audio play blocked:", err.message);
      setAvatarIdle();
    });
  }

  // ── Chat feed (max 3 items) ─────────────────────────────────────────────────

  function addChatItem(event) {
    const typeClass = event.event_type === "gift"
      ? "gift"
      : event.event_type === "follow"
        ? "follow"
        : "";

    let msgText = event.message || "";
    if (event.event_type === "gift")   msgText = `🎁 regalo`;
    if (event.event_type === "follow") msgText = `nuevo seguidor`;

    const item = document.createElement("div");
    item.className = `chat-item ${typeClass}`;
    item.innerHTML = `<span class="chat-username">@${event.username || "anon"}</span><span class="chat-message">${msgText}</span>`;
    chatFeed.appendChild(item);

    // Keep max 3
    while (chatFeed.children.length > 3) {
      chatFeed.removeChild(chatFeed.firstChild);
    }

    // Auto-remove after 8s
    setTimeout(() => {
      if (item.parentNode) item.parentNode.removeChild(item);
    }, 8000);
  }

  // ── SSE connection ──────────────────────────────────────────────────────────

  let es;
  let reconnectDelay = 2000;

  function connect() {
    if (es) { try { es.close(); } catch {} }

    es = new EventSource(eventsUrl);

    // Generic response events (avatar speaks)
    es.addEventListener("response", (e) => {
      try {
        const data = JSON.parse(e.data);
        playResponse(data);
        addChatItem(data);
      } catch {}
    });

    // Chat/gift/follow display only (no audio)
    ["comment", "gift", "follow"].forEach((type) => {
      es.addEventListener(type, (e) => {
        try { addChatItem(JSON.parse(e.data)); } catch {}
      });
    });

    // Gift → reaction avatar
    es.addEventListener("gift", (e) => {
      try {
        if (!isTalking) setAvatarReaction();
      } catch {}
    });

    es.onopen  = () => { reconnectDelay = 2000; console.log("[overlay] SSE connected"); };
    es.onerror = () => {
      console.warn("[overlay] SSE error — reconnecting in", reconnectDelay, "ms");
      es.close();
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 1.5, 30000);
    };
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  setAvatarIdle();
  connect();

})();
