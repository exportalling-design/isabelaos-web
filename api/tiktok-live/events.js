// GET /api/tiktok-live/events?session_id=xxx
// Server-Sent Events stream — polls Supabase every 1.5s for new events.
// Uses Edge runtime so the connection can stay open indefinitely.

const SUPABASE_URL        = process.env.SUPABASE_URL        || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_MS = 1500;

export const config = { runtime: "edge" };

export default async function handler(req) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session_id");
  if (!sessionId) {
    return new Response(JSON.stringify({ error: "missing session_id" }), { status: 400 });
  }

  const encoder = new TextEncoder();
  let lastTs = new Date().toISOString();
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial ping so OBS/browser confirms connection
      controller.enqueue(encoder.encode(`: connected\n\n`));

      const poll = async () => {
        if (closed) return;
        try {
          const apiUrl =
            `${SUPABASE_URL}/rest/v1/tiktok_live_events` +
            `?session_id=eq.${sessionId}` +
            `&created_at=gt.${encodeURIComponent(lastTs)}` +
            `&order=created_at.asc` +
            `&limit=20`;

          const r = await fetch(apiUrl, {
            headers: {
              apikey: SUPABASE_SERVICE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
              "Content-Type": "application/json",
            },
          });

          if (r.ok) {
            const events = await r.json();
            if (Array.isArray(events) && events.length > 0) {
              lastTs = events[events.length - 1].created_at;
              for (const ev of events) {
                const line = `event: ${ev.event_type}\ndata: ${JSON.stringify(ev)}\n\n`;
                controller.enqueue(encoder.encode(line));
              }
            }
          }
        } catch {}

        // Keepalive comment
        controller.enqueue(encoder.encode(`: ping\n\n`));

        if (!closed) setTimeout(poll, POLL_MS);
      };

      setTimeout(poll, POLL_MS);

      // Abort signal from client disconnect
      req.signal?.addEventListener("abort", () => {
        closed = true;
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
