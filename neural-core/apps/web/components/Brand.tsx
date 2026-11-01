import styles from "./Brand.module.css";

/** Wordmark: a hex nut with an arc through it, set beside a condensed stencil name. */
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={styles.brand}>
      <svg viewBox="0 0 40 40" className={styles.mark} aria-hidden="true">
        <path d="M20 2.5 35.2 11.25v17.5L20 37.5 4.8 28.75v-17.5Z" className={styles.nut} />
        <circle cx="20" cy="20" r="8.5" className={styles.bore} />
        <path d="M21.5 9.5 16 21h5l-2.5 9.5 7-13h-5l1.5-8Z" className={styles.arc} />
      </svg>
      {!compact && (
        <div className={styles.words}>
          <span className={styles.name}>Neural Core</span>
          <span className={styles.sub}>Substation 07 · Night shift</span>
        </div>
      )}
    </div>
  );
}
