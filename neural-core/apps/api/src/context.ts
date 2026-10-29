import type { Response } from "express";
import { DEFAULT_CALIBRATION, type Calibration } from "@neural-core/shared";
import type { Env } from "./env.js";
import type { Hub } from "./ws/index.js";
import { Station } from "./stations/station.js";
import type { Store } from "./store/store.js";

export interface AppContext {
  env: Env;
  store: Store;
  hub: Hub;
  stations: Map<number, Station>;
  logs: string[];
  log: (msg: string) => void;
  station(id: number): Station;
  defaultCalibration(): Calibration;
}

export function createContext(env: Env, store: Store, hubFactory: (ctx: AppContext) => Hub): AppContext {
  const logs: string[] = [];
  const ctx: AppContext = {
    env,
    store,
    stations: new Map<number, Station>(),
    logs,
    log(msg: string) {
      const line = `${new Date().toISOString().slice(11, 19)} ${msg}`;
      console.log(`[neural-core] ${line}`);
      logs.push(line);
      if (logs.length > 200) logs.shift();
    },
    defaultCalibration(): Calibration {
      return store.eventMedianCalibration() ?? { ...DEFAULT_CALIBRATION, source: "default" };
    },
    station(id: number): Station {
      let s = ctx.stations.get(id);
      if (!s) {
        s = new Station(id, {
          hub: ctx.hub,
          mainsHz: env.MAINS_HZ,
          baud: env.SERIAL_BAUD,
          dataDir: env.DATA_DIR,
          defaultCalibration: () => ctx.defaultCalibration(),
          onCalibrated: (station, playerId, c) => store.saveCalibration(station, playerId, c),
          log: (m) => ctx.log(m),
        });
        ctx.stations.set(id, s);
      }
      return s;
    },
    hub: null as unknown as Hub,
  };
  ctx.hub = hubFactory(ctx);
  return ctx;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function sendError(res: Response, err: unknown, log: (m: string) => void): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message }, ...err.extra });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  log(`error: ${message}`);
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong on the server. The operator panel has details." } });
}
