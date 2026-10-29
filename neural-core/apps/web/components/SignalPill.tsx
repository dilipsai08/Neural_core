"use client";

import type { SignalQuality } from "@neural-core/shared";
import styles from "./SignalPill.module.css";

const TEXT: Record<SignalQuality | "offline", string> = {
  good: "Signal good",
  fair: "Signal noisy",
  bad: "Signal poor",
  offline: "No headset",
};

export function SignalPill({ quality, connected }: { quality: SignalQuality | null; connected: boolean }) {
  const state = !connected || !quality ? "offline" : quality;
  return (
    <span className={styles.pill} data-state={state} role="status">
      <i className={styles.bars} aria-hidden="true">
        <b />
        <b />
        <b />
      </i>
      {TEXT[state]}
    </span>
  );
}
