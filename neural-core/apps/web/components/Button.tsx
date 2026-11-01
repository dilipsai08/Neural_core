import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  iconAfter,
  children,
  className,
  ...rest
}: {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  iconAfter?: IconName;
  children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={[styles.button, styles[variant], styles[size], className].filter(Boolean).join(" ")} {...rest}>
      {icon && <Icon name={icon} size={size === "lg" ? 26 : size === "sm" ? 16 : 20} />}
      {children && <span>{children}</span>}
      {iconAfter && <Icon name={iconAfter} size={size === "lg" ? 26 : size === "sm" ? 16 : 20} />}
    </button>
  );
}
