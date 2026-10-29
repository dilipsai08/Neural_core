import type { SVGProps } from "react";

/**
 * One icon family: 24px grid, 1.75 stroke, square caps, no fills.
 * Drawn for this project so every glyph shares the same weight.
 */
const paths = {
  bolt: <path d="M13 2 5 13.5h6L10 22l8-12h-6l1-8Z" />,
  arrowRight: <path d="M4 12h15M13 6l6 6-6 6" />,
  arrowLeft: <path d="M20 12H5M11 6l-6 6 6 6" />,
  head: (
    <>
      <path d="M12 3c-4.4 0-7.5 3.2-7.5 7.4 0 2.6 1.2 4.3 2.5 5.6V21h7v-2.5h2.2a1.8 1.8 0 0 0 1.8-1.8V14l1.8-.6-1.6-3.3C18.2 5.8 15.6 3 12 3Z" />
      <path d="M9 9.5h3" />
    </>
  ),
  signal: <path d="M3 12h3l2.5-6 4 13 3-9 1.5 2H21" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" />
    </>
  ),
  pause: <path d="M8 5v14M16 5v14" />,
  play: <path d="M7 4.5v15l12-7.5-12-7.5Z" />,
  refresh: <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />,
  stop: <rect x="5.5" y="5.5" width="13" height="13" rx="1" />,
  ban: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m6 6 12 12" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="1.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  download: <path d="M12 3.5v12M6.5 10l5.5 5.5 5.5-5.5M4 20.5h16" />,
  radio: (
    <>
      <rect x="3.5" y="8.5" width="17" height="12" rx="1.5" />
      <path d="M7 8.5 16 3.5M7.5 13h4M7.5 16h4" />
      <circle cx="16" cy="14.5" r="2" />
    </>
  ),
  trophy: (
    <>
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
      <path d="M7 6H4v1.5A3.5 3.5 0 0 0 7.5 11M17 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5M12 14v4M8 20.5h8" />
    </>
  ),
  usb: (
    <>
      <path d="M12 2.5v15M9 6l3-3.5L15 6" />
      <path d="M12 13 7.5 10.5V8M12 15.5l4.5-2.5V10" />
      <circle cx="12" cy="19.5" r="2" />
    </>
  ),
  volume: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5Z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  mute: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5Z" />
      <path d="m16 9.5 5 5M21 9.5l-5 5" />
    </>
  ),
  check: <path d="m4.5 12.5 5 5 10-11" />,
  alert: (
    <>
      <path d="M12 3.5 2.5 20h19L12 3.5Z" />
      <path d="M12 10v4.5M12 17v.5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5c1-3.7 4-5.5 7.5-5.5s6.5 1.8 7.5 5.5" />
    </>
  ),
  id: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <circle cx="8.5" cy="11" r="2" />
      <path d="M5.5 16c.7-1.5 1.8-2.2 3-2.2s2.3.7 3 2.2M14 10h4M14 13.5h3" />
    </>
  ),
  skull: (
    <>
      <path d="M12 3c-4.4 0-7.5 3-7.5 7.2 0 2.4 1 4 2.5 5V19h10v-3.8c1.5-1 2.5-2.6 2.5-5C19.5 6 16.4 3 12 3Z" />
      <circle cx="9" cy="11" r="1.6" />
      <circle cx="15" cy="11" r="1.6" />
      <path d="M10 19v2M14 19v2" />
    </>
  ),
  pylon: <path d="M12 2.5 7 21.5M12 2.5l5 19M5 7.5h14M7.5 12.5h9M6.2 17h11.6M9 7.5l5 5M15 7.5l-5 5M8 12.5l7.6 4.5M16 12.5 8.4 17" />,
  wave: <path d="M2.5 12c2 0 2-5 4-5s2 10 4 10 2-10 4-10 2 10 4 10 1.5-5 3-5" />,
  record: <circle cx="12" cy="12" r="6" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 24, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}
