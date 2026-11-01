"use client";

import { useEffect, useRef, useState } from "react";
import {
  CALIBRATION_FOCUS_S,
  CALIBRATION_HIGH_PERCENTILE,
  CALIBRATION_LOW_PERCENTILE,
  CALIBRATION_MIN_SPAN,
  CALIBRATION_RELAX_S,
  mapFocusScore,
  percentile,
  type Calibration,
} from "@neural-core/shared";
import { Button } from "@/components/Button";
import { FocusGauge } from "@/components/FocusGauge";
import { Icon } from "@/components/Icon";
import { Panel } from "@/components/Panel";
import { TopBar } from "@/components/TopBar";
import { api } from "@/lib/api";
import { audio } from "@/lib/audio";
import { useCalibrationMessages, useCommands, useFocus, useSignal, useStationStatus } from "@/lib/link";
import { useIdleReset, useKiosk } from "@/lib/useKiosk";
import k from "./Kiosk.module.css";
import styles from "./CalibrateScreen.module.css";

type Stage = "ready-relax" | "relax" | "ready-focus" | "focus" | "done";

const PHASES = [
  { key: "relax", title: "Relax", seconds: CALIBRATION_RELAX_S, body: "Soft gaze on the beacon. Breathe in as it grows, out as it shrinks." },
  { key: "focus", title: "Focus", seconds: CALIBRATION_FOCUS_S, body: "Count down from 100 in sevens, silently: 100, 93, 86 and on." },
] as const;

/** Signal frames (2 Hz) needed before the needle can be placed on the player's own range. */
const OWN_RANGE_MIN_FRAMES = 4;
/** Last 60 s of readings. */
const OWN_RANGE_MAX_FRAMES = 120;

/**
 * Until calibration finishes the server scores focus against a default range,
 * which can pin the needle near 100. While learning, place the needle on this
 * player's own readings so far instead (same 10th–90th percentile rule the
 * calibration uses). Display only: calibration itself is computed on the server.
 */
function useOwnRangeFocus(station: number, learning: boolean): number | null {
  const signal = useSignal(station);
  const seen = useRef<number[]>([]);
  const lastT = useRef(0);
  const smooth = useRef<number | null>(null);
  const [value, setValue] = useState<number | null>(null);

  useEffect(() => {
    if (!learning || !signal || signal.t === lastT.current || signal.quality === "bad") return;
    lastT.current = signal.t;
    const s = seen.current;
    s.push(signal.index);
    if (s.length > OWN_RANGE_MAX_FRAMES) s.shift();
    if (s.length < OWN_RANGE_MIN_FRAMES) return;
    let low = percentile(s, CALIBRATION_LOW_PERCENTILE);
    let high = percentile(s, CALIBRATION_HIGH_PERCENTILE);
    if (high - low < CALIBRATION_MIN_SPAN) {
      const mid = (low + high) / 2;
      low = mid - CALIBRATION_MIN_SPAN / 2;
      high = mid + CALIBRATION_MIN_SPAN / 2;
    }
    const x = mapFocusScore(signal.index, low, high);
    // About the same smoothing as the server's score, at the 2 Hz frame rate.
    smooth.current = smooth.current === null ? x : smooth.current + 0.3 * (x - smooth.current);
    setValue(smooth.current);
  }, [signal, learning]);

  return value;
}

export function CalibrateScreen() {
  const { router, session, dispatch, station } = useKiosk({ needsPlayer: true });
  const status = useStationStatus(station);
  const focus = useFocus(station);
  const [stage, setStage] = useState<Stage>("ready-relax");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Calibration | null>(null);
  const [previous, setPrevious] = useState<Calibration | null>(null);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ownRange = useOwnRangeFocus(station, stage !== "done");
  // Once calibrated, the needle shows the real focus score from the server.
  const needle = stage === "done" ? (focus?.score ?? null) : ownRange;

  useEffect(() => {
    if (!session.player) return;
    api
      .assign(station, session.player.id)
      .then((r) => setPrevious(r.previousCalibration))
      .catch(() => undefined);
  }, [station, session.player]);

  useEffect(() => () => {
    if (autoTimer.current) clearTimeout(autoTimer.current);
  }, []);

  useIdleReset(240, () => {
    dispatch({ type: "RESET" });
    router.replace("/");
  }, stage === "ready-relax" || stage === "done");

  const begin = async (phase: "relax" | "focus") => {
    audio.unlock();
    setError(null);
    setProgress(0);
    try {
      await api.calibrate(station, phase);
      setStage(phase);
      audio.beep(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start calibration");
    }
  };

  useCalibrationMessages(station, (m) => {
    if (m.error) {
      setError(m.error);
      setStage(m.phase === "relax" ? "ready-relax" : "ready-focus");
      return;
    }
    setProgress(m.progress);
    if (!m.done) return;
    if (m.phase === "relax" && !m.result) {
      setStage("ready-focus");
      audio.beep(true);
      dispatch({ type: "RELAX_DONE" });
      // Keep momentum: the focus phase starts by itself after a short breath.
      autoTimer.current = setTimeout(() => void begin("focus"), 4000);
    } else if (m.result) {
      setResult(m.result);
      setStage("done");
      audio.chainUp(2);
    }
  });

  useCommands(station, (c) => {
    if (c.action === "skip-calibration") void skip();
  });

  const skip = async () => {
    const r = await api.skipCalibration(station);
    setResult(r.calibration);
    setStage("done");
  };

  const reusePrevious = async () => {
    const r = await api.usePreviousCalibration(station);
    setResult(r.calibration);
    setStage("done");
  };

  const proceed = () => {
    if (!result) return;
    audio.click();
    dispatch({ type: "CALIBRATED", calibration: result });
    router.push("/play/");
  };

  const active = stage === "relax" || stage === "focus" ? stage : null;
  const phase = stage === "relax" || stage === "ready-relax" ? PHASES[0] : PHASES[1];
  const remaining = active ? Math.ceil(phase.seconds * (1 - progress)) : phase.seconds;

  return (
    <main className={k.screen}>
      <TopBar station={station} step={2} />
      <div className={`${k.body} ${styles.body}`}>
        <aside className={styles.rail}>
          <span className="label">Step 3 · Tune the arc</span>
          {PHASES.map((p, i) => {
            const state =
              stage === "done" || (i === 0 && (stage === "ready-focus" || stage === "focus"))
                ? "done"
                : (i === 0 && (stage === "relax" || stage === "ready-relax")) || (i === 1 && (stage === "focus" || stage === "ready-focus"))
                  ? "active"
                  : "todo";
            return (
              <Panel key={p.key} className={styles.phase} data-state={state}>
                <div className={styles.phaseHead}>
                  <span className={`num ${styles.phaseN}`}>0{i + 1}</span>
                  <span className={styles.phaseState}>{state === "done" ? "Done" : state === "active" ? "Now" : "Next"}</span>
                </div>
                <h2 className={styles.phaseTitle}>{p.title}</h2>
                <p className={styles.phaseBody}>{p.body}</p>
                <span className={`num ${styles.phaseTime}`}>{p.seconds} s</span>
              </Panel>
            );
          })}
          {previous && stage !== "done" && (
            <Button variant="secondary" icon="refresh" onClick={() => void reusePrevious()}>
              Reuse my last calibration
            </Button>
          )}
        </aside>

        <section className={styles.stage}>
          {stage === "done" && result ? (
            <div className={styles.doneBlock}>
              <span className={styles.doneIcon}>
                <Icon name="check" size={56} />
              </span>
              <h1 className={k.title}>Arc tuned to you</h1>
              <p className={k.sub}>
                {result.source === "measured"
                  ? "Your relaxed and focused readings set your personal 0–100 scale."
                  : result.source === "previous"
                    ? "Using your calibration from your last shift."
                    : "Using tonight's typical range. Your score will still track your focus."}
              </p>
              <Button variant="primary" size="lg" iconAfter="arrowRight" onClick={proceed}>
                Report for duty
              </Button>
            </div>
          ) : (
            <>
              <div className={styles.beaconWrap} data-phase={phase.key} data-active={Boolean(active)}>
                <svg viewBox="0 0 200 200" className={styles.ring} aria-hidden="true">
                  <circle cx="100" cy="100" r="92" className={styles.ringTrack} />
                  <circle
                    cx="100"
                    cy="100"
                    r="92"
                    className={styles.ringFill}
                    style={{ strokeDashoffset: 578 * (1 - (active ? progress : 0)) }}
                  />
                </svg>
                <div className={styles.beacon} />
                <div className={styles.timer}>
                  <span className="num">{String(remaining).padStart(2, "0")}</span>
                  <span className={styles.timerUnit}>seconds</span>
                </div>
              </div>
              <h1 className={`${k.title} ${styles.instruction}`}>
                {stage === "ready-relax" && "First, let your mind go quiet"}
                {stage === "relax" && "Breathe with the beacon"}
                {stage === "ready-focus" && "Now sharpen it"}
                {stage === "focus" && "100, 93, 86… keep counting"}
              </h1>
              <p className={`${k.sub} ${styles.instructionSub}`}>
                {stage === "ready-focus"
                  ? "Next: count down from 100 in steps of seven, silently. Starting in a moment."
                  : "Keep your jaw loose and your eyes soft. Blinking is fine."}
              </p>
              {error && (
                <p className={k.error} role="alert">
                  <Icon name="alert" size={18} /> {error}
                </p>
              )}
              <div className={styles.controls}>
                {stage === "ready-relax" && (
                  <Button variant="primary" size="lg" icon="play" onClick={() => void begin("relax")} disabled={!status?.connected}>
                    Start relax · {CALIBRATION_RELAX_S}s
                  </Button>
                )}
                {stage === "ready-focus" && (
                  <Button
                    variant="primary"
                    size="lg"
                    icon="play"
                    onClick={() => {
                      if (autoTimer.current) clearTimeout(autoTimer.current);
                      void begin("focus");
                    }}
                  >
                    Start focus now
                  </Button>
                )}
                {(stage === "ready-relax" || stage === "ready-focus") && (
                  <Button variant="ghost" size="sm" onClick={() => void skip()}>
                    Volunteer: skip calibration
                  </Button>
                )}
              </div>
            </>
          )}
        </section>

        <aside className={styles.live}>
          <Panel tone="sunken" className={styles.gaugePanel}>
            <FocusGauge value={status?.connected ? needle : null} size={240} />
          </Panel>
          <p className={k.note}>
            The needle is live. While calibrating it follows your own signal and is not scored; afterwards it shows your real focus.
          </p>
        </aside>
      </div>
    </main>
  );
}
