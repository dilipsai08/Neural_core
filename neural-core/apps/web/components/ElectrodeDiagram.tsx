import styles from "./ElectrodeDiagram.module.css";

/**
 * Electrode placement for forehead EEG with the BioAmp band:
 * IN+ on the forehead (Fp1/Fp2), IN− and REF on the bony bumps behind the ears.
 */
export function ElectrodeDiagram() {
  return (
    <svg viewBox="0 0 420 340" className={styles.svg} role="img" aria-label="Electrode placement: forehead, and behind both ears">
      {/* head in profile, facing right */}
      <path
        className={styles.head}
        d="M190 40c-62 0-108 44-108 108 0 34 12 60 30 80l2 52c0 10 8 18 18 18h58l4-30h34c14 0 24-10 24-24v-22l18-6c6-2 8-8 5-13l-15-26c-2-58-34-137-70-137Z"
      />
      <path className={styles.ear} d="M170 150c-14 0-22 12-22 26s8 28 20 28c8 0 12-6 12-14 0-6-4-10-4-16 0-8 6-12 6-16 0-6-6-8-12-8Z" />
      <path className={styles.band} d="M110 92c40-30 120-36 160-8" />
      <path className={styles.brow} d="M262 132c8-4 16-4 22 0" />

      {/* IN+ forehead */}
      <circle className={styles.electrode} cx="268" cy="96" r="11" />
      <circle className={styles.core} cx="268" cy="96" r="4" />
      <path className={styles.lead} d="M279 96h22" />
      <text className={styles.tag} x="306" y="92">IN+</text>
      <text className={styles.caption} x="306" y="108">Forehead · Fp1</text>

      {/* mastoid behind ear */}
      <circle className={styles.electrode} cx="140" cy="214" r="11" />
      <circle className={styles.core} cx="140" cy="214" r="4" />
      <path className={styles.lead} d="M129 214H40" />
      <text className={styles.tag} x="40" y="200">IN−</text>
      <text className={styles.caption} x="40" y="236">Behind left ear</text>

      <g className={styles.inset}>
        <rect x="24" y="262" width="196" height="58" rx="8" />
        <circle className={styles.electrode} cx="50" cy="291" r="9" />
        <circle className={styles.core} cx="50" cy="291" r="3.5" />
        <text className={styles.tag} x="68" y="288">REF</text>
        <text className={styles.caption} x="68" y="306">Behind right ear</text>
      </g>
    </svg>
  );
}
