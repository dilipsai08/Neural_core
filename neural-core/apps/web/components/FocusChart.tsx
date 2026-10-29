import { ROUND_DURATION_S, buildChainTimeline, type FocusPoint, type RunEvent } from "@neural-core/shared";
import styles from "./FocusChart.module.css";

const W = 900;
const H = 300;
const PAD = { l: 40, r: 12, t: 12, b: 34 };

/**
 * Focus over the 60 s shift. Shaded bands show where the chain multiplier was
 * running; ticks along the bottom mark kills (and breaches in red).
 */
export function FocusChart({ focus, events }: { focus: FocusPoint[]; events: RunEvent[] }) {
  const x = (tMs: number) => PAD.l + (Math.min(tMs, ROUND_DURATION_S * 1000) / (ROUND_DURATION_S * 1000)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / 100) * (H - PAD.t - PAD.b);
  const chain = buildChainTimeline(focus);

  const bands: Array<{ from: number; to: number; mult: number }> = [];
  chain.times.forEach((t, i) => {
    const m = chain.mults[i]!;
    const last = bands[bands.length - 1];
    if (last && last.mult === m) last.to = chain.times[i + 1] ?? t;
    else bands.push({ from: t, to: chain.times[i + 1] ?? t, mult: m });
  });

  const line = focus.map((p, i) => `${i ? "L" : "M"}${x(p.tMs).toFixed(1)} ${y(p.score).toFixed(1)}`).join(" ");
  const area = focus.length ? `${line} L${x(focus[focus.length - 1]!.tMs).toFixed(1)} ${y(0)} L${x(focus[0]!.tMs).toFixed(1)} ${y(0)} Z` : "";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.chart} role="img" aria-label="Focus over time">
      <defs>
        <linearGradient id="focusFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--arc)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--arc)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {bands
        .filter((b) => b.mult > 1)
        .map((b) => (
          <rect
            key={b.from}
            x={x(b.from)}
            y={PAD.t}
            width={Math.max(1, x(b.to) - x(b.from))}
            height={H - PAD.t - PAD.b}
            className={styles.band}
            data-mult={b.mult}
          />
        ))}
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className={styles.grid} />
          <text x={PAD.l - 8} y={y(v) + 4} className={styles.axis} textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      <line x1={PAD.l} x2={W - PAD.r} y1={y(60)} y2={y(60)} className={styles.threshold} />
      <text x={PAD.l + 6} y={y(60) - 6} className={styles.axis}>
        chain threshold 60
      </text>
      {[0, 15, 30, 45, 60].map((s) => (
        <text key={s} x={x(s * 1000)} y={H - 8} className={styles.axis} textAnchor="middle">
          {s}s
        </text>
      ))}
      {area && <path d={area} fill="url(#focusFill)" />}
      {line && <path d={line} className={styles.line} />}
      {events
        .filter((e) => e.kind === "kill" || e.kind === "breach")
        .map((e, i) => (
          <line
            key={i}
            x1={x(e.tMs)}
            x2={x(e.tMs)}
            y1={H - PAD.b + 2}
            y2={H - PAD.b + (e.kind === "kill" ? 10 : 14)}
            className={e.kind === "kill" ? styles.kill : styles.breach}
          />
        ))}
    </svg>
  );
}
