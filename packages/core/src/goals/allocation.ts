/**
 * Goal funding (decision 004, design.md §5): the account balance fills the
 * protected amount first, then goals in priority order up to each target;
 * the rest is "Unassigned". Withdrawals therefore reduce the lowest-priority
 * goals first. Below the protected amount every goal is $0 and the account
 * shows a warning.
 */
import { Money, type Cents } from "../money.ts";
import type { AccountId, Goal, Id } from "../types.ts";

/** Goals that hold money: not archived. Completed goals keep their money until archived. */
export function activeGoals<G extends Pick<Goal, "archivedAt">>(goals: readonly G[]): G[] {
  return goals.filter((g) => g.archivedAt === null);
}

/** Funding order: priority ascending, then creation time, then id. */
export function byPriority<G extends Pick<Goal, "priority" | "createdAt" | "id">>(goals: readonly G[]): G[] {
  return [...goals].sort((a, b) => a.priority - b.priority || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface GoalAllocation {
  goalId: Id;
  allocatedCents: Cents;
  targetCents: Cents;
  complete: boolean;
}

export interface AccountAllocation {
  balanceCents: Cents;
  protectedTargetCents: Cents;
  /** Money filling the protected amount (≤ protected target). */
  protectedCents: Cents;
  belowProtected: boolean;
  goals: GoalAllocation[];
  unassignedCents: Cents;
  /** Shown on the account when the balance is below the protected amount. */
  warning: string | null;
}

export type AllocGoal = Pick<Goal, "id" | "targetCents" | "priority" | "createdAt">;

/**
 * Allocate `balanceCents` to `goals` (all on one account). Goals are taken
 * in the order given by `order` (goal ids) when passed, else by priority.
 * Invariant: protected + sum(goals) + unassigned = max(balance, 0).
 */
export function allocate(
  balanceCents: Cents,
  protectedTargetCents: Cents,
  goals: readonly AllocGoal[],
  order?: readonly Id[],
): AccountAllocation {
  const ordered = order ? order.map((id) => goals.find((g) => g.id === id)).filter((g): g is AllocGoal => !!g) : byPriority(goals);
  const available = Math.max(balanceCents, 0);
  const protectedTarget = Math.max(protectedTargetCents, 0);
  const protectedCents = Math.min(available, protectedTarget);
  const belowProtected = balanceCents < protectedTarget;
  let left = belowProtected ? 0 : available - protectedCents;
  const out: GoalAllocation[] = ordered.map((g) => {
    const allocatedCents = Math.min(left, Math.max(g.targetCents, 0));
    left -= allocatedCents;
    return { goalId: g.id, allocatedCents, targetCents: g.targetCents, complete: allocatedCents >= g.targetCents };
  });
  return {
    balanceCents,
    protectedTargetCents: protectedTarget,
    protectedCents,
    belowProtected,
    goals: out,
    unassignedCents: belowProtected ? 0 : left,
    warning: belowProtected
      ? `Balance ${Money.format(balanceCents)} is below the protected ${Money.format(protectedTarget)}, so every goal shows $0.`
      : null,
  };
}

export function allocatedFor(allocation: AccountAllocation, goalId: Id): Cents {
  return allocation.goals.find((g) => g.goalId === goalId)?.allocatedCents ?? 0;
}

/** Allocate every account's goals at once. */
export function allocateAll(
  accounts: ReadonlyArray<{ id: AccountId; currentBalanceCents: Cents | null; protectedAmountCents: Cents }>,
  goals: readonly Goal[],
): Map<AccountId, AccountAllocation> {
  const out = new Map<AccountId, AccountAllocation>();
  const live = activeGoals(goals);
  for (const a of accounts) {
    const own = live.filter((g) => g.accountId === a.id);
    if (own.length === 0 && a.protectedAmountCents === 0) continue;
    out.set(a.id, allocate(a.currentBalanceCents ?? 0, a.protectedAmountCents, own));
  }
  return out;
}

export type BarSegment =
  | { kind: "protected"; cents: Cents; targetCents: Cents }
  | { kind: "goal"; goalId: Id; name: string; cents: Cents; targetCents: Cents; complete: boolean; colorSlot: number }
  | { kind: "unassigned"; cents: Cents };

/** The account bar split by goal: protected, each goal (with its target), unassigned. */
export function accountBar(
  balanceCents: Cents,
  protectedTargetCents: Cents,
  goals: ReadonlyArray<AllocGoal & Pick<Goal, "name" | "colorSlot">>,
): { totalCents: Cents; segments: BarSegment[]; warning: string | null } {
  const a = allocate(balanceCents, protectedTargetCents, goals);
  const segments: BarSegment[] = [];
  if (a.protectedTargetCents > 0) segments.push({ kind: "protected", cents: a.protectedCents, targetCents: a.protectedTargetCents });
  for (const ga of a.goals) {
    const g = goals.find((x) => x.id === ga.goalId)!;
    segments.push({ kind: "goal", goalId: g.id, name: g.name, cents: ga.allocatedCents, targetCents: g.targetCents, complete: ga.complete, colorSlot: g.colorSlot });
  }
  segments.push({ kind: "unassigned", cents: a.unassignedCents });
  return { totalCents: Math.max(balanceCents, 0), segments, warning: a.warning };
}
