import { MAX_STATIONS } from "@neural-core/shared";

/**
 * Where the API lives. In production the API serves this app, so it is the
 * same origin. In development Next runs on :3000 and the API on :3001.
 */
export function apiBase(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window === "undefined") return "http://localhost:3001";
  const { protocol, hostname, port } = window.location;
  return port === "3000" ? `${protocol}//${hostname}:3001` : `${protocol}//${window.location.host}`;
}

export function wsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  return apiBase().replace(/^http/, "ws") + "/ws";
}

const STATION_KEY = "nc.station";

/** Each kiosk remembers its station. Set once with ?station=2. */
export function stationId(): number {
  if (typeof window === "undefined") return 1;
  const fromQuery = Number(new URLSearchParams(window.location.search).get("station"));
  if (fromQuery >= 1 && fromQuery <= MAX_STATIONS) {
    safeSet(STATION_KEY, String(fromQuery));
    return fromQuery;
  }
  const stored = Number(safeGet(STATION_KEY));
  return stored >= 1 && stored <= MAX_STATIONS ? stored : 1;
}

export function safeGet(key: string, storage: "local" | "session" = "local"): string | null {
  try {
    return (storage === "local" ? window.localStorage : window.sessionStorage).getItem(key);
  } catch {
    return null;
  }
}

export function safeSet(key: string, value: string | null, storage: "local" | "session" = "local"): void {
  try {
    const s = storage === "local" ? window.localStorage : window.sessionStorage;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
  } catch {
    // Private mode or storage disabled: the kiosk still works for this page view.
  }
}
