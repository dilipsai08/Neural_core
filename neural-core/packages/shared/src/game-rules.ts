import {
  ARC_MIN_MULT,
  BOSS_SPAWN_S,
  BREACH_PENALTY,
  CHAIN_FOCUS_THRESHOLD,
  CHAIN_GRACE_S,
  CHAIN_LADDER,
  DISTORTION_CAP,
  DISTORTION_FOCUS_CLEAN,
  DISTORTION_FOCUS_MAX,
  ROUND_DURATION_S,
  VERIFY_TIME_TOLERANCE_S,
} from "./constants.js";
import { createSeededRng, hash32, seededRange, seededWeighted } from "./rng.js";
import type {
  EnemyKind,
  EnemySpec,
  FocusPoint,
  RankTitle,
  RunEvent,
  RunStats,
  SpawnEntry,
} from "./types.js";
import { clamp } from "./utils.js";

// ─── Enemies ───────────────────────────────────────────────────────────
export const ENEMIES: Readonly<Record<EnemyKind, EnemySpec>> = {
  shambler: { kind: "shambler", hp: 1, points: 100, crossS: 11, scale: 1 },
  sparker: { kind: "sparker", hp: 1, points: 150, crossS: 7, scale: 0.85 },
  brute: { kind: "brute", hp: 3, points: 300, crossS: 14, scale: 1.45 },
  wraith: { kind: "wraith", hp: 1, points: 200, crossS: 9.5, scale: 1.05 },
  conductor: { kind: "conductor", hp: 12, points: 1500, crossS: 13.5, scale: 2.4 },
};

export const LANE_COUNT = 3;

interface Phase {
  until: number;
  interval: number;
  weights: Partial<Record<EnemyKind, number>>;
  pairChance: number;
}

/** Act structure of the 45 s round: Brownout → Surge → Overload → The Conductor. */
const PHASES: readonly Phase[] = [
  { until: 11, interval: 1.9, weights: { shambler: 0.85, wraith: 0.15 }, pairChance: 0 },
  { until: 22, interval: 1.45, weights: { shambler: 0.5, sparker: 0.35, wraith: 0.15 }, pairChance: 0.15 },
  { until: BOSS_SPAWN_S, interval: 1.25, weights: { shambler: 0.35, sparker: 0.3, brute: 0.2, wraith: 0.15 }, pairChance: 0.25 },
  { until: ROUND_DURATION_S, interval: 2.0, weights: { shambler: 0.45, sparker: 0.4, wraith: 0.15 }, pairChance: 0.1 },
];

export const ACTS = [
  { at: 0, name: "Brownout" },
  { at: 11, name: "Surge" },
  { at: 22, name: "Overload" },
  { at: BOSS_SPAWN_S, name: "The Conductor" },
] as const;

/**
 * Deterministic spawn sequence. Every player with the same seed faces exactly
 * the same enemies at the same times in the same lanes.
 */
export function generateWave(seed: number): SpawnEntry[] {
  const rng = createSeededRng(seed);
  const out: SpawnEntry[] = [];
  let id = 1;
  let t = 1.2;
  let lastLane = -1;

  const push = (kind: EnemyKind, at: number, lane: number) => {
    out.push({ id, kind, t: round2(at), lane, crossS: ENEMIES[kind].crossS, noiseSeed: hash32(seed, id) });
    id += 1;
  };

  while (t < ROUND_DURATION_S - 4) {
    const phase = PHASES.find((p) => t < p.until) ?? PHASES[PHASES.length - 1]!;
    const kind = seededWeighted(rng, phase.weights);
    let lane = Math.floor(rng() * LANE_COUNT);
    if (lane === lastLane) lane = (lane + 1) % LANE_COUNT;
    lastLane = lane;
    push(kind, t, lane);
    if (rng() < phase.pairChance) {
      const other = (lane + 1 + Math.floor(rng() * (LANE_COUNT - 1))) % LANE_COUNT;
      push(seededWeighted(rng, { shambler: 1, sparker: 0.6 }), t + 0.35, other);
    }
    t += phase.interval * seededRange(rng, 0.75, 1.25);
  }

  push("conductor", BOSS_SPAWN_S, 1);
  return out.sort((a, b) => a.t - b.t || a.id - b.id);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// ─── Focus → difficulty ────────────────────────────────────────────────
/**
 * Distortion in [0, DISTORTION_CAP]: 0 when locked in, rising smoothly as focus
 * drops. Drives enemy jitter, speed surges, blur and wraith fade.
 */
export function distortionFor(focus: number): number {
  const x = clamp((DISTORTION_FOCUS_CLEAN - focus) / (DISTORTION_FOCUS_CLEAN - DISTORTION_FOCUS_MAX), 0, 1);
  const eased = x * x * (3 - 2 * x);
  return eased * DISTORTION_CAP;
}

/**
 * Bounded progress offset (in fraction of the crossing) added to an enemy's
 * steady walk when the player is distracted. Bounded so crossings stay within
 * the server's verification tolerance and targets stay catchable.
 */
export const MAX_PROGRESS_WOBBLE = 0.12;

// ─── Focus chain (sustained-focus multiplier) ─────────────────────────
export function multiplierForChain(sustainedS: number): number {
  let mult = 1;
  for (const step of CHAIN_LADDER) {
    if (sustainedS >= step.atS) mult = step.mult;
  }
  return mult;
}

/** Seconds until the next multiplier step, or null at the top of the ladder. */
export function nextChainStep(sustainedS: number): { atS: number; mult: number } | null {
  return CHAIN_LADDER.find((s) => s.atS > sustainedS) ?? null;
}

export interface ChainState {
  sustainedS: number;
  mult: number;
  alive: boolean;
}

/**
 * Tracks how long focus has stayed at or above the threshold. Fed with the
 * same 4 Hz frames on the kiosk and on the server, so both agree on the
 * multiplier at any moment.
 */
export class ChainTracker {
  private chainStart: number | null = null;
  private lastGood = -Infinity;
  private lastT = 0;
  best = 0;

  push(tS: number, focus: number): ChainState {
    this.lastT = tS;
    if (focus >= CHAIN_FOCUS_THRESHOLD) {
      this.lastGood = tS;
      if (this.chainStart === null) this.chainStart = tS;
    } else if (tS - this.lastGood > CHAIN_GRACE_S) {
      this.chainStart = null;
    }
    const state = this.state();
    this.best = Math.max(this.best, state.sustainedS);
    return state;
  }

  state(): ChainState {
    const sustainedS = this.chainStart === null ? 0 : this.lastT - this.chainStart;
    return { sustainedS, mult: multiplierForChain(sustainedS), alive: this.chainStart !== null };
  }

  reset(): void {
    this.chainStart = null;
    this.lastGood = -Infinity;
    this.lastT = 0;
    this.best = 0;
  }
}

export interface ChainTimeline {
  times: number[];
  mults: number[];
  best: number;
}

export function buildChainTimeline(points: readonly FocusPoint[]): ChainTimeline {
  const tracker = new ChainTracker();
  const times: number[] = [];
  const mults: number[] = [];
  for (const p of points) {
    const s = tracker.push(p.tMs / 1000, p.score);
    times.push(p.tMs);
    mults.push(s.mult);
  }
  return { times, mults, best: tracker.best };
}

export function multiplierAt(tl: ChainTimeline, tMs: number): number {
  let lo = 0;
  let hi = tl.times.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (tl.times[mid]! <= tMs) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found < 0 ? 1 : tl.mults[found]!;
}

export function maxMultiplierAround(tl: ChainTimeline, tMs: number, windowMs: number): number {
  let best = multiplierAt(tl, tMs);
  for (let i = 0; i < tl.times.length; i++) {
    const t = tl.times[i]!;
    if (t >= tMs - windowMs && t <= tMs + windowMs) best = Math.max(best, tl.mults[i]!);
  }
  return best;
}

// ─── Scoring ───────────────────────────────────────────────────────────
export function pointsForKill(kind: EnemyKind, mult: number): number {
  return ENEMIES[kind].points * mult;
}

export interface ScoreInput {
  seed: number;
  events: readonly RunEvent[];
  focus: readonly FocusPoint[];
}

export interface ScoreOutput {
  stats: RunStats;
  rejected: number;
  notes: string[];
}

/**
 * Authoritative scoring. Recomputes the score from kill events and the
 * verified focus timeline; never trusts a client-reported total.
 */
export function scoreRun({ seed, events, focus }: ScoreInput): ScoreOutput {
  const wave = generateWave(seed);
  const byId = new Map(wave.map((s) => [s.id, s]));
  const chain = buildChainTimeline(focus);
  const notes: string[] = [];
  const tolMs = VERIFY_TIME_TOLERANCE_S * 1000;
  const durMs = ROUND_DURATION_S * 1000;

  const hitsOn = new Map<number, number>();
  const killed = new Set<number>();
  let rejected = 0;
  let shots = 0;
  let boltHits = 0;
  let kills = 0;
  let score = 0;
  let maxMult = 1;
  let bossDown = false;

  const sorted = [...events].sort((a, b) => a.tMs - b.tMs);
  for (const ev of sorted) {
    if (ev.tMs < -tolMs || ev.tMs > durMs + tolMs) {
      rejected += 1;
      continue;
    }
    if (ev.kind === "shot") {
      shots += 1;
      continue;
    }
    if (ev.kind !== "hit" && ev.kind !== "kill") continue;

    const spawn = ev.enemyId === undefined ? undefined : byId.get(ev.enemyId);
    if (!spawn) {
      rejected += 1;
      continue;
    }
    const aliveFrom = spawn.t * 1000 - tolMs;
    const aliveTo = (spawn.t + spawn.crossS) * 1000 + tolMs;
    if (ev.tMs < aliveFrom || ev.tMs > aliveTo || killed.has(spawn.id)) {
      rejected += 1;
      continue;
    }

    if (ev.kind === "hit") {
      if (ev.cause === "arc") {
        if (maxMultiplierAround(chain, ev.tMs, tolMs) < ARC_MIN_MULT) {
          rejected += 1;
          notes.push(`arc hit on #${spawn.id} without arc-level chain`);
          continue;
        }
      } else {
        boltHits += 1;
        if (boltHits > shots) {
          rejected += 1;
          notes.push("more bolt hits than shots");
          continue;
        }
      }
      hitsOn.set(spawn.id, (hitsOn.get(spawn.id) ?? 0) + 1);
      continue;
    }

    // kill
    if ((hitsOn.get(spawn.id) ?? 0) < ENEMIES[spawn.kind].hp) {
      rejected += 1;
      notes.push(`kill on #${spawn.id} without enough hits`);
      continue;
    }
    killed.add(spawn.id);
    kills += 1;
    const mult = multiplierAt(chain, ev.tMs);
    maxMult = Math.max(maxMult, mult);
    score += pointsForKill(spawn.kind, mult);
    if (spawn.kind === "conductor") bossDown = true;
  }

  // Breaches are derived, not reported: anything that walked the full line.
  let breaches = 0;
  for (const s of wave) {
    const end = (s.t + s.crossS) * 1000;
    if (!killed.has(s.id) && end < durMs - tolMs) breaches += 1;
  }
  score = Math.max(0, score - breaches * BREACH_PENALTY);

  const avgFocus = focus.length ? focus.reduce((a, p) => a + p.score, 0) / focus.length : 0;
  const accuracy = shots ? Math.min(100, (boltHits / shots) * 100) : 0;

  return {
    stats: {
      score,
      kills,
      shots,
      hits: boltHits,
      accuracy: round2(accuracy),
      avgFocus: round2(avgFocus),
      bestChainS: round2(chain.best),
      maxMult,
      breaches,
      bossDown,
    },
    rejected,
    notes,
  };
}

// ─── Titles & story chapters ──────────────────────────────────────────
export const RANK_TITLES: readonly (RankTitle & { minScore: number })[] = [
  { id: "fuse-runner", label: "Fuse Runner", chapter: 1, minScore: 0 },
  { id: "lineworker", label: "Lineworker", chapter: 2, minScore: 3800 },
  { id: "arc-warden", label: "Arc Warden", chapter: 3, minScore: 9000 },
  { id: "grid-saint", label: "Grid Saint", chapter: 4, minScore: 16500 },
];

export function titleForScore(score: number): RankTitle {
  let pick = RANK_TITLES[0]!;
  for (const t of RANK_TITLES) if (score >= t.minScore) pick = t;
  return { id: pick.id, label: pick.label, chapter: pick.chapter };
}

export function nextTitle(score: number): (RankTitle & { minScore: number }) | null {
  return RANK_TITLES.find((t) => t.minScore > score) ?? null;
}
