/**
 * WCAG AA contrast (§15): every text/background token pair the UI uses, and
 * the key chart colours against cream. Add a row here when a component
 * starts putting a new text colour on a new surface.
 */
import { describe, expect, it } from "vitest";
import { contrastRatio, TARGET_RATIO } from "./contrast.ts";
import { chartTheme } from "./chartTheme.ts";
import { OTHER_COLOR } from "./colorMap.ts";
import { color, creamSurfaces, seriesColors, statusColor, type ColorToken } from "./tokens.ts";

const surfaces: ColorToken[] = ["surface-cream-deep", "surface-cream", "surface-cream-light", "surface-white"];

/** [text, background, where it's used] — body text, so 4.5:1. */
const textPairs: [ColorToken, ColorToken, string][] = [
  ...(["text-strong", "text", "text-muted", "accent-blue", "orange-700", "pink-700", "status-danger", "status-ok"] as ColorToken[]).flatMap(
    (fg) => surfaces.map((bg): [ColorToken, ColorToken, string] => [fg, bg, "text on surfaces"]),
  ),
  ["text-strong", "accent-blue-soft", "focused dock item, icon-button hover"],
  ["text", "accent-blue-soft", "segments / ghost button hover"],
  ["text-muted", "accent-blue-soft", "secondary text on hover"],
  ["accent-blue", "accent-blue-soft", "on-track status label"],
  ["text-on-accent", "accent-blue", "primary button"],
  ["text-on-accent", "accent-blue-hover", "primary button hover"],
  ["text-on-accent", "accent-blue-pressed", "primary button pressed"],
  ["text-on-accent", "text-strong", "tooltip"],
  ["orange-700", "orange-100", "warning status label"],
  ["pink-700", "pink-100", "pink highlight label"],
  ["status-danger", "status-danger-bg", "over status label / danger button"],
  ["status-ok", "status-ok-bg", "under status label"],
  ["text-strong", "orange-100", "text on orange highlight"],
  ["text-strong", "pink-100", "text on pink highlight"],
];

describe("WCAG AA contrast: text", () => {
  it.each(textPairs)("%s on %s (%s) >= 4.5:1", (fg, bg) => {
    expect(contrastRatio(color[fg], color[bg])).toBeGreaterThanOrEqual(TARGET_RATIO.AA);
  });

  it("status aliases are text-safe on their backgrounds", () => {
    expect(contrastRatio(statusColor.warning, statusColor.warningBg)).toBeGreaterThanOrEqual(TARGET_RATIO.AA);
    expect(contrastRatio(statusColor.danger, statusColor.dangerBg)).toBeGreaterThanOrEqual(TARGET_RATIO.AA);
    expect(contrastRatio(statusColor.ok, statusColor.okBg)).toBeGreaterThanOrEqual(TARGET_RATIO.AA);
  });

  it("chart axis labels and legend text are text-safe on cream", () => {
    for (const bg of creamSurfaces) {
      expect(contrastRatio(chartTheme.categoryAxis.axisLabel.color, bg)).toBeGreaterThanOrEqual(TARGET_RATIO.AA);
      expect(contrastRatio(chartTheme.legend.textStyle.color, bg)).toBeGreaterThanOrEqual(TARGET_RATIO.AA);
    }
  });
});

describe("WCAG AA contrast: UI and chart graphics (1.4.11, 3:1)", () => {
  const backgrounds = [...creamSurfaces, color["surface-white"]];

  it.each(seriesColors.map((c, i) => [i, c]))("series colour %i (%s) >= 3:1 on every cream and white", (_i, c) => {
    for (const bg of backgrounds) expect(contrastRatio(c as string, bg)).toBeGreaterThanOrEqual(TARGET_RATIO.UI);
  });

  it("the shared 'Other' shade is visible on cream", () => {
    for (const bg of backgrounds) expect(contrastRatio(OTHER_COLOR, bg)).toBeGreaterThanOrEqual(TARGET_RATIO.UI);
  });

  it("borders and the focus ring stand out from every surface", () => {
    for (const bg of backgrounds) {
      expect(contrastRatio(color.border, bg)).toBeGreaterThanOrEqual(TARGET_RATIO.UI);
      expect(contrastRatio(color["accent-blue"], bg)).toBeGreaterThanOrEqual(TARGET_RATIO.UI);
    }
  });

  it("the axis line is visible on cream", () => {
    for (const bg of creamSurfaces) expect(contrastRatio(chartTheme.categoryAxis.axisLine.lineStyle.color, bg)).toBeGreaterThanOrEqual(TARGET_RATIO.UI);
  });
});

describe("contrast math (ported from make-colors.js)", () => {
  it("matches known ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });
  it("rejects non-hex input", () => {
    expect(() => contrastRatio("red", "#ffffff")).toThrow();
  });
});
