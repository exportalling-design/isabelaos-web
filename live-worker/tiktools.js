// Wrapper for @tik.tools/node-client
// If the SDK API differs, adjust the import and constructor here.
// Docs: https://tik.tools/docs/node-client
import TikToolsClient from "@tik.tools/node-client";

export function createConnection(tiktokUsername, handlers) {
  const client = new TikToolsClient({
    uniqueId: tiktokUsername,
    apiKey: process.env.TIKTOOLS_API_KEY,
    options: {
      enableExtendedGiftInfo: true,
      reconnectEnabled: true,
      reconnectDelay: 3000,
    },
  });

  client.on("comment", (data) => {
    handlers.onComment({
      type: "comment",
      username: data.uniqueId || data.nickname || "anon",
      message: data.comment || "",
      userId: data.userId,
    });
  });

  client.on("gift", (data) => {
    if (data.giftType === 1 && !data.repeatEnd) return; // Only fire on streak end
    handlers.onGift({
      type: "gift",
      username: data.uniqueId || data.nickname || "anon",
      giftName: data.giftName || "gift",
      giftCount: data.repeatCount || 1,
      diamondCount: data.diamondCount || 0,
      userId: data.userId,
    });
  });

  client.on("follow", (data) => {
    handlers.onFollow({
      type: "follow",
      username: data.uniqueId || data.nickname || "anon",
      userId: data.userId,
    });
  });

  client.on("connected", () => {
    console.log(`[tiktools] connected → @${tiktokUsername}`);
    handlers.onConnected?.();
  });

  client.on("disconnected", (reason) => {
    console.warn(`[tiktools] disconnected: ${reason}`);
    handlers.onDisconnected?.(reason);
  });

  client.on("error", (err) => {
    console.error("[tiktools] error:", err.message || err);
    handlers.onError?.(err);
  });

  return {
    connect: () => client.connect(),
    disconnect: () => client.disconnect(),
  };
}
