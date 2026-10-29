"use client";

import { useCallback, useEffect, useState } from "react";
import { backupAvailable, clearBackup, readBackup, type BackupEntry } from "@/lib/localBackup";
import { Button } from "./Button";
import { Panel } from "./Panel";
import styles from "./BackupPanel.module.css";

function hoursLeft(e: BackupEntry): string {
  const h = Math.max(0, (e.expiresAt - Date.now()) / 3_600_000);
  return h >= 1 ? `${Math.floor(h)} h` : `${Math.ceil(h * 60)} min`;
}

/** The kiosk's encrypted 24-hour backup of name, roll number and score (operator only). */
export function BackupPanel() {
  const [entries, setEntries] = useState<BackupEntry[]>([]);
  const [available, setAvailable] = useState(true);

  const load = useCallback(() => {
    setAvailable(backupAvailable());
    void readBackup().then(setEntries);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [load]);

  const download = () => {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = entries.map((e) =>
      [e.name, e.rollNumber, e.score ?? "", e.runId ?? "", new Date(e.savedAt).toISOString()].map(esc).join(","),
    );
    const blob = new Blob([["name,roll_number,score,run_id,saved_at", ...rows].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `neural-core-kiosk-backup-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Panel
      label="This browser's backup · encrypted · deleted after 24 h"
      aside={<span>{entries.length} entries</span>}
      className={styles.panel}
    >
      {!available ? (
        <p className={styles.muted}>
          Backup is off on this device: browsers only allow encryption on http://localhost or https. Open the kiosk via
          localhost to enable it.
        </p>
      ) : entries.length === 0 ? (
        <p className={styles.muted}>Nothing stored. Players registered on this browser appear here for 24 hours.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Roll number</th>
              <th className={styles.right}>Score</th>
              <th>Saved</th>
              <th>Deletes in</th>
            </tr>
          </thead>
          <tbody>
            {entries
              .slice()
              .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
              .map((e) => (
                <tr key={`${e.playerId}-${e.runId ?? "reg"}`}>
                  <td>{e.name}</td>
                  <td className="num">{e.rollNumber}</td>
                  <td className={`num ${styles.right}`}>{e.score ?? "–"}</td>
                  <td className="num">{new Date(e.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="num">{hoursLeft(e)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
      <div className={styles.actions}>
        <Button size="sm" icon="download" onClick={download} disabled={entries.length === 0}>
          Download CSV
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={entries.length === 0}
          onClick={() => {
            if (window.confirm("Delete this browser's backup now?")) void clearBackup().then(load);
          }}
        >
          Delete now
        </Button>
      </div>
    </Panel>
  );
}
