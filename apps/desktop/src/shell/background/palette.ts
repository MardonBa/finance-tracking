/**
 * The pixel-waves theme's palette definition, ported from the
 * `makeColors({...})` call in ~/.claude/skills/pixel-waves/hooks/register.tsx.
 * make-colors.js itself expands these anchors into Claude Code's full theme
 * graph, which the app doesn't need: the app's design tokens (ui/tokens.css)
 * start from these same anchors, and its WCAG check (ui/contrast.ts) is a
 * port of make-colors.js's contrast math. scene.test.ts checks the tokens
 * still match these anchors.
 */
export const PIXEL_WAVES_PALETTE = {
  label: "Pixel waves",
  only: "light",
  /** The sky fill behind the clouds and waves. */
  sky: "#f4ecd8",
  roles: { accent: "#1d4c9e", danger: "#b3392f", success: "#3f7a3a", warning: "#a86f14", pro: "#5b4f9a" },
  anchors: {
    "surface-0": "#efe6d0",
    "surface-1": "#f4ecd8",
    "surface-2": "#faf5e8",
    "text-primary": "#14233f",
    "text-secondary": "#33435f",
    "text-muted": "#55627a",
  },
  /** register.tsx's backdrop glass (unused: the app's windows are opaque cards). */
  glass: { blur: 10, tint: "#f4ecd8", opacity: 0.6 },
  /** Twinkle sparkles. */
  twinkle: "#ffffff",
} as const;
