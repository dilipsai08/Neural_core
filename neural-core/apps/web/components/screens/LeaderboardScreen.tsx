"use client";

import { useEffect, useRef, useState } from "react";
import { Brand } from "@/components/Brand";
import { FocusGauge } from "@/components/FocusGauge";
import { Leaderboard } from "@/components/Leaderboard";
import { Panel } from "@/components/Panel";
import { api } from "@/lib/api";
import { useLink } from "@/lib/link";
import { useLeaderboard } from "@/lib/useLeaderboard";
import { useStations } from "@/lib/useStations";
import styles from "./LeaderboardScreen.module.css";

/** Projector view: top 10, live station focus, freeze state. Built for reading from across a hall. */
export function LeaderboardScreen() {
  const linkState = useLink("display");
  const { data, error } = useLeaderboard(10);
  const { statuses, focus } = useStations();
  const [names, setNames] = useState<Record<number, string>>({});
  const requested = useRef(new Set<number>());

  const active = statuses.filter((s) => s.runId !== null && s.playerId !== null);

  useEffect(() => {
    for (const s of active) {
      const id = s.playerId!;
      if (requested.current.has(id)) continue;
      requested.current.add(id);
      api
        .player(id)
        .then((p) => setNames((n) => ({ ...n, [id]: p.fullName })))
        .catch(() => undefined);
    }
  }, [active]);

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <Brand />
        <div className={styles.headline}>
          <span className="label">{data?.event ?? "Neural Core"} · live</span>
          <h1 className={styles.title}>Who held the line</h1>
        </div>
        <div className={styles.chips}>
          <span className={styles.chip}>
            <span className="num">{data?.totalRanked ?? 0}</span> on the board
          </span>
          <span className={styles.chip}>
            <span className="num">{data?.totalRuns ?? 0}</span> shifts
          </span>
          {linkState !== "open" && <span className={styles.chipWarn}>Reconnecting</span>}
        </div>
      </header>

      {data?.frozenAt && (
        <div className={styles.frozen}>
          Board frozen at {new Date(data.frozenAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Winners
          coming up.
        </div>
      )}

      <div className={styles.body}>
        <section className={styles.board}>
          {error && !data ? (
            <p className={styles.muted}>Can’t reach the grid server. Retrying…</p>
          ) : (
            <Leaderboard entries={data?.entries ?? []} size="xl" empty="The board is empty. The first shift of the night sets the bar." />
          )}
        </section>

        <aside className={styles.side}>
          <Panel label="On shift now" hazard screws className={styles.live}>
            {active.length === 0 ? (
              <p className={styles.muted}>Stations are between players.</p>
            ) : (
              <ul className={styles.stations}>
                {active.map((s) => (
                  <li key={s.id}>
                    <FocusGauge value={focus[s.id]?.score ?? null} size={150} />
                    <div>
                      <span className="label">{s.label}</span>
                      <p className={styles.player}>{names[s.playerId!] ?? "Player"}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel tone="sunken" className={styles.how}>
            <p>
              <b>How it works.</b> A forehead EEG sensor turns attention into a 0–100 focus score. Calm, sustained focus
              steadies the targets and chains score multipliers up to ×8.
            </p>
          </Panel>
        </aside>
      </div>
    </main>
  );
}
