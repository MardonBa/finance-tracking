/**
 * Seams to other Phase 2 tracks that aren't merged yet.
 * Goal celebrations, pictures and colours come straight from windows/goals (merged).
 */
import { buildColorMap, categoryColorMap, type ColorMap } from "../../ui/colorMap.ts";

/**
 * The app-wide category colours (§15) once the spending track sets them; until
 * then (or before its data loads) a map ranked from what this card shows.
 * TODO(revisit): wire after merge — transactions-spending owns setCategoryColorMap(); drop the fallback once it always runs first.
 */
export function overviewCategoryColors(items: ReadonlyArray<{ key: string; value: number }>): ColorMap {
  const global = categoryColorMap();
  return global.named.length > 0 ? global : buildColorMap(items);
}
