"use client";

import { api, ApiError, type FinishResponse } from "./api";
import { safeGet, safeSet } from "./config";
import type { ArenaResult } from "@/game/arena";

const KEY = "nc.pendingRuns";

type Pending = Record<string, ArenaResult & { aborted?: boolean }>;

function read(): Pending {
  try {
    return JSON.parse(safeGet(KEY) ?? "{}") as Pending;
  } catch {
    return {};
  }
}

/**
 * A finished run is written to localStorage before it is sent, and removed
 * only once the server confirms. A dropped network never loses a shift.
 */
export async function submitRun(runId: number, result: ArenaResult, aborted = false): Promise<FinishResponse> {
  const all = read();
  all[runId] = { ...result, aborted };
  safeSet(KEY, JSON.stringify(all));
  let delay = 800;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await api.finish(runId, { ...result, aborted });
      forget(runId);
      return res;
    } catch (e) {
      // 4xx means the server has already decided (e.g. the run was closed): stop retrying.
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        forget(runId);
        throw e;
      }
      if (attempt >= 6) throw e;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 8000);
    }
  }
}

function forget(runId: number): void {
  const all = read();
  delete all[runId];
  safeSet(KEY, JSON.stringify(all));
}

/** Retry anything left over from a previous page load. */
export async function flushPendingRuns(): Promise<void> {
  for (const [id, r] of Object.entries(read())) {
    try {
      await submitRun(Number(id), r, r.aborted);
    } catch {
      // Kept for the next attempt.
    }
  }
}
