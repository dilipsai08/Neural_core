import { describe, expect, it } from "vitest";
import { FocusProcessor, FocusScorer, type Analysis } from "./processor.js";
import { parseSerialLine } from "./serial-protocol.js";

const FS = 250;
const MAX = 16383;

function run(seconds: number, gen: (t: number, i: number) => number): Analysis[] {
  const p = new FocusProcessor({ fs: FS, adcMax: MAX, mainsHz: 50 });
  const out: Analysis[] = [];
  for (let i = 0; i < seconds * FS; i++) {
    const a = p.push(Math.round(MAX / 2 + gen(i / FS, i)));
    if (a) out.push(a);
  }
  return out;
}

let seed = 7;
const noise = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647 - 0.5;
};
const eeg = (beta: number, alpha: number) => (t: number) =>
  alpha * Math.sin(2 * Math.PI * 10 * t) + 0.7 * alpha * Math.sin(2 * Math.PI * 6 * t) + beta * Math.sin(2 * Math.PI * 20 * t) + noise() * 6;

describe("FocusProcessor", () => {
  it("emits four analyses per second after settling", () => {
    const out = run(6, eeg(10, 10));
    expect(out.length).toBeGreaterThanOrEqual(14);
    expect(out.length).toBeLessThanOrEqual(18);
  });

  it("engagement index rises with beta", () => {
    const calm = run(5, eeg(4, 20)).at(-1)!;
    const focused = run(5, eeg(20, 6)).at(-1)!;
    expect(focused.index).toBeGreaterThan(calm.index * 4);
    expect(focused.quality).toBe("good");
  });

  it("flags a flat line and a railed signal as bad", () => {
    expect(run(4, () => 0).at(-1)!.quality).toBe("bad");
    expect(run(4, () => -MAX).at(-1)!.quality).toBe("bad");
  });

  it("warns about heavy mains hum but keeps the bands clean", () => {
    const clean = run(5, eeg(8, 8)).at(-1)!;
    const a = run(5, (t) => eeg(8, 8)(t) + 200 * Math.sin(2 * Math.PI * 50 * t)).at(-1)!;
    expect(a.quality).toBe("fair");
    expect(a.mainsRatio).toBeGreaterThan(3);
    // The notch removes the hum: the engagement index barely moves.
    expect(Math.abs(a.index - clean.index) / clean.index).toBeLessThan(0.15);
  });

  it("detects a blink", () => {
    const out = run(5, (t) => eeg(8, 8)(t) + (t > 4.6 && t < 4.85 ? 300 * Math.sin(Math.PI * (t - 4.6) * 4) : 0));
    expect(out.some((a) => a.artifact === "blink")).toBe(true);
  });

  it("detects jaw tension", () => {
    const a = run(5, (t) => eeg(6, 6)(t) + 60 * Math.sin(2 * Math.PI * 38 * t)).at(-1)!;
    expect(a.artifact).toBe("tension");
  });
});

describe("noise robustness", () => {
  it("removes 100 Hz mains harmonic as well as 50 Hz", () => {
    const clean = run(5, eeg(8, 8)).at(-1)!;
    const humm = run(5, (t) => eeg(8, 8)(t) + 150 * Math.sin(2 * Math.PI * 50 * t) + 80 * Math.sin(2 * Math.PI * 100 * t)).at(-1)!;
    expect(Math.abs(humm.index - clean.index) / clean.index).toBeLessThan(0.15);
  });

  it("is not thrown by electrical spikes", () => {
    const clean = run(5, eeg(8, 8)).at(-1)!;
    // Two short, huge spikes per second (switching noise, cable knocks).
    const spiky = run(5, (t, i) => eeg(8, 8)(t) + (i % 125 === 0 ? 2500 : 0)).at(-1)!;
    expect(spiky.index / clean.index).toBeGreaterThan(0.6);
    expect(spiky.index / clean.index).toBeLessThan(1.6);
  });
});

describe("FocusScorer", () => {
  const base: Analysis = {
    tMs: 0, bands: { theta: 1, alpha: 1, beta: 1, high: 0 }, index: 1, artifact: "none", highRatio: 0,
    quality: "good", mainsRatio: 0, railShare: 0, wave: [],
  };

  it("maps through calibration, ignores a single noisy window and smooths", () => {
    const s = new FocusScorer({ low: 0.5, high: 1.5, source: "measured" });
    for (let i = 0; i < 5; i++) s.next({ ...base, tMs: i * 250, index: 1.5 });
    expect(s.next({ ...base, tMs: 1250, index: 1.5 }).score).toBe(100);
    // One wild window (EM spike) does not move the score: the median rejects it.
    expect(s.next({ ...base, tMs: 1500, index: 0.5 }).raw).toBe(100);
    // A sustained change does, smoothly.
    let last = 100;
    for (let i = 0; i < 6; i++) last = s.next({ ...base, tMs: 1750 + i * 250, index: 0.5 }).score;
    expect(last).toBeLessThan(80);
    expect(last).toBeGreaterThan(20);
  });

  it("holds the score while the signal is unusable", () => {
    const s = new FocusScorer({ low: 0.5, high: 1.5, source: "measured" });
    for (let i = 0; i < 5; i++) s.next({ ...base, tMs: i * 250, index: 1.3 });
    const held = s.next({ ...base, tMs: 1250, index: 0.1, quality: "bad" });
    expect(held.score).toBeGreaterThan(75);
  });

  it("holds the score through a blink", () => {
    const s = new FocusScorer({ low: 0.5, high: 1.5, source: "measured" });
    s.next({ ...base, index: 1.3 });
    const held = s.next({ ...base, tMs: 250, index: 0.2, artifact: "blink" });
    expect(held.score).toBe(80);
  });

  it("penalises tension", () => {
    const s = new FocusScorer({ low: 0.5, high: 1.5, source: "measured" });
    expect(s.next({ ...base, index: 1.5, artifact: "tension", highRatio: 0.6 }).raw).toBeLessThan(80);
  });
});

describe("serial protocol", () => {
  it("parses samples, headers and junk", () => {
    expect(parseSerialLine("8231\r")).toEqual({ kind: "sample", counts: 8231 });
    expect(parseSerialLine("#NC1 fs=250 bits=14 board=UNO_R4")).toMatchObject({ kind: "header", bits: 14, fs: 250 });
    expect(parseSerialLine("hello")).toEqual({ kind: "ignored" });
    expect(parseSerialLine("-5")).toEqual({ kind: "ignored" });
  });
});
