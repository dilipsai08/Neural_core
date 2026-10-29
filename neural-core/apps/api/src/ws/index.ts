import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { FocusFrame } from "@neural-core/shared";

let wss: WebSocketServer | null = null;

export function initWebSocketServer(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    ws.on("error", (err) => {
      console.error("WS error:", err.message);
    });
  });

  return wss;
}

export function broadcastFocus(frame: FocusFrame): void {
  if (!wss) return;
  const payload = JSON.stringify(frame);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

export function broadcastLeaderboardUpdate(): void {
  if (!wss) return;
  const payload = JSON.stringify({ type: "leaderboard:update" });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}
