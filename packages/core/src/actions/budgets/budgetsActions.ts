/**
 * Budget, part and trip editing (§10). The plan carries to later periods
 * until changed: a new amount or a part edit takes effect from the start of
 * the current period, so finished periods keep the plan they had (history
 * and track record stay honest). Amounts never carry over (decision 004).
 */
import { z } from "zod";
import { ActionError, defineAction, findRow, type Mutation } from "../../registry.ts";
import {
  BUDGET_PART_TARGET_KINDS,
  BUDGET_PERIOD_KINDS,
  type Budget,
  type BudgetAmount,
  type BudgetPart,
  type BudgetPartTarget,
  type CoreData,
  type Tag,
  type Trip,
} from "../../types.ts";
import { Money } from "../../money.ts";
import { addDays, startOfMonth } from "../../dates.ts";
import { centsSchema, idSchema, isoDateSchema } from "../../schemas.ts";
import { restoreInverse } from "../../flows/actionHelpers.ts";
import { currentPeriod } from "../../budgets/periods.ts";

const money = (c: number | null | undefined) => (c === null || c === undefined ? null : Money.format(c));
const nonNegativeCents = centsSchema.refine((c) => c >= 0, { message: "Amounts can't be negative" });

const targetSchema = z.object({ kind: z.enum(BUDGET_PART_TARGET_KINDS), value: z.string().min(1).max(200) });

function requireBudget(data: Pick<CoreData, "budgets">, id: string): Budget {
  const b = findRow(data, "budgets", { id });
  if (!b) throw new ActionError(`No budget ${id}`);
  return b;
}

function requirePart(data: Pick<CoreData, "budgetParts">, id: string): BudgetPart {
  const p = findRow(data, "budgetParts", { id });
  if (!p) throw new ActionError(`No budget part ${id}`);
  return p;
}

function periodStart(b: Budget, today: string): string {
  return currentPeriod(b, today).start;
}

function targetText(targets: readonly { kind?: string; targetKind?: string; value?: string; targetValue?: string }[]): string | null {
  if (targets.length === 0) return null;
  return targets.map((t) => `${t.kind ?? t.targetKind}: ${(t.value ?? t.targetValue ?? "").replace(/^auto:/, "")}`).join(", ");
}

// ---------------------------------------------------------------- budgets

const budgetShape = {
  periodKind: z.enum(BUDGET_PERIOD_KINDS),
  /** First day of a period (default: the 1st of this month for monthly, today otherwise). */
  anchorDate: isoDateSchema,
  customEndDate: isoDateSchema.nullable(),
};

export const createBudget = defineAction({
  name: "budgets.create",
  description: "Create an overall budget with an amount per period (monthly by default; weekly, biweekly, yearly or custom dates).",
  input: z
    .object({
      name: z.string().trim().min(1).max(100),
      amountCents: nonNegativeCents,
      periodKind: budgetShape.periodKind.default("monthly"),
      anchorDate: budgetShape.anchorDate.optional(),
      customEndDate: budgetShape.customEndDate.default(null),
    })
    .refine((b) => b.periodKind !== "custom" || (b.customEndDate !== null && b.anchorDate !== undefined && b.customEndDate >= b.anchorDate), {
      message: "A custom budget needs a start and an end date",
    }),
  needs: ["budgets", "budgetAmounts"],
  examples: [{ name: "Monthly spending", amountCents: 300_000, periodKind: "monthly", customEndDate: null }],
  describe(_data, input) {
    return {
      summary: `Create the budget "${input.name}"`,
      changes: [
        { label: "Amount", before: null, after: `${Money.format(input.amountCents)} ${input.periodKind}` },
        ...(input.periodKind === "custom" ? [{ label: "Dates", before: null, after: `${input.anchorDate} – ${input.customEndDate}` }] : []),
      ],
    };
  },
  apply(_data, input, ctx) {
    const anchor = input.anchorDate ?? (input.periodKind === "monthly" ? startOfMonth(ctx.today) : ctx.today);
    const budget: Budget = {
      id: ctx.newId(),
      name: input.name,
      periodKind: input.periodKind,
      anchorDate: anchor,
      customEndDate: input.periodKind === "custom" ? input.customEndDate : null,
      archivedAt: null,
      createdAt: ctx.now,
    };
    // The amount applies from the current period (or the first one, for a budget starting later).
    const amount: BudgetAmount = {
      budgetId: budget.id,
      effectiveFrom: anchor > ctx.today ? anchor : periodStart(budget, ctx.today),
      amountCents: input.amountCents,
    };
    return [
      { op: "upsert", table: "budgets", row: budget },
      { op: "upsert", table: "budgetAmounts", row: amount },
    ];
  },
  inverse: restoreInverse,
});

export const editBudget = defineAction({
  name: "budgets.edit",
  description: "Rename a budget, change its amount (from the current period on), or change its period.",
  input: z.object({
    budgetId: idSchema,
    name: z.string().trim().min(1).max(100).optional(),
    amountCents: nonNegativeCents.optional(),
    periodKind: budgetShape.periodKind.optional(),
    anchorDate: budgetShape.anchorDate.optional(),
    customEndDate: budgetShape.customEndDate.optional(),
  }),
  needs: ["budgets", "budgetAmounts"],
  describe(data, input, ctx) {
    const b = requireBudget(data, input.budgetId);
    const p = currentPeriod(b, ctx.today);
    const cur = data.budgetAmounts
      .filter((a) => a.budgetId === b.id && a.effectiveFrom <= p.start)
      .sort((x, y) => (x.effectiveFrom < y.effectiveFrom ? 1 : -1))[0];
    const changes = [];
    if (input.name !== undefined) changes.push({ label: "Name", before: b.name, after: input.name });
    if (input.amountCents !== undefined) changes.push({ label: `Amount from ${p.start}`, before: money(cur?.amountCents), after: money(input.amountCents) });
    if (input.periodKind !== undefined) changes.push({ label: "Period", before: b.periodKind, after: input.periodKind });
    if (input.anchorDate !== undefined) changes.push({ label: "Starts on", before: b.anchorDate, after: input.anchorDate });
    if (input.customEndDate !== undefined) changes.push({ label: "Ends on", before: b.customEndDate, after: input.customEndDate });
    return { summary: `Edit the budget "${b.name}"`, changes };
  },
  apply(data, input, ctx) {
    const b = requireBudget(data, input.budgetId);
    const next: Budget = {
      ...b,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.periodKind !== undefined ? { periodKind: input.periodKind } : {}),
      ...(input.anchorDate !== undefined ? { anchorDate: input.anchorDate } : {}),
      ...(input.customEndDate !== undefined ? { customEndDate: input.customEndDate } : {}),
    };
    if (next.periodKind === "custom" && (next.customEndDate === null || next.customEndDate < next.anchorDate)) {
      throw new ActionError("A custom budget needs an end date on or after its start");
    }
    if (next.periodKind !== "custom") next.customEndDate = null;
    const muts: Mutation[] = [{ op: "upsert", table: "budgets", row: next }];
    if (input.amountCents !== undefined) {
      const row: BudgetAmount = { budgetId: b.id, effectiveFrom: periodStart(next, ctx.today), amountCents: input.amountCents };
      muts.push({ op: "upsert", table: "budgetAmounts", row });
    }
    return muts;
  },
  inverse: restoreInverse,
});

export const deleteBudget = defineAction({
  name: "budgets.delete",
  description: "Delete a budget with its amounts and parts (undo restores them).",
  input: z.object({ budgetId: idSchema }),
  needs: ["budgets", "budgetAmounts", "budgetParts", "budgetPartTargets"],
  describe(data, input) {
    const b = requireBudget(data, input.budgetId);
    const n = data.budgetParts.filter((p) => p.budgetId === b.id).length;
    return { summary: `Delete the budget "${b.name}"`, changes: [{ label: "Budget", before: `${b.name} (${n} parts)`, after: null }] };
  },
  apply(data, input) {
    const b = requireBudget(data, input.budgetId);
    const parts = data.budgetParts.filter((p) => p.budgetId === b.id);
    const partIds = new Set(parts.map((p) => p.id));
    return [
      ...data.budgetPartTargets
        .filter((t) => partIds.has(t.partId))
        .map((t): Mutation => ({ op: "delete", table: "budgetPartTargets", key: { partId: t.partId, targetKind: t.targetKind, targetValue: t.targetValue } })),
      ...parts.map((p): Mutation => ({ op: "delete", table: "budgetParts", key: { id: p.id } })),
      ...data.budgetAmounts
        .filter((a) => a.budgetId === b.id)
        .map((a): Mutation => ({ op: "delete", table: "budgetAmounts", key: { budgetId: a.budgetId, effectiveFrom: a.effectiveFrom } })),
      { op: "delete", table: "budgets", key: { id: b.id } },
    ];
  },
  inverse: restoreInverse,
});

// ---------------------------------------------------------------- parts

function targetRows(partId: string, targets: readonly z.infer<typeof targetSchema>[]): BudgetPartTarget[] {
  const seen = new Set<string>();
  const out: BudgetPartTarget[] = [];
  for (const t of targets) {
    const k = `${t.kind}|${t.value}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ partId, targetKind: t.kind, targetValue: t.value });
  }
  return out;
}

export const createPart = defineAction({
  name: "budgets.createPart",
  description:
    "Add a part to a budget with an expected amount, defined by categories, merchants or a tag (each transaction counts toward at most one part; a tag beats a category).",
  input: z.object({
    budgetId: idSchema,
    name: z.string().trim().min(1).max(100),
    expectedCents: nonNegativeCents,
    targets: z.array(targetSchema).min(1).max(50),
  }),
  needs: ["budgets", "budgetParts", "budgetPartTargets"],
  describe(data, input) {
    const b = requireBudget(data, input.budgetId);
    return {
      summary: `Add "${input.name}" to ${b.name}`,
      changes: [
        { label: "Expected", before: null, after: Money.format(input.expectedCents) },
        { label: "Covers", before: null, after: targetText(input.targets) },
      ],
    };
  },
  apply(data, input, ctx) {
    const b = requireBudget(data, input.budgetId);
    const start = periodStart(b, ctx.today);
    const active = data.budgetParts.filter((p) => p.budgetId === b.id && (p.effectiveTo === null || p.effectiveTo >= start));
    if (active.some((p) => p.name.toLowerCase() === input.name.toLowerCase())) throw new ActionError(`"${input.name}" already exists in this budget`);
    const part: BudgetPart = {
      id: ctx.newId(),
      budgetId: b.id,
      name: input.name,
      expectedCents: input.expectedCents,
      effectiveFrom: start,
      effectiveTo: null,
      position: active.length === 0 ? 0 : Math.max(...active.map((p) => p.position)) + 1,
    };
    return [
      { op: "upsert", table: "budgetParts", row: part },
      ...targetRows(part.id, input.targets).map((row): Mutation => ({ op: "upsert", table: "budgetPartTargets", row })),
    ];
  },
  inverse: restoreInverse,
});

export const editPart = defineAction({
  name: "budgets.editPart",
  description: "Change a budget part's name, expected amount or what it covers, from the current period on (past periods keep their plan).",
  input: z.object({
    partId: idSchema,
    name: z.string().trim().min(1).max(100).optional(),
    expectedCents: nonNegativeCents.optional(),
    targets: z.array(targetSchema).min(1).max(50).optional(),
    position: z.number().int().min(0).optional(),
  }),
  needs: ["budgets", "budgetParts", "budgetPartTargets"],
  describe(data, input) {
    const p = requirePart(data, input.partId);
    const cur = data.budgetPartTargets.filter((t) => t.partId === p.id);
    const changes = [];
    if (input.name !== undefined) changes.push({ label: "Name", before: p.name, after: input.name });
    if (input.expectedCents !== undefined) changes.push({ label: "Expected", before: money(p.expectedCents), after: money(input.expectedCents) });
    if (input.targets !== undefined) changes.push({ label: "Covers", before: targetText(cur), after: targetText(input.targets) });
    if (input.position !== undefined) changes.push({ label: "Order", before: String(p.position + 1), after: String(input.position + 1) });
    return { summary: `Edit "${p.name}"`, changes };
  },
  apply(data, input, ctx) {
    const p = requirePart(data, input.partId);
    const b = requireBudget(data, p.budgetId);
    if (p.effectiveTo !== null && p.effectiveTo < ctx.today) throw new ActionError(`"${p.name}" has ended; add a new part instead`);
    const start = periodStart(b, ctx.today);
    const curTargets = data.budgetPartTargets.filter((t) => t.partId === p.id);
    const nextTargets = input.targets ? targetRows(p.id, input.targets) : curTargets;
    const fields = {
      name: input.name ?? p.name,
      expectedCents: input.expectedCents ?? p.expectedCents,
      position: input.position ?? p.position,
    };
    const muts: Mutation[] = [];
    if (p.effectiveFrom >= start) {
      // Created this period: edit in place.
      muts.push({ op: "upsert", table: "budgetParts", row: { ...p, ...fields } });
      if (input.targets) {
        for (const t of curTargets) muts.push({ op: "delete", table: "budgetPartTargets", key: { partId: t.partId, targetKind: t.targetKind, targetValue: t.targetValue } });
        for (const t of nextTargets) muts.push({ op: "upsert", table: "budgetPartTargets", row: t });
      }
      return muts;
    }
    // Earlier periods keep the old version; a new version starts this period.
    const next: BudgetPart = { ...p, ...fields, id: ctx.newId(), effectiveFrom: start, effectiveTo: null };
    muts.push({ op: "upsert", table: "budgetParts", row: { ...p, effectiveTo: addDays(start, -1) } });
    muts.push({ op: "upsert", table: "budgetParts", row: next });
    for (const t of nextTargets) muts.push({ op: "upsert", table: "budgetPartTargets", row: { ...t, partId: next.id } });
    return muts;
  },
  inverse: restoreInverse,
});

export const deletePart = defineAction({
  name: "budgets.deletePart",
  description: "Remove a part from a budget from the current period on (past periods keep it in their history).",
  input: z.object({ partId: idSchema }),
  needs: ["budgets", "budgetParts", "budgetPartTargets"],
  describe(data, input) {
    const p = requirePart(data, input.partId);
    return { summary: `Remove "${p.name}"`, changes: [{ label: "Part", before: `${p.name} (${Money.format(p.expectedCents)})`, after: null }] };
  },
  apply(data, input, ctx) {
    const p = requirePart(data, input.partId);
    const b = requireBudget(data, p.budgetId);
    const start = periodStart(b, ctx.today);
    if (p.effectiveFrom < start) return [{ op: "upsert", table: "budgetParts", row: { ...p, effectiveTo: addDays(start, -1) } }];
    return [
      ...data.budgetPartTargets
        .filter((t) => t.partId === p.id)
        .map((t): Mutation => ({ op: "delete", table: "budgetPartTargets", key: { partId: t.partId, targetKind: t.targetKind, targetValue: t.targetValue } })),
      { op: "delete", table: "budgetParts", key: { id: p.id } },
    ];
  },
  inverse: restoreInverse,
});

// ---------------------------------------------------------------- trips

export const createTrip = defineAction({
  name: "budgets.createTrip",
  description:
    "Create a trip (or other one-off tagged budget) with its own dates and expected total; transactions tagged with it count in each month's overall as a trip line, not in monthly parts.",
  input: z
    .object({
      name: z.string().trim().min(1).max(100),
      startDate: isoDateSchema,
      endDate: isoDateSchema,
      expectedCents: nonNegativeCents,
      /** Existing tag to use; default: a tag named after the trip. */
      tagName: z.string().trim().min(1).max(60).optional(),
    })
    .refine((t) => t.startDate <= t.endDate, { message: "A trip ends on or after it starts" }),
  needs: ["trips", "tags"],
  examples: [{ name: "Lisbon trip", startDate: "2026-10-20", endDate: "2026-11-05", expectedCents: 150_000 }],
  describe(_data, input) {
    return {
      summary: `Create the trip "${input.name}"`,
      changes: [
        { label: "Dates", before: null, after: `${input.startDate} – ${input.endDate}` },
        { label: "Expected", before: null, after: Money.format(input.expectedCents) },
      ],
    };
  },
  apply(data, input, ctx) {
    const tagName = input.tagName ?? input.name;
    const muts: Mutation[] = [];
    let tag = data.tags.find((t) => t.name.toLowerCase() === tagName.toLowerCase());
    if (!tag) {
      tag = { id: ctx.newId(), name: tagName, createdAt: ctx.now } satisfies Tag;
      muts.push({ op: "upsert", table: "tags", row: tag });
    }
    if (data.trips.some((t) => t.tagId === tag.id)) throw new ActionError(`The tag "${tag.name}" already belongs to a trip`);
    const trip: Trip = { id: ctx.newId(), tagId: tag.id, name: input.name, startDate: input.startDate, endDate: input.endDate, expectedCents: input.expectedCents };
    muts.push({ op: "upsert", table: "trips", row: trip });
    return muts;
  },
  inverse: restoreInverse,
});

export const editTrip = defineAction({
  name: "budgets.editTrip",
  description: "Change a trip's name, dates or expected total.",
  input: z.object({
    tripId: idSchema,
    name: z.string().trim().min(1).max(100).optional(),
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
    expectedCents: nonNegativeCents.optional(),
  }),
  needs: ["trips"],
  describe(data, input) {
    const t = findRow(data, "trips", { id: input.tripId });
    if (!t) throw new ActionError(`No trip ${input.tripId}`);
    const changes = [];
    if (input.name !== undefined) changes.push({ label: "Name", before: t.name, after: input.name });
    if (input.startDate !== undefined || input.endDate !== undefined) {
      changes.push({ label: "Dates", before: `${t.startDate} – ${t.endDate}`, after: `${input.startDate ?? t.startDate} – ${input.endDate ?? t.endDate}` });
    }
    if (input.expectedCents !== undefined) changes.push({ label: "Expected", before: money(t.expectedCents), after: money(input.expectedCents) });
    return { summary: `Edit the trip "${t.name}"`, changes };
  },
  apply(data, input) {
    const t = findRow(data, "trips", { id: input.tripId });
    if (!t) throw new ActionError(`No trip ${input.tripId}`);
    const next: Trip = {
      ...t,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
      ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
      ...(input.expectedCents !== undefined ? { expectedCents: input.expectedCents } : {}),
    };
    if (next.startDate > next.endDate) throw new ActionError("A trip ends on or after it starts");
    return [{ op: "upsert", table: "trips", row: next }];
  },
  inverse: restoreInverse,
});

export const deleteTrip = defineAction({
  name: "budgets.deleteTrip",
  description: "Delete a trip budget (its tag and tagged transactions stay).",
  input: z.object({ tripId: idSchema }),
  needs: ["trips"],
  describe(data, input) {
    const t = findRow(data, "trips", { id: input.tripId });
    if (!t) throw new ActionError(`No trip ${input.tripId}`);
    return { summary: `Delete the trip "${t.name}"`, changes: [{ label: "Trip", before: t.name, after: null }] };
  },
  apply(data, input) {
    if (!findRow(data, "trips", { id: input.tripId })) throw new ActionError(`No trip ${input.tripId}`);
    return [{ op: "delete", table: "trips", key: { id: input.tripId } }];
  },
  inverse: restoreInverse,
});
