/**
 * Seams to other Phase 2 tracks' code that isn't on this branch yet. Each
 * looks the module up at build time (import.meta.glob finds nothing when the
 * file doesn't exist) and falls back to a no-op, so this branch builds alone
 * and picks the real thing up automatically after the merge.
 *
 * TODO(revisit): wire after merge — check each export name below matches.
 */
import type { ComponentType } from "react";
import { buildColorMap, categoryColorMap, type ColorMap } from "../../ui/colorMap.ts";

// --- Goal celebrations (budgets-goals track: windows/goals/GoalCelebrations.tsx exports GoalCelebrations).
const celebrationModules = import.meta.glob<{ GoalCelebrations?: ComponentType }>("../goals/GoalCelebrations.tsx", { eager: true });
const NoCelebrations: ComponentType = () => null;
/** Plays over the Overview when a goal milestone was crossed since the app was last opened (§11, §13). */
export const GoalCelebrations: ComponentType = Object.values(celebrationModules)[0]?.GoalCelebrations ?? NoCelebrations;
export const hasGoalCelebrations = GoalCelebrations !== NoCelebrations;

// --- Goal pictures (budgets-goals track; stored on the Mac only, §11).
// TODO(revisit): wire after merge — the export name `GoalPicture` ({ goalId, name, size }) is assumed.
export interface GoalPictureProps {
  goalId: string;
  name: string;
  size: number;
  color: string;
}
const pictureModules = import.meta.glob<{ GoalPicture?: ComponentType<GoalPictureProps> }>("../goals/GoalPicture.tsx", { eager: true });
export const GoalPictureFromGoals: ComponentType<GoalPictureProps> | undefined = Object.values(pictureModules)[0]?.GoalPicture;

/**
 * The app-wide category colours (§15) once the spending track sets them; until
 * then (or before its data loads) a map ranked from what this card shows.
 * TODO(revisit): the spending track owns setCategoryColorMap(); drop the fallback once it always runs first.
 */
export function overviewCategoryColors(items: ReadonlyArray<{ key: string; value: number }>): ColorMap {
  const global = categoryColorMap();
  return global.named.length > 0 ? global : buildColorMap(items);
}
