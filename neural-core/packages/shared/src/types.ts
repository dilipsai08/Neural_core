// ─── Session States ───────────────────────────────────────────────────
export const SESSION_STATES = [
  "IDLE",
  "REGISTER",
  "SENSOR_SETUP",
  "CALIBRATE_RELAX",
  "CALIBRATE_FOCUS",
  "PRACTICE",
  "PLAYING",
  "RESULT",
  "PAUSED",
] as const;

export type SessionState = (typeof SESSION_STATES)[number];

// ─── Focus & Signal ───────────────────────────────────────────────────
export type SignalQuality = "good" | "fair" | "bad";
export type ArtifactType = "none" | "blink" | "tension";

export interface FocusFrame {
  type: "focus";
  t: number;          // server ms timestamp
  score: number;      // 0-100, smoothed
  raw: number;        // 0-100, unsmoothed
  quality: SignalQuality;
  artifact: ArtifactType;
}

export interface FocusSample {
  t: number;
  uv: number;
}

export interface FocusSource {
  start(): Promise<void>;
  stop(): Promise<void>;
  onSample(cb: (s: FocusSample) => void): void;
}

export type SensorSourceType = "serial" | "fake" | "replay";

// ─── Database Entities ────────────────────────────────────────────────
export interface Player {
  id: number;
  displayId: string;
  fullName: string;
  contactKey: string;
  consentAt: string;
  createdAt: string;
}

export type RunStatus = "valid" | "redo" | "disqualified" | "aborted";

export interface Run {
  id: number;
  playerId: number;
  status: RunStatus;
  score: number;
  accuracy: number;
  avgFocus: number;
  bestStreakS: number;
  seed: number;
  calibration: { low: number; high: number };
  startedAt: string;
  finishedAt: string | null;
}

export type RunEventKind = "hit" | "miss" | "zen_shot" | "distraction";

export interface RunEvent {
  id: number;
  runId: number;
  tMs: number;
  kind: RunEventKind;
  focus: number;
  data: Record<string, unknown> | null;
}

export interface LeaderboardEntry {
  rank: number;
  playerId: number;
  displayId: string;
  fullName: string;
  score: number;
  avgFocus: number;
  accuracy: number;
}

// ─── Gameplay Types ───────────────────────────────────────────────────
export type EnemyType = "grunt" | "phantom" | "sniper" | "boss";
export type FocusTier = "scattered" | "engaged" | "locked";
