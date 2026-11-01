"use client";

import { useEffect, useRef } from "react";
import type { SignalFrame } from "@neural-core/shared";
import styles from "./Waveform.module.css";

const HISTORY = 300; // 6 s at 50 Hz

/** Scrolling filtered-EEG trace on a measurement grid. Draws on its own rAF. */
export function Waveform({ frame, height = 220 }: { frame: SignalFrame | null; height?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const data = useRef<number[]>([]);
  const quality = useRef<string>("bad");

  useEffect(() => {
    if (!frame) return;
    data.current.push(...frame.wave);
    if (data.current.length > HISTORY) data.current.splice(0, data.current.length - HISTORY);
    quality.current = frame.quality;
  }, [frame]);

  useEffect(() => {
    let raf = 0;
    const css = getComputedStyle(document.documentElement);
    const colors = {
      grid: "rgba(255,255,255,0.05)",
      axis: "rgba(255,255,255,0.12)",
      good: css.getPropertyValue("--arc").trim() || "#7fe3ff",
      fair: css.getPropertyValue("--warn").trim() || "#f29a3a",
      bad: css.getPropertyValue("--alert").trim() || "#e5584a",
    };
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvas.current;
      if (!c) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== w * dpr) {
        c.width = w * dpr;
        c.height = h * dpr;
      }
      const g = c.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      g.strokeStyle = colors.grid;
      g.lineWidth = 1;
      for (let x = 0; x <= w; x += w / 12) {
        g.beginPath();
        g.moveTo(Math.round(x) + 0.5, 0);
        g.lineTo(Math.round(x) + 0.5, h);
        g.stroke();
      }
      for (let y = 0; y <= h; y += h / 6) {
        g.beginPath();
        g.moveTo(0, Math.round(y) + 0.5);
        g.lineTo(w, Math.round(y) + 0.5);
        g.stroke();
      }
      g.strokeStyle = colors.axis;
      g.beginPath();
      g.moveTo(0, h / 2 + 0.5);
      g.lineTo(w, h / 2 + 0.5);
      g.stroke();

      const d = data.current;
      if (d.length < 2) return;
      const sorted = d.map(Math.abs).sort((a, b) => a - b);
      const scale = Math.max(1e-6, sorted[Math.floor(sorted.length * 0.95)]! * 1.6);
      const q = quality.current as keyof typeof colors;
      g.strokeStyle = colors[q] ?? colors.good;
      g.lineWidth = 1.6;
      g.lineJoin = "round";
      g.beginPath();
      const step = w / (HISTORY - 1);
      const offset = HISTORY - d.length;
      for (let i = 0; i < d.length; i++) {
        const x = (offset + i) * step;
        const y = h / 2 - (Math.max(-scale, Math.min(scale, d[i]!)) / scale) * (h / 2 - 6);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvas} className={styles.canvas} style={{ height }} aria-label="Live EEG waveform" />;
}
