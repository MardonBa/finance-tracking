/**
 * Stable colours for categories and goals (§15): each category and each goal
 * keeps the same colour in every window.
 *
 * Categories: ONE app-wide map is built from all categories ranked by overall
 * size (e.g. 12-month spending), not per chart. The biggest `maxColors` get a
 * palette colour by rank; every smaller one shares the neutral "Other". A
 * chart then calls `foldOther()` to merge its "Other" members into one entry.
 * Because the map is global and its input is sorted deterministically
 * (value desc, then key), the same data always gives the same colours.
 *
 * Goals: colour by creation order (`goalColorMap`), so reordering priorities
 * never recolours a goal.
 *
 * Phase 2: call `setCategoryColorMap(buildColorMap(...))` once after loading
 * category totals; windows call `categoryColor(key)` / `foldOther(...)`.
 */
import { color, seriesColors } from "./tokens.ts";

export const OTHER_KEY = "__other__";
export const OTHER_LABEL = "Other";
export const OTHER_COLOR: string = color["neutral-other"];

export interface RankedItem {
  key: string;
  /** Size used for ranking (e.g. total spend in cents). Sign is ignored. */
  value: number;
}

export interface ColorMap {
  /** The key's colour; unknown keys and small categories get OTHER_COLOR. */
  get(key: string): string;
  isOther(key: string): boolean;
  /** Keys that have their own colour, biggest first. */
  readonly named: readonly string[];
}

export interface BuildOptions {
  /** Max distinct colours (defaults to the palette size). */
  maxColors?: number;
  /** Items below this share of the total fall into "Other" (default 0.02 = 2%). */
  minShare?: number;
  palette?: readonly string[];
}

// TODO(revisit): 6 named colours and a 2% cut-off for "Other" are first guesses.
export function buildColorMap(items: readonly RankedItem[], opts: BuildOptions = {}): ColorMap {
  const palette = opts.palette ?? seriesColors;
  const maxColors = Math.min(opts.maxColors ?? palette.length, palette.length);
  const minShare = opts.minShare ?? 0.02;
  const total = items.reduce((s, i) => s + Math.abs(i.value), 0);
  const sorted = [...items].sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const named: string[] = [];
  const colors = new Map<string, string>();
  for (const item of sorted) {
    if (named.length >= maxColors) break;
    if (colors.has(item.key)) continue;
    if (total > 0 && Math.abs(item.value) / total < minShare) break;
    colors.set(item.key, palette[named.length] as string);
    named.push(item.key);
  }
  return {
    get: (key) => colors.get(key) ?? OTHER_COLOR,
    isOther: (key) => !colors.has(key),
    named,
  };
}

/** Goals keep the colour of their creation order, cycling the palette. */
export function goalColorMap(goalIdsInCreationOrder: readonly string[], palette: readonly string[] = seriesColors): ColorMap {
  const colors = new Map<string, string>();
  goalIdsInCreationOrder.forEach((id, i) => colors.set(id, palette[i % palette.length] as string));
  return {
    get: (key) => colors.get(key) ?? OTHER_COLOR,
    isOther: (key) => !colors.has(key),
    named: [...goalIdsInCreationOrder],
  };
}

export interface ChartItem {
  key: string;
  label: string;
  value: number;
}

export interface ColoredChartItem extends ChartItem {
  color: string;
  /** Keys merged into this entry (only on "Other"). */
  members?: string[];
}

/** Colours one chart's items from the map and merges the "Other" ones (kept last). */
export function foldOther(items: readonly ChartItem[], map: ColorMap): ColoredChartItem[] {
  const out: ColoredChartItem[] = [];
  const members: string[] = [];
  let otherValue = 0;
  for (const item of items) {
    if (map.isOther(item.key)) {
      members.push(item.key);
      otherValue += item.value;
    } else {
      out.push({ ...item, color: map.get(item.key) });
    }
  }
  if (members.length > 0) out.push({ key: OTHER_KEY, label: OTHER_LABEL, value: otherValue, color: OTHER_COLOR, members });
  return out;
}

let categoryMap: ColorMap = buildColorMap([]);

/** Set once (per data load) from all categories' overall totals. */
export function setCategoryColorMap(map: ColorMap): void {
  categoryMap = map;
}

export function categoryColorMap(): ColorMap {
  return categoryMap;
}

export function categoryColor(key: string): string {
  return categoryMap.get(key);
}
