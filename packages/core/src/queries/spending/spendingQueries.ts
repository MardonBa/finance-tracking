import { z } from "zod";
import { defineQuery } from "../../registry.ts";
import { monthEnd, monthOf, monthStart } from "../../dates.ts";
import { isoMonthSchema } from "../../schemas.ts";
import { LEDGER_NEEDS, buildLedger } from "../../flows/ledger.ts";
import { monthParamsSchema, monthRun, monthRunSchema, rangeSchema, usualMonthsSchema } from "../../flows/params.ts";
import { cashFlowSeries, monthlySummary } from "../../spending/summary.ts";
import { sankey } from "../../spending/sankey.ts";
import {
  categorySeries,
  heatmap,
  necessitySplit,
  notNecessaryTrend,
  savedByDestination,
  spendingByCategory,
  topMerchants,
} from "../../spending/breakdowns.ts";
import { cuttingBackProgress, worthALook, type RecurringSignal } from "../../spending/worthALook.ts";

const OCT = { from: "2026-10-01", to: "2026-10-31" };

export const monthlySummaryQuery = defineQuery({
  name: "spending.monthlySummary",
  description:
    "Income, spending, amount saved and savings rate for a month, each compared with the previous month and with usual (average of the previous 1–3 months).",
  params: monthParamsSchema.extend({ usualMonths: usualMonthsSchema }),
  needs: LEDGER_NEEDS,
  examples: [{ month: "2026-10", usualMonths: 3 }, { month: "2026-10", usualMonths: 1 }],
  run(data, p) {
    return monthlySummary(buildLedger(data), p.month, p.usualMonths);
  },
});

export const cashFlow = defineQuery({
  name: "spending.cashFlow",
  description: "Income, spending, saved and savings rate for each month in a run of months (savings rate month over month).",
  params: monthRunSchema,
  needs: LEDGER_NEEDS,
  examples: [{ endMonth: "2026-10", months: 3 }],
  run(data, p) {
    return cashFlowSeries(buildLedger(data), monthRun(p.endMonth, p.months));
  },
});

export const byCategory = defineQuery({
  name: "spending.byCategory",
  description: "Spending per category for a date range; the categories add up to total spending.",
  params: rangeSchema.and(z.object({ level: z.enum(["primary", "detailed"]).default("primary") })),
  needs: LEDGER_NEEDS,
  examples: [{ ...OCT, level: "primary" }, { ...OCT, level: "detailed" }],
  run(data, p) {
    return spendingByCategory(buildLedger(data), p.from, p.to, p.level);
  },
});

export const sankeyQuery = defineQuery({
  name: "spending.sankey",
  description:
    "Flow diagram for a month: income sources → categories → top merchants (rest as Other), with what's left flowing to Saved or Overspent.",
  params: monthParamsSchema.extend({
    maxSources: z.number().int().min(1).max(20).default(5),
    merchantsPerCategory: z.number().int().min(0).max(10).default(3),
  }),
  needs: LEDGER_NEEDS,
  examples: [
    { month: "2026-10", maxSources: 5, merchantsPerCategory: 3 },
    { month: "2026-09", maxSources: 1, merchantsPerCategory: 1 },
  ],
  run(data, p) {
    return sankey(buildLedger(data), monthStart(p.month), monthEnd(p.month), p);
  },
});

export const categorySeriesQuery = defineQuery({
  name: "spending.categorySeries",
  description: "One monthly series per category on a shared scale (small multiples), with this month vs usual.",
  params: monthRunSchema.extend({ usualMonths: usualMonthsSchema }),
  needs: LEDGER_NEEDS,
  examples: [{ endMonth: "2026-10", months: 6, usualMonths: 3 }],
  run(data, p) {
    return categorySeries(buildLedger(data), monthRun(p.endMonth, p.months), p.usualMonths);
  },
});

export const topMerchantsQuery = defineQuery({
  name: "spending.topMerchants",
  description: "Merchants ranked by spending for a period, with transaction count and a 6–12 month trend line.",
  params: rangeSchema.and(
    z.object({ limit: z.number().int().min(1).max(100).default(10), trendMonths: z.number().int().min(6).max(12).default(12) }),
  ),
  needs: LEDGER_NEEDS,
  examples: [{ ...OCT, limit: 10, trendMonths: 12 }],
  run(data, p) {
    return topMerchants(buildLedger(data), p.from, p.to, p);
  },
});

export const heatmapQuery = defineQuery({
  name: "spending.heatmap",
  description: "Spending per day (calendar grid) and per day of the week for a date range.",
  params: rangeSchema,
  needs: LEDGER_NEEDS,
  examples: [OCT],
  run(data, p) {
    return heatmap(buildLedger(data), p.from, p.to);
  },
});

export const savedByDestinationQuery = defineQuery({
  name: "spending.savedByDestination",
  description: "Money moved into each savings and investment account per month, shown as saved rather than hidden as transfers.",
  params: monthRunSchema,
  needs: LEDGER_NEEDS,
  examples: [{ endMonth: "2026-10", months: 2 }],
  run(data, p) {
    return savedByDestination(buildLedger(data), monthRun(p.endMonth, p.months));
  },
});

export const necessity = defineQuery({
  name: "spending.necessity",
  description: "Spending split into necessary, not necessary and not set (no defaults: unlabelled is 'not set'), overall and per category.",
  params: rangeSchema,
  needs: LEDGER_NEEDS,
  examples: [OCT],
  run(data, p) {
    return necessitySplit(buildLedger(data), p.from, p.to);
  },
});

export const notNecessaryTrendQuery = defineQuery({
  name: "spending.notNecessaryTrend",
  description: "Not-necessary (and not-set) spending month over month.",
  params: monthRunSchema,
  needs: LEDGER_NEEDS,
  examples: [{ endMonth: "2026-10", months: 3 }],
  run(data, p) {
    return notNecessaryTrend(buildLedger(data), monthRun(p.endMonth, p.months));
  },
});

/**
 * Recurring signals derived from the recurring items (§9): a stream first
 * seen this month is "new"; a last amount more than 5% over the average is a
 * price increase. TODO(revisit): replace with the recurring module's own
 * detection once it exists (core-balances track).
 */
function recurringSignals(
  items: { id: string; description: string; merchantName: string | null; averageAmountCents: number; lastAmountCents: number | null; firstSeenOn: string; isActive: boolean; direction: string }[],
  links: { recurringItemId: string; transactionId: string }[],
  month: string,
): RecurringSignal[] {
  const out: RecurringSignal[] = [];
  for (const it of [...items].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!it.isActive || it.direction !== "outflow") continue;
    const name = it.merchantName ?? it.description;
    const txs = links.filter((l) => l.recurringItemId === it.id).map((l) => l.transactionId);
    const avg = Math.abs(it.averageAmountCents);
    const last = it.lastAmountCents === null ? null : Math.abs(it.lastAmountCents);
    if (monthOf(it.firstSeenOn) === month) {
      out.push({ kind: "new_recurring", recurringId: it.id, name, amountCents: last ?? avg, previousAmountCents: null, transactionIds: txs });
    } else if (last !== null && avg > 0 && last > avg * 1.05) {
      out.push({ kind: "price_increase", recurringId: it.id, name, amountCents: last, previousAmountCents: avg, transactionIds: txs });
    }
  }
  return out;
}

export const worthALookQuery = defineQuery({
  name: "spending.worthALook",
  description:
    "Rule-based places to improve: categories above their usual pace, rising merchants, small frequent purchases, new recurring charges and price increases.",
  params: monthParamsSchema.extend({ usualMonths: usualMonthsSchema }),
  needs: [...LEDGER_NEEDS, "recurringItems", "recurringItemTransactions"],
  examples: [{ month: "2026-10", usualMonths: 3 }],
  run(data, p, today) {
    const signals = recurringSignals(data.recurringItems, data.recurringItemTransactions, p.month);
    return worthALook(buildLedger(data), { month: p.month, today, usualMonths: p.usualMonths, recurringSignals: signals });
  },
});

export const cuttingBack = defineQuery({
  name: "spending.cuttingBack",
  description: "The cutting-back list: for each category or merchant, spending month by month since it was added vs the average before.",
  params: z.object({ throughMonth: isoMonthSchema.optional() }),
  needs: [...LEDGER_NEEDS, "cuttingBack"],
  examples: [{}, { throughMonth: "2026-10" }],
  run(data, p, today) {
    return cuttingBackProgress(buildLedger(data), data.cuttingBack, p.throughMonth ?? monthOf(today));
  },
});
