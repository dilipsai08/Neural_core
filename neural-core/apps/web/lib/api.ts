import type {
  Calibration,
  FocusPoint,
  LeaderboardEntry,
  Player,
  RunEvent,
  RunResult,
  RunStats,
  StationStatus,
  VerificationReport,
} from "@neural-core/shared";
import { apiBase } from "./config";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit & { pin?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.pin) headers["x-operator-pin"] = init.pin;
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/api${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  } catch {
    throw new ApiError(0, "OFFLINE", "Can't reach the Neural Core server. Check the network cable or call a volunteer.", {});
  }
  const text = await res.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    const err = (body.error ?? {}) as { code?: string; message?: string };
    throw new ApiError(res.status, err.code ?? "ERROR", err.message ?? res.statusText, body);
  }
  return body as T;
}

const post = <T>(path: string, data?: unknown, pin?: string) =>
  request<T>(path, { method: "POST", body: JSON.stringify(data ?? {}), pin });

export interface PlayerSummary extends Player {
  attemptsUsed: number;
  attemptsAllowed: number;
  personalBest: number | null;
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  totalRanked: number;
  totalRuns: number;
  frozenAt: string | null;
  event: string;
}

export interface FinishResponse {
  runId: number;
  status: string;
  stats: RunStats;
  verification: VerificationReport;
}

export const api = {
  health: () => request<{ ok: boolean; event: string; stations: StationStatus[] }>("/health"),
  station: (id: number) => request<StationStatus>(`/stations/${id}`),
  assign: (station: number, playerId: number) =>
    post<{ status: StationStatus; previousCalibration: Calibration | null }>(`/stations/${station}/assign`, { playerId }),
  calibrate: (station: number, phase: "relax" | "focus") => post<{ ok: true }>(`/stations/${station}/calibration`, { phase }),
  skipCalibration: (station: number) => post<{ calibration: Calibration }>(`/stations/${station}/calibration/skip`),
  usePreviousCalibration: (station: number) =>
    post<{ calibration: Calibration }>(`/stations/${station}/calibration/previous`),
  register: (fullName: string, contactKey: string) =>
    post<Player>("/players", { fullName, contactKey, consent: true }),
  player: (id: number) => request<PlayerSummary>(`/players/${id}`),
  startRun: (playerId: number, station: number) =>
    post<{ runId: number; seed: number; ranked: boolean; calibration: Calibration }>("/runs/start", { playerId, station }),
  go: (runId: number) => post<{ goAt: number }>(`/runs/${runId}/go`),
  finish: (runId: number, data: { events: RunEvent[]; focus: FocusPoint[]; clientScore: number; aborted?: boolean }) =>
    post<FinishResponse>(`/runs/${runId}/finish`, data),
  result: (runId: number) => request<RunResult>(`/runs/${runId}`),
  leaderboard: (limit = 10) => request<LeaderboardResponse>(`/leaderboard?limit=${limit}`),
};

export const operatorApi = {
  state: (pin: string) => request<OperatorState>("/operator/state", { pin }),
  ports: (pin: string) => request<Array<{ path: string; label: string }>>("/operator/serial-ports", { pin }),
  source: (pin: string, station: number, body: { kind: string; port?: string }) =>
    post<StationStatus>(`/operator/stations/${station}/source`, body, pin),
  fake: (pin: string, station: number, target: number | null) =>
    post<StationStatus>(`/operator/stations/${station}/fake`, { target }, pin),
  record: (pin: string, station: number, on: boolean) =>
    post<{ file: string | null }>(`/operator/stations/${station}/record`, { on }, pin),
  command: (pin: string, station: number, action: string) =>
    post<StationStatus>(`/operator/stations/${station}/command`, { action }, pin),
  runStatus: (pin: string, runId: number, status: "valid" | "disqualified" | "redo") =>
    post<{ ok: true }>(`/operator/runs/${runId}/status`, { status }, pin),
  freeze: (pin: string, frozen: boolean) => post<{ frozenAt: string | null }>("/operator/freeze", { frozen }, pin),
  exportUrl: (pin: string) => `${apiBase()}/api/operator/export.csv?pin=${encodeURIComponent(pin)}`,
};

export interface OperatorRun {
  id: number;
  playerId: number;
  station: number;
  status: string;
  ranked: boolean;
  startedAt: string;
  finishedAt: string | null;
  stats: RunStats | null;
  clientScore: number | null;
  verification: VerificationReport | null;
  player?: Player;
}

export interface OperatorState {
  stations: Array<StationStatus & { recording: boolean }>;
  runs: OperatorRun[];
  connections: Array<{ role: string; station: number | null; addr: string }>;
  frozenAt: string | null;
  logs: string[];
  players: number;
  attemptsAllowed: number;
}
