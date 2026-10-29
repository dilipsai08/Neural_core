"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type LeaderboardResponse } from "./api";
import { useMessages } from "./link";

export function useLeaderboard(limit: number): { data: LeaderboardResponse | null; error: string | null } {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .leaderboard(limit)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [limit]);

  useEffect(() => {
    load();
    // Belt and braces: refresh every 20 s even if a WS event is missed.
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, [load]);

  useMessages((m) => {
    if (m.type === "leaderboard:update") load();
  });

  return { data, error };
}
