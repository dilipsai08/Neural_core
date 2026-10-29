import {
  FOCUS_TIER_SCATTERED,
  FOCUS_TIER_ENGAGED,
  MULTIPLIER_SCATTERED,
  MULTIPLIER_ENGAGED,
  MULTIPLIER_LOCKED,
  DISPLAY_ID_PREFIX,
} from "./constants.js";
import type { FocusTier } from "./types.js";

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function mapFocusScore(index: number, low: number, high: number): number {
  if (high <= low) return 50;
  return clamp(((index - low) / (high - low)) * 100, 0, 100);
}

export function getFocusTier(score: number): FocusTier {
  if (score < FOCUS_TIER_SCATTERED) return "scattered";
  if (score < FOCUS_TIER_ENGAGED) return "engaged";
  return "locked";
}

export function getFocusMultiplier(score: number): number {
  const tier = getFocusTier(score);
  switch (tier) {
    case "scattered":
      return MULTIPLIER_SCATTERED;
    case "engaged":
      return MULTIPLIER_ENGAGED;
    case "locked":
      return MULTIPLIER_LOCKED;
  }
}

export function formatDisplayId(num: number): string {
  return `${DISPLAY_ID_PREFIX}${String(num).padStart(3, "0")}`;
}
