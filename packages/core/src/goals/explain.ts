/**
 * Why did a goal lose money? (§11, design.md §5 "Withdrawal impact")
 *
 * Compare two allocation states of one account. The change is split into
 * steps applied in a fixed order, and each goal's change at each step is
 * attributed to that step, so the reasons always add up to the goal's
 * total change exactly:
 *   1. protected amount changed
 *   2. goals removed (frees money)
 *   3. goal targets changed
 *   4. goals added (at their new places)
 *   5. priorities reordered
 *   6. balance changed (withdrawal or deposit)
 */
import { Money, type Cents } from "../money.ts";
import type { IsoDate } from "../dates.ts";
import type { Id, TransactionId } from "../types.ts";
import { allocate, allocatedFor, byPriority, type AllocGoal } from "./allocation.ts";
import { shortDate } from "./progress.ts";

export type ExplainGoal = AllocGoal & { name: string };

export interface AllocationState {
  balanceCents: Cents;
  protectedCents: Cents;
  goals: readonly ExplainGoal[];
}

export type LossReasonKind =
  | "protected_raised"
  | "target_raised"
  | "higher_priority_added"
  | "reordered"
  | "withdrawal";

export interface LossReason {
  kind: LossReasonKind;
  /** Negative: money this goal lost because of this reason. */
  cents: Cents;
  message: string;
  /** Other goals involved (added or moved ahead). */
  goalIds: Id[];
  /** Outflow transactions behind a withdrawal. */
  transactionIds: TransactionId[];
}

export interface GoalChange {
  goalId: Id;
  name: string;
  beforeCents: Cents;
  afterCents: Cents;
  changeCents: Cents;
  /** Only reasons that cost this goal money. */
  losses: LossReason[];
  /** Change from steps that added money (not explained further). */
  gainedCents: Cents;
  summary: string | null;
}

export interface WithdrawalContext {
  /** Outflows from the account between the two states (for the message and drill-down). */
  outflows?: ReadonlyArray<{ transactionId: TransactionId; date: IsoDate; amountCents: Cents }>;
}

function orderIds(goals: readonly AllocGoal[]): Id[] {
  return byPriority(goals).map((g) => g.id);
}

export function explainGoalChanges(before: AllocationState, after: AllocationState, ctx: WithdrawalContext = {}): GoalChange[] {
  const afterIds = new Set(after.goals.map((g) => g.id));
  const beforeIds = new Set(before.goals.map((g) => g.id));
  const afterOrder = orderIds(after.goals);
  const beforeOrder = orderIds(before.goals);

  type State = { balance: Cents; protectedCents: Cents; goals: ExplainGoal[]; order: Id[] };
  const states: Array<{ kind: LossReasonKind | "removed"; state: State }> = [];
  let cur: State = { balance: before.balanceCents, protectedCents: before.protectedCents, goals: [...before.goals], order: beforeOrder };
  const alloc = (s: State) => allocate(s.balance, s.protectedCents, s.goals, s.order);

  // 1. protected
  cur = { ...cur, protectedCents: after.protectedCents };
  states.push({ kind: "protected_raised", state: cur });
  // 2. removals
  cur = { ...cur, goals: cur.goals.filter((g) => afterIds.has(g.id)), order: cur.order.filter((id) => afterIds.has(id)) };
  states.push({ kind: "removed", state: cur });
  // 3. targets
  cur = { ...cur, goals: cur.goals.map((g) => ({ ...g, targetCents: after.goals.find((a) => a.id === g.id)!.targetCents })) };
  states.push({ kind: "target_raised", state: cur });
  // 4. additions at their new places; existing goals keep their old relative order
  const existingInOldOrder = cur.order.slice();
  let k = 0;
  const withAdds = afterOrder.map((id) => (beforeIds.has(id) ? existingInOldOrder[k++]! : id));
  cur = { ...cur, goals: [...cur.goals, ...after.goals.filter((g) => !beforeIds.has(g.id))], order: withAdds };
  states.push({ kind: "higher_priority_added", state: cur });
  // 5. reorder
  cur = { ...cur, order: afterOrder };
  states.push({ kind: "reordered", state: cur });
  // 6. balance
  cur = { ...cur, balance: after.balanceCents };
  states.push({ kind: "withdrawal", state: cur });

  const out: GoalChange[] = [];
  const outflows = ctx.outflows ?? [];
  for (const id of afterOrder.concat(beforeOrder.filter((x) => !afterIds.has(x)))) {
    const goal = after.goals.find((g) => g.id === id) ?? before.goals.find((g) => g.id === id)!;
    if (!afterIds.has(id)) continue; // removed goals aren't explained
    const beforeCents = beforeIds.has(id) ? allocatedFor(allocate(before.balanceCents, before.protectedCents, before.goals), id) : 0;
    let prev = beforeCents;
    let prevState: State = { balance: before.balanceCents, protectedCents: before.protectedCents, goals: [...before.goals], order: beforeOrder };
    const losses: LossReason[] = [];
    let gained = 0;
    for (const { kind, state } of states) {
      const now = state.goals.some((g) => g.id === id) ? allocatedFor(alloc(state), id) : 0;
      const delta = now - prev;
      if (delta < 0 && kind !== "removed") {
        losses.push(reason(kind, delta, goal, prevState, state, outflows));
      } else if (delta !== 0) {
        gained += delta;
      }
      prev = now;
      prevState = state;
    }
    const afterCents = prev;
    const totalLoss = losses.reduce((s, l) => s + l.cents, 0);
    out.push({
      goalId: id,
      name: goal.name,
      beforeCents,
      afterCents,
      changeCents: afterCents - beforeCents,
      losses,
      gainedCents: gained,
      summary: losses.length ? `${goal.name} lost ${Money.format(-totalLoss)}: ${losses.map((l) => l.message).join("; ")}` : null,
    });
  }
  return out;
}

function reason(
  kind: LossReasonKind | "removed",
  cents: Cents,
  goal: ExplainGoal,
  prev: { order: Id[]; goals: ExplainGoal[] },
  next: { order: Id[]; goals: ExplainGoal[] },
  outflows: NonNullable<WithdrawalContext["outflows"]>,
): LossReason {
  const lost = Money.format(-cents);
  const nameOf = (id: Id) => next.goals.find((g) => g.id === id)?.name ?? id;
  switch (kind) {
    case "protected_raised":
      return { kind, cents, message: `the protected amount was raised (${lost})`, goalIds: [], transactionIds: [] };
    case "target_raised": {
      const ownBefore = prev.goals.find((g) => g.id === goal.id);
      const ownAfter = next.goals.find((g) => g.id === goal.id);
      if (ownBefore && ownAfter && ownAfter.targetCents < ownBefore.targetCents) {
        return { kind, cents, message: `its target was lowered (${lost} moved to unassigned or later goals)`, goalIds: [goal.id], transactionIds: [] };
      }
      const ahead = next.order.slice(0, next.order.indexOf(goal.id));
      const raised = ahead.filter((id) => {
        const p = prev.goals.find((g) => g.id === id);
        const n = next.goals.find((g) => g.id === id);
        return p && n && n.targetCents > p.targetCents;
      });
      return { kind, cents, message: `a higher-priority goal's target was raised (${raised.map(nameOf).join(", ")}, ${lost})`, goalIds: raised, transactionIds: [] };
    }
    case "higher_priority_added": {
      const prevIds = new Set(prev.order);
      const added = next.order.slice(0, next.order.indexOf(goal.id)).filter((id) => !prevIds.has(id));
      return { kind, cents, message: `higher-priority goal ${added.map((id) => `"${nameOf(id)}"`).join(", ")} was added (${lost})`, goalIds: added, transactionIds: [] };
    }
    case "reordered": {
      const before = new Set(prev.order.slice(0, prev.order.indexOf(goal.id)));
      const moved = next.order.slice(0, next.order.indexOf(goal.id)).filter((id) => !before.has(id));
      return { kind, cents, message: `${moved.map((id) => `"${nameOf(id)}"`).join(", ")} moved ahead of it (${lost})`, goalIds: moved, transactionIds: [] };
    }
    default: {
      const sorted = [...outflows].sort((a, b) => (a.date < b.date ? -1 : 1));
      const last = sorted.at(-1);
      const message = last ? `lost ${lost} after the ${shortDate(last.date)} ${sorted.length > 1 ? "withdrawals" : "transfer"}` : `the account balance went down (${lost})`;
      return { kind: "withdrawal", cents, message, goalIds: [], transactionIds: sorted.map((o) => o.transactionId) };
    }
  }
}
