import { describe, expect, it } from "vitest";
import {
  ChainTracker,
  ENEMIES,
  buildChainTimeline,
  distortionFor,
  generateWave,
  multiplierAt,
  multiplierForChain,
  scoreRun,
  titleForScore,
} from "./game-rules.js";
import { BOSS_SPAWN_S, BREACH_PENALTY, DISTORTION_CAP, ROUND_DURATION_S } from "./constants.js";
import type { FocusPoint, RunEvent } from "./types.js";

const steady = (score: number, seconds = ROUND_DURATION_S): FocusPoint[] =>
  Array.from({ length: seconds * 4 + 1 }, (_, i) => ({ tMs: i * 250, score, frameT: 1000 + i * 250 }));

describe("generateWave", () => {
  it("is deterministic for a seed", () => {
    expect(generateWave(7)).toEqual(generateWave(7));
    expect(generateWave(7)).not.toEqual(generateWave(8));
  });

  it("spawns one conductor and keeps ids unique", () => {
    const wave = generateWave(42);
    expect(wave.filter((s) => s.kind === "conductor")).toHaveLength(1);
    expect(wave.find((s) => s.kind === "conductor")!.t).toBe(BOSS_SPAWN_S);
    expect(new Set(wave.map((s) => s.id)).size).toBe(wave.length);
    expect(wave.every((s) => s.t >= 0 && s.t < ROUND_DURATION_S)).toBe(true);
  });
});

describe("focus chain", () => {
  it("climbs the ladder with sustained focus", () => {
    expect(multiplierForChain(0)).toBe(1);
    expect(multiplierForChain(4)).toBe(2);
    expect(multiplierForChain(9)).toBe(3);
    expect(multiplierForChain(15)).toBe(5);
    expect(multiplierForChain(40)).toBe(8);
  });

  it("forgives a short dip but breaks on a long one", () => {
    const c = new ChainTracker();
    for (let t = 0; t <= 10; t += 0.25) c.push(t, 80);
    expect(c.state().mult).toBe(3);
    c.push(10.25, 20);
    c.push(11, 20);
    expect(c.state().alive).toBe(true);
    c.push(12, 20);
    expect(c.state()).toMatchObject({ alive: false, mult: 1 });
  });

  it("timeline lookup matches the live tracker", () => {
    const tl = buildChainTimeline(steady(75, 20));
    expect(multiplierAt(tl, 3_000)).toBe(1);
    expect(multiplierAt(tl, 9_500)).toBe(3);
    expect(multiplierAt(tl, 16_000)).toBe(5);
  });
});

describe("distortion", () => {
  it("is zero when locked in and capped when scattered", () => {
    expect(distortionFor(90)).toBe(0);
    expect(distortionFor(0)).toBeCloseTo(DISTORTION_CAP);
    expect(distortionFor(40)).toBeGreaterThan(distortionFor(60));
  });
});

describe("scoreRun", () => {
  const seed = 1234;
  const wave = generateWave(seed);

  function killAll(focus: number): { events: RunEvent[]; focus: FocusPoint[] } {
    const events: RunEvent[] = [];
    for (const s of wave) {
      const t = Math.round((s.t + 1) * 1000);
      for (let i = 0; i < ENEMIES[s.kind].hp; i++) {
        events.push({ tMs: t, kind: "shot", focus });
        events.push({ tMs: t, kind: "hit", enemyId: s.id, cause: "bolt", focus });
      }
      events.push({ tMs: t, kind: "kill", enemyId: s.id, focus });
    }
    return { events, focus: steady(focus) };
  }

  it("rewards sustained focus with a much higher score", () => {
    const calm = scoreRun({ seed, ...killAll(85) });
    const scattered = scoreRun({ seed, ...killAll(20) });
    expect(calm.rejected).toBe(0);
    expect(calm.stats.kills).toBe(wave.length);
    expect(calm.stats.breaches).toBe(0);
    expect(calm.stats.maxMult).toBe(8);
    expect(calm.stats.score).toBeGreaterThan(scattered.stats.score * 3);
    expect(titleForScore(calm.stats.score).id).toBe("grid-saint");
  });

  it("rejects kills without hits, unknown enemies and duplicates", () => {
    const events: RunEvent[] = [
      { tMs: 3000, kind: "kill", enemyId: wave[0]!.id, focus: 50 },
      { tMs: 3000, kind: "kill", enemyId: 9999, focus: 50 },
    ];
    const out = scoreRun({ seed, events, focus: steady(50) });
    expect(out.stats.kills).toBe(0);
    expect(out.rejected).toBe(2);
  });

  it("rejects arc hits when the chain never reached arc level", () => {
    const s = wave[0]!;
    const events: RunEvent[] = [{ tMs: (s.t + 1) * 1000, kind: "hit", enemyId: s.id, cause: "arc", focus: 30 }];
    expect(scoreRun({ seed, events, focus: steady(30) }).rejected).toBe(1);
  });

  it("derives breaches and never goes negative", () => {
    const out = scoreRun({ seed, events: [], focus: steady(50) });
    expect(out.stats.breaches).toBeGreaterThan(5);
    expect(out.stats.score).toBe(0);
    expect(BREACH_PENALTY).toBeGreaterThan(0);
  });
});
