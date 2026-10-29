import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import path from "node:path";
import {
  formatDisplayId,
  titleForScore,
  type Calibration,
  type FocusPoint,
  type LeaderboardEntry,
  type Player,
  type Run,
  type RunEvent,
  type RunStats,
  type RunStatus,
  type VerificationReport,
} from "@neural-core/shared";

/**
 * Append-only ledger. Every change is one JSON line in ledger.jsonl, fsynced
 * before the API answers, and the in-memory state is rebuilt from it on boot.
 * A crash or power cut can never lose a finished run, and the file is
 * human-readable for disputes.
 */
export type LedgerEntry =
  | { op: "player"; at: string; player: Player }
  | { op: "run:start"; at: string; run: Run }
  | { op: "run:go"; at: string; runId: number; goAt: number }
  | {
      op: "run:finish";
      at: string;
      runId: number;
      status: RunStatus;
      stats: RunStats;
      clientScore: number;
      verification: VerificationReport;
      events: RunEvent[];
      focus: FocusPoint[];
    }
  | { op: "run:status"; at: string; runId: number; status: RunStatus; actor: string }
  | { op: "calibration"; at: string; station: number; playerId: number | null; calibration: Calibration }
  | { op: "freeze"; at: string; frozen: boolean }
  | { op: "audit"; at: string; actor: string; action: string; details: Record<string, unknown> };

export interface StoredRun extends Run {
  events: RunEvent[];
  focus: FocusPoint[];
}

export class Store {
  readonly players = new Map<number, Player>();
  readonly runs = new Map<number, StoredRun>();
  readonly calibrations: Array<{ station: number; playerId: number | null; calibration: Calibration; at: string }> = [];
  readonly audit: Array<{ at: string; actor: string; action: string; details: Record<string, unknown> }> = [];
  frozenAt: string | null = null;
  /** Called after every new ledger entry (used to mirror into PostgreSQL). */
  onChange: ((entry: LedgerEntry) => void) | null = null;

  private readonly file: string;
  private byContact = new Map<string, number>();

  constructor(dir: string) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, "ledger.jsonl");
    if (existsSync(this.file)) this.replay();
  }

  private replay(): void {
    const lines = readFileSync(this.file, "utf8").split("\n");
    let bad = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        this.apply(JSON.parse(line) as LedgerEntry);
      } catch {
        bad += 1;
      }
    }
    if (bad) console.warn(`[store] skipped ${bad} unreadable ledger line(s)`);
  }

  private write(entry: LedgerEntry): void {
    // Append and fsync through one writable handle. (fsync on a read-only
    // handle fails with EPERM on Windows.)
    const fd = openSync(this.file, "a");
    try {
      writeSync(fd, JSON.stringify(entry) + "\n");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    this.apply(entry);
    this.onChange?.(entry);
  }

  private apply(e: LedgerEntry): void {
    switch (e.op) {
      case "player":
        this.players.set(e.player.id, e.player);
        this.byContact.set(e.player.contactKey, e.player.id);
        break;
      case "run:start":
        this.runs.set(e.run.id, { ...e.run, events: [], focus: [] });
        break;
      case "run:go": {
        const r = this.runs.get(e.runId);
        if (r) r.goAt = e.goAt;
        break;
      }
      case "run:finish": {
        const r = this.runs.get(e.runId);
        if (!r) break;
        r.status = e.status;
        r.stats = e.stats;
        r.clientScore = e.clientScore;
        r.verification = e.verification;
        r.events = e.events;
        r.focus = e.focus;
        r.finishedAt = e.at;
        break;
      }
      case "run:status": {
        const r = this.runs.get(e.runId);
        if (r) r.status = e.status;
        break;
      }
      case "calibration":
        this.calibrations.push({ station: e.station, playerId: e.playerId, calibration: e.calibration, at: e.at });
        break;
      case "freeze":
        this.frozenAt = e.frozen ? e.at : null;
        break;
      case "audit":
        this.audit.push({ at: e.at, actor: e.actor, action: e.action, details: e.details });
        break;
    }
  }

  // ─── Players ──────────────────────────────────────────────────────────
  playerByContact(contactKey: string): Player | null {
    const id = this.byContact.get(contactKey);
    return id === undefined ? null : (this.players.get(id) ?? null);
  }

  createPlayer(fullName: string, contactKey: string): Player {
    const id = this.players.size + 1;
    const now = new Date().toISOString();
    const player: Player = {
      id,
      displayId: formatDisplayId(id),
      fullName,
      contactKey,
      consentAt: now,
      createdAt: now,
    };
    this.write({ op: "player", at: now, player });
    return player;
  }

  // ─── Runs ─────────────────────────────────────────────────────────────
  rankedAttempts(playerId: number): number {
    let n = 0;
    for (const r of this.runs.values()) {
      if (r.playerId === playerId && (r.status === "valid" || r.status === "disqualified")) n += 1;
    }
    return n;
  }

  startRun(input: { playerId: number; station: number; seed: number; calibration: Calibration; encore: boolean }): Run {
    const id = this.runs.size + 1;
    const now = new Date().toISOString();
    const run: Run = {
      id,
      playerId: input.playerId,
      station: input.station,
      status: "active",
      ranked: !input.encore,
      seed: input.seed,
      calibration: input.calibration,
      startedAt: now,
      goAt: null,
      finishedAt: null,
      stats: null,
      clientScore: null,
      verification: null,
    };
    this.write({ op: "run:start", at: now, run });
    return run;
  }

  markGo(runId: number, goAt: number): void {
    this.write({ op: "run:go", at: new Date().toISOString(), runId, goAt });
  }

  finishRun(input: {
    runId: number;
    status: RunStatus;
    stats: RunStats;
    clientScore: number;
    verification: VerificationReport;
    events: RunEvent[];
    focus: FocusPoint[];
  }): void {
    this.write({ op: "run:finish", at: new Date().toISOString(), ...input });
  }

  setRunStatus(runId: number, status: RunStatus, actor: string): void {
    this.write({ op: "run:status", at: new Date().toISOString(), runId, status, actor });
  }

  // ─── Calibrations ─────────────────────────────────────────────────────
  saveCalibration(station: number, playerId: number | null, calibration: Calibration): void {
    this.write({ op: "calibration", at: new Date().toISOString(), station, playerId, calibration });
  }

  lastCalibrationFor(playerId: number): Calibration | null {
    for (let i = this.calibrations.length - 1; i >= 0; i--) {
      const c = this.calibrations[i]!;
      if (c.playerId === playerId && c.calibration.source === "measured") return c.calibration;
    }
    return null;
  }

  /** Median of today's measured calibrations, used when one is skipped. */
  eventMedianCalibration(): Calibration | null {
    const measured = this.calibrations.filter((c) => c.calibration.source === "measured").map((c) => c.calibration);
    if (measured.length < 3) return null;
    const med = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      return s[s.length >> 1]!;
    };
    return { low: med(measured.map((c) => c.low)), high: med(measured.map((c) => c.high)), source: "event-median" };
  }

  // ─── Leaderboard ──────────────────────────────────────────────────────
  setFrozen(frozen: boolean): void {
    this.write({ op: "freeze", at: new Date().toISOString(), frozen });
  }

  /** Best valid run per player, ordered by score, then avg focus, then accuracy. */
  leaderboard(limit: number): LeaderboardEntry[] {
    return this.rankedRuns().slice(0, limit);
  }

  rankedRuns(): LeaderboardEntry[] {
    const best = new Map<number, StoredRun>();
    for (const r of this.runs.values()) {
      if (r.status !== "valid" || !r.stats || !r.finishedAt) continue;
      if (this.frozenAt && r.finishedAt > this.frozenAt) continue;
      const cur = best.get(r.playerId);
      if (!cur || compareRuns(r, cur) < 0) best.set(r.playerId, r);
    }
    return [...best.values()].sort(compareRuns).map((r, i) => {
      const p = this.players.get(r.playerId)!;
      const s = r.stats!;
      return {
        rank: i + 1,
        playerId: p.id,
        displayId: p.displayId,
        fullName: p.fullName,
        runId: r.id,
        score: s.score,
        avgFocus: s.avgFocus,
        accuracy: s.accuracy,
        maxMult: s.maxMult,
        title: titleForScore(s.score).label,
        station: r.station,
        finishedAt: r.finishedAt!,
      };
    });
  }

  personalBest(playerId: number, excludeRunId?: number): number | null {
    let best: number | null = null;
    for (const r of this.runs.values()) {
      if (r.playerId !== playerId || r.id === excludeRunId || !r.stats) continue;
      if (r.status !== "valid" && r.status !== "encore") continue;
      best = Math.max(best ?? 0, r.stats.score);
    }
    return best;
  }

  // ─── Audit ────────────────────────────────────────────────────────────
  logAudit(actor: string, action: string, details: Record<string, unknown>): void {
    this.write({ op: "audit", at: new Date().toISOString(), actor, action, details });
  }
}

export function compareRuns(a: Run, b: Run): number {
  const sa = a.stats!;
  const sb = b.stats!;
  return sb.score - sa.score || sb.avgFocus - sa.avgFocus || sb.accuracy - sa.accuracy || a.id - b.id;
}
