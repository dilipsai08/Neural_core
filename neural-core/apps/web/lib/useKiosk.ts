"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { stationId } from "./config";
import { useSession } from "./session";

/**
 * Shared kiosk page plumbing: resolves the station and sends the visitor back
 * to the attract screen if they land on a step without a registered player.
 */
export function useKiosk(opts: { needsPlayer?: boolean } = {}) {
  const router = useRouter();
  const { session, dispatch, hydrated } = useSession();
  const [station, setStation] = useState(1);

  useEffect(() => setStation(stationId()), []);

  useEffect(() => {
    if (hydrated && opts.needsPlayer && !session.player) router.replace("/");
  }, [hydrated, opts.needsPlayer, session.player, router]);

  return { router, session, dispatch, hydrated, station };
}

/** Return to the attract screen after a period without input. */
export function useIdleReset(seconds: number, onIdle: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    let timer = setTimeout(onIdle, seconds * 1000);
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(onIdle, seconds * 1000);
    };
    const events = ["pointerdown", "pointermove", "keydown"] as const;
    events.forEach((e) => window.addEventListener(e, bump));
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, bump));
    };
  }, [seconds, onIdle, enabled]);
}
