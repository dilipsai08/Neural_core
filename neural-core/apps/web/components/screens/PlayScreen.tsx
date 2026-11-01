"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BRIEFING_S } from "@neural-core/shared";
import { ArenaCanvas, type ArenaHandle } from "@/components/ArenaCanvas";
import { Button } from "@/components/Button";
import { GameHud } from "@/components/GameHud";
import { Icon } from "@/components/Icon";
import type { Arena, ArenaHud, ArenaResult } from "@/game/arena";
import { api, ApiError } from "@/lib/api";
import { audio } from "@/lib/audio";
import { useCommands, useLink, useMessages } from "@/lib/link";
import { backupScore } from "@/lib/localBackup";
import { submitRun } from "@/lib/pending";
import { useKiosk } from "@/lib/useKiosk";
import styles from "./PlayScreen.module.css";

type Stage = "loading" | "briefing" | "live" | "saving" | "error" | "played";

const BRIEF = [
  "Substation 07, 23:41. The Neural Core blew an hour ago. The dead are up, and they're carrying current.",
  "They're drawn to the last live transformer. Yours. The emitter runs on your headset.",
  "Calm mind, clean arc. Hold your focus and every kill chains. Forty-five seconds until the grid reboots.",
];

export function PlayScreen() {
  const { router, session, dispatch, station } = useKiosk({ needsPlayer: true });
  const linkState = useLink("kiosk", station);
  const arenaRef = useRef<ArenaHandle>(null);
  const [arena, setArena] = useState<Arena | null>(null);
  const [run, setRun] = useState<{ runId: number; seed: number; ranked: boolean } | null>(null);
  const [stage, setStage] = useState<Stage>("loading");
  const [error, setError] = useState<string | null>(null);
  const [hud, setHud] = useState<ArenaHud | null>(null);
  const [radio, setRadio] = useState<{ text: string; from: string; key: number } | null>(null);
  const [banner, setBanner] = useState<{ text: string; kind: "up" | "break"; key: number } | null>(null);
  const [briefLine, setBriefLine] = useState(0);
  const [goal, setGoal] = useState<{ best: number | null } | null>(null);
  const started = useRef(false);
  const finished = useRef(false);

  // Create the run once the session is ready.
  useEffect(() => {
    if (!session.player || run || stage !== "loading") return;
    if (!session.calibration) {
      router.replace("/setup/");
      return;
    }
    api
      .startRun(session.player.id, station)
      .then((r) => {
        setRun(r);
        dispatch({ type: "RUN_STARTED", runId: r.runId });
        setStage("briefing");
      })
      .catch((e: Error) => {
        setError(
          e instanceof ApiError && e.code === "ALREADY_PLAYED"
            ? "This player has already played. Each registration gets one game."
            : e.message,
        );
        setStage(e instanceof ApiError && e.code === "ALREADY_PLAYED" ? "played" : "error");
      });
    api
      .player(session.player.id)
      .then((p) => setGoal({ best: p.personalBest }))
      .catch(() => undefined);
  }, [session.player, session.calibration, run, stage, station, dispatch, router]);

  const go = useCallback(() => {
    if (started.current || !arena || !run) return;
    started.current = true;
    audio.unlock();
    setStage("live");
    arena.start();
    dispatch({ type: "PLAYING" });
    void api.go(run.runId).catch(() => undefined);
  }, [arena, run, dispatch]);

  // Briefing: three radio lines, then go. Shorter for players who have heard it.
  useEffect(() => {
    if (stage !== "briefing" || !arena) return;
    audio.radio();
    const per = session.briefed ? 900 : (BRIEFING_S * 1000) / BRIEF.length;
    const timers = BRIEF.map((_, i) => setTimeout(() => setBriefLine(i), i * per));
    timers.push(setTimeout(go, BRIEF.length * per + 400));
    return () => timers.forEach(clearTimeout);
  }, [stage, arena, go, session.briefed]);

  useMessages((m) => {
    if (m.type === "focus" && m.station === station) arenaRef.current?.arena?.pushFocus(m);
  });

  const finish = useCallback(
    async (result: ArenaResult, aborted = false) => {
      if (finished.current || !run) return;
      finished.current = true;
      setStage("saving");
      const playerId = session.player?.id;
      try {
        const saved = await submitRun(run.runId, result, aborted);
        if (playerId && !aborted) void backupScore(playerId, run.runId, saved.stats.score);
        if (aborted) {
          dispatch({ type: "RESET" });
          router.replace("/");
        } else {
          dispatch({ type: "FINISHED", runId: run.runId });
          router.replace("/result/");
        }
      } catch (e) {
        // Server unreachable: keep the kiosk's own score in the local backup.
        if (playerId && !aborted) void backupScore(playerId, run.runId, result.clientScore);
        setError(e instanceof Error ? e.message : "Could not save the shift");
        setStage("error");
      }
    },
    [run, dispatch, router, session.player],
  );

  useCommands(station, (c) => {
    const a = arenaRef.current?.arena;
    if (!a) return;
    if (c.action === "pause") a.pause("operator");
    if (c.action === "resume") a.resume(true);
    if (c.action === "abort") void finish(a.abort(), true);
  });

  // Mouse, keyboard (arrows + space) aim and fire.
  useEffect(() => {
    if (!arena) return;
    const move = (e: PointerEvent) => arena.setPointer(e.clientX, e.clientY);
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      arena.setPointer(e.clientX, e.clientY);
      arena.fire();
    };
    const keys = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        arena.fire();
      }
      const step = e.shiftKey ? 60 : 26;
      if (e.code === "ArrowLeft") arena.nudgePointer(-step, 0);
      if (e.code === "ArrowRight") arena.nudgePointer(step, 0);
      if (e.code === "ArrowUp") arena.nudgePointer(0, -step);
      if (e.code === "ArrowDown") arena.nudgePointer(0, step);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", keys);
    arena.setPointer(window.innerWidth / 2, window.innerHeight / 2);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", keys);
    };
  }, [arena]);

  const callbacks = {
    onHud: setHud,
    onRadio: (text: string, from: string) => setRadio({ text, from, key: Date.now() }),
    onChain: (kind: "up" | "break", mult: number) =>
      setBanner({ kind, key: Date.now(), text: kind === "up" ? (mult >= 8 ? "×8 Overcharge" : `×${mult} chain`) : "Chain lost" }),
    onFinish: (r: ArenaResult) => void finish(r),
  };

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 1400);
    return () => clearTimeout(t);
  }, [banner]);

  useEffect(() => {
    if (!radio) return;
    const t = setTimeout(() => setRadio(null), 6500);
    return () => clearTimeout(t);
  }, [radio]);

  const paused = hud?.phase === "paused";
  const linkDown = linkState !== "open";

  return (
    <main className={styles.screen}>
      {run && (
        <ArenaCanvas
          ref={arenaRef}
          mode="play"
          seed={run.seed}
          callbacks={callbacks}
          onReady={setArena}
          onError={(m) => {
            setError(m);
            setStage("error");
          }}
        />
      )}

      {stage === "live" && <GameHud hud={hud} />}

      {stage === "live" && hud?.phase === "countdown" && (
        <div className={styles.countdown} key={`count-${Math.ceil(hud.countdown)}`}>
          <span className="num">{Math.ceil(hud.countdown) || "GO"}</span>
        </div>
      )}

      {banner && (
        <div className={styles.banner} data-kind={banner.kind} key={`banner-${banner.key}`}>
          {banner.text}
        </div>
      )}

      {radio && stage === "live" && (
        <div className={styles.radio} key={`radio-${radio.key}`}>
          <span className={styles.radioFrom}>
            <Icon name="radio" size={18} /> {radio.from}
          </span>
          <p className={styles.radioText}>{radio.text}</p>
        </div>
      )}

      {(stage === "briefing" || stage === "loading") && (
        <div className={styles.briefing}>
          <div className={styles.briefCard}>
            <span className={styles.radioFrom}>
              <Icon name="radio" size={18} /> Grid control · channel 7
            </span>
            {BRIEF.map((line, i) => (
              <p key={i} className={styles.briefLine} data-on={i <= briefLine && stage === "briefing"}>
                {line}
              </p>
            ))}
            <div className={styles.briefFoot}>
              <span className={styles.goal}>
                {goal?.best ? (
                  <>
                    Your best <span className="num">{goal.best.toLocaleString("en-IN")}</span>. Beat it.
                  </>
                ) : (
                  <>First shift. Click to fire, stay calm to chain.</>
                )}
              </span>
              <Button variant="primary" iconAfter="arrowRight" onClick={go} disabled={!arena}>
                {arena ? "Skip briefing" : "Charging arena…"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {paused && (
        <div className={styles.overlay}>
          <div className={styles.pauseCard}>
            <Icon name={hud?.pauseReason === "operator" ? "pause" : "signal"} size={40} />
            <h2>
              {hud?.pauseReason === "operator" ? "Paused by volunteer" : hud?.pauseReason === "quality" ? "Signal too noisy" : "Headset signal lost"}
            </h2>
            <p>
              {hud?.pauseReason === "operator"
                ? "Hold tight. The clock is stopped and nothing is lost."
                : "The clock is stopped. Keep still; the shift resumes by itself when the signal is back."}
            </p>
            {hud?.pauseReason !== "signal" && (
              <Button variant="secondary" icon="play" onClick={() => arenaRef.current?.arena?.resume(true)}>
                Volunteer: resume
              </Button>
            )}
          </div>
        </div>
      )}

      {stage === "saving" && (
        <div className={styles.overlay}>
          <div className={styles.pauseCard}>
            <Icon name="bolt" size={40} />
            <h2>Logging your shift</h2>
            <p>Verifying the run with the grid server.</p>
          </div>
        </div>
      )}

      {stage === "played" && (
        <div className={styles.overlay}>
          <div className={styles.pauseCard}>
            <Icon name="trophy" size={40} />
            <h2>Shift already logged</h2>
            <p>{error}</p>
            <Button
              variant="secondary"
              onClick={() => {
                dispatch({ type: "RESET" });
                router.replace("/");
              }}
            >
              Back to start
            </Button>
          </div>
        </div>
      )}

      {stage === "error" && (
        <div className={styles.overlay}>
          <div className={styles.pauseCard} data-error="true">
            <Icon name="alert" size={40} />
            <h2>Something went wrong</h2>
            <p>{error}</p>
            <p className={styles.small}>Your result is kept on this kiosk and will be sent automatically.</p>
            <Button
              variant="secondary"
              onClick={() => {
                dispatch({ type: "RESET" });
                router.replace("/");
              }}
            >
              Back to start
            </Button>
          </div>
        </div>
      )}

      {linkDown && stage === "live" && !paused && <div className={styles.linkWarn}>Reconnecting to the grid server…</div>}
    </main>
  );
}
