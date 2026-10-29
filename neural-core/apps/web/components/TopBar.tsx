"use client";

import { useEffect, useState, type ReactNode } from "react";
import { audio } from "@/lib/audio";
import { useLink, useStationStatus } from "@/lib/link";
import { Brand } from "./Brand";
import { Icon } from "./Icon";
import { SignalPill } from "./SignalPill";
import { StepRail } from "./StepRail";
import styles from "./TopBar.module.css";

export function TopBar({ station, step, children }: { station: number; step?: 0 | 1 | 2 | 3; children?: ReactNode }) {
  const linkState = useLink("kiosk", station);
  const status = useStationStatus(station);
  const [muted, setMuted] = useState(false);

  useEffect(() => setMuted(audio.muted), []);

  return (
    <header className={styles.bar}>
      <Brand />
      <div className={styles.center}>{step !== undefined ? <StepRail active={step} /> : children}</div>
      <div className={styles.right}>
        <span className={`label ${styles.station}`}>Station {String(station).padStart(2, "0")}</span>
        {linkState !== "open" ? (
          <span className={styles.offline} role="status">
            <Icon name="alert" size={16} /> Reconnecting
          </span>
        ) : (
          <SignalPill quality={status?.quality ?? null} connected={Boolean(status?.connected)} />
        )}
        <button
          className={styles.iconButton}
          aria-label={muted ? "Unmute sound" : "Mute sound"}
          onClick={() => {
            audio.setMuted(!muted);
            setMuted(!muted);
          }}
        >
          <Icon name={muted ? "mute" : "volume"} size={20} />
        </button>
      </div>
    </header>
  );
}
