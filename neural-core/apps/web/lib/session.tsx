"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import type { Calibration, SessionState } from "@neural-core/shared";
import { safeGet, safeSet, stationId } from "./config";

export interface SessionPlayer {
  id: number;
  displayId: string;
  fullName: string;
}

export interface Session {
  state: SessionState;
  station: number;
  player: SessionPlayer | null;
  calibration: Calibration | null;
  runId: number | null;
  lastRunId: number | null;
  /** Briefing is shortened for players who have already heard it. */
  briefed: boolean;
  /** State to return to when PAUSED clears. */
  resumeTo: SessionState | null;
}

export type SessionAction =
  | { type: "BEGIN" }
  | { type: "REGISTERED"; player: SessionPlayer }
  | { type: "SENSOR_READY" }
  | { type: "RELAX_DONE" }
  | { type: "CALIBRATED"; calibration: Calibration }
  | { type: "RUN_STARTED"; runId: number }
  | { type: "PLAYING" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "FINISHED"; runId: number }
  | { type: "PLAY_AGAIN" }
  | { type: "RECALIBRATE" }
  | { type: "RESET" }
  | { type: "HYDRATE"; session: Session };

const initial = (station: number): Session => ({
  state: "IDLE",
  station,
  player: null,
  calibration: null,
  runId: null,
  lastRunId: null,
  briefed: false,
  resumeTo: null,
});

/**
 * Kiosk session state machine:
 * IDLE → REGISTER → SENSOR_SETUP → CALIBRATE_RELAX → CALIBRATE_FOCUS → BRIEFING
 *      → PLAYING → RESULT → (play again → BRIEFING) | (reset → IDLE)
 * Any state ⇄ PAUSED.
 */
export function sessionReducer(s: Session, a: SessionAction): Session {
  switch (a.type) {
    case "HYDRATE":
      return a.session;
    case "BEGIN":
      return { ...initial(s.station), state: "REGISTER" };
    case "REGISTERED":
      return { ...s, player: a.player, state: "SENSOR_SETUP", calibration: null, briefed: false };
    case "SENSOR_READY":
      return s.player ? { ...s, state: "CALIBRATE_RELAX" } : s;
    case "RELAX_DONE":
      return s.state === "CALIBRATE_RELAX" ? { ...s, state: "CALIBRATE_FOCUS" } : s;
    case "CALIBRATED":
      return s.player ? { ...s, calibration: a.calibration, state: "BRIEFING" } : s;
    case "RUN_STARTED":
      return { ...s, runId: a.runId, state: "BRIEFING" };
    case "PLAYING":
      return s.runId ? { ...s, state: "PLAYING", briefed: true } : s;
    case "PAUSE":
      return s.state === "PAUSED" ? s : { ...s, resumeTo: s.state, state: "PAUSED" };
    case "RESUME":
      return s.state === "PAUSED" ? { ...s, state: s.resumeTo ?? "PLAYING", resumeTo: null } : s;
    case "FINISHED":
      return { ...s, runId: null, lastRunId: a.runId, state: "RESULT" };
    case "PLAY_AGAIN":
      return s.player ? { ...s, runId: null, state: s.calibration ? "BRIEFING" : "SENSOR_SETUP" } : s;
    case "RECALIBRATE":
      return s.player ? { ...s, calibration: null, state: "SENSOR_SETUP" } : s;
    case "RESET":
      return initial(s.station);
  }
}

const KEY = "nc.session";

interface SessionCtx {
  session: Session;
  dispatch: (a: SessionAction) => void;
  hydrated: boolean;
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, rawDispatch] = useReducer(sessionReducer, 1, initial);
  const [hydrated, setHydrated] = useReducer(() => true, false);

  useEffect(() => {
    const station = stationId();
    const saved = safeGet(KEY, "session");
    let next = initial(station);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Session;
        if (parsed.station === station) next = parsed;
      } catch {
        // Corrupt entry: start clean.
      }
    }
    rawDispatch({ type: "HYDRATE", session: next });
    setHydrated();
  }, []);

  useEffect(() => {
    if (hydrated) safeSet(KEY, JSON.stringify(session), "session");
  }, [session, hydrated]);

  const dispatch = useCallback((a: SessionAction) => rawDispatch(a), []);
  const value = useMemo(() => ({ session, dispatch, hydrated }), [session, dispatch, hydrated]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
