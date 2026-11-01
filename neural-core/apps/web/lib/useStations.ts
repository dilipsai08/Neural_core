"use client";

import { useState } from "react";
import type { FocusFrame, StationStatus } from "@neural-core/shared";
import { link, useMessages } from "./link";

/** Every station's status and latest focus frame (for displays and the operator). */
export function useStations(): { statuses: StationStatus[]; focus: Record<number, FocusFrame> } {
  const [statuses, setStatuses] = useState<StationStatus[]>(() => [...link.latestStatus.values()]);
  const [focus, setFocus] = useState<Record<number, FocusFrame>>(() => Object.fromEntries(link.latestFocus));
  useMessages((m) => {
    if (m.type === "station") {
      const st = m.status as unknown as StationStatus;
      setStatuses((prev) => [...prev.filter((p) => p.id !== st.id), st].sort((a, b) => a.id - b.id));
    }
    if (m.type === "focus") setFocus((prev) => ({ ...prev, [m.station]: m }));
  });
  return { statuses, focus };
}
