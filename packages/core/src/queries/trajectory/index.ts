/** Trajectory queries (§12): looking back and the forward projection. */
import { z } from "zod";
import { defineQuery, type AnyQuery, type Figure } from "../../registry.ts";
import { centsSchema, idSchema, isoMonthSchema } from "../../schemas.ts";
import { accountKind, displayName } from "../../balances/accountKinds.ts";
import { balanceMovingTransactions } from "../../balances/rebuild.ts";
import { Money } from "../../money.ts";
import { contributionItems, investmentAccounts } from "../../investments/investments.ts";
import {
  contributionsVsGrowth,
  earningVsSpending,
  interestVsPrincipal,
  isInterestTransaction,
  rollUpToYears,
} from "../../trajectory/lookback.ts";
import {
  lifePhaseFieldsSchema,
  parsePhase,
  phaseRow,
  readAssumptions,
  trajectoryBaseAssumptionsSchema,
} from "../../trajectory/assumptions.ts";
import { PROJECTION_HORIZONS, projectNetWorth, startingParts } from "../../trajectory/projection.ts";

export const earningVsSpendingQuery = defineQuery({
  name: "trajectory.earningVsSpending",
  description: "Income vs spending per month or year with the savings rate and spending as a share of income (totals come from the flows module).",
  params: z.object({
    months: z.array(z.object({ period: isoMonthSchema, incomeCents: centsSchema, spendingCents: centsSchema })),
    groupBy: z.enum(["month", "year"]).default("month"),
  }),
  needs: [],
  examples: [{ months: [{ period: "2026-09", incomeCents: 500000, spendingCents: 320000 }, { period: "2026-10", incomeCents: 510000, spendingCents: 410000 }], groupBy: "year" }],
  run(_data, params) {
    const rows = params.groupBy === "year" ? rollUpToYears(params.months) : [...params.months].sort((a, b) => (a.period < b.period ? -1 : 1));
    return { value: { groupBy: params.groupBy, rows: earningVsSpending(rows) }, figures: {} };
  },
});

export const investmentGrowthQuery = defineQuery({
  name: "trajectory.investmentGrowth",
  description: "Investment value over time split into what I put in (transfers in minus out) and growth, from when each account's history starts.",
  params: z.object({ accountId: idSchema.optional() }),
  needs: ["accounts", "balanceSnapshots", "investmentTransactions", "transactions", "transferLinks"],
  examples: [{}, { accountId: "acc_brokerage" }],
  run(data, params) {
    const accounts = investmentAccounts(data.accounts).filter((a) => !params.accountId || a.id === params.accountId);
    return {
      value: {
        accounts: accounts.map((a) => {
          const values = data.balanceSnapshots.filter((s) => s.accountId === a.id && s.date >= a.connectedOn).map((s) => ({ date: s.date, valueCents: s.balanceCents }));
          const items = contributionItems(a.id, data.investmentTransactions, data.transactions, data.transferLinks);
          return {
            accountId: a.id,
            accountName: displayName(a),
            ...contributionsVsGrowth(values, items.map((i) => ({ date: i.date, cents: i.cents, id: i.id }))),
            contributionIds: items.map((i) => ({ id: i.id, source: i.source })),
          };
        }),
      },
      figures: {},
    };
  },
});

export const interestQuery = defineQuery({
  name: "trajectory.interest",
  description: "Interest vs principal for interest-earning accounts: cumulative principal deposited vs total interest, plus interest per month and per year.",
  params: z.object({ accountId: idSchema.optional() }),
  needs: ["accounts", "transactions", "overrides"],
  examples: [{}, { accountId: "acc_hysa" }],
  run(data, params) {
    const ov = new Map(data.overrides.map((o) => [o.transactionId, o]));
    const accounts = data.accounts.filter(
      (a) =>
        (!params.accountId || a.id === params.accountId) &&
        (accountKind(a) === "savings" || data.transactions.some((t) => t.accountId === a.id && isInterestTransaction(t, ov.get(t.id)))),
    );
    const figures: Record<string, Figure> = {};
    const rows = accounts.map((a) => {
      const moving = balanceMovingTransactions(data.transactions, a.id);
      const start = (a.currentBalanceCents ?? 0) - Money.sum(moving.map((t) => t.amountCents));
      const r = interestVsPrincipal({ accountId: a.id, transactions: data.transactions, overrides: data.overrides, startingBalanceCents: start });
      const byId = new Map(moving.map((t) => [t.id, t]));
      const fig = (ids: string[], label: string): Figure => {
        const contributions = ids.map((id) => ({ transactionId: id, cents: byId.get(id)!.amountCents }));
        return { cents: Money.sum(contributions.map((c) => c.cents)), contributions, label };
      };
      for (const m of r.months) figures[`interest.${a.id}.${m.month}`] = fig(m.interestTransactionIds, `${displayName(a)} interest · ${m.month}`);
      for (const y of r.years) figures[`interest.${a.id}.${y.year}`] = fig(y.interestTransactionIds, `${displayName(a)} interest · ${y.year}`);
      figures[`interest.${a.id}.total`] = fig(r.months.flatMap((m) => m.interestTransactionIds), `${displayName(a)} interest · all time`);
      return { accountName: displayName(a), ...r };
    });
    return { value: { accounts: rows }, figures };
  },
});

export const assumptionsQuery = defineQuery({
  name: "trajectory.assumptions",
  description: "The current projection assumptions (return, HYSA rate, inflation, income/spending, contributions, range) and life phases.",
  params: z.object({}),
  needs: ["trajectoryAssumptions", "lifePhases"],
  examples: [{}],
  run(data) {
    const { assumptions, isDefault } = readAssumptions(data.trajectoryAssumptions);
    return {
      value: { assumptions, isDefault, phases: data.lifePhases.map(parsePhase).sort((a, b) => a.fromYear - b.fromYear) },
      figures: {},
    };
  },
});

export const projectionQuery = defineQuery({
  name: "trajectory.projection",
  description: "Projected net worth and each part (cash, HYSA, investments) over 1, 20, 30 or 40 years as a lower/expected/higher range, in today's or future dollars, from editable assumptions and life phases.",
  params: z.object({
    horizonYears: z.union(PROJECTION_HORIZONS.map((h) => z.literal(h)) as [z.ZodLiteral<1>, z.ZodLiteral<20>, z.ZodLiteral<30>, z.ZodLiteral<40>]).default(30),
    dollars: z.enum(["future", "today"]).default("future"),
    /** Recent "usual" monthly income and spending (§8), used when the assumptions leave them empty. */
    usualMonthlyIncomeCents: centsSchema.default(0),
    usualMonthlySpendingCents: centsSchema.default(0),
    /** Unsaved edits to preview live, on top of the stored assumptions. */
    assumptions: trajectoryBaseAssumptionsSchema.partial().optional(),
    /** Unsaved phases to preview live, replacing the stored ones. */
    phases: z.array(lifePhaseFieldsSchema).optional(),
  }),
  needs: ["accounts", "trajectoryAssumptions", "lifePhases"],
  examples: [
    { horizonYears: 30, dollars: "future", usualMonthlyIncomeCents: 500000, usualMonthlySpendingCents: 350000 },
    {
      horizonYears: 1,
      dollars: "today",
      usualMonthlyIncomeCents: 0,
      usualMonthlySpendingCents: 0,
      assumptions: { investmentReturnPct: 5 },
      phases: [{ name: "Later", fromYear: 2030, toYear: 2040, monthlyIncomeCents: 700000, monthlySpendingCents: null, savingsRatePct: 25, investmentReturnPct: null, hysaRatePct: null, inflationPct: null, contributions: null }],
    },
  ],
  run(data, params, today) {
    const stored = readAssumptions(data.trajectoryAssumptions).assumptions;
    const overrides = Object.fromEntries(Object.entries(params.assumptions ?? {}).filter(([, v]) => v !== undefined));
    const base = trajectoryBaseAssumptionsSchema.parse({ ...stored, ...overrides });
    const phases = params.phases ? params.phases.map((p, i) => parsePhase(phaseRow(`preview_${i}`, p, ""))) : data.lifePhases.map(parsePhase);
    const { start, partByAccount } = startingParts(data.accounts.filter((a) => !a.hidden));
    const result = projectNetWorth({
      today,
      horizonYears: params.horizonYears,
      dollars: params.dollars,
      start,
      partByAccount,
      base,
      usualMonthlyIncomeCents: params.usualMonthlyIncomeCents,
      usualMonthlySpendingCents: params.usualMonthlySpendingCents,
      phases,
    });
    return { value: { ...result, assumptions: base }, figures: {} };
  },
});

/** Queries of the "trajectory" module. Every name must start with "trajectory.". Add files in this folder and list them here. */
export const queries: AnyQuery[] = [earningVsSpendingQuery, investmentGrowthQuery, interestQuery, assumptionsQuery, projectionQuery];
