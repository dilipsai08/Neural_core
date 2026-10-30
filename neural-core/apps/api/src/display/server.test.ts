import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { RunStats } from "@neural-core/shared";
import type { AppContext } from "../context.js";
import { Store } from "../store/store.js";
import { DisplayServer, type DisplayBoard } from "./server.js";

const stats = (score: number): RunStats => ({
  score, kills: 1, shots: 1, hits: 1, accuracy: 50, avgFocus: 50, bestChainS: 0, maxMult: 1, breaches: 0, bossDown: false,
});
const cal = { low: 0.4, high: 1.2, source: "measured" as const };
const verification = { ok: true, serverScore: 0, clientScore: 0, rejectedEvents: 0, notes: [] };

function finish(store: Store, name: string, score: number): number {
  const p = store.createPlayer(name, `R-${name}`);
  const run = store.startRun({ playerId: p.id, station: 1, seed: 1, calibration: cal, encore: false });
  store.finishRun({ runId: run.id, status: "valid", stats: stats(score), clientScore: score, verification, events: [], focus: [] });
  return run.id;
}

function nextBoard(ws: WebSocket): Promise<DisplayBoard> {
  return new Promise((resolve) => ws.once("message", (d) => resolve(JSON.parse(d.toString()) as DisplayBoard)));
}

let display: DisplayServer | null = null;
afterEach(() => display?.close());

describe("DisplayServer", () => {
  it("sends the board on connect and pushes a new one, with the finished shift, only when told", async () => {
    const store = new Store(mkdtempSync(path.join(tmpdir(), "nc-display-")));
    finish(store, "Asha", 9000);
    const ctx = { store, env: { EVENT_NAME: "Test" }, log: () => undefined } as unknown as AppContext;
    display = new DisplayServer(ctx);
    const port = 4300 + Math.floor(Math.random() * 500);
    display.start(port, "127.0.0.1");
    await new Promise((r) => setTimeout(r, 150));

    const ws = new WebSocket(`ws://127.0.0.1:${port}/feed`);
    const first = await nextBoard(ws);
    expect(first.rows.map((r) => r.name)).toEqual(["Asha"]);
    expect(first.latest).toBeNull();
    expect(JSON.stringify(first)).not.toContain("R-Asha"); // contact details never reach the screen

    // A new shift in the ledger is not shown until the server says a game finished.
    const runId = finish(store, "Bilal", 12000);
    const pushed = nextBoard(ws);
    display.changed(runId);
    const board = await pushed;
    expect(board.rows.map((r) => r.name)).toEqual(["Bilal", "Asha"]);
    expect(board.latest).toMatchObject({ runId, name: "Bilal", score: 12000, rank: 1 });
    ws.close();
  });
});
