import styles from "./StepRail.module.css";

const STEPS = ["Register", "Headset", "Calibrate", "Hold the line"] as const;

/** Persistent progress rail for the kiosk flow. */
export function StepRail({ active }: { active: 0 | 1 | 2 | 3 }) {
  return (
    <ol className={styles.rail} aria-label="Progress">
      {STEPS.map((label, i) => (
        <li key={label} className={styles.step} data-state={i < active ? "done" : i === active ? "active" : "todo"}>
          <span className={`num ${styles.index}`}>{String(i + 1).padStart(2, "0")}</span>
          <span className={styles.label}>{label}</span>
        </li>
      ))}
    </ol>
  );
}
