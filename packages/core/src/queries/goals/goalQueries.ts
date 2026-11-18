/** Goal queries (§11): cards, account bars, celebrations, what-if and loss explanations. */
import { z } from "zod";
import { defineQuery, type Figure } from "../../registry.ts";
import { Money } from "../../money.ts";
import type { IsoDate } from "../../dates.ts";
import { centsSchema, idSchema, isoDateSchema } from "../../schemas.ts";
import type { Account, CoreData, Goal } from "../../types.ts";
import { displayName } from "../../balances/accountKinds.ts";
import { accountBar, activeGoals, allocate, allocatedFor, byPriority } from "../../goals/allocation.ts";
import {
  balanceLookup,
  contributionStatus,
  deadlineStatus,
  projectCompletion,
  projectionLabel,
  recentMonthlyRate,
  savedOn,
  whatIf,
  type BalanceOn,
  type WhatIfResult,
} from "../../goals/progress.ts";
import { milestonesFor, newCelebrations } from "../../goals/milestones.ts";
import { explainGoalChanges, type GoalChange } from "../../goals/explain.ts";

type GoalData = Pick<CoreData, "accounts" | "goals" | "goalMilestonesSeen" | "balanceSnapshots">;

interface AccountContext {
  account: Account;
  goals: Goal[];
  balanceOn: BalanceOn;
  balanceCents: number;
}

function accountContexts(data: Pick<CoreData, "accounts" | "goals" | "balanceSnapshots">, today: IsoDate): AccountContext[] {
  const live = activeGoals(data.goals);
  return data.accounts
    .filter((a) => live.some((g) => g.accountId === a.id) || a.protectedAmountCents > 0)
    .map((account) => ({
      account,
      goals: byPriority(live.filter((g) => g.accountId === account.id)),
      balanceOn: balanceLookup(data.balanceSnapshots, account.id, today, account.currentBalanceCents),
      balanceCents: account.currentBalanceCents ?? 0,
    }));
}

const createdDay = (g: Goal) => g.createdAt.slice(0, 10);

function goalCards(data: GoalData, today: IsoDate) {
  return accountContexts(data, today).flatMap((ctx) => {
    const { account, goals, balanceOn, balanceCents } = ctx;
    const allocation = allocate(balanceCents, account.protectedAmountCents, goals);
    const accountRate = recentMonthlyRate(balanceOn, today);
    const projections = projectCompletion({ balanceCents, protectedCents: account.protectedAmountCents, goals, monthlyRateCents: accountRate, today });
    return goals.map((g) => {
      const saved = allocatedFor(allocation, g.id);
      const savedAt = (d: IsoDate) => savedOn(balanceOn, account.protectedAmountCents, goals, g.id, d);
      const projection = projections.find((p) => p.goalId === g.id)!;
      const seen = new Set(data.goalMilestonesSeen.filter((m) => m.goalId === g.id).map((m) => m.milestoneCents));
      return {
        goalId: g.id,
        name: g.name,
        accountId: account.id,
        accountName: displayName(account),
        priority: g.priority,
        colorSlot: g.colorSlot,
        savedCents: saved,
        targetCents: g.targetCents,
        percent: g.targetCents > 0 ? Math.min(100, (saved * 100) / g.targetCents) : 0,
        completedAt: g.completedAt,
        createdAt: g.createdAt,
        /** The goal's own settings, for edit forms. */
        plan: { deadline: g.deadline, expectedContributionCents: g.expectedContributionCents, contributionPeriod: g.contributionPeriod },
        recentMonthlyRateCents: recentMonthlyRate(savedAt, today, { notBefore: createdDay(g) }),
        accountMonthlyRateCents: accountRate,
        deadline: g.deadline
          ? deadlineStatus({ targetCents: g.targetCents, savedCents: saved, deadline: g.deadline, today, startDate: createdDay(g), startSavedCents: savedAt(createdDay(g)) ?? 0 })
          : null,
        contributions:
          g.expectedContributionCents !== null
            ? contributionStatus({ expectedCents: g.expectedContributionCents, period: g.contributionPeriod ?? "monthly", today, saved: savedAt })
            : null,
        projection: { ...projection, ...projectionLabel(projection.projectedDate, g.deadline) },
        milestones: milestonesFor(g.targetCents).map((m) => ({ ...m, celebrated: seen.has(m.cents), reached: saved >= m.cents })),
        newCelebrations: newCelebrations(g, saved, seen),
        accountWarning: allocation.warning,
      };
    });
  });
}

export const listGoals = defineQuery({
  name: "goals.list",
  description: "Goal cards: saved vs target, progress, deadline need and ahead/behind, expected vs actual contributions, recent rate, projected completion, milestones; plus archived achievements.",
  params: z.object({}),
  needs: ["accounts", "goals", "goalMilestonesSeen", "balanceSnapshots", "transactions"],
  examples: [{}],
  run(data, _params, today) {
    const achievements = data.goals
      .filter((g) => g.archivedAt !== null)
      .map((g) => {
        const t = g.purchaseTransactionId ? data.transactions.find((x) => x.id === g.purchaseTransactionId) : undefined;
        return { goalId: g.id, name: g.name, targetCents: g.targetCents, completedAt: g.completedAt, archivedAt: g.archivedAt, colorSlot: g.colorSlot, purchase: t ? { transactionId: t.id, date: t.date, amountCents: t.amountCents, name: t.merchantName ?? t.rawDescription } : null };
      });
    const figures: Record<string, Figure> = {};
    for (const a of achievements) {
      if (a.purchase) figures[`purchase.${a.goalId}`] = { cents: a.purchase.amountCents, contributions: [{ transactionId: a.purchase.transactionId, cents: a.purchase.amountCents }], label: `${a.name} purchase` };
    }
    return { value: { goals: goalCards(data, today), achievements }, figures };
  },
});

export const goalAccountBars = defineQuery({
  name: "goals.accountBars",
  description: "Each goal account's balance as one bar split into protected, each goal (with its target) and unassigned, plus a below-protected warning.",
  params: z.object({}),
  needs: ["accounts", "goals", "balanceSnapshots"],
  examples: [{}],
  run(data, _params, today) {
    return {
      value: {
        accounts: accountContexts(data, today).map(({ account, goals, balanceCents }) => ({
          accountId: account.id,
          accountName: displayName(account),
          balanceCents,
          ...accountBar(balanceCents, account.protectedAmountCents, goals),
        })),
      },
      figures: {},
    };
  },
});

export const goalCelebrations = defineQuery({
  name: "goals.celebrations",
  description: "Milestones and completions reached but not yet celebrated (each plays once); record them with goals.markMilestonesSeen.",
  params: z.object({}),
  needs: ["accounts", "goals", "goalMilestonesSeen", "balanceSnapshots"],
  examples: [{}],
  run(data, _params, today) {
    const pending = goalCards(data, today).flatMap((c) => c.newCelebrations.map((m) => ({ ...m, name: c.name })));
    return { value: { pending, hasCompletion: pending.some((p) => p.kind === "completion") }, figures: {} };
  },
});

export const goalWhatIf = defineQuery({
  name: "goals.whatIf",
  description: "What-if for one account's goals: change the monthly contribution and/or the priority order and see new projected completion dates.",
  params: z.object({ accountId: idSchema, contributionDeltaCents: centsSchema.default(0), order: z.array(idSchema).optional() }),
  needs: ["accounts", "goals", "balanceSnapshots"],
  examples: [{ accountId: "acc_hysa", contributionDeltaCents: 15000 }],
  run(data, params, today) {
    const ctx = accountContexts(data, today).find((c) => c.account.id === params.accountId);
    if (!ctx) return { value: { accountId: params.accountId, found: false, result: null as WhatIfResult | null }, figures: {} };
    const result: WhatIfResult | null = whatIf(
      { balanceCents: ctx.balanceCents, protectedCents: ctx.account.protectedAmountCents, goals: ctx.goals, monthlyRateCents: recentMonthlyRate(ctx.balanceOn, today), today },
      { contributionDeltaCents: params.contributionDeltaCents, order: params.order },
    );
    return { value: { accountId: params.accountId, found: true, result }, figures: {} };
  },
});

export const goalLosses = defineQuery({
  name: "goals.explainChanges",
  description: "Why goals on an account gained or lost money since a date (e.g. \"MacBook lost $300 after the Nov 3 transfer\"), with the withdrawals behind it.",
  params: z.object({ accountId: idSchema, since: isoDateSchema }),
  needs: ["accounts", "goals", "balanceSnapshots", "transactions"],
  examples: [{ accountId: "acc_hysa", since: "2026-10-01" }],
  run(data, params, today) {
    const ctx = accountContexts(data, today).find((c) => c.account.id === params.accountId);
    if (!ctx) {
      return { value: { accountId: params.accountId, since: params.since, balanceKnown: false, changes: [] as GoalChange[] }, figures: {} as Record<string, Figure> };
    }
    const outflows = data.transactions
      .filter((t) => t.accountId === params.accountId && !t.pending && !t.removed && t.amountCents < 0 && t.date > params.since && t.date <= today)
      .map((t) => ({ transactionId: t.id, date: t.date, amountCents: t.amountCents }));
    const before = ctx.balanceOn(params.since);
    const goals = ctx.goals;
    const changes =
      before === null
        ? []
        : explainGoalChanges(
            { balanceCents: before, protectedCents: ctx.account.protectedAmountCents, goals },
            { balanceCents: ctx.balanceCents, protectedCents: ctx.account.protectedAmountCents, goals },
            { outflows },
          );
    const figures: Record<string, Figure> = {
      withdrawals: {
        cents: Money.sum(outflows.map((o) => o.amountCents)),
        contributions: outflows.map((o) => ({ transactionId: o.transactionId, cents: o.amountCents })),
        label: `Money out of the account since ${params.since}`,
      },
    };
    return { value: { accountId: params.accountId, since: params.since, balanceKnown: before !== null, changes }, figures };
  },
});

export const goalQueries = [listGoals, goalAccountBars, goalCelebrations, goalWhatIf, goalLosses];
