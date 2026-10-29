import type { BandPowers } from "@neural-core/shared";
import styles from "./BandBars.module.css";

const BANDS: Array<{ key: keyof BandPowers; label: string; hz: string }> = [
  { key: "theta", label: "Theta", hz: "4–8 Hz" },
  { key: "alpha", label: "Alpha", hz: "8–13 Hz" },
  { key: "beta", label: "Beta", hz: "13–30 Hz" },
  { key: "high", label: "Muscle", hz: "30–45 Hz" },
];

/** Relative band power as segmented meters. Muscle (30-45 Hz) is shown as a warning band. */
export function BandBars({ bands }: { bands: BandPowers | null }) {
  const total = bands ? bands.theta + bands.alpha + bands.beta + bands.high : 0;
  return (
    <div className={styles.bars}>
      {BANDS.map((b) => {
        const share = bands && total > 0 ? bands[b.key] / total : 0;
        const lit = Math.round(share * 20);
        return (
          <div key={b.key} className={styles.bar} data-band={b.key}>
            <div className={styles.head}>
              <span className={styles.name}>{b.label}</span>
              <span className="num">{Math.round(share * 100)}%</span>
            </div>
            <div className={styles.meter} aria-hidden="true">
              {Array.from({ length: 20 }, (_, i) => (
                <i key={i} data-on={i < lit} />
              ))}
            </div>
            <span className={styles.hz}>{b.hz}</span>
          </div>
        );
      })}
    </div>
  );
}
