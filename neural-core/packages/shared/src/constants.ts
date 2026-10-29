// ─── Signal Processing Constants (from info.md) ──────────────────────────
export const SAMPLE_RATE_HZ = 250;
export const ADC_GAIN_UV = 1.0;

export const BANDPASS_LOW_HZ = 0.5;
export const BANDPASS_HIGH_HZ = 45;
export const NOTCH_HZ = 50;

export const WINDOW_SIZE_S = 2;
export const WINDOW_HOP_S = 0.5;

export const BAND_THETA = [4, 8] as const;
export const BAND_ALPHA = [8, 13] as const;
export const BAND_BETA = [13, 30] as const;
export const BAND_HIGH = [30, 45] as const;

export const FOCUS_EMA_ALPHA = 0.15;
export const FOCUS_OUTPUT_RATE_HZ = 4;
export const BLINK_HOLD_MS = 500;

export const CALIBRATION_RELAX_S = 30;
export const CALIBRATION_FOCUS_S = 30;
export const CALIBRATION_LOW_PERCENTILE = 0.1;
export const CALIBRATION_HIGH_PERCENTILE = 0.9;

// ─── Gameplay Constants ───────────────────────────────────────────────
export const ROUND_DURATION_S = 90;
export const PRACTICE_DURATION_S = 45;
export const BOSS_PHASE_REMAINING_S = 20;

export const FOCUS_TIER_SCATTERED = 40;
export const FOCUS_TIER_ENGAGED = 70;

export const MULTIPLIER_SCATTERED = 1;
export const MULTIPLIER_ENGAGED = 2;
export const MULTIPLIER_LOCKED = 3;

export const ENEMY_POINTS = {
  grunt: 100,
  phantom: 150,
  sniper: 200,
  boss: 500,
} as const;

export const JITTER_MIN = 0.05;
export const JITTER_MAX = 0.6;

export const ZEN_CHARGE_DURATION_S = 8;
export const ZEN_SHOT_DURATION_S = 3;

// ─── System & UI Constants ───────────────────────────────────────────
export const LEADERBOARD_DEFAULT_LIMIT = 10;
export const ATTRACT_TOP_N = 5;
export const OPERATOR_PIN_LENGTH = 4;
export const DISPLAY_ID_PREFIX = "NC-";
export const FOCUS_SAMPLE_STORAGE_HZ = 4;
