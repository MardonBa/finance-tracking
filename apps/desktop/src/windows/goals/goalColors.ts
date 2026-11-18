/**
 * Each goal keeps the same colour everywhere (§15). Core gives every goal a
 * stable `colorSlot` when it's created (the lowest slot not used by another
 * active goal), so reordering or archiving never recolours a goal. Every
 * window (Goals, Overview, ...) colours goals with this function.
 */
import { seriesColors } from "../../ui/tokens.ts";

export function goalColor(colorSlot: number): string {
  return seriesColors[((colorSlot % seriesColors.length) + seriesColors.length) % seriesColors.length] as string;
}
