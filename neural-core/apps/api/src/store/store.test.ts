import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RunStats } from "@neural-core/shared";
import { Store } from "./store.js";

const stats = (score: number, avgFocus = 50, accuracy = 50): RunStats => ({
  score, kills: 1, shots: 1, hits: 1, accuracy, avgFocus, bestChainS: 0, maxMult: 1, breaches: 0, bossDown: false,
});
const cal = { low: 0.4, high: 1.2, source: "measured" as const };
const verification = { ok: true, serverScore: 0, clientScore: 0, rejectedEvents: 0, notes: [] };

function finish(store: Store, playerId: number, s: RunStats) {
  const run = store.startRun({ playerId, station: 1, seed: 1, calibration: cal, encore: false });
  store.finishRun({ runId: run.id, status: "valid", stats: s, clientScore: s.score, verification, events: [], focus: [] });
  return run.id;
}

describe("Store", () => {
  it("ranks best run per player with tie-breakers and survives a restart", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "nc-store-"));
    const store = new Store(dir);
    const a = store.createPlayer("Asha", "R1");
    const b = store.createPlayer("Bilal", "R2");
    const c = store.createPlayer("Chen", "R3");
    finish(store, a.id, stats(5000));
    finish(store, a.id, stats(9000));
    finish(store, b.id, stats(9000, 70));
    finish(store, c.id, stats(9000, 70, 90));

    const board = store.leaderboard(10);
    expect(board.map((e) => e.fullName)).toEqual(["Chen", "Bilal", "Asha"]);
    expect(board[2]!.score).toBe(9000);

    const reopened = new Store(dir);
    expect(reopened.leaderboard(10)).toEqual(board);
    expect(reopened.playerByContact("R2")?.fullName).toBe("Bilal");
    expect(reopened.rankedAttempts(a.id)).toBe(2);
  });

  it("drops disqualified runs and respects the freeze", () => {
    const store = new Store(mkdtempSync(path.join(tmpdir(), "nc-store-")));
    const a = store.createPlayer("Asha", "R1");
    const runId = finish(store, a.id, stats(7000));
    store.setRunStatus(runId, "disqualified", "test");
    expect(store.leaderboard(10)).toHaveLength(0);
    store.setFrozen(true);
    const b = store.createPlayer("Bilal", "R2");
    finish(store, b.id, stats(100));
    expect(store.leaderboard(10)).toHaveLength(0);
  });
});
