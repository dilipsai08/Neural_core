"use client";

import { useCallback, useEffect, useState } from "react";
import { nextTitle, type RunResult } from "@neural-core/shared";
import { Brand } from "@/components/Brand";
import { Button } from "@/components/Button";
import { FocusChart } from "@/components/FocusChart";
import { Icon } from "@/components/Icon";
import { Panel } from "@/components/Panel";
import { api } from "@/lib/api";
import { audio } from "@/lib/audio";
import { LORE } from "@/lib/lore";
import { flushPendingRuns } from "@/lib/pending";
import { useIdleReset, useKiosk } from "@/lib/useKiosk";
import styles from "./ResultScreen.module.css";

function useCountUp(target: number, ms = 1400): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setV(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

export function ResultScreen() {
  const { router, session, dispatch, hydrated } = useKiosk();
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    if (!session.lastRunId) {
      router.replace("/");
      return;
    }
    void flushPendingRuns();
    api
      .result(session.lastRunId)
      .then(setResult)
      .catch((e: Error) => setError(e.message));
  }, [hydrated, session.lastRunId, router]);

  const done = useCallback(() => {
    dispatch({ type: "RESET" });
    router.replace("/");
  }, [dispatch, router]);

  useIdleReset(75, done);

  const score = useCountUp(result?.run.stats?.score ?? 0);
  if (error) {
    return (
      <main className={styles.screen}>
        <div className={styles.center}>
          <p className={styles.error}>
            <Icon name="alert" /> {error}
          </p>
          <Button onClick={done}>Back to start</Button>
        </div>
      </main>
    );
  }
  if (!result || !result.run.stats) {
    return (
      <main className={styles.screen}>
        <div className={styles.center}>
          <p className="label">Reading the grid log…</p>
        </div>
      </main>
    );
  }

  const s = result.run.stats;
  const isBest = result.personalBest === null || s.score > result.personalBest;
  const upcoming = nextTitle(s.score);
  const lore = LORE.filter((l) => l.chapter <= result.title.chapter);
  const newest = lore[lore.length - 1]!;
  const attemptsLeft = Math.max(0, result.attemptsAllowed - result.attemptsUsed);
  const gap = result.nextAbove ? result.nextAbove.score - s.score : null;

  const again = () => {
    audio.unlock();
    dispatch({ type: "PLAY_AGAIN" });
    router.push("/play/");
  };

  return (
    <main className={styles.screen}>
      <header className={styles.top}>
        <Brand />
        <span className="label">
          Shift report · {result.player.fullName} · <span className="num">{result.player.displayId}</span>
        </span>
      </header>

      <div className={styles.grid}>
        <section className={styles.hero}>
          <span className="label">{result.run.status === "encore" ? "Encore shift · saved, not ranked" : "Grid restored"}</span>
          <div className={styles.scoreRow}>
            <span className={`num ${styles.score}`}>{score.toLocaleString("en-IN")}</span>
            <span className={styles.pts}>pts</span>
          </div>
          <div className={styles.badges}>
            {result.rank !== null && (
              <span className={styles.rank} data-podium={result.rank <= 3}>
                <Icon name="trophy" size={20} /> #{result.rank} of {result.totalRanked} tonight
              </span>
            )}
            {isBest && result.personalBest !== null && <span className={styles.best}>New personal best</span>}
            {!isBest && result.personalBest !== null && (
              <span className={styles.note}>
                Your best <span className="num">{result.personalBest.toLocaleString("en-IN")}</span>
              </span>
            )}
          </div>
          {gap !== null && gap > 0 && result.nextAbove && (
            <p className={styles.gap}>
              <span className="num">{gap.toLocaleString("en-IN")}</span> points behind #{result.nextAbove.rank}{" "}
              {result.nextAbove.name}. One more steady stretch at ×5 would cover it.
            </p>
          )}
        </section>

        <Panel className={styles.title} hazard screws>
          <span className="label">Rank earned</span>
          <h2 className={styles.titleName}>{result.title.label}</h2>
          <p className={styles.titleNext}>
            {upcoming ? (
              <>
                Next: <b>{upcoming.label}</b> at <span className="num">{upcoming.minScore.toLocaleString("en-IN")}</span>
              </>
            ) : (
              "Highest rank on the grid."
            )}
          </p>
          <div className={styles.lore}>
            <span className={styles.loreTitle}>
              <Icon name="radio" size={16} /> {newest.title} unlocked
            </span>
            <p>{newest.body}</p>
          </div>
        </Panel>

        <Panel label="Your focus over the shift" className={styles.chart} aside={<span>shaded = chain running</span>}>
          <FocusChart focus={result.focusTimeline} events={result.events} />
        </Panel>

        <Panel className={styles.stats}>
          <dl className={styles.statGrid}>
            <div>
              <dt>Kills</dt>
              <dd className="num">{s.kills}</dd>
            </div>
            <div>
              <dt>Accuracy</dt>
              <dd className="num">{Math.round(s.accuracy)}%</dd>
            </div>
            <div>
              <dt>Avg focus</dt>
              <dd className="num">{Math.round(s.avgFocus)}</dd>
            </div>
            <div>
              <dt>Longest chain</dt>
              <dd className="num">{s.bestChainS.toFixed(1)}s</dd>
            </div>
            <div>
              <dt>Peak multiplier</dt>
              <dd className="num">×{s.maxMult}</dd>
            </div>
            <div>
              <dt>Breaches</dt>
              <dd className="num" data-bad={s.breaches > 0}>
                {s.breaches}
              </dd>
            </div>
            <div>
              <dt>Conductor</dt>
              <dd>{s.bossDown ? "Down" : "Escaped"}</dd>
            </div>
            <div>
              <dt>Ranked shifts</dt>
              <dd className="num">
                {result.attemptsUsed}/{result.attemptsAllowed}
              </dd>
            </div>
          </dl>
        </Panel>
      </div>

      <footer className={styles.actions}>
        <span className={styles.note}>Focus is a relative game score, not a medical measurement.</span>
        <span className={styles.spacer} />
        <Button variant="ghost" onClick={done}>
          Finish
        </Button>
        <Button
          variant="secondary"
          icon="refresh"
          onClick={() => {
            dispatch({ type: "RECALIBRATE" });
            router.push("/setup/");
          }}
        >
          Recalibrate
        </Button>
        <Button variant="primary" size="lg" iconAfter="arrowRight" onClick={again}>
          {attemptsLeft > 0 ? `Another shift · ${attemptsLeft} ranked left` : "Encore shift"}
        </Button>
      </footer>
    </main>
  );
}
