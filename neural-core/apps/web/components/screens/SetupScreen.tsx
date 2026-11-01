"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { BandBars } from "@/components/BandBars";
import { Button } from "@/components/Button";
import { ElectrodeDiagram } from "@/components/ElectrodeDiagram";
import { FocusGauge } from "@/components/FocusGauge";
import { Icon } from "@/components/Icon";
import { Panel } from "@/components/Panel";
import { TopBar } from "@/components/TopBar";
import { Waveform } from "@/components/Waveform";
import { api } from "@/lib/api";
import { audio } from "@/lib/audio";
import { useFocus, useSignal, useStationStatus } from "@/lib/link";
import { useIdleReset, useKiosk } from "@/lib/useKiosk";
import { webSerialBridge } from "@/lib/webSerialBridge";
import k from "./Kiosk.module.css";
import styles from "./SetupScreen.module.css";

const QUALITY_COPY = {
  good: { title: "Signal clean", body: "Electrodes are seated. You're ready." },
  fair: { title: "Signal noisy", body: "Press the forehead pad gently and relax your jaw." },
  bad: { title: "Signal poor", body: "Check the pads are on skin and the cable is clipped in." },
  offline: { title: "No headset data", body: "The sensor isn't streaming. A volunteer will connect it." },
} as const;

export function SetupScreen() {
  const { router, session, dispatch, station } = useKiosk({ needsPlayer: true });
  const status = useStationStatus(station);
  const signal = useSignal(station);
  const focus = useFocus(station);
  const [notGoodFor, setNotGoodFor] = useState(0);
  const bridgeRunning = useSyncExternalStore(
    (cb) => webSerialBridge.onChange(cb),
    () => webSerialBridge.running,
    () => false,
  );
  const [canBridge, setCanBridge] = useState(false);

  useEffect(() => setCanBridge(webSerialBridge.supported), []);
  useEffect(() => {
    // Make sure the server knows about this station even if STATIONS didn't list it.
    void api.station(station).catch(() => undefined);
  }, [station]);

  const connected = Boolean(status?.connected);
  const quality = connected ? (signal?.quality ?? status?.quality ?? "bad") : "offline";

  useEffect(() => {
    const id = setInterval(() => setNotGoodFor((s) => (quality === "good" ? 0 : s + 1)), 1000);
    return () => clearInterval(id);
  }, [quality]);

  useIdleReset(240, () => {
    dispatch({ type: "RESET" });
    router.replace("/");
  });

  const next = () => {
    audio.click();
    dispatch({ type: "SENSOR_READY" });
    router.push("/calibrate/");
  };

  const copy = QUALITY_COPY[quality];
  const checks = [
    { ok: connected, label: "Headset streaming" },
    { ok: connected && (signal?.railShare ?? 1) === 0, label: "Within amplifier range" },
    { ok: connected && (signal?.mainsRatio ?? 9) < 0.6, label: "Low mains hum" },
    { ok: connected && signal !== null && signal.bands.high / Math.max(1e-9, signal.bands.theta + signal.bands.alpha + signal.bands.beta + signal.bands.high) < 0.35, label: "Jaw relaxed" },
  ];

  return (
    <main className={k.screen}>
      <TopBar station={station} step={1} />
      <div className={`${k.body} ${styles.body}`}>
        <header className={`${k.heading} ${styles.heading}`}>
          <span className="label">Step 2 · Headset · {session.player?.fullName}</span>
          <h1 className={k.title}>Fit the headset</h1>
          <p className={k.sub}>Sit back, relax your jaw and keep still while the signal settles. This takes about 20 seconds.</p>
        </header>

        <Panel label="Electrode placement" screws className={styles.diagram}>
          <ElectrodeDiagram />
          <p className={k.note}>Apply a pea-sized dab of gel; wipe the skin with the prep gel first for a cleaner signal.</p>
        </Panel>

        <Panel
          label="Live signal · filtered 0.5–45 Hz"
          aside={signal ? <span className="num">index {signal.index.toFixed(2)}</span> : null}
          className={styles.signal}
        >
          <div className={styles.quality} data-q={quality}>
            <span className={styles.qualityLamp} aria-hidden="true" />
            <div>
              <p className={styles.qualityTitle}>{copy.title}</p>
              <p className={styles.qualityBody}>{copy.body}</p>
            </div>
          </div>
          <Waveform frame={signal} />
          <BandBars bands={signal?.bands ?? null} />
        </Panel>

        <div className={styles.side}>
          <Panel tone="sunken" className={styles.gauge}>
            <FocusGauge value={connected ? (focus?.score ?? null) : null} size={230} />
          </Panel>
          <Panel label="Checklist">
            <ul className={styles.checks}>
              {checks.map((c) => (
                <li key={c.label} data-ok={c.ok}>
                  <Icon name={c.ok ? "check" : "close"} size={18} /> {c.label}
                </li>
              ))}
            </ul>
          </Panel>
          {!connected && canBridge && (
            <Button icon="usb" onClick={() => void webSerialBridge.start(station)} disabled={bridgeRunning}>
              {bridgeRunning ? "USB bridge running" : "Connect sensor on this laptop"}
            </Button>
          )}
          <Button variant="primary" size="lg" iconAfter="arrowRight" disabled={quality !== "good"} onClick={next}>
            Calibrate
          </Button>
          {connected && quality !== "good" && notGoodFor > 20 && (
            <Button variant="ghost" size="sm" onClick={next}>
              Volunteer: continue with a noisy signal
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}
