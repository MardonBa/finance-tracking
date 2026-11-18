/**
 * Goal actions (§11): create, edit, delete, reorder, archive, complete,
 * link purchase, set deadline, set expected contribution, and record
 * celebrated milestones. Inverses come from the generic `inverseMutations`.
 */
import { z } from "zod";
import { ActionError, defineAction, findRow, type Change, type Mutation } from "../../registry.ts";
import { Money } from "../../money.ts";
import { centsSchema, idSchema, isoDateSchema } from "../../schemas.ts";
import { CONTRIBUTION_PERIODS, type Account, type CoreData, type Goal } from "../../types.ts";
import { accountKind, displayName, isDebtKind } from "../../balances/accountKinds.ts";
import { activeGoals, allocate, allocatedFor, byPriority } from "../../goals/allocation.ts";
import { milestonesFor } from "../../goals/milestones.ts";
import { explainGoalChanges } from "../../goals/explain.ts";

const fmt = (c: number | null | undefined) => (c === null || c === undefined ? null : Money.format(c));

function needGoal(data: Pick<CoreData, "goals">, goalId: string): Goal {
  const g = findRow(data, "goals", { id: goalId });
  if (!g) throw new ActionError(`No goal ${goalId}`);
  return g;
}

function needGoalAccount(data: Pick<CoreData, "accounts">, accountId: string): Account {
  const a = findRow(data, "accounts", { id: accountId });
  if (!a) throw new ActionError(`No account ${accountId}`);
  if (isDebtKind(accountKind(a))) throw new ActionError(`Goals can't be funded from ${displayName(a)} (a ${accountKind(a)} account).`);
  return a;
}

/** Before → after money per goal on an account when its goals change. */
export function reallocationChanges(account: Account, before: readonly Goal[], after: readonly Goal[]): Change[] {
  const own = (gs: readonly Goal[]) => activeGoals(gs).filter((g) => g.accountId === account.id);
  const balance = account.currentBalanceCents ?? 0;
  const changes = explainGoalChanges(
    { balanceCents: balance, protectedCents: account.protectedAmountCents, goals: own(before) },
    { balanceCents: balance, protectedCents: account.protectedAmountCents, goals: own(after) },
  );
  return changes
    .filter((c) => c.changeCents !== 0)
    .map((c) => ({ label: `${c.name} (money assigned)`, before: Money.format(c.beforeCents), after: Money.format(c.afterCents) }));
}

function upsertGoal(row: Goal): Mutation {
  return { op: "upsert", table: "goals", row };
}

/**
 * Milestones `goal` already covers with the money it would be assigned once
 * `goalsAfter` are the goals, recorded as seen so only progress made from
 * here on is celebrated (open-items: "a new goal celebrates the milestones it
 * already covers"). `includeCompletion: false` leaves the completion
 * milestone to celebrate, e.g. when lowering a target finishes the goal.
 */
export function alreadyReachedMilestones(
  data: Pick<CoreData, "accounts" | "goalMilestonesSeen">,
  goal: Goal,
  goalsAfter: readonly Goal[],
  now: string,
  opts: { includeCompletion: boolean },
): Mutation[] {
  const account = findRow(data, "accounts", { id: goal.accountId });
  if (!account) return [];
  const own = activeGoals(goalsAfter).filter((g) => g.accountId === account.id);
  const saved = allocatedFor(allocate(account.currentBalanceCents ?? 0, account.protectedAmountCents, own), goal.id);
  return milestonesFor(goal.targetCents)
    .filter((m) => saved >= m.cents && (opts.includeCompletion || m.kind !== "completion"))
    .filter((m) => !data.goalMilestonesSeen.some((x) => x.goalId === goal.id && x.milestoneCents === m.cents))
    .map((m) => ({ op: "upsert", table: "goalMilestonesSeen", row: { goalId: goal.id, milestoneCents: m.cents, seenAt: now } }) as Mutation);
}

/** Goals with the goal rows in `muts` applied (and any new ones added). */
function withUpserts(goals: readonly Goal[], muts: readonly Mutation[]): Goal[] {
  const rows = muts.filter((m) => m.table === "goals" && m.op === "upsert").map((m) => m.row as Goal);
  return [...goals.map((g) => rows.find((r) => r.id === g.id) ?? g), ...rows.filter((r) => !goals.some((g) => g.id === r.id))];
}

// ---------------------------------------------------------------- create

const createInput = z.object({
  name: z.string().trim().min(1).max(80),
  accountId: idSchema,
  targetCents: centsSchema.refine((c) => c > 0, { message: "Target must be more than $0" }),
  deadline: isoDateSchema.nullable().optional(),
  expectedContributionCents: centsSchema.nullable().optional(),
  contributionPeriod: z.enum(CONTRIBUTION_PERIODS).nullable().optional(),
  /** Defaults to last (lowest priority) on its account. */
  priority: z.number().int().min(1).optional(),
});

export const createGoal = defineAction({
  name: "goals.create",
  description:
    "Create a savings goal with a name, target amount and account, optionally a deadline and an expected contribution per period. Milestones the money already assigned to it covers count as celebrated; only later progress is celebrated.",
  input: createInput,
  needs: ["goals", "accounts", "goalMilestonesSeen"],
  examples: [
    { name: "Bike", accountId: "acc_hysa", targetCents: 120000 },
    { name: "DGX Spark", accountId: "acc_hysa", targetCents: 400000, deadline: "2027-06-01", expectedContributionCents: 30000, contributionPeriod: "monthly", priority: 1 },
  ],
  describe(data, input, ctx) {
    const account = needGoalAccount(data, input.accountId);
    const muts = this.apply(data, input, ctx);
    const after = muts.filter((m) => m.table === "goals" && m.op === "upsert").map((m) => m.row as Goal);
    const merged = [...data.goals.filter((g) => !after.some((a) => a.id === g.id)), ...after];
    return {
      summary: `Create goal "${input.name}" for ${Money.format(input.targetCents)} in ${displayName(account)}`,
      changes: [
        { label: "Goal", before: null, after: `${input.name} · ${Money.format(input.targetCents)}` },
        ...reallocationChanges(account, data.goals, merged),
      ],
    };
  },
  apply(data, input, ctx) {
    needGoalAccount(data, input.accountId);
    const siblings = byPriority(activeGoals(data.goals).filter((g) => g.accountId === input.accountId));
    const position = Math.min(input.priority ?? siblings.length + 1, siblings.length + 1);
    const used = new Set(activeGoals(data.goals).map((g) => g.colorSlot));
    let colorSlot = 0;
    while (used.has(colorSlot)) colorSlot++;
    const goal: Goal = {
      id: ctx.newId(),
      name: input.name,
      accountId: input.accountId,
      targetCents: input.targetCents,
      priority: position,
      deadline: input.deadline ?? null,
      expectedContributionCents: input.expectedContributionCents ?? null,
      contributionPeriod: input.expectedContributionCents != null ? (input.contributionPeriod ?? "monthly") : null,
      colorSlot,
      completedAt: null,
      archivedAt: null,
      purchaseTransactionId: null,
      createdAt: ctx.now,
    };
    const muts: Mutation[] = [];
    siblings.forEach((g, i) => {
      const p = i + 1 >= position ? i + 2 : i + 1;
      if (g.priority !== p) muts.push(upsertGoal({ ...g, priority: p }));
    });
    muts.push(upsertGoal(goal));
    muts.push(...alreadyReachedMilestones(data, goal, withUpserts(data.goals, muts), ctx.now, { includeCompletion: true }));
    return muts;
  },
});

// ---------------------------------------------------------------- edit

export const editGoal = defineAction({
  name: "goals.edit",
  description:
    "Change a goal's name, target amount or account. Progress milestones of the new target (or on the new account) that are already covered count as celebrated; completion still celebrates.",
  input: z.object({
    goalId: idSchema,
    name: z.string().trim().min(1).max(80).optional(),
    targetCents: centsSchema.refine((c) => c > 0, { message: "Target must be more than $0" }).optional(),
    accountId: idSchema.optional(),
  }),
  needs: ["goals", "accounts", "goalMilestonesSeen"],
  describe(data, input) {
    const g = needGoal(data, input.goalId);
    const changes: Change[] = [];
    if (input.name !== undefined && input.name !== g.name) changes.push({ label: "Name", before: g.name, after: input.name });
    if (input.targetCents !== undefined && input.targetCents !== g.targetCents) changes.push({ label: "Target", before: fmt(g.targetCents), after: fmt(input.targetCents) });
    if (input.accountId !== undefined && input.accountId !== g.accountId) {
      const from = findRow(data, "accounts", { id: g.accountId });
      const to = needGoalAccount(data, input.accountId);
      changes.push({ label: "Account", before: from ? displayName(from) : g.accountId, after: displayName(to) });
    }
    const account = findRow(data, "accounts", { id: g.accountId });
    if (account) {
      const after = data.goals.map((x) => (x.id === g.id ? { ...x, ...defined(input) } : x));
      changes.push(...reallocationChanges(account, data.goals, after));
    }
    return { summary: `Edit goal "${g.name}"`, changes };
  },
  apply(data, input, ctx) {
    const g = needGoal(data, input.goalId);
    if (input.accountId !== undefined) needGoalAccount(data, input.accountId);
    const row: Goal = { ...g, ...defined(input) };
    if (input.accountId !== undefined && input.accountId !== g.accountId) {
      row.priority = activeGoals(data.goals).filter((x) => x.accountId === input.accountId).length + 1;
    }
    const muts = [upsertGoal(row)];
    if (row.targetCents !== g.targetCents || row.accountId !== g.accountId) {
      muts.push(...alreadyReachedMilestones(data, row, withUpserts(data.goals, muts), ctx.now, { includeCompletion: false }));
    }
    return muts;
  },
});

function defined(input: { name?: string; targetCents?: number; accountId?: string }): Partial<Goal> {
  const out: Partial<Goal> = {};
  if (input.name !== undefined) out.name = input.name;
  if (input.targetCents !== undefined) out.targetCents = input.targetCents;
  if (input.accountId !== undefined) out.accountId = input.accountId;
  return out;
}

// ---------------------------------------------------------------- delete

export const deleteGoal = defineAction({
  name: "goals.delete",
  description: "Delete a goal; its money becomes unassigned or flows to lower-priority goals.",
  input: z.object({ goalId: idSchema }),
  needs: ["goals", "goalMilestonesSeen", "accounts"],
  describe(data, input) {
    const g = needGoal(data, input.goalId);
    const account = findRow(data, "accounts", { id: g.accountId });
    return {
      summary: `Delete goal "${g.name}"`,
      changes: [
        { label: "Goal", before: `${g.name} · ${Money.format(g.targetCents)}`, after: null },
        ...(account ? reallocationChanges(account, data.goals, data.goals.filter((x) => x.id !== g.id)) : []),
      ],
    };
  },
  apply(data, input) {
    const g = needGoal(data, input.goalId);
    const muts: Mutation[] = data.goalMilestonesSeen
      .filter((m) => m.goalId === g.id)
      .map((m) => ({ op: "delete", table: "goalMilestonesSeen", key: { goalId: m.goalId, milestoneCents: m.milestoneCents } }));
    muts.push({ op: "delete", table: "goals", key: { id: g.id } });
    // Close the gap in priorities.
    byPriority(activeGoals(data.goals).filter((x) => x.accountId === g.accountId && x.id !== g.id)).forEach((x, i) => {
      if (x.priority !== i + 1) muts.push(upsertGoal({ ...x, priority: i + 1 }));
    });
    return muts;
  },
});

// ---------------------------------------------------------------- reorder

export const reorderGoals = defineAction({
  name: "goals.reorder",
  description: "Set the funding priority order of the goals on one account (first = funded first).",
  input: z.object({ accountId: idSchema, goalIds: z.array(idSchema).min(1) }),
  needs: ["goals", "accounts"],
  describe(data, input, ctx) {
    const account = needGoalAccount(data, input.accountId);
    const muts = this.apply(data, input, ctx);
    const after = data.goals.map((g) => {
      const m = muts.find((x) => x.op === "upsert" && (x.row as Goal).id === g.id);
      return m && m.op === "upsert" ? (m.row as Goal) : g;
    });
    const name = (id: string) => data.goals.find((g) => g.id === id)?.name ?? id;
    const current = byPriority(activeGoals(data.goals).filter((g) => g.accountId === input.accountId)).map((g) => g.name);
    return {
      summary: `Reorder goals in ${displayName(account)}`,
      changes: [{ label: "Order", before: current.join(" → "), after: input.goalIds.map(name).join(" → ") }, ...reallocationChanges(account, data.goals, after)],
    };
  },
  apply(data, input) {
    needGoalAccount(data, input.accountId);
    const own = activeGoals(data.goals).filter((g) => g.accountId === input.accountId);
    const ids = new Set(input.goalIds);
    if (ids.size !== input.goalIds.length || own.length !== ids.size || own.some((g) => !ids.has(g.id))) {
      throw new ActionError("The new order must list every active goal on the account exactly once.");
    }
    return input.goalIds.flatMap((id, i) => {
      const g = own.find((x) => x.id === id)!;
      return g.priority === i + 1 ? [] : [upsertGoal({ ...g, priority: i + 1 })];
    });
  },
});

// ---------------------------------------------------------------- archive / complete

export const archiveGoal = defineAction({
  name: "goals.archive",
  description: "Archive a goal as an achievement (it stops holding money), or bring an archived goal back.",
  input: z.object({ goalId: idSchema, archived: z.boolean() }),
  needs: ["goals"],
  describe(data, input) {
    const g = needGoal(data, input.goalId);
    return {
      summary: `${input.archived ? "Archive" : "Unarchive"} goal "${g.name}"`,
      changes: [{ label: "Archived", before: g.archivedAt ? "yes" : "no", after: input.archived ? "yes" : "no" }],
    };
  },
  apply(data, input, ctx) {
    const g = needGoal(data, input.goalId);
    if (input.archived === (g.archivedAt !== null)) return [];
    if (input.archived) return [upsertGoal({ ...g, archivedAt: ctx.now, completedAt: g.completedAt ?? ctx.now })];
    const priority = activeGoals(data.goals).filter((x) => x.accountId === g.accountId).length + 1;
    return [upsertGoal({ ...g, archivedAt: null, priority })];
  },
});

export const completeGoal = defineAction({
  name: "goals.markComplete",
  description: "Mark a goal as completed (or not completed).",
  input: z.object({ goalId: idSchema, completed: z.boolean() }),
  needs: ["goals"],
  describe(data, input) {
    const g = needGoal(data, input.goalId);
    return {
      summary: `Mark "${g.name}" as ${input.completed ? "completed" : "not completed"}`,
      changes: [{ label: "Completed", before: g.completedAt ? "yes" : "no", after: input.completed ? "yes" : "no" }],
    };
  },
  apply(data, input, ctx) {
    const g = needGoal(data, input.goalId);
    return [upsertGoal({ ...g, completedAt: input.completed ? (g.completedAt ?? ctx.now) : null })];
  },
});

// ---------------------------------------------------------------- link purchase, deadline, contribution

export const linkGoalPurchase = defineAction({
  name: "goals.linkPurchase",
  description: "Link a completed goal to the transaction that bought the thing (or clear the link).",
  input: z.object({ goalId: idSchema, transactionId: idSchema.nullable() }),
  needs: ["goals", "transactions"],
  describe(data, input) {
    const g = needGoal(data, input.goalId);
    const label = (id: string | null) => {
      if (!id) return null;
      const t = findRow(data, "transactions", { id });
      return t ? `${t.merchantName ?? t.rawDescription} · ${t.date} · ${Money.format(t.amountCents)}` : id;
    };
    return {
      summary: input.transactionId ? `Link "${g.name}" to its purchase` : `Unlink the purchase from "${g.name}"`,
      changes: [{ label: "Purchase", before: label(g.purchaseTransactionId), after: label(input.transactionId) }],
    };
  },
  apply(data, input) {
    const g = needGoal(data, input.goalId);
    if (input.transactionId && !findRow(data, "transactions", { id: input.transactionId })) throw new ActionError(`No transaction ${input.transactionId}`);
    return [upsertGoal({ ...g, purchaseTransactionId: input.transactionId })];
  },
});

export const setGoalDeadline = defineAction({
  name: "goals.setDeadline",
  description: "Set or clear a goal's deadline (target date).",
  input: z.object({ goalId: idSchema, deadline: isoDateSchema.nullable() }),
  needs: ["goals"],
  describe(data, input) {
    const g = needGoal(data, input.goalId);
    return { summary: `${input.deadline ? "Set" : "Clear"} the deadline of "${g.name}"`, changes: [{ label: "Deadline", before: g.deadline, after: input.deadline }] };
  },
  apply(data, input) {
    return [upsertGoal({ ...needGoal(data, input.goalId), deadline: input.deadline })];
  },
});

export const setGoalContribution = defineAction({
  name: "goals.setContribution",
  description: "Set or clear a goal's expected contribution per period (e.g. $300 per month).",
  input: z.object({
    goalId: idSchema,
    expectedContributionCents: centsSchema.refine((c) => c > 0, { message: "Must be more than $0" }).nullable(),
    contributionPeriod: z.enum(CONTRIBUTION_PERIODS).nullable(),
  }),
  needs: ["goals"],
  describe(data, input) {
    const g = needGoal(data, input.goalId);
    const show = (c: number | null, p: string | null) => (c === null ? null : `${Money.format(c)} ${p ?? "monthly"}`);
    return {
      summary: `${input.expectedContributionCents === null ? "Clear" : "Set"} the expected contribution of "${g.name}"`,
      changes: [{ label: "Expected contribution", before: show(g.expectedContributionCents, g.contributionPeriod), after: show(input.expectedContributionCents, input.contributionPeriod) }],
    };
  },
  apply(data, input) {
    const g = needGoal(data, input.goalId);
    const cents = input.expectedContributionCents;
    return [upsertGoal({ ...g, expectedContributionCents: cents, contributionPeriod: cents === null ? null : (input.contributionPeriod ?? "monthly") })];
  },
});

// ---------------------------------------------------------------- milestones

export const markMilestonesSeen = defineAction({
  name: "goals.markMilestonesSeen",
  description: "Record that milestone celebrations were shown, so each plays only once.",
  input: z.object({ goalId: idSchema, milestonesCents: z.array(centsSchema).min(1) }),
  needs: ["goals", "goalMilestonesSeen"],
  describe(data, input) {
    const g = needGoal(data, input.goalId);
    return {
      summary: `Mark ${input.milestonesCents.length} milestone(s) of "${g.name}" as celebrated`,
      changes: input.milestonesCents.map((c) => ({ label: `Milestone ${Money.format(c)}`, before: "not celebrated", after: "celebrated" })),
    };
  },
  apply(data, input, ctx) {
    needGoal(data, input.goalId);
    return [...new Set(input.milestonesCents)]
      .filter((c) => !findRow(data, "goalMilestonesSeen", { goalId: input.goalId, milestoneCents: c }))
      .map((c) => ({ op: "upsert", table: "goalMilestonesSeen", row: { goalId: input.goalId, milestoneCents: c, seenAt: ctx.now } }) as Mutation);
  },
});

export const goalActions = [
  createGoal,
  editGoal,
  deleteGoal,
  reorderGoals,
  archiveGoal,
  completeGoal,
  linkGoalPurchase,
  setGoalDeadline,
  setGoalContribution,
  markMilestonesSeen,
];
