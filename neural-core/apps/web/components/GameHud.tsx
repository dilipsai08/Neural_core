"use client";

import { CHAIN_LADDER, ENEMIES, ROUND_DURATION_S, focusBand } from "@neural-core/shared";
import type { ArenaHud } from "@/game/arena";
import { FocusGauge } from "./FocusGauge";
import { Icon } from "./Icon";
import styles from "./GameHud.module.css";

const ACT_NUMERAL = ["I", "II", "III", "IV"];

export function GameHud({ hud }: { hud: ArenaHud | null }) {
  if (!hud) return null;
  const secs = Math.ceil(hud.timeLeft);
  const step = hud.nextStep;
  const prevAt = [...CHAIN_LADDER].reverse().find((s) => s.atS <= hud.sustainedS)?.atS ?? 0;
  const toNext = step ? Math.min(1, (hud.sustainedS - prevAt) / (step.atS - prevAt)) : 1;
  const accuracy = hud.shots ? Math.round((hud.hits / hud.shots) * 100) : null;
  const band = hud.focus === null ? null : focusBand(hud.focus);

  return (
    <div className={styles.hud} data-band={band ?? "none"}>
      {/* score + chain */}
      <section className={`${styles.plate} ${styles.score}`}>
        <span className="label">Score</span>
        <span className={`num ${styles.scoreValue}`}>{hud.score.toLocaleString("en-IN")}</span>
        <div className={styles.chain} data-alive={hud.chainAlive}>
          <span className={styles.mult} data-mult={hud.mult}>
            ×{hud.mult}
          </span>
          <div className={styles.chainInfo}>
            <span className={styles.chainLabel}>
              {hud.mult >= 8 ? "Overcharge" : hud.chainAlive ? "Focus chain" : "Hold focus ≥ 60 to chain"}
            </span>
            <div className={styles.chainBar}>
              <i style={{ transform: `scaleX(${hud.chainAlive ? toNext : 0})` }} />
            </div>
            <div className={styles.ladder}>
              {CHAIN_LADDER.map((s) => (
                <span key={s.mult} data-on={hud.mult >= s.mult}>
                  ×{s.mult}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* clock */}
      <section className={styles.clock}>
        <span className={styles.act}>
          Act {ACT_NUMERAL[hud.actIndex]} · {hud.act}
        </span>
        <span className={`num ${styles.time}`} data-low={secs <= 10}>
          0:{String(secs).padStart(2, "0")}
        </span>
        <div className={styles.ticks} aria-hidden="true">
          {Array.from({ length: ROUND_DURATION_S / 2 }, (_, i) => (
            <i key={i} data-on={i < Math.ceil(hud.timeLeft / 2)} />
          ))}
        </div>
      </section>

      {/* grid status */}
      <section className={`${styles.plate} ${styles.status}`}>
        <div className={styles.stat}>
          <span className="label">Breaches</span>
          <span className={`num ${styles.statValue}`} data-bad={hud.breaches > 0}>
            {hud.breaches}
          </span>
        </div>
        <div className={styles.stat}>
          <span className="label">Kills</span>
          <span className={`num ${styles.statValue}`}>{hud.kills}</span>
        </div>
        <div className={styles.stat}>
          <span className="label">Accuracy</span>
          <span className={`num ${styles.statValue}`}>{accuracy === null ? "--" : `${accuracy}%`}</span>
        </div>
      </section>

      {/* focus instrument */}
      <section className={`${styles.plate} ${styles.focus}`}>
        <FocusGauge value={hud.focus} size={190} />
        <div className={styles.focusText}>
          <span className="label">Mind</span>
          <p className={styles.focusState}>
            {hud.focus === null
              ? "Waiting for headset"
              : band === "locked"
                ? "Locked in. Targets steady."
                : band === "steady"
                  ? "Steady. Keep it there."
                  : band === "drifting"
                    ? "Drifting. They're starting to blur."
                    : "Scattered. Breathe out slowly."}
          </p>
          {hud.artifact === "tension" && (
            <p className={styles.artifact}>
              <Icon name="alert" size={16} /> Jaw tension: unclench
            </p>
          )}
          {hud.artifact === "blink" && <p className={styles.artifactSoft}>Blink detected · holding score</p>}
        </div>
      </section>

      {hud.boss && (
        <section className={`${styles.plate} ${styles.boss}`} data-shield={hud.boss.shield}>
          <div className={styles.bossHead}>
            <span className={styles.bossName}>The Conductor</span>
            <span className={styles.bossShield}>
              {hud.boss.shield ? (
                <>
                  <Icon name="lock" size={16} /> Shield up · hold a ×2 chain
                </>
              ) : (
                <>
                  <Icon name="bolt" size={16} /> Shield down · fire!
                </>
              )}
            </span>
          </div>
          <div className={styles.bossBar}>
            <i style={{ transform: `scaleX(${hud.boss.hp / ENEMIES.conductor.hp})` }} />
          </div>
        </section>
      )}
    </div>
  );
}
