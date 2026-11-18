import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { color } from "../../ui/tokens.ts";
import { PIXEL_WAVES_PALETTE } from "./palette.ts";
import { fitScene, sceneMarkup, sceneSvg } from "./scene.ts";
import { PARTS } from "./sceneParts.ts";

describe("pixel-waves scene (§14)", () => {
  it("has the scene parts: clouds, layered waves, twinkles", () => {
    expect(PARTS.tw).toBe(320);
    expect(PARTS.vh).toBe(180);
    expect(PARTS.clouds.length).toBeGreaterThan(0);
    expect(PARTS.layers.length).toBeGreaterThan(1);
  });

  it("composes like register.tsx: sky, each cloud, each layer twice, every third twinkle", () => {
    const svg = sceneSvg();
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain(`fill="${PIXEL_WAVES_PALETTE.sky}"`);
    for (const c of PARTS.clouds) expect(svg).toContain(c.g);
    expect(svg.split(`<g transform="translate(${PARTS.tw},0)">`).length - 1).toBe(PARTS.layers.length);
    const twinkles = sceneMarkup().match(/<rect x="\d+" y="\d+" width="1" height="1"\/>/g) ?? [];
    expect(twinkles.length).toBeGreaterThanOrEqual(Math.ceil(PARTS.twinkles.length / 3));
  });

  it("has no runtime dependency on ~/.claude", () => {
    for (const f of ["scene.ts", "sceneParts.ts", "palette.ts", "PixelWaves.tsx"]) {
      const src = readFileSync(join(import.meta.dirname, f), "utf8");
      expect(src).not.toMatch(/from\s+["'][^"']*\.claude/);
      expect(src).not.toMatch(/import\(["'][^"']*\.claude/);
    }
  });

  it("the app tokens start from the scene's palette", () => {
    expect(color["surface-cream-deep"]).toBe(PIXEL_WAVES_PALETTE.anchors["surface-0"]);
    expect(color["surface-cream"]).toBe(PIXEL_WAVES_PALETTE.anchors["surface-1"]);
    expect(color["surface-cream-light"]).toBe(PIXEL_WAVES_PALETTE.anchors["surface-2"]);
    expect(color["text-strong"]).toBe(PIXEL_WAVES_PALETTE.anchors["text-primary"]);
    expect(color.text).toBe(PIXEL_WAVES_PALETTE.anchors["text-secondary"]);
    expect(color["text-muted"]).toBe(PIXEL_WAVES_PALETTE.anchors["text-muted"]);
    expect(color["accent-blue"]).toBe(PIXEL_WAVES_PALETTE.roles.accent);
  });
});

describe("fitScene: crisp, covering, no stretch", () => {
  const sizes: [number, number, number][] = [
    [1200, 800, 2],
    [1200, 800, 1],
    [721, 481, 2],
    [2560, 900, 2],
    [800, 1600, 1],
    [333, 222, 1.5],
    [1, 1, 3],
  ];

  it.each(sizes)("%ix%i @%sx", (w, h, dpr) => {
    const f = fitScene(w, h, dpr);
    // Integer device pixels per scene pixel.
    expect(Number.isInteger(f.devicePixelsPerUnit)).toBe(true);
    expect(f.width * dpr).toBeCloseTo(PARTS.tw * f.devicePixelsPerUnit, 6);
    // Uniform scale: aspect ratio preserved.
    expect(f.width / f.height).toBeCloseTo(PARTS.tw / PARTS.vh, 6);
    // Covers the desktop.
    expect(f.width).toBeGreaterThanOrEqual(w - 1e-9);
    expect(f.height).toBeGreaterThanOrEqual(h - 1e-9);
    // Smallest such scale.
    const smaller = f.devicePixelsPerUnit - 1;
    if (smaller >= 1) expect(PARTS.tw * smaller < w * dpr || PARTS.vh * smaller < h * dpr).toBe(true);
    // Centred, offset on the device-pixel grid, never leaving a gap.
    expect(f.left).toBeLessThanOrEqual(0);
    expect(f.left + f.width).toBeGreaterThanOrEqual(w - 1 / dpr);
    expect(Math.abs(f.left * dpr - Math.round(f.left * dpr))).toBeLessThan(1e-6);
  });

  it("handles a bad devicePixelRatio", () => {
    expect(fitScene(640, 360, 0).devicePixelsPerUnit).toBe(2);
    expect(fitScene(640, 360, Number.NaN).devicePixelsPerUnit).toBe(2);
  });
});
