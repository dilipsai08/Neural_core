"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ROUND_DURATION_S, CALIBRATION_FOCUS_S, CALIBRATION_RELAX_S } from "@neural-core/shared";
import { ArenaCanvas } from "@/components/ArenaCanvas";
import { Button } from "@/components/Button";
import { FocusGauge } from "@/components/FocusGauge";
import { Leaderboard } from "@/components/Leaderboard";
import { Panel } from "@/components/Panel";
import { TopBar } from "@/components/TopBar";
import { audio } from "@/lib/audio";
import { stationId } from "@/lib/config";
import { useFocus, useStationStatus } from "@/lib/link";
import { useSession } from "@/lib/session";
import { useLeaderboard } from "@/lib/useLeaderboard";
import styles from "./HomeScreen.module.css";

const STEPS = [
  { n: "01", title: "Wear the headset", body: "A volunteer fits two sensors on your forehead and one behind your ear." },
  { n: "02", title: "Tune the arc", body: `${CALIBRATION_RELAX_S + CALIBRATION_FOCUS_S} seconds: breathe slowly, then count down in sevens.` },
  { n: "03", title: "Hold the line", body: `${ROUND_DURATION_S} seconds. Click to fire. Stay calm and the targets hold still.` },
];

export function HomeScreen() {
  const router = useRouter();
  const { dispatch } = useSession();
  const [station, setStation] = useState(1);
  const { data } = useLeaderboard(5);
  const focus = useFocus(station);
  const status = useStationStatus(station);
  const [arenaFailed, setArenaFailed] = useState<string | null>(null);

  useEffect(() => setStation(stationId()), []);

  const start = () => {
    audio.unlock();
    audio.click();
    dispatch({ type: "BEGIN" });
    router.push("/register/");
  };

  return (
    <main className={styles.screen}>
      {!arenaFailed && <ArenaCanvas mode="attract" onError={setArenaFailed} />}
      <div className={styles.scrim} />
      <TopBar station={station} />

      <div className={styles.layout}>
        <section className={styles.hero}>
          <p className={styles.eyebrow}>
            <span className={styles.liveDot} aria-hidden="true" /> Brain-controlled arena · one {ROUND_DURATION_S}-second shift
          </p>
          <h1 className={styles.title}>
            <span>Neural</span>
            <span className={styles.titleCore}>Core</span>
          </h1>
          <p className={styles.lead}>
            The Neural Core blew at 23:14. Every corpse within two kilometres is walking on stray current, and they
            are heading for the last live transformer. Your headset powers its emitter: <strong>the calmer your mind,
            the cleaner the arc.</strong>
          </p>
          <div className={styles.actions}>
            <Button variant="primary" size="lg" iconAfter="arrowRight" onClick={start}>
              Start your shift
            </Button>
            <span className={styles.duration}>
              <span className="num">≈ 3 min</span> including setup
            </span>
          </div>
          <ol className={styles.steps}>
            {STEPS.map((s) => (
              <li key={s.n} className={styles.step}>
                <span className={`num ${styles.stepN}`}>{s.n}</span>
                <span className={styles.stepTitle}>{s.title}</span>
                <span className={styles.stepBody}>{s.body}</span>
              </li>
            ))}
          </ol>
        </section>

        <aside className={styles.side}>
          <Panel
            label="Tonight's line"
            aside={data ? <span className="num">{data.totalRanked} on the board</span> : null}
            hazard
            screws
            className={styles.board}
          >
            {data ? (
              <Leaderboard entries={data.entries} />
            ) : (
              <p className={styles.muted}>Reading the board…</p>
            )}
          </Panel>
          <Panel tone="sunken" className={styles.live}>
            <FocusGauge value={status?.connected ? (focus?.score ?? null) : null} size={150} />
            <div className={styles.liveText}>
              <span className="label">Headset on this station</span>
              <p>
                {status?.connected
                  ? "Put it on and watch the needle. Calm attention pushes it right."
                  : "Waiting for the headset. A volunteer will connect it."}
              </p>
            </div>
          </Panel>
        </aside>
      </div>

      <footer className={styles.footer}>
        <span>Focus is a relative game score from your EEG, not a medical measurement.</span>
        {arenaFailed && <span className={styles.warn}>{arenaFailed}</span>}
      </footer>
    </main>
  );
}
