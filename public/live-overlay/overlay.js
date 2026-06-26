// IsabelaOS Live Overlay — 4-state avatar control, SSE listener, chat feed
(function () {
  "use strict";

  const cfg        = window.LIVE_SESSION || {};
  const urlParams  = new URLSearchParams(location.search);
  const sessionId  = cfg.session_id   || urlParams.get("session_id") || "";
  const eventsUrl  = cfg.events_url   || `/api/tiktok-live/events?session_id=${sessionId}`;
  const avatarType = cfg.avatar_type  || "video";

  // 4-state video URLs (AI-generated preferred, legacy fallbacks)
  const idleUrl    = cfg.video_idle_url    || cfg.avatar_idle_url    || "";
  const talkingUrl = cfg.video_talking_url || cfg.avatar_talking_url || "";
  const dancingUrl = cfg.video_dancing_url || cfg.avatar_reaction_url|| "";
  const lipsyncUrl = cfg.video_lipsync_url || idleUrl;

  if (!sessionId) {
    console.error("[overlay] no session_id — add ?session_id= to URL");
    return;
  }

  // DOM refs
  const avatarVideo    = document.getElementById("avatar-video");
  const avatarImg      = document.getElementById("avatar-img");
  const lipsyncBar     = document.getElementById("lipsync-bar");
  const responseBubble = document.getElementById("response-bubble");
  const responseUser   = document.getElementById("response-username");
  const responseText   = document.getElementById("response-text");
  const chatFeed       = document.getElementById("chat-feed");

  // State
  let currentState  = "idle";   // idle | talking | dancing | lipsync
  let isTalking     = false;
  let bubbleTimeout = null;
  let lastActivity  = Date.now();
  let giftBackTimer = null;
  let lipSyncTimer  = null;

  // ── Avatar state machine ────────────────────────────────────────────────────

  function setVideo(url, loop = true) {
    if (avatarType === "png") {
      avatarVideo.style.display = "none";
      avatarImg.style.display   = "block";
      avatarImg.src = url || "";
    } else {
      avatarImg.style.display   = "none";
      avatarVideo.style.display = "block";
      if (avatarVideo.src !== url) {
        avatarVideo.src = url || "";
      }
      avatarVideo.loop = loop;
      avatarVideo.play().catch(() => {});
    }
  }

  function setState(state) {
    currentState = state;
    switch (state) {
      case "idle":
        setVideo(idleUrl, true);
        lipsyncBar.classList.remove("talking");
        isTalking = false;
        break;
      case "talking":
        setVideo(talkingUrl || idleUrl, true);
        lipsyncBar.classList.add("talking");
        isTalking = true;
        break;
      case "dancing":
        setVideo(dancingUrl || idleUrl, true);
        lipsyncBar.classList.remove("talking");
        isTalking = false;
        break;
      case "lipsync":
        setVideo(lipsyncUrl || idleUrl, true);
        lipsyncBar.classList.remove("talking");
        isTalking = false;
        break;
    }
  }

  // ── Audio playback ─────────────────────────────────────────────────────────

  function playResponse(event) {
    if (!event.audio_url) return;
    lastActivity = Date.now();

    const audio = new Audio(event.audio_url);
    setState("talking");

    clearTimeout(bubbleTimeout);
    responseUser.textContent = "@" + (event.username || "");
    responseText.textContent = event.response_text || "";
    responseBubble.classList.remove("hidden");

    audio.onended = () => {
      setState("idle");
      bubbleTimeout = setTimeout(() => responseBubble.classList.add("hidden"), 2500);
    };
    audio.onerror = () => {
      setState("idle");
      responseBubble.classList.add("hidden");
    };
    audio.play().catch(() => setState("idle"));
  }

  // ── Gift: dancing for 5s then back to idle ─────────────────────────────────

  function handleGift(event) {
    lastActivity = Date.now();
    clearTimeout(giftBackTimer);
    if (!isTalking) {
      setState("dancing");
      giftBackTimer = setTimeout(() => {
        if (currentState === "dancing") setState("idle");
      }, 5000);
    }
  }

  // ── Lipsync: 10min idle → lipsync 30s → idle ──────────────────────────────

  function startLipSyncWatch() {
    clearInterval(lipSyncTimer);
    lipSyncTimer = setInterval(() => {
      const idleMs = Date.now() - lastActivity;
      if (idleMs >= 10 * 60 * 1000 && currentState === "idle") {
        setState("lipsync");
        lastActivity = Date.now(); // reset so it doesn't loop immediately
        setTimeout(() => {
          if (currentState === "lipsync") setState("idle");
        }, 30_000);
      }
    }, 60_000);
  }

  // ── Chat feed (max 3 items) ─────────────────────────────────────────────────

  function addChatItem(event) {
    const typeClass = event.event_type === "gift"
      ? "gift"
      : event.event_type === "follow" ? "follow" : "";

    let msgText = event.message || "";
    if (event.event_type === "gift")   msgText = "🎁 regalo";
    if (event.event_type === "follow") msgText = "nuevo seguidor";

    const item = document.createElement("div");
    item.className = `chat-item ${typeClass}`;
    item.innerHTML = `<span class="chat-username">@${event.username || "anon"}</span><span class="chat-message">${msgText}</span>`;
    chatFeed.appendChild(item);

    while (chatFeed.children.length > 3) chatFeed.removeChild(chatFeed.firstChild);
    setTimeout(() => { if (item.parentNode) item.parentNode.removeChild(item); }, 8000);
  }

  // ── SSE connection ──────────────────────────────────────────────────────────

  let es;
  let reconnectDelay = 2000;

  function connect() {
    if (es) { try { es.close(); } catch {} }
    es = new EventSource(eventsUrl);

    es.addEventListener("response", (e) => {
      try { playResponse(JSON.parse(e.data)); } catch {}
    });

    es.addEventListener("gift", (e) => {
      try {
        const data = JSON.parse(e.data);
        addChatItem(data);
        handleGift(data);
      } catch {}
    });

    ["comment", "follow"].forEach((type) => {
      es.addEventListener(type, (e) => {
        try {
          lastActivity = Date.now();
          addChatItem(JSON.parse(e.data));
        } catch {}
      });
    });

    // Worker-driven state override (e.g. future lipsync signals)
    es.addEventListener("state", (e) => {
      try {
        const data = JSON.parse(e.data);
        const newState = data.message || data.state;
        if (["idle","talking","dancing","lipsync"].includes(newState)) {
          setState(newState);
        }
      } catch {}
    });

    es.onopen  = () => { reconnectDelay = 2000; };
    es.onerror = () => {
      es.close();
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 1.5, 30000);
    };
  }

  // ── YouTube background music ────────────────────────────────────────────────

  function extractYouTubeId(url) {
    if (!url) return null;
    const m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  const ytUrl = cfg.youtube_url || "";
  const ytVideoId = extractYouTubeId(ytUrl);

  if (ytVideoId) {
    // Load IFrame Player API asynchronously
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);

    window.onYouTubeIframeAPIReady = function () {
      new YT.Player("yt-player", {
        videoId: ytVideoId,
        playerVars: {
          autoplay:       1,
          loop:           1,
          playlist:       ytVideoId, // required for loop
          controls:       0,
          disablekb:      1,
          fs:             0,
          modestbranding: 1,
          rel:            0,
        },
        events: {
          onReady: (e) => {
            e.target.setVolume(30);
            e.target.playVideo();
          },
        },
      });
    };
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  setState("idle");
  connect();
  startLipSyncWatch();

})();
