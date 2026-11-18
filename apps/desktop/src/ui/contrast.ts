/**
 * WCAG 2.x contrast math, ported from the pixel-waves theme's
 * make-colors.js (`relativeLuminance`, `contrastRatio`, `TARGET_RATIO`).
 */

export const TARGET_RATIO = {
  /** Body text (WCAG AA, 1.4.3). */
  AA: 4.5,
  /** Large text, and graphical objects / UI components (1.4.11). */
  UI: 3,
  AAA: 7,
} as const;

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function relativeLuminance(r: number, g: number, b: number): number {
  const channel = (s: number) => (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(...hexToRgb(a));
  const lb = relativeLuminance(...hexToRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
