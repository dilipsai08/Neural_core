"use client";

import { useEffect, useRef, useState } from "react";
import type { LeaderboardEntry } from "@neural-core/shared";
import { Brand } from "@/components/Brand";
import { audio } from "@/lib/audio";
import { useLeaderboard } from "@/lib/useLeaderboard";
import styles from "./WinnersScreen.module.css";

const ORDER = [2, 1, 0] as const; // reveal third, then second, then first
const PLACE = ["Grid Saint of the night", "Runner-up", "Third place"];
const METAL = ["gold", "silver", "bronze"] as const;

/** End-of-day reveal. Space, Enter or a click reveals the next place. */
export function WinnersScreen() {
  const { data } = useLeaderboard(3);
  const [shown, setShown] = useState(0);
  const shownRef = useRef(0);
  const top: LeaderboardEntry[] = data?.entries ?? [];

  useEffect(() => {
    const set = (n: number) => {
      shownRef.current = n;
      setShown(n);
    };
    const next = () => {
      audio.unlock();
      const n = Math.min(3, shownRef.current + 1);
      if (n === shownRef.current) return;
      if (n === 3) audio.surge();
      else audio.chainUp(n + 1);
      set(n);
    };
    const key = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "Enter" || e.code === "ArrowRight") next();
      if (e.code === "Backspace" || e.code === "ArrowLeft") set(Math.max(0, shownRef.current - 1));
    };
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", next);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("pointerdown", next);
    };
  }, []);

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <Brand />
        <span className="label">Final standings{data?.frozenAt ? " · board frozen" : ""}</span>
      </header>
      <h1 className={styles.title}>The steadiest minds tonight</h1>

      <div className={styles.podium}>
        {[1, 0, 2].map((place) => {
          const e = top[place];
          const revealed = ORDER.slice(0, shown).includes(place as 0 | 1 | 2);
          return (
            <div key={place} className={styles.column} data-place={place + 1} data-revealed={revealed}>
              <div className={styles.card}>
                {revealed && e ? (
                  <>
                    <span className="label">{PLACE[place]}</span>
                    <p className={styles.name}>{e.fullName}</p>
                    <p className={`num ${styles.score}`}>{e.score.toLocaleString("en-IN")}</p>
                    <p className={styles.meta}>
                      {e.title} · avg focus {Math.round(e.avgFocus)} · best ×{e.maxMult}
                    </p>
                  </>
                ) : revealed ? (
                  <span className={styles.meta}>Unclaimed tonight</span>
                ) : (
                  <span className={styles.hidden}>?</span>
                )}
              </div>
              <div className={styles.block} data-metal={METAL[place]}>
                <span className="num">{place + 1}</span>
              </div>
            </div>
          );
        })}
      </div>
      <p className={styles.hint}>{shown < 3 ? "Press space to reveal" : "Congratulations to tonight's line."}</p>
    </main>
  );
}
