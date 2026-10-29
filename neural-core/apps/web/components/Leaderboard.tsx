import type { LeaderboardEntry } from "@neural-core/shared";
import styles from "./Leaderboard.module.css";

const PLATE = ["gold", "silver", "bronze"] as const;

export function Leaderboard({
  entries,
  size = "md",
  highlight,
  empty,
}: {
  entries: LeaderboardEntry[];
  size?: "md" | "xl";
  highlight?: number;
  empty?: string;
}) {
  if (entries.length === 0) {
    return <p className={styles.empty}>{empty ?? "No shifts logged yet. Be the first name on the board."}</p>;
  }
  return (
    <ol className={`${styles.list} ${styles[size]}`}>
      {entries.map((e) => (
        <li key={e.runId} className={styles.row} data-me={e.playerId === highlight}>
          <span className={styles.rank} data-plate={PLATE[e.rank - 1] ?? "none"}>
            <span className="num">{e.rank}</span>
          </span>
          <span className={styles.who}>
            <span className={styles.name}>{e.fullName}</span>
            <span className={styles.meta}>
              {e.title} · focus {Math.round(e.avgFocus)} · best ×{e.maxMult}
            </span>
          </span>
          <span className={`num ${styles.score}`}>{e.score.toLocaleString("en-IN")}</span>
        </li>
      ))}
    </ol>
  );
}
