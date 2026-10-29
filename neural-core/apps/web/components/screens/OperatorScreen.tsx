"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { FocusFrame, StationStatus } from "@neural-core/shared";
import { Brand } from "@/components/Brand";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Panel } from "@/components/Panel";
import { api, operatorApi, type OperatorState } from "@/lib/api";
import { safeGet, safeSet } from "@/lib/config";
import { useLink, useMessages } from "@/lib/link";
import styles from "./OperatorScreen.module.css";

const PIN_KEY = "nc.operatorPin";

export function OperatorScreen() {
  const [pin, setPin] = useState<string | null>(null);
  const [entry, setEntry] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setPin(safeGet(PIN_KEY, "session")), []);

  const login = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await operatorApi.state(entry);
      safeSet(PIN_KEY, entry, "session");
      setPin(entry);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wrong PIN");
    }
  };

  if (!pin) {
    return (
      <main className={styles.gate}>
        <form className={styles.gateCard} onSubmit={login}>
          <Brand />
          <h1 className={styles.gateTitle}>Operator console</h1>
          <p className={styles.muted}>Volunteers only. Enter the station PIN.</p>
          <input
            className={styles.pin}
            type="password"
            inputMode="numeric"
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
            autoFocus
            aria-label="Operator PIN"
          />
          {error && <p className={styles.err}>{error}</p>}
          <Button variant="primary" type="submit" icon="lock">
            Unlock
          </Button>
        </form>
      </main>
    );
  }
  return (
    <Console
      pin={pin}
      onLock={() => {
        safeSet(PIN_KEY, null, "session");
        setPin(null);
      }}
    />
  );
}

function Console({ pin, onLock }: { pin: string; onLock: () => void }) {
  const linkState = useLink("operator");
  const [state, setState] = useState<OperatorState | null>(null);
  const [ports, setPorts] = useState<Array<{ path: string; label: string }>>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [newStation, setNewStation] = useState("");
  const history = useRef<Record<number, number[]>>({});
  const [focus, setFocus] = useState<Record<number, FocusFrame>>({});

  const load = useCallback(() => {
    operatorApi
      .state(pin)
      .then(setState)
      .catch((e: Error) => {
        if (e.message.includes("PIN")) onLock();
        setToast(e.message);
      });
  }, [pin, onLock]);

  useEffect(() => {
    load();
    const id = setInterval(load, 2500);
    return () => clearInterval(id);
  }, [load]);

  const refreshPorts = useCallback(() => {
    operatorApi.ports(pin).then(setPorts).catch((e: Error) => setToast(`Port scan failed: ${e.message}`));
  }, [pin]);
  useEffect(refreshPorts, [refreshPorts]);

  useMessages((m) => {
    if (m.type === "focus") {
      const h = (history.current[m.station] ??= []);
      h.push(m.score);
      if (h.length > 120) h.shift();
      setFocus((f) => ({ ...f, [m.station]: m }));
    }
    if (m.type === "station" || m.type === "leaderboard:update") load();
  });

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      setToast(done);
      load();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Action failed");
    }
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <main className={styles.console}>
      <header className={styles.header}>
        <Brand />
        <h1 className={styles.title}>Operator console</h1>
        <div className={styles.headerActions}>
          <span className={styles.chip} data-ok={linkState === "open"}>
            <i /> WebSocket {linkState}
          </span>
          <span className={styles.chip} data-ok>
            <span className="num">{state?.players ?? 0}</span> players
          </span>
          <span className={styles.chip} data-ok={state?.database === "connected"}>
            <i /> PostgreSQL {state?.database ?? "…"}
          </span>
          <Button
            size="sm"
            variant={state?.frozenAt ? "danger" : "secondary"}
            icon="lock"
            onClick={() => void act(() => operatorApi.freeze(pin, !state?.frozenAt), state?.frozenAt ? "Board unfrozen" : "Board frozen")}
          >
            {state?.frozenAt ? "Unfreeze board" : "Freeze board"}
          </Button>
          <a className={styles.link} href={operatorApi.exportUrl(pin)} download>
            <Icon name="download" size={16} /> Export CSV
          </a>
          <Button size="sm" variant="ghost" onClick={onLock}>
            Lock
          </Button>
        </div>
      </header>

      <section className={styles.stations}>
        {(state?.stations ?? []).map((s) => (
          <StationCard
            key={s.id}
            pin={pin}
            status={s}
            frame={focus[s.id] ?? null}
            history={history.current[s.id] ?? []}
            ports={ports}
            onPorts={refreshPorts}
            act={act}
          />
        ))}
        <Panel tone="sunken" className={styles.addStation}>
          <span className="label">Add a station</span>
          <p className={styles.muted}>Open a kiosk with ?station=N, or add it here first.</p>
          <div className={styles.inline}>
            <input className={styles.small} value={newStation} onChange={(e) => setNewStation(e.target.value)} placeholder="2" />
            <Button
              size="sm"
              onClick={() => void act(() => api.station(Number(newStation)), `Station ${newStation} added`)}
            >
              Add
            </Button>
          </div>
        </Panel>
      </section>

      <div className={styles.lower}>
        <Panel label="Recent shifts" aside={<span>{state?.attemptsAllowed} ranked per player</span>} className={styles.runs}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Run</th>
                <th>Player</th>
                <th>Stn</th>
                <th>Status</th>
                <th className={styles.right}>Score</th>
                <th className={styles.right}>Client</th>
                <th>Check</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(state?.runs ?? []).map((r) => (
                <tr key={r.id}>
                  <td className="num">#{r.id}</td>
                  <td>
                    {r.player?.fullName ?? "?"} <span className={styles.muted}>{r.player?.displayId}</span>
                  </td>
                  <td className="num">{r.station}</td>
                  <td>
                    <span className={styles.status} data-status={r.status}>
                      {r.status}
                    </span>
                  </td>
                  <td className={`num ${styles.right}`}>{r.stats?.score ?? "–"}</td>
                  <td className={`num ${styles.right}`}>{r.clientScore ?? "–"}</td>
                  <td title={r.verification?.notes.join("\n")}>
                    {r.verification ? (
                      r.verification.ok ? (
                        <Icon name="check" size={16} className={styles.ok} />
                      ) : (
                        <span className={styles.warnText}>
                          <Icon name="alert" size={16} /> {r.verification.notes[0] ?? "review"}
                        </span>
                      )
                    ) : null}
                  </td>
                  <td className={styles.rowActions}>
                    {r.status !== "disqualified" && r.stats && (
                      <Button size="sm" variant="ghost" onClick={() => void act(() => operatorApi.runStatus(pin, r.id, "disqualified"), `Run #${r.id} disqualified`)}>
                        Disqualify
                      </Button>
                    )}
                    {r.status === "valid" && (
                      <Button size="sm" variant="ghost" onClick={() => void act(() => operatorApi.runStatus(pin, r.id, "redo"), `Run #${r.id} marked redo; the player gets the attempt back`)}>
                        Redo
                      </Button>
                    )}
                    {(r.status === "disqualified" || r.status === "redo") && (
                      <Button size="sm" variant="ghost" onClick={() => void act(() => operatorApi.runStatus(pin, r.id, "valid"), `Run #${r.id} restored`)}>
                        Restore
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel label="Server log" className={styles.logs}>
          <pre className={styles.pre}>{(state?.logs ?? []).slice().reverse().join("\n")}</pre>
          <span className="label">Connected devices</span>
          <ul className={styles.conns}>
            {(state?.connections ?? []).map((c, i) => (
              <li key={i}>
                {c.role}
                {c.station ? ` · stn ${c.station}` : ""} <span className={styles.muted}>{c.addr.replace("::ffff:", "")}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {toast && <div className={styles.toast}>{toast}</div>}
    </main>
  );
}

function StationCard({
  pin,
  status: s,
  frame,
  history,
  ports,
  onPorts,
  act,
}: {
  pin: string;
  status: StationStatus & { recording?: boolean };
  frame: FocusFrame | null;
  history: number[];
  ports: Array<{ path: string; label: string }>;
  onPorts: () => void;
  act: (fn: () => Promise<unknown>, done: string) => Promise<void>;
}) {
  const [port, setPort] = useState("");
  const [slider, setSlider] = useState(s.fakeTarget ?? 60);
  const cmd = (action: string, done: string) => act(() => operatorApi.command(pin, s.id, action), done);
  const spark = history.map((v, i) => `${i ? "L" : "M"}${(i / 119) * 240} ${40 - (v / 100) * 38}`).join(" ");

  return (
    <Panel className={styles.station} screws>
      <header className={styles.stationHead}>
        <span className={styles.lamp} data-q={s.connected ? s.quality : "off"} />
        <h2 className={styles.stationTitle}>{s.label}</h2>
        <span className={`num ${styles.focusNum}`}>{s.connected && frame ? Math.round(frame.score) : "--"}</span>
      </header>
      <p className={styles.muted}>
        {s.source} · {s.sourceDetail} · {s.connected ? s.quality : "no data"}
        {frame && frame.artifact !== "none" ? ` · ${frame.artifact}` : ""}
      </p>
      <svg viewBox="0 0 240 42" className={styles.spark} aria-hidden="true">
        <path d={spark} />
      </svg>
      <dl className={styles.facts}>
        <div>
          <dt>Player</dt>
          <dd>{s.playerId ?? "–"}</dd>
        </div>
        <div>
          <dt>Run</dt>
          <dd>{s.runId ? `#${s.runId}${s.paused ? " (paused)" : ""}` : "–"}</dd>
        </div>
        <div>
          <dt>Calibration</dt>
          <dd>
            {s.calibrating ? `measuring ${s.calibrating}` : s.calibration ? `${s.calibration.low}–${s.calibration.high} (${s.calibration.source})` : "none"}
          </dd>
        </div>
      </dl>

      <div className={styles.group}>
        <span className="label">Sensor source</span>
        <div className={styles.segment}>
          {(["none", "fake", "bridge"] as const).map((k) => (
            <button key={k} data-on={s.source === k} onClick={() => void act(() => operatorApi.source(pin, s.id, { kind: k }), `${s.label}: ${k}`)}>
              {k}
            </button>
          ))}
        </div>
        <div className={styles.inline}>
          <select className={styles.select} value={port} onChange={(e) => setPort(e.target.value)} onFocus={onPorts}>
            <option value="">Serial port…</option>
            {ports.map((p) => (
              <option key={p.path} value={p.path}>
                {p.path} · {p.label}
              </option>
            ))}
          </select>
          <Button size="sm" icon="usb" disabled={!port} onClick={() => void act(() => operatorApi.source(pin, s.id, { kind: "serial", port }), `${s.label}: serial ${port}`)}>
            Use
          </Button>
        </div>
      </div>

      {s.source === "fake" && (
        <div className={styles.group}>
          <span className="label">Fake focus {s.fakeTarget === null ? "· wandering" : `· ${s.fakeTarget}`}</span>
          <div className={styles.inline}>
            <input
              type="range"
              min={0}
              max={100}
              value={slider}
              className={styles.range}
              onChange={(e) => setSlider(Number(e.target.value))}
              onPointerUp={() => void act(() => operatorApi.fake(pin, s.id, slider), `Fake focus ${slider}`)}
              aria-label="Fake focus level"
            />
            <Button size="sm" variant="ghost" onClick={() => void act(() => operatorApi.fake(pin, s.id, null), "Fake focus wandering")}>
              Wander
            </Button>
          </div>
        </div>
      )}

      <div className={styles.commands}>
        <Button size="sm" icon="pause" onClick={() => void cmd("pause", "Paused")}>
          Pause
        </Button>
        <Button size="sm" icon="play" onClick={() => void cmd("resume", "Resumed")}>
          Resume
        </Button>
        <Button size="sm" icon="refresh" onClick={() => void cmd("skip-calibration", "Calibration skipped")}>
          Skip cal.
        </Button>
        <Button size="sm" variant="danger" icon="stop" onClick={() => void cmd("abort", "Run aborted")}>
          Abort
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void cmd("reset", "Station reset")}>
          Next player
        </Button>
        <Button
          size="sm"
          variant={s.recording ? "danger" : "ghost"}
          icon="record"
          onClick={() => void act(() => operatorApi.record(pin, s.id, !s.recording), s.recording ? "Recording saved" : "Recording raw signal")}
        >
          {s.recording ? "Stop rec" : "Record"}
        </Button>
      </div>
    </Panel>
  );
}
