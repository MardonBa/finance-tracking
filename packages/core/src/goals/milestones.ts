/**
 * Goal milestones (§11): every 25% or every $300, whichever is the smaller
 * amount; completion is its own (bigger) milestone. Each is celebrated once,
 * even if the balance dips below it and comes back.
 */
import type { Cents } from "../money.ts";
import type { Goal, Id } from "../types.ts";

export const MILESTONE_MAX_STEP_CENTS = 30000;

export function milestoneStep(targetCents: Cents): Cents {
  return Math.max(1, Math.min(Math.round(targetCents / 4), MILESTONE_MAX_STEP_CENTS));
}

export interface Milestone {
  cents: Cents;
  kind: "progress" | "completion";
  /** Share of the target, 0–100. */
  percent: number;
}

/** All milestones of a goal, ascending; the last one is completion at the target. */
export function milestonesFor(targetCents: Cents): Milestone[] {
  if (targetCents <= 0) return [];
  const step = milestoneStep(targetCents);
  const out: Milestone[] = [];
  for (let c = step; c < targetCents; c += step) out.push({ cents: c, kind: "progress", percent: (c * 100) / targetCents });
  out.push({ cents: targetCents, kind: "completion", percent: 100 });
  return out;
}

/**
 * Pure: (goal, current saved, already-celebrated set) → new celebrations,
 * ascending. The caller records them as seen (goals.markMilestonesSeen).
 */
export function newCelebrations(
  goal: Pick<Goal, "id" | "targetCents">,
  savedCents: Cents,
  celebrated: ReadonlySet<Cents>,
): Array<Milestone & { goalId: Id }> {
  return milestonesFor(goal.targetCents)
    .filter((m) => savedCents >= m.cents && !celebrated.has(m.cents))
    .map((m) => ({ ...m, goalId: goal.id }));
}
