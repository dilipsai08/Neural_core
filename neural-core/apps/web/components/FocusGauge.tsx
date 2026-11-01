"use client";

import { useEffect, useRef } from "react";
import { focusBand, type FocusBand } from "@neural-core/shared";
import styles from "./FocusGauge.module.css";

const START = -120;
const SWEEP = 240;
const BAND_LABEL: Record<FocusBand, string> = {
  scattered: "Scattered",
  drifting: "Drifting",
  steady: "Steady",
  locked: "Locked in",
};

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  // Rounded so server and client render identical attribute strings.
  return [Math.round((cx + r * Math.cos(rad)) * 1000) / 1000, Math.round((cy + r * Math.sin(rad)) * 1000) / 1000];
}

function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

const ZONES: Array<{ from: number; to: number; cls: string }> = [
  { from: 0, to: 35, cls: "zAlert" },
  { from: 35, to: 60, cls: "zWarn" },
  { from: 60, to: 80, cls: "zSteady" },
  { from: 80, to: 100, cls: "zArc" },
];

/**
 * Instrument-style focus meter: 240° dial, zone ring, damped needle driven by
 * spring physics so frame-to-frame jumps in the score never look twitchy.
 */
export function FocusGauge({
  value,
  size = 280,
  caption = "Focus",
  live = true,
}: {
  value: number | null;
  size?: number;
  caption?: string;
  live?: boolean;
}) {
  const needle = useRef<SVGGElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const target = useRef(value ?? 0);
  target.current = value ?? 0;

  useEffect(() => {
    let pos = target.current;
    let vel = 0;
    let raf = 0;
    let last = performance.now();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (reduce) pos = target.current;
      else {
        const k = 60;
        const c = 2 * Math.sqrt(k) * 0.82;
        vel += (k * (target.current - pos) - c * vel) * dt;
        pos += vel * dt;
      }
      const deg = START + (Math.max(0, Math.min(100, pos)) / 100) * SWEEP;
      needle.current?.setAttribute("transform", `rotate(${deg} 100 100)`);
      if (readout.current) readout.current.textContent = String(Math.round(Math.max(0, Math.min(100, pos))));
      root.current?.setAttribute("data-band", focusBand(pos));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const band = value === null ? null : focusBand(value);

  return (
    <div
      ref={root}
      className={styles.gauge}
      style={{ width: size, height: size * 0.86, ["--gauge" as string]: `${size}px` }}
      data-live={live && value !== null}
    >
      <svg viewBox="0 0 200 172" className={styles.svg} aria-hidden="true">
        <defs>
          <radialGradient id="gaugeFace" cx="50%" cy="40%" r="65%">
            <stop offset="0%" stopColor="#1d2329" />
            <stop offset="100%" stopColor="#0b0e11" />
          </radialGradient>
        </defs>
        <circle cx="100" cy="100" r="92" fill="url(#gaugeFace)" className={styles.face} />
        {ZONES.map((z) => (
          <path
            key={z.cls}
            d={arc(100, 100, 80, START + (z.from / 100) * SWEEP + 0.8, START + (z.to / 100) * SWEEP - 0.8)}
            className={`${styles.zone} ${styles[z.cls]}`}
          />
        ))}
        {Array.from({ length: 41 }, (_, i) => {
          const deg = START + (i / 40) * SWEEP;
          const major = i % 5 === 0;
          const [x1, y1] = polar(100, 100, major ? 66 : 70, deg);
          const [x2, y2] = polar(100, 100, 74, deg);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className={major ? styles.tickMajor : styles.tick} />;
        })}
        {[0, 25, 50, 75, 100].map((v) => {
          const [x, y] = polar(100, 100, 55, START + (v / 100) * SWEEP);
          return (
            <text key={v} x={x} y={y + 3} className={styles.scale} textAnchor="middle">
              {v}
            </text>
          );
        })}
        <g ref={needle} transform={`rotate(${START} 100 100)`}>
          <path d="M 98.2 104 L 100 26 L 101.8 104 Z" className={styles.needle} />
        </g>
        <circle cx="100" cy="100" r="7" className={styles.hub} />
        <circle cx="100" cy="100" r="2.5" className={styles.hubCap} />
      </svg>
      <div className={styles.readout}>
        <span ref={readout} className={`num ${styles.value}`}>
          {value === null ? "--" : Math.round(value)}
        </span>
        <span className={styles.caption}>{value === null ? "No signal" : band ? BAND_LABEL[band] : caption}</span>
      </div>
    </div>
  );
}
