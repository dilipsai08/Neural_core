import { describe, expect, it } from "vitest";
import { createSeededRng, noise1, seededWeighted } from "./rng.js";

describe("rng", () => {
  it("mulberry32 is deterministic and in [0, 1)", () => {
    const a = createSeededRng(99);
    const b = createSeededRng(99);
    for (let i = 0; i < 1000; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("weighted pick respects weights", () => {
    const rng = createSeededRng(5);
    let hits = 0;
    for (let i = 0; i < 2000; i++) if (seededWeighted(rng, { a: 0.9, b: 0.1 }) === "a") hits++;
    expect(hits / 2000).toBeGreaterThan(0.85);
  });

  it("noise is smooth and bounded", () => {
    for (let x = 0; x < 20; x += 0.01) {
      const v = noise1(3, x);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      expect(Math.abs(noise1(3, x + 0.01) - v)).toBeLessThan(0.05);
    }
  });
});
