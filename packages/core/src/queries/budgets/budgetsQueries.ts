import { z } from "zod";
import { defineQuery, type Figure } from "../../registry.ts";
import { idSchema, isoDateSchema } from "../../schemas.ts";
import { LEDGER_NEEDS, buildLedger } from "../../flows/ledger.ts";
import { BUDGET_NEEDS, budgetHistory, budgetPeriodView, tripView } from "../../budgets/budget.ts";
import { currentPeriod, periodContaining } from "../../budgets/periods.ts";

const NEEDS = [...LEDGER_NEEDS, ...BUDGET_NEEDS] as const;

const prefixed = (prefix: string, figures: Record<string, Figure>) =>
  Object.fromEntries(Object.entries(figures).map(([k, v]) => [`${prefix}${k}`, v]));

/** Every active budget's bars for the period containing today (or `date`). */
export const overview = defineQuery({
  name: "budgets.overview",
  description:
    "Each active budget for the current period: overall bar, one bar per part, Everything else and trip lines, each with spent, pending (not counted), pace marker and end-of-period projection.",
  params: z.object({ date: isoDateSchema.optional() }),
  needs: NEEDS,
  examples: [{}],
  run(data, p, today) {
    const ledger = buildLedger(data);
    const figures: Record<string, Figure> = {};
    const value = data.budgets
      .filter((b) => b.archivedAt === null)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))
      .map((b) => {
        const r = budgetPeriodView(ledger, data, b, currentPeriod(b, p.date ?? today), today);
        Object.assign(figures, prefixed(`${b.id}.`, r.figures));
        return r.value;
      });
    return { value, figures };
  },
});

/** One budget for the period containing `date` (default today). */
export const period = defineQuery({
  name: "budgets.period",
  description: "One budget's bars for the period containing a date (default today); null if the budget doesn't exist or has no period then.",
  params: z.object({ budgetId: idSchema, date: isoDateSchema.optional() }),
  needs: NEEDS,
  examples: [{ budgetId: "budget_monthly" }],
  run(data, p, today) {
    const b = data.budgets.find((x) => x.id === p.budgetId);
    const per = b ? (p.date ? periodContaining(b, p.date) : currentPeriod(b, today)) : null;
    if (!b || !per) return { value: null, figures: {} };
    return budgetPeriodView(buildLedger(data), data, b, per, today);
  },
});

/** Planned vs actual, history grid and track record. */
export const history = defineQuery({
  name: "budgets.history",
  description:
    "Planned vs actual for the overall budget, each part and Everything else over the last N periods (history grid), with the track record: periods within plan and the average difference.",
  params: z.object({
    budgetId: idSchema,
    periods: z.number().int().min(1).max(36).default(6),
    endDate: isoDateSchema.optional(),
  }),
  needs: NEEDS,
  examples: [{ budgetId: "budget_monthly", periods: 6 }],
  run(data, p, today) {
    const b = data.budgets.find((x) => x.id === p.budgetId);
    if (!b) return { value: null, figures: {} };
    return budgetHistory(buildLedger(data), data, b, p.endDate ?? today, p.periods, today);
  },
});

export const trips = defineQuery({
  name: "budgets.trips",
  description: "Each trip's own bar across its dates (spent vs expected, pace, projection) and its spending per month.",
  params: z.object({ tripId: idSchema.optional() }),
  needs: NEEDS,
  examples: [{}],
  run(data, p, today) {
    const ledger = buildLedger(data);
    const figures: Record<string, Figure> = {};
    const value = data.trips
      .filter((t) => p.tripId === undefined || t.id === p.tripId)
      .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : a.id < b.id ? -1 : 1))
      .map((t) => {
        const r = tripView(ledger, t, today);
        Object.assign(figures, prefixed(`${t.id}.`, r.figures));
        return r.value;
      });
    return { value, figures };
  },
});
