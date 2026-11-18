import { z } from "zod";
import { defineQuery, type AnyQuery, type Figure } from "../../registry.ts";
import { DATA_KEYS, type CoreData } from "../../types.ts";
import { monthEnd, monthOf, monthStart } from "../../dates.ts";
import { LEDGER_NEEDS, buildLedger } from "../../flows/ledger.ts";
import { figure, groupBy, inPeriod, measures } from "../../flows/figures.ts";
import { applyFilter, describeFilter, drillFilterSchema } from "../../flows/filter.ts";
import { drillDownFigure, rowFor } from "../../flows/rows.ts";
import { monthRun, rangeSchema } from "../../flows/params.ts";
import { queryRegistry } from "../index.ts";

const OCT = { from: "2026-10-01", to: "2026-10-31" };

/**
 * The transactions list with search and filters (§7): by merchant,
 * description, amount or note, plus date range, account and category.
 * Newest first. Every row carries merchant + category + amount (§6).
 */
export const list = defineQuery({
  name: "transactions.list",
  description:
    "Transactions matching a filter (date range, accounts, categories, merchants, tags, buckets) and an optional search by merchant, description, amount or note, newest first, with the filtered total.",
  params: drillFilterSchema.extend({
    limit: z.number().int().min(1).max(1000).default(200),
    offset: z.number().int().min(0).default(0),
  }),
  needs: LEDGER_NEEDS,
  examples: [
    { measure: "amount", includePending: true, limit: 50, offset: 0 },
    { ...OCT, measure: "spend", text: "amazon", limit: 200, offset: 0 },
    { ...OCT, measure: "amount", text: "89.50", limit: 200, offset: 0 },
  ],
  run(data, p) {
    const ledger = buildLedger(data);
    const { limit, offset, ...filter } = p;
    const entries = applyFilter(ledger, filter);
    const total = figure(entries, measures[filter.measure], describeFilter(ledger, filter));
    const ids = [...new Set(entries.map((e) => e.transactionId))];
    const rows = ids.map((id) => rowFor(ledger, id)!);
    rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.transactionId < b.transactionId ? -1 : 1));
    return {
      value: { label: total.label ?? "", count: rows.length, totalCents: total.cents, rows: rows.slice(offset, offset + limit) },
      figures: { total },
    };
  },
});

const drillParams = z.union([
  z.object({ filter: drillFilterSchema }),
  z.object({ query: z.string().min(1), params: z.unknown(), figure: z.string().min(1) }),
]);

/**
 * What's behind a number (§7): either a filter, or the figure of another
 * query (re-run with the same params). Split parts and linked refunds are
 * grouped under their parent purchase. The total always equals the figure.
 */
export const drillDown = defineQuery({
  name: "transactions.drillDown",
  description:
    "The exact transactions behind a chart number, given either a filter or a query name + params + figure key; split parts and linked refunds are shown with their parent and the total equals the number.",
  params: drillParams,
  // Re-running another query may need any slice.
  needs: DATA_KEYS,
  examples: [
    { filter: { ...OCT, buckets: ["spending"], categories: ["FOOD_AND_DRINK"], measure: "spend" } },
    { query: "spending.byCategory", params: { ...OCT, level: "primary" }, figure: "total" },
  ],
  run(data, p, today) {
    const ledger = buildLedger(data);
    let fig: Figure;
    if ("filter" in p) {
      fig = figure(applyFilter(ledger, p.filter), measures[p.filter.measure], describeFilter(ledger, p.filter));
    } else {
      const q: AnyQuery | undefined = queryRegistry.get(p.query);
      if (!q) throw new Error(`Unknown query ${p.query}`);
      if (q.name === "transactions.drillDown") throw new Error("Can't drill into a drill-down");
      const params = q.params.parse(p.params);
      const slices = Object.fromEntries(q.needs.map((k: keyof CoreData) => [k, data[k]]));
      const result = q.run(slices as never, params, today);
      const found = result.figures[p.figure];
      if (!found) throw new Error(`Query ${p.query} has no figure "${p.figure}"`);
      fig = found;
    }
    const value = drillDownFigure(ledger, fig);
    return { value, figures: { total: fig } };
  },
});

/** Merchant view (§7): all its transactions, total and count for the period, and a 6–12 month trend. */
export const merchant = defineQuery({
  name: "transactions.merchant",
  description: "One merchant: its transactions, total and count for a period, and monthly spending over the last 6–12 months.",
  params: rangeSchema.and(z.object({ merchantKey: z.string().min(1), trendMonths: z.number().int().min(6).max(12).default(12) })),
  needs: LEDGER_NEEDS,
  examples: [{ ...OCT, merchantKey: "auto:AMAZON", trendMonths: 6 }],
  run(data, p) {
    const ledger = buildLedger(data);
    const name = ledger.merchantNames.get(p.merchantKey) ?? p.merchantKey;
    const mine = ledger.entries.filter((e) => e.merchantKey === p.merchantKey);
    const inRange = inPeriod(mine, p.from, p.to);
    // Spending merchants total by spend; payers (income) by amount.
    const measure = inRange.some((e) => e.bucket === "spending") || mine.some((e) => e.bucket === "spending") ? measures.spend : measures.amount;
    const total = figure(inRange, measure, `${name} · ${p.from} – ${p.to}`);
    const figures: Record<string, Figure> = { total };
    const trend = monthRun(monthOf(p.to), p.trendMonths).map((m) => {
      const f = figure(inPeriod(mine, monthStart(m), monthEnd(m)), measure, `${name} · ${m}`);
      figures[`month.${m}`] = f;
      return { month: m, cents: f.cents };
    });
    const ids = [...new Set(mine.map((e) => e.transactionId))];
    const rows = ids.map((id) => rowFor(ledger, id)!).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return {
      value: {
        merchantKey: p.merchantKey,
        name,
        totalCents: total.cents,
        count: new Set(inRange.map((e) => e.transactionId)).size,
        trend,
        rows,
        /** The raw names grouped under this merchant (for merge / separate). */
        rawNames: [...new Set(mine.map((e) => e.rawDescription))].sort(),
      },
      figures,
    };
  },
});

/** All merchants with their total for a period (for merge / separate). */
export const merchants = defineQuery({
  name: "transactions.merchants",
  description: "Every merchant group with its spending, count and the raw names grouped under it, for a period.",
  params: rangeSchema,
  needs: LEDGER_NEEDS,
  examples: [OCT],
  run(data, p) {
    const ledger = buildLedger(data);
    const figures: Record<string, Figure> = {};
    const value = [...groupBy(inPeriod(ledger.entries, p.from, p.to), (e) => e.merchantKey).entries()]
      .map(([key, es]) => {
        const f = figure(es, measures.spend, `${ledger.merchantNames.get(key) ?? key} · ${p.from} – ${p.to}`);
        figures[key] = f;
        return {
          merchantKey: key,
          name: ledger.merchantNames.get(key) ?? key,
          spendCents: f.cents,
          count: new Set(es.map((e) => e.transactionId)).size,
          isMerged: !key.startsWith("auto:"),
          rawNames: [...new Set(es.map((e) => e.rawDescription))].sort(),
        };
      })
      .sort((a, b) => b.spendCents - a.spendCents || (a.merchantKey < b.merchantKey ? -1 : 1));
    return { value, figures };
  },
});
