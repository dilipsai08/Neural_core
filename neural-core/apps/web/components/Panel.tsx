import type { HTMLAttributes, ReactNode } from "react";
import styles from "./Panel.module.css";

/** Machined graphite plate: edge highlight, inset shadow, optional screws and header. */
export function Panel({
  label,
  aside,
  screws = false,
  hazard = false,
  tone = "default",
  children,
  className,
  ...rest
}: {
  label?: ReactNode;
  aside?: ReactNode;
  screws?: boolean;
  hazard?: boolean;
  tone?: "default" | "sunken";
  children?: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  return (
    <section className={[styles.panel, styles[tone], hazard && styles.hazard, className].filter(Boolean).join(" ")} {...rest}>
      {screws && (
        <>
          <i className={`${styles.screw} ${styles.tl}`} />
          <i className={`${styles.screw} ${styles.tr}`} />
          <i className={`${styles.screw} ${styles.bl}`} />
          <i className={`${styles.screw} ${styles.br}`} />
        </>
      )}
      {(label || aside) && (
        <header className={styles.header}>
          {label && <span className="label">{label}</span>}
          {aside && <span className={styles.aside}>{aside}</span>}
        </header>
      )}
      {children}
    </section>
  );
}
