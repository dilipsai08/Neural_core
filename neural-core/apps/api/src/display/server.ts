import express from "express";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import type { AppContext } from "../context.js";

/** Rows shown on the display. */
const DISPLAY_ROWS = 10;
const STATIC_DIR = fileURLToPath(new URL("../../display/", import.meta.url));

export interface DisplayRow {
  rank: number;
  runId: number;
  name: string;
  title: string;
  score: number;
  avgFocus: number;
  maxMult: number;
}

export interface DisplayBoard {
  type: "board";
  event: string;
  rows: DisplayRow[];
  totalRanked: number;
  /** The shift that just finished, so the screen can announce it. */
  latest: { runId: number; name: string; score: number; rank: number | null } | null;
}

/**
 * The venue's leaderboard screen, on its own port. It never polls: the board
 * is built once when a shift finishes (or an operator changes a run) and
 * pushed to every open screen. A screen that connects gets the current board.
 *
 * The board comes from the in-memory ledger, which is what the online
 * database mirrors, so building it costs no database query at all.
 */
export class DisplayServer {
  private server: Server | null = null;
  private wss: WebSocketServer | null = null;
  private board: DisplayBoard;

  constructor(private readonly ctx: AppContext) {
    this.board = this.build(null);
  }

  start(port: number, host: string): void {
    const app = express();
    app.disable("x-powered-by");
    app.use(express.static(STATIC_DIR, { extensions: ["html"] }));
    this.server = createServer(app);
    this.wss = new WebSocketServer({ server: this.server, path: "/feed" });
    this.wss.on("connection", (ws) => ws.send(JSON.stringify({ ...this.board, latest: null })));
    this.server.on("error", (err) => this.ctx.log(`display: ${err.message}`));
    this.server.listen(port, host, () => this.ctx.log(`leaderboard display on http://localhost:${port}`));
  }

  /** Rebuild and push. runId: the shift that just finished, if any. */
  changed(runId?: number): void {
    this.board = this.build(runId ?? null);
    const payload = JSON.stringify(this.board);
    for (const ws of this.wss?.clients ?? []) if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }

  private build(runId: number | null): DisplayBoard {
    const { store, env } = this.ctx;
    const ranked = store.rankedRuns();
    let latest: DisplayBoard["latest"] = null;
    const run = runId === null ? undefined : store.runs.get(runId);
    if (run?.stats) {
      const player = store.players.get(run.playerId);
      const mine = ranked.find((e) => e.runId === run.id);
      latest = { runId: run.id, name: player?.fullName ?? "Player", score: run.stats.score, rank: mine?.rank ?? null };
    }
    return {
      type: "board",
      event: env.EVENT_NAME,
      // Names and scores only: contact details never leave the server.
      rows: ranked.slice(0, DISPLAY_ROWS).map((e) => ({
        rank: e.rank,
        runId: e.runId,
        name: e.fullName,
        title: e.title,
        score: e.score,
        avgFocus: e.avgFocus,
        maxMult: e.maxMult,
      })),
      totalRanked: ranked.length,
      latest,
    };
  }

  close(): void {
    this.wss?.close();
    this.server?.close();
  }
}
