"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Panel } from "@/components/Panel";
import { TopBar } from "@/components/TopBar";
import { api, ApiError } from "@/lib/api";
import { audio } from "@/lib/audio";
import { backupPlayer } from "@/lib/localBackup";
import { useIdleReset, useKiosk } from "@/lib/useKiosk";
import type { SessionPlayer } from "@/lib/session";
import k from "./Kiosk.module.css";
import styles from "./RegisterScreen.module.css";

export function RegisterScreen() {
  const { router, dispatch, station } = useKiosk();
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<SessionPlayer | null>(null);
  const [played, setPlayed] = useState(false);

  useIdleReset(120, () => {
    dispatch({ type: "RESET" });
    router.replace("/");
  });

  const proceed = async (player: SessionPlayer) => {
    void backupPlayer(player.id, player.fullName, contact.trim());
    await api.assign(station, player.id);
    dispatch({ type: "REGISTERED", player });
    router.push("/setup/");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    audio.unlock();
    setError(null);
    if (name.trim().length < 2) return setError("Enter your name as it should appear on the leaderboard.");
    if (contact.trim().length < 3) return setError("Enter your roll number or phone number.");
    if (!consent) return setError("Tick the consent box to continue.");
    setBusy(true);
    try {
      const p = await api.register(name.trim(), contact.trim());
      audio.click();
      await proceed({ id: p.id, displayId: p.displayId, fullName: p.fullName });
    } catch (err) {
      if (err instanceof ApiError && err.code === "DUPLICATE_CONTACT") {
        const player = err.body.player as SessionPlayer;
        setExisting(player);
        // One game per registration: a returning ID that has already played can't go again.
        const summary = await api.player(player.id).catch(() => null);
        setPlayed(!!summary && summary.attemptsUsed >= summary.attemptsAllowed);
      } else {
        setError(err instanceof Error ? err.message : "Registration failed. Try again or call a volunteer.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={k.screen}>
      <TopBar station={station} step={0} />
      <div className={`${k.body} ${styles.body}`}>
        <Panel screws className={styles.form}>
          <form onSubmit={submit} noValidate>
            <header className={k.heading}>
              <span className="label">Shift roster · Substation 07</span>
              <h1 className={k.title}>Sign the night roster</h1>
              <p className={k.sub}>Your name goes on the leaderboard. Your ID keeps the board fair: one person, one entry.</p>
            </header>

            {existing ? (
              <div className={styles.welcome} role="status">
                <span className="label">Already on the roster</span>
                <p className={styles.welcomeName}>
                  {played ? "Shift already logged" : "Welcome back"}, {existing.fullName}{" "}
                  <span className="num">{existing.displayId}</span>
                </p>
                <p className={k.note}>
                  {played
                    ? "Each registration gets one game, and this ID has played it. Your score is on the board."
                    : "You signed up but haven’t played yet. Continue to start your shift."}
                </p>
                <div className={k.row}>
                  {!played && (
                    <Button variant="primary" iconAfter="arrowRight" onClick={() => void proceed(existing)}>
                      That’s me, continue
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setExisting(null);
                      setPlayed(false);
                    }}
                  >
                    {played ? "Back" : "Not me, change ID"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className={styles.fields}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>
                    <Icon name="user" size={18} /> Full name
                  </span>
                  <input
                    className={styles.input}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="As it should appear on the board"
                    maxLength={60}
                    autoComplete="off"
                    autoFocus
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>
                    <Icon name="id" size={18} /> Roll number or phone
                  </span>
                  <input
                    className={styles.input}
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    placeholder="e.g. 22CS1043"
                    maxLength={40}
                    autoComplete="off"
                    inputMode="text"
                  />
                  <span className={k.note}>Never shown on screen. Used to contact winners.</span>
                </label>
                <label className={styles.consent}>
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span className={styles.box} aria-hidden="true">
                    <Icon name="check" size={18} />
                  </span>
                  <span>
                    I agree to wear the EEG headset and to my name and score appearing on the event leaderboard. I
                    understand the focus score is a game metric, not a medical measurement.
                  </span>
                </label>
                {error && (
                  <p className={k.error} role="alert">
                    <Icon name="alert" size={18} /> {error}
                  </p>
                )}
                <div className={k.row}>
                  <Button
                    type="button"
                    variant="ghost"
                    icon="arrowLeft"
                    onClick={() => {
                      dispatch({ type: "RESET" });
                      router.push("/");
                    }}
                  >
                    Back
                  </Button>
                  <span className={k.spacer} />
                  <Button type="submit" variant="primary" size="lg" iconAfter="arrowRight" disabled={busy}>
                    {busy ? "Signing…" : "Continue"}
                  </Button>
                </div>
              </div>
            )}
          </form>
        </Panel>

        <aside className={styles.side}>
          <Panel label="Shift briefing" hazard>
            <ul className={styles.brief}>
              <li>
                <Icon name="skull" size={22} />
                <span>
                  <b>They walk left to right.</b> Stop them before they reach the substation gate.
                </span>
              </li>
              <li>
                <Icon name="target" size={22} />
                <span>
                  <b>Click to fire the arc.</b> A wandering mind makes them shake, blur and lurch.
                </span>
              </li>
              <li>
                <Icon name="bolt" size={22} />
                <span>
                  <b>Stay focused to chain.</b> Sustained focus multiplies every kill: ×2, ×3, ×5, ×8.
                </span>
              </li>
              <li>
                <Icon name="trophy" size={22} />
                <span>
                  <b>One shift per player.</b> You can’t die: the shift runs the full 45 seconds.
                </span>
              </li>
            </ul>
          </Panel>
        </aside>
      </div>
    </main>
  );
}
