/**
 * JS mirror of the colour tokens in tokens.css, for places CSS variables
 * can't reach (ECharts canvas, the colour map). tokens.test.ts checks every
 * entry here equals the same variable in tokens.css. Keys are the CSS
 * variable names without the leading `--`.
 */
export const color = {
  "surface-cream-deep": "#efe6d0",
  "surface-cream": "#f4ecd8",
  "surface-cream-light": "#faf5e8",
  "surface-white": "#ffffff",

  "accent-blue": "#1d4c9e",
  "accent-blue-hover": "#17407f",
  "accent-blue-pressed": "#123366",
  "accent-blue-soft": "#dbe5f5",
  "blue-500": "#3f7fd0",

  "text-strong": "#14233f",
  text: "#33435f",
  "text-muted": "#55627a",
  "text-disabled": "#8a8f99",
  "text-on-accent": "#ffffff",

  "orange-700": "#9a4416",
  "orange-600": "#c2601f",
  "orange-500": "#e07b39",
  "orange-300": "#f2a96b",
  "orange-100": "#fbe3cc",

  "pink-700": "#a03158",
  "pink-600": "#c74a78",
  "pink-500": "#e0668f",
  "pink-300": "#f19db8",
  "pink-100": "#fbdfe8",

  "status-danger": "#a3302a",
  "status-danger-bg": "#f8dcd8",
  "status-ok": "#2f6b4f",
  "status-ok-bg": "#dcefe4",
  "neutral-other": "#8a7f6a",

  border: "#14233f",
  "border-soft": "#d8ccb0",
} as const;

export type ColorToken = keyof typeof color;

/** Aliases defined with var() in tokens.css. */
export const statusColor = {
  warning: color["orange-700"],
  warningBg: color["orange-100"],
  danger: color["status-danger"],
  dangerBg: color["status-danger-bg"],
  ok: color["status-ok"],
  okBg: color["status-ok-bg"],
} as const;

/** The cream surfaces windows and charts sit on. */
export const creamSurfaces = [color["surface-cream-deep"], color["surface-cream"], color["surface-cream-light"]] as const;

/**
 * Categorical chart series, in assignment order. Every one is >= 3:1 against
 * every cream surface and white (WCAG 1.4.11, checked by contrast.test.ts).
 * Kept short on purpose: "small multiples over rainbow stacks" (design.md);
 * anything past this list shares `neutral-other`.
 */
export const seriesColors = [
  color["accent-blue"],
  color["orange-600"],
  color["pink-600"],
  color["blue-500"],
  color["orange-700"],
  color["pink-700"],
] as const;

export const fontSans = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif';
