/**
 * Composes the still pixel-waves scene (cream sky, clouds, layered waves)
 * exactly as the Claude Code theme's register.tsx does, and fits it to any
 * desktop size with integer device-pixel scaling so pixel edges stay crisp.
 */
import { PIXEL_WAVES_PALETTE } from "./palette.ts";
import { PARTS, type SceneParts } from "./sceneParts.ts";

/** Inner SVG markup (no <svg> wrapper), in scene units of PARTS.tw x PARTS.vh. */
export function sceneMarkup(parts: SceneParts = PARTS): string {
  const { tw } = parts;
  let out = `<rect x="-2000" y="-2000" width="5000" height="5000" fill="${PIXEL_WAVES_PALETTE.sky}"/>`;
  for (const c of parts.clouds) out += c.g;
  for (const L of parts.layers) {
    // show the tile from its start; the second copy covers any width past it
    out += `<g>${L.g}</g><g transform="translate(${tw},0)">${L.g}</g>`;
  }
  out += `<g fill="${PIXEL_WAVES_PALETTE.twinkle}">`;
  parts.twinkles.forEach(([x, y], i) => {
    if (i % 3 === 0) out += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
  });
  return out + "</g>";
}

/** The full standalone SVG, identical to register.tsx's `scene()`. */
export function sceneSvg(parts: SceneParts = PARTS): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${parts.tw} ${parts.vh}" preserveAspectRatio="xMidYMax slice" shape-rendering="crispEdges">` +
    sceneMarkup(parts) +
    "</svg>"
  );
}

export interface SceneFit {
  /** Device pixels per scene pixel: always a whole number (crisp edges). */
  devicePixelsPerUnit: number;
  /** CSS size of the drawn scene. */
  width: number;
  height: number;
  /** CSS offset from the desktop's left edge (<= 0: centred crop). Bottom-aligned. */
  left: number;
}

/**
 * "Cover" fit like `xMidYMax slice`, but with each scene pixel mapped to a
 * whole number of device pixels (no stretch, no blur): the smallest integer
 * scale that covers the area, centred horizontally, anchored to the bottom.
 */
export function fitScene(cssWidth: number, cssHeight: number, dpr: number, parts: Pick<SceneParts, "tw" | "vh"> = PARTS): SceneFit {
  const ratio = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  const w = Math.max(1, cssWidth) * ratio;
  const h = Math.max(1, cssHeight) * ratio;
  const n = Math.max(1, Math.ceil(Math.max(w / parts.tw, h / parts.vh)));
  const width = (parts.tw * n) / ratio;
  const height = (parts.vh * n) / ratio;
  // Snap the offset to the device-pixel grid too.
  const left = Math.round(((cssWidth - width) / 2) * ratio) / ratio;
  return { devicePixelsPerUnit: n, width, height, left };
}
