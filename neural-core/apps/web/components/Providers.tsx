"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { stationId } from "@/lib/config";
import { useCommands } from "@/lib/link";
import { readBackup } from "@/lib/localBackup";
import { SessionProvider, useSession } from "@/lib/session";

const NON_KIOSK = ["/operator", "/leaderboard", "/winners"];

/** Operator "Next player" (and "Abort" outside a shift) sends this kiosk back to the start. */
function KioskCommands() {
  const router = useRouter();
  const pathname = usePathname();
  const { dispatch } = useSession();
  const [station, setStation] = useState(1);
  useEffect(() => setStation(stationId()), []);

  const isKiosk = !NON_KIOSK.some((p) => pathname.startsWith(p));
  useCommands(station, (c) => {
    if (!isKiosk) return;
    if (c.action === "reset" || (c.action === "abort" && !pathname.startsWith("/play"))) {
      dispatch({ type: "RESET" });
      router.replace("/");
    }
  });
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  // Delete backup entries older than 24 h on load and every hour after.
  useEffect(() => {
    void readBackup();
    const id = setInterval(() => void readBackup(), 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <SessionProvider>
      <KioskCommands />
      {children}
    </SessionProvider>
  );
}
