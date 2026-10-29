import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage, Server } from "node:http";
import { wsClientMessageSchema, type StationStatus, type WsServerMessage } from "@neural-core/shared";
import type { StationHub } from "../stations/station.js";

type Role = "kiosk" | "display" | "operator" | "bridge" | "unknown";

interface ClientInfo {
  role: Role;
  station: number | null;
  alive: boolean;
  addr: string;
}

export interface BridgeHandler {
  (station: number, counts: number[], bits: number, from: string): void;
}

/**
 * One WebSocket endpoint (/ws) for every device at the venue. Clients say
 * hello with their role and station; the server only sends each one what it
 * needs (kiosks get their own station's focus, operators get everything).
 */
export class Hub implements StationHub {
  private wss: WebSocketServer | null = null;
  private readonly clients = new Map<WebSocket, ClientInfo>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  /** Supplies current station statuses so a new client is up to date at once. */
  statusProvider: () => StationStatus[] = () => [];

  constructor(private readonly onBridge: BridgeHandler, private readonly log: (m: string) => void) {}

  attach(server: Server): void {
    this.wss = new WebSocketServer({ server, path: "/ws", maxPayload: 64 * 1024 });
    this.wss.on("connection", (ws, req) => this.onConnection(ws, req));
    this.heartbeat = setInterval(() => {
      for (const [ws, info] of this.clients) {
        if (!info.alive) {
          ws.terminate();
          this.clients.delete(ws);
          continue;
        }
        info.alive = false;
        ws.ping();
      }
    }, 10_000);
  }

  private onConnection(ws: WebSocket, req: IncomingMessage): void {
    const addr = req.socket.remoteAddress ?? "?";
    const info: ClientInfo = { role: "unknown", station: null, alive: true, addr };
    this.clients.set(ws, info);
    ws.on("pong", () => (info.alive = true));
    ws.on("close", () => {
      this.clients.delete(ws);
      if (info.role === "bridge") this.log(`bridge for station ${info.station} disconnected (${addr})`);
    });
    ws.on("error", (err) => this.log(`ws ${addr}: ${err.message}`));
    ws.on("message", (data) => {
      let json: unknown;
      try {
        json = JSON.parse(data.toString());
      } catch {
        return;
      }
      const parsed = wsClientMessageSchema.safeParse(json);
      if (!parsed.success) return;
      const msg = parsed.data;
      if (msg.type === "hello") {
        info.role = msg.role;
        info.station = msg.station ?? null;
        if (msg.role === "bridge") {
          this.log(`bridge for station ${info.station} connected (${addr})`);
          return;
        }
        for (const status of this.statusProvider()) {
          if (msg.role === "kiosk" && status.id !== info.station) continue;
          ws.send(JSON.stringify({ type: "station", station: status.id, status: { ...status } } satisfies WsServerMessage));
        }
        return;
      }
      if (msg.type === "bridge:samples") {
        info.role = "bridge";
        info.station = msg.station;
        this.onBridge(msg.station, msg.counts, msg.bits, `Bridge ${addr.replace("::ffff:", "")}`);
      }
    });
  }

  private send(filter: (c: ClientInfo) => boolean, msg: WsServerMessage): void {
    const payload = JSON.stringify(msg);
    for (const [ws, info] of this.clients) {
      if (ws.readyState === WebSocket.OPEN && filter(info)) ws.send(payload);
    }
  }

  private forStation(station: number) {
    return (c: ClientInfo) =>
      c.role === "operator" ||
      (c.role === "display" && (c.station === null || c.station === station)) ||
      (c.role === "kiosk" && c.station === station);
  }

  focus(frame: Parameters<StationHub["focus"]>[0]): void {
    this.send(this.forStation(frame.station), frame);
  }

  signal(frame: Parameters<StationHub["signal"]>[0]): void {
    this.send(this.forStation(frame.station), frame);
  }

  calibration(msg: Parameters<StationHub["calibration"]>[0]): void {
    this.send(this.forStation(msg.station), msg);
  }

  status(status: StationStatus): void {
    this.send((c) => c.role !== "bridge", { type: "station", station: status.id, status: { ...status } });
  }

  command(station: number, action: "pause" | "resume" | "abort" | "reset" | "skip-calibration"): void {
    this.send(this.forStation(station), { type: "command", station, action });
  }

  leaderboardChanged(): void {
    this.send((c) => c.role !== "bridge", { type: "leaderboard:update" });
  }

  connections(): Array<{ role: Role; station: number | null; addr: string }> {
    return [...this.clients.values()].map(({ role, station, addr }) => ({ role, station, addr }));
  }

  close(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.wss?.close();
  }
}
