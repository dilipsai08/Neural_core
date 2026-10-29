import { DISPLAY_ID_PREFIX } from "./constants.js";

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Map an engagement index onto 0-100 using a player's calibration. */
export function mapFocusScore(index: number, low: number, high: number): number {
  if (high <= low) return 50;
  return clamp(((index - low) / (high - low)) * 100, 0, 100);
}

export type FocusBand = "scattered" | "drifting" | "steady" | "locked";

export function focusBand(score: number): FocusBand {
  if (score < 35) return "scattered";
  if (score < 60) return "drifting";
  if (score < 80) return "steady";
  return "locked";
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = clamp((sorted.length - 1) * p, 0, sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

export function formatDisplayId(num: number): string {
  return `${DISPLAY_ID_PREFIX}${String(num).padStart(3, "0")}`;
}
