// ─── Hardware: BioAmp EXG Pill → Arduino UNO R4 (A0) → USB serial ─────────
export const SAMPLE_RATE_HZ = 250;
/** UNO R4 ADC is set to 14-bit in firmware (analogReadResolution(14)). */
export const ADC_BITS_DEFAULT = 14;
export const ADC_VREF_V = 5;
export const SERIAL_BAUD_DEFAULT = 115200;
/** Raw sample batches forwarded by a bridge (browser or node) per message. */
export const BRIDGE_BATCH_SAMPLES = 10;

// ─── Signal processing ─────────────────────────────────────────────────
export const BANDPASS_LOW_HZ = 0.5;
export const BANDPASS_HIGH_HZ = 45;
/** India mains. Set MAINS_HZ=60 on the API for 60 Hz countries. */
export const NOTCH_HZ_DEFAULT = 50;

export const WINDOW_SIZE_S = 2;
/** 0.25 s hop → one focus frame per hop at the 4 Hz output rate. */
export const WINDOW_HOP_S = 0.25;
/** Welch segment inside the 2 s window (50% overlap → 3 segments). */
export const WELCH_SEGMENT_S = 1;
export const FFT_SIZE = 256;

export const BAND_THETA = [4, 8] as const;
export const BAND_ALPHA = [8, 13] as const;
export const BAND_BETA = [13, 30] as const;
export const BAND_HIGH = [30, 45] as const;

export const FOCUS_EMA_ALPHA = 0.15;
export const FOCUS_OUTPUT_RATE_HZ = 4;
export const BLINK_HOLD_MS = 500;
/** A hop whose peak exceeds this many robust std-devs of the baseline is a blink. */
export const BLINK_SIGMA = 6;
/** Share of 30-45 Hz power above which the window counts as jaw/forehead tension. */
export const TENSION_RATIO = 0.35;
/** Score penalty applied at full tension (scaled by how far past the ratio). */
export const TENSION_PENALTY = 35;

/** Rail: share of samples within 1% of 0 or full scale. */
export const QUALITY_RAIL_SHARE_BAD = 0.05;
/** Flat: std-dev of raw ADC counts in a window (14-bit scale). */
export const QUALITY_FLAT_COUNTS = 2;
/** Mains ratio: power at notch frequency vs 1-45 Hz power, before the notch. */
export const QUALITY_MAINS_RATIO_FAIR = 0.6;
/** No samples for this long → source considered disconnected. */
export const SOURCE_STALE_MS = 1500;

export const CALIBRATION_RELAX_S = 20;
export const CALIBRATION_FOCUS_S = 20;
export const CALIBRATION_LOW_PERCENTILE = 0.1;
export const CALIBRATION_HIGH_PERCENTILE = 0.9;
/** Used when calibration is skipped and no earlier calibration exists today. */
export const DEFAULT_CALIBRATION = { low: 0.35, high: 1.25 } as const;
/** A calibration is rejected if high/low is narrower than this. */
export const CALIBRATION_MIN_SPAN = 0.08;

// ─── Game: "Substation 07" ─────────────────────────────────────────────
export const ROUND_DURATION_S = 60;
export const SIM_HZ = 60;
export const BRIEFING_S = 9;
export const COUNTDOWN_S = 3;

/** Focus at or above this keeps the focus chain alive. */
export const CHAIN_FOCUS_THRESHOLD = 60;
/** A dip below the threshold shorter than this does not break the chain. */
export const CHAIN_GRACE_S = 1.5;
/** Sustained good-focus seconds → points multiplier. */
export const CHAIN_LADDER = [
  { atS: 0, mult: 1 },
  { atS: 4, mult: 2 },
  { atS: 9, mult: 3 },
  { atS: 15, mult: 5 },
  { atS: 23, mult: 8 },
] as const;
/** From this multiplier a kill arcs into the nearest enemy. */
export const ARC_MIN_MULT = 3;
/** From this multiplier the arc forks to two enemies. */
export const ARC_FORK_MULT = 5;

/** Focus below which enemies start to destabilise; 0 distortion at/above. */
export const DISTORTION_FOCUS_CLEAN = 72;
/** Focus at/below which distortion reaches its cap. */
export const DISTORTION_FOCUS_MAX = 15;
/** Distortion is capped so a target is always hittable. */
export const DISTORTION_CAP = 0.9;
/** Client-side smoothing time constant for distortion changes (seconds). */
export const DISTORTION_TAU_S = 0.8;

export const BREACH_PENALTY = 100;
/** Boss shield drops when the chain multiplier is at least this. */
export const BOSS_SHIELD_MULT = 2;
export const BOSS_SPAWN_S = 41;

/** If no focus frame arrives for this long mid-round, the round pauses. */
export const SIGNAL_LOSS_PAUSE_MS = 2500;

// ─── System ────────────────────────────────────────────────────────────
export const LEADERBOARD_DEFAULT_LIMIT = 10;
export const ATTRACT_TOP_N = 5;
export const DISPLAY_ID_PREFIX = "NC-";
export const FOCUS_SAMPLE_STORAGE_HZ = 4;
export const MAX_STATIONS = 8;
/** Kill timing tolerance used by the server when verifying a run. */
export const VERIFY_TIME_TOLERANCE_S = 1.5;
/** Server-held focus history per station (seconds). */
export const FOCUS_HISTORY_S = 600;
