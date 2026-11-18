/**
 * Small inline icon set (24x24, 2px strokes, currentColor). Pixel-friendly
 * square caps to match the background. Decorative by default (aria-hidden);
 * controls supply their own label.
 */
import type { SVGProps } from "react";

const paths = {
  close: "M6 6l12 12M18 6L6 18",
  minimize: "M5 17h14",
  maximize: "M5 5h14v14H5z",
  restore: "M8 8h11v11H8zM5 16V5h11",
  plus: "M12 5v14M5 12h14",
  check: "M5 12l5 5L19 7",
  warning: "M12 4l9 16H3zM12 10v4M12 17v.5",
  arrowUp: "M12 19V5M6 11l6-6 6 6",
  arrowDown: "M12 5v14M6 13l6 6 6-6",
  dash: "M6 12h12",
  info: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v6M12 7.5v.5",
  grip: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
  lock: "M6 11h12v9H6zM8 11V8a4 4 0 018 0v3",
  fingerprint:
    "M7 11a5 5 0 0110 0v2M12 11v4a6 6 0 01-1 3M9 12v2a8 8 0 01-1 4M15 13a10 10 0 01-1 6M4 9a8.5 8.5 0 0116 0",
  chevronDown: "M6 9l6 6 6-6",
  search: "M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4",
  // Accounts, sync, security (onboarding-overview track)
  refresh: "M20 12a8 8 0 11-2.3-5.6M20 4v5h-5",
  shield: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM9 12l2 2 4-4",
  bank: "M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18",
  cash: "M3 7h18v10H3zM12 10a2 2 0 100 4 2 2 0 000-4z",
  pencil: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  chevronRight: "M9 6l6 6-6 6",
  // Areas
  overview: "M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z",
  spending: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  budgets: "M4 7h16M4 12h10M4 17h6M17 14l3 3-3 3",
  goals: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 7a5 5 0 100 10 5 5 0 000-10zM12 11v2",
  recurring: "M4 12a8 8 0 0114-5l2 2M20 12a8 8 0 01-14 5l-2-2M20 4v5h-5M4 20v-5h5",
  trajectory: "M3 19l6-6 4 4 8-9M15 8h6v6",
  investments: "M4 20h16M6 16v-4M10 16V8M14 16v-6M18 16V5",
  transactions: "M5 5h14M5 10h14M5 15h14M5 20h9",
  assistant: "M4 5h16v11H9l-5 4zM9 10h.01M12 10h.01M15 10h.01",
} as const;

export type IconName = keyof typeof paths;
export const iconNames = Object.keys(paths) as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 18, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={paths[name]} />
    </svg>
  );
}
