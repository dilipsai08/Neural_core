// ─── Kiosk session ─────────────────────────────────────────────────────
export const SESSION_STATES = [
  "IDLE",
  "REGISTER",
  "SENSOR_SETUP",
  "CALIBRATE_RELAX",
  "CALIBRATE_FOCUS",
  "BRIEFING",
  "PLAYING",
  "PAUSED",
  "RESULT",
] as const;
export type SessionState = (typeof SESSION_STATES)[number];

// ─── Focus & signal ────────────────────────────────────────────────────
export type SignalQuality = "good" | "fair" | "bad";
export type ArtifactType = "none" | "blink" | "tension";

export interface FocusFrame {
  type: "focus";
  station: number;
  t: number; // server ms timestamp
  score: number; // 0-100, smoothed
  raw: number; // 0-100, unsmoothed
  quality: SignalQuality;
  artifact: ArtifactType;
}

export interface BandPowers {
  theta: number;
  alpha: number;
  beta: number;
  high: number;
}

/** Live telemetry for the sensor setup screen (2 Hz). */
export interface SignalFrame {
  type: "signal";
  station: number;
  t: number;
  /** Filtered µV-proportional samples, decimated to 50 Hz. */
  wave: number[];
  bands: BandPowers;
  index: number;
  quality: SignalQuality;
  mainsRatio: number;
  railShare: number;
}

export interface RawSample {
  t: number;
  /** Raw ADC counts. */
  counts: number;
}

export interface FocusSource {
  readonly kind: SourceKind;
  start(): Promise<void>;
  stop(): Promise<void>;
  onSample(cb: (s: RawSample) => void): void;
  /** Full scale of the ADC counts this source produces. */
  readonly adcMax: number;
}

export type SourceKind = "none" | "serial" | "bridge" | "fake" | "replay";

export interface Calibration {
  low: number;
  high: number;
  source: "measured" | "default" | "event-median" | "previous";
}

export type CalibrationPhase = "relax" | "focus";

export interface StationStatus {
  id: number;
  label: string;
  source: SourceKind;
  sourceDetail: string;
  connected: boolean;
  quality: SignalQuality;
  lastFrameAt: number | null;
  calibration: Calibration | null;
  calibrating: CalibrationPhase | null;
  playerId: number | null;
  runId: number | null;
  paused: boolean;
  fakeTarget: number | null;
}

// ─── Persistence ───────────────────────────────────────────────────────
export interface Player {
  id: number;
  displayId: string;
  fullName: string;
  contactKey: string;
  consentAt: string;
  createdAt: string;
}

export type RunStatus = "active" | "valid" | "encore" | "redo" | "disqualified" | "aborted";

export interface RunStats {
  score: number;
  kills: number;
  shots: number;
  hits: number;
  accuracy: number; // 0-100
  avgFocus: number; // 0-100
  bestChainS: number;
  maxMult: number;
  breaches: number;
  bossDown: boolean;
}

export interface Run {
  id: number;
  playerId: number;
  station: number;
  status: RunStatus;
  /** False once the player has used their ranked attempts ("encore" runs). */
  ranked: boolean;
  seed: number;
  calibration: Calibration;
  startedAt: string;
  goAt: number | null; // server ms when the 60 s clock started
  finishedAt: string | null;
  stats: RunStats | null;
  clientScore: number | null;
  verification: VerificationReport | null;
}

export type RunEventKind = "shot" | "hit" | "kill" | "breach" | "deflect";

export interface RunEvent {
  tMs: number;
  kind: RunEventKind;
  enemyId?: number;
  cause?: "bolt" | "arc";
  focus: number;
}

export interface FocusPoint {
  /** Run clock (pauses excluded). */
  tMs: number;
  score: number;
  /** Server timestamp of the frame this point came from, for verification. */
  frameT: number;
}

export interface VerificationReport {
  ok: boolean;
  serverScore: number;
  clientScore: number;
  rejectedEvents: number;
  notes: string[];
}

export interface LeaderboardEntry {
  rank: number;
  playerId: number;
  displayId: string;
  fullName: string;
  runId: number;
  score: number;
  avgFocus: number;
  accuracy: number;
  maxMult: number;
  title: string;
  station: number;
  finishedAt: string;
}

export interface RunResult {
  run: Run;
  player: Player;
  rank: number | null;
  totalRanked: number;
  title: RankTitle;
  focusTimeline: FocusPoint[];
  events: RunEvent[];
  personalBest: number | null;
  nextAbove: { rank: number; score: number; name: string } | null;
  attemptsUsed: number;
  attemptsAllowed: number;
}

export interface RankTitle {
  id: "fuse-runner" | "lineworker" | "arc-warden" | "grid-saint";
  label: string;
  chapter: number;
}

// ─── Game ──────────────────────────────────────────────────────────────
export type EnemyKind = "shambler" | "sparker" | "brute" | "wraith" | "conductor";

export interface EnemySpec {
  kind: EnemyKind;
  hp: number;
  points: number;
  /** Seconds to walk from the left edge to the breach line at a steady pace. */
  crossS: number;
  /** Visual scale relative to a shambler. */
  scale: number;
}

export interface SpawnEntry {
  id: number;
  kind: EnemyKind;
  t: number; // seconds into the round
  lane: number; // 0 = nearest
  crossS: number;
  noiseSeed: number;
}
