"use client";

import { useCallback, useEffect, useState } from "react";
import { nextTitle, RESULT_CARD_S, TOP3_SHOW_S, type LeaderboardEntry, type RunResult } from "@neural-core/shared";
import { Brand } from "@/components/Brand";
import { Button } from "@/components/Button";
import { FocusChart } from "@/components/FocusChart";
import { Icon } from "@/components/Icon";
import { Leaderboard } from "@/components/Leaderboard";
import { Panel } from "@/components/Panel";
import { api } from "@/lib/api";
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

/** Whole seconds left on a countdown that only runs while `running` is true. */
function useCountdown(seconds: number, running: boolean, onDone: () => void): number {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (!running) return;
    setLeft(seconds);
    const end = Date.now() + seconds * 1000;
    const id = setInterval(() => {
      const s = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) {
        clearInterval(id);
        onDone();
      }
    }, 250);
    return () => clearInterval(id);
  }, [seconds, running, onDone]);
  return left;
}

/** After the shift: score card (skippable) → arc transition → tonight's top 3 → home. */
type Stage = "card" | "leaving" | "top3";

export function ResultScreen() {
  const { router, session, dispatch, hydrated } = useKiosk();
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("card");
  const [top, setTop] = useState<LeaderboardEntry[] | null>(null);

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

  const toTop3 = useCallback(() => {
    setStage((st) => (st === "card" ? "leaving" : st));
    // Fetch now so the board is ready when the arc sweep finishes.
    api
      .leaderboard(3)
      .then((r) => setTop(r.entries))
      .catch(() => setTop([]));
  }, []);

  useEffect(() => {
    if (stage !== "leaving") return;
    const t = setTimeout(() => setStage("top3"), 900);
    return () => clearTimeout(t);
  }, [stage]);

  const cardLeft = useCountdown(RESULT_CARD_S, stage === "card" && !!result?.run.stats, toTop3);
  const homeLeft = useCountdown(TOP3_SHOW_S, stage === "top3", done);

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
  const gap = result.nextAbove ? result.nextAbove.score - s.score : null;

  if (stage === "top3") {
    const inTop = top?.some((e) => e.runId === result.run.id) ?? false;
    return (
      <main className={`${styles.screen} ${styles.podiumScreen}`}>
        <header className={styles.top}>
          <Brand />
          <span className="label">Tonight’s grid · top 3</span>
        </header>
        <section className={styles.podium}>
          <span className="label">Substation 07 · shift log</span>
          <h1 className={styles.podiumTitle}>Top 3 tonight</h1>
          {top === null ? (
            <p className="label">Reading the board…</p>
          ) : (
            <Leaderboard entries={top} size="xl" highlight={result.player.id} empty="The board is empty. Yours is the first shift." />
          )}
          <p className={styles.podiumYou}>
            {inTop ? (
              <>You made the top 3, {result.player.fullName}. The grid remembers.</>
            ) : (
              <>
                {result.player.fullName}: <span className="num">{s.score.toLocaleString("en-IN")}</span> pts
                {result.rank !== null && (
                  <>
                    {" "}
                    · <span className="num">#{result.rank}</span> of {result.totalRanked}
                  </>
                )}
              </>
            )}
          </p>
        </section>
        <footer className={styles.actions}>
          <span className={styles.note}>Focus is a relative game score, not a medical measurement.</span>
          <span className={styles.spacer} />
          <Countdown left={homeLeft} total={TOP3_SHOW_S} label="Back to start in" />
          <Button variant="primary" size="lg" iconAfter="arrowRight" onClick={done}>
            Finish
          </Button>
        </footer>
      </main>
    );
  }

  return (
    <main className={styles.screen} data-leaving={stage === "leaving"}>
      {stage === "leaving" && <div className={styles.sweep} aria-hidden="true" />}
      <header className={styles.top}>
        <Brand />
        <span className="label">
          Shift report · {result.player.fullName} · <span className="num">{result.player.displayId}</span>
        </span>
      </header>

      <div className={styles.grid}>
        <section className={styles.hero}>
          <span className="label">Grid restored</span>
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
              {result.nextAbove.name}. One steady stretch at ×5 would have covered it.
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
              <dt>Shots</dt>
              <dd className="num">{s.shots}</dd>
            </div>
          </dl>
        </Panel>
      </div>

      <footer className={styles.actions}>
        <span className={styles.note}>Focus is a relative game score, not a medical measurement.</span>
        <span className={styles.spacer} />
        <Countdown left={cardLeft} total={RESULT_CARD_S} label="Top 3 in" />
        <Button variant="primary" size="lg" iconAfter="arrowRight" onClick={toTop3} disabled={stage !== "card"}>
          Skip
        </Button>
      </footer>
    </main>
  );
}

function Countdown({ left, total, label }: { left: number; total: number; label: string }) {
  return (
    <span className={styles.countdown} aria-live="off">
      <span>
        {label} <span className="num">{left}</span> s
      </span>
      <span className={styles.countBar}>
        <span style={{ transform: `scaleX(${Math.max(0, left / total)})` }} />
      </span>
    </span>
  );
}
