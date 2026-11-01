"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  wsServerMessageSchema,
  type CalibrationMessage,
  type CommandMessage,
  type FocusFrame,
  type SignalFrame,
  type StationStatus,
  type WsServerMessage,
} from "@neural-core/shared";
import { wsUrl } from "./config";

type Role = "kiosk" | "display" | "operator" | "bridge";
type Listener = (msg: WsServerMessage) => void;

export type LinkState = "connecting" | "open" | "closed";

/**
 * One reconnecting WebSocket per browser tab. Pages subscribe to the
 * messages they need; the link survives client-side navigation so the focus
 * stream never drops between screens.
 */
class FocusLink {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private stateListeners = new Set<() => void>();
  private retryMs = 500;
  private hello: { role: Role; station?: number } | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  state: LinkState = "closed";
  readonly latestFocus = new Map<number, FocusFrame>();
  readonly latestStatus = new Map<number, StationStatus>();

  connect(role: Role, station?: number): void {
    const same = this.hello?.role === role && this.hello?.station === station;
    this.hello = { role, station };
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      if (!same && this.ws.readyState === WebSocket.OPEN) this.sendHello();
      return;
    }
    this.open();
  }

  private open(): void {
    if (typeof window === "undefined") return;
    this.setState("connecting");
    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    ws.onopen = () => {
      this.retryMs = 500;
      this.setState("open");
      this.sendHello();
    };
    ws.onmessage = (ev) => {
      let json: unknown;
      try {
        json = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      const parsed = wsServerMessageSchema.safeParse(json);
      if (!parsed.success) return;
      const msg = parsed.data;
      if (msg.type === "focus") this.latestFocus.set(msg.station, msg);
      if (msg.type === "station") this.latestStatus.set(msg.station, msg.status as unknown as StationStatus);
      for (const l of this.listeners) l(msg);
    };
    ws.onclose = () => {
      this.ws = null;
      this.setState("closed");
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => this.open(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 4000);
    };
    ws.onerror = () => ws.close();
  }

  private sendHello(): void {
    if (this.hello) this.send({ type: "hello", ...this.hello });
  }

  send(data: unknown): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(data));
    return true;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onState(fn: () => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  private setState(s: LinkState): void {
    this.state = s;
    for (const l of this.stateListeners) l();
  }
}

export const link = new FocusLink();

export function useLink(role: Role, station?: number): LinkState {
  useEffect(() => {
    link.connect(role, station);
  }, [role, station]);
  return useSyncExternalStore(
    (cb) => link.onState(cb),
    () => link.state,
    () => "closed" as LinkState,
  );
}

export function useMessages(fn: Listener): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => link.subscribe((m) => ref.current(m)), []);
}

export function useFocus(station: number): FocusFrame | null {
  const [frame, setFrame] = useState<FocusFrame | null>(() => link.latestFocus.get(station) ?? null);
  useMessages((m) => {
    if (m.type === "focus" && m.station === station) setFrame(m);
  });
  return frame;
}

export function useStationStatus(station: number): StationStatus | null {
  const [status, setStatus] = useState<StationStatus | null>(() => link.latestStatus.get(station) ?? null);
  useMessages((m) => {
    if (m.type === "station" && m.station === station) setStatus(m.status as unknown as StationStatus);
  });
  return status;
}

export function useSignal(station: number): SignalFrame | null {
  const [frame, setFrame] = useState<SignalFrame | null>(null);
  useMessages((m) => {
    if (m.type === "signal" && m.station === station) setFrame(m);
  });
  return frame;
}

export function useCalibrationMessages(station: number, fn: (m: CalibrationMessage) => void): void {
  useMessages((m) => {
    if (m.type === "calibration" && m.station === station) fn(m);
  });
}

export function useCommands(station: number, fn: (m: CommandMessage) => void): void {
  useMessages((m) => {
    if (m.type === "command" && m.station === station) fn(m);
  });
}
