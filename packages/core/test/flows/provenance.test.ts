/**
 * §7 drill-down and §1 provenance: for EVERY registered query, on both
 * fixtures, every figure drills down to a transaction list whose total equals
 * the figure, with split parts and linked refunds grouped under their parent,
 * and every row carries merchant + category + amount.
 */
import { describe, expect, it } from "vitest";
import { basicFixture } from "../../fixtures/index.ts";
import { flowsFixture } from "../../fixtures/flows.ts";
import { queryRegistry } from "../../src/queries/index.ts";
import { buildLedger } from "../../src/flows/ledger.ts";
import { drillDownFigure, rowFor } from "../../src/flows/rows.ts";
import { applyFilter, filterFigure, parseAmountQuery } from "../../src/flows/filter.ts";
import { spendingByCategory } from "../../src/spending/breakdowns.ts";
import type { CoreData } from "../../src/types.ts";
import type { AnyQuery } from "../../src/registry.ts";
import { Money } from "../../src/money.ts";

const pick = (data: CoreData, q: AnyQuery) => Object.fromEntries(q.needs.map((k: keyof CoreData) => [k, data[k]]));

/** Extra params so every query also runs on the flows fixture's interesting month. */
const FLOWS_PARAMS: Record<string, unknown[]> = {
  "budgets.period": [{ budgetId: "budget_monthly" }, { budgetId: "budget_monthly", date: "2026-09-15" }],
  "budgets.history": [{ budgetId: "budget_monthly", periods: 4 }],
  "budgets.trips": [{}],
  "transactions.merchant": [{ from: "2026-09-01", to: "2026-10-31", merchantKey: "auto:AMAZON" }],
  "spending.sankey": [{ month: "2026-10" }, { month: "2026-09" }],
  "spending.monthlySummary": [{ month: "2026-10", usualMonths: 2 }],
  "spending.cuttingBack": [{ throughMonth: "2026-10" }],
};

for (const [fixtureName, load] of [
  ["basic", basicFixture],
  ["flows", flowsFixture],
] as const) {
  describe(`provenance on the ${fixtureName} fixture`, () => {
    const { data, today } = load();
    const ledger = buildLedger(data);
    for (const q of queryRegistry.all) {
      if (q.name.startsWith("example.")) continue;
      it(`${q.name}: every figure drills down to exactly its number`, () => {
        const examples = [...q.examples, ...(fixtureName === "flows" ? (FLOWS_PARAMS[q.name] ?? []) : [])];
        for (const ex of examples) {
          const result = q.run(pick(data, q) as never, q.params.parse(ex), today);
          for (const [key, fig] of Object.entries(result.figures)) {
            // Contributions from other modules' queries may point outside the ledger; ours never do.
            if (!fig.contributions.every((c) => ledger.byTransaction.has(c.transactionId))) {
              expect(q.name.split(".")[0], `${q.name} ${key}`).not.toMatch(/^(flows|spending|transactions|budgets)$/);
              continue;
            }
            const dd = drillDownFigure(ledger, fig);
            expect(dd.totalCents, `${q.name} ${key}`).toBe(fig.cents);
            expect(Money.sum(dd.groups.map((g) => g.totalCents)), `${q.name} ${key}`).toBe(fig.cents);
            for (const g of dd.groups) {
              expect(g.row.merchantName.length, `${q.name} ${key}`).toBeGreaterThan(0);
              expect(g.row.category.length, `${q.name} ${key}`).toBeGreaterThan(0);
              expect(typeof g.row.amountCents).toBe("number");
            }
          }
        }
      });
    }
  });
}

describe("drill-down details (§7)", () => {
  const { data, today } = flowsFixture();
  const ledger = buildLedger(data);

  it("the transactions.drillDown query re-runs a chart's query and its total equals the clicked figure", () => {
    const q = queryRegistry.get("transactions.drillDown")!;
    const byCat = spendingByCategory(ledger, "2026-10-01", "2026-10-31");
    const clicked = byCat.figures["category.FOOD_AND_DRINK"]!;
    const r = q.run(data as never, q.params.parse({ query: "spending.byCategory", params: { from: "2026-10-01", to: "2026-10-31" }, figure: "category.FOOD_AND_DRINK" }), today);
    expect((r.value as { totalCents: number }).totalCents).toBe(clicked.cents);
    expect(() => q.run(data as never, q.params.parse({ query: "nope.nothing", params: {}, figure: "x" }), today)).toThrow();
  });

  it("a filter gives the same list and total as the chart figure, with a readable header", () => {
    const byCat = spendingByCategory(ledger, "2026-10-01", "2026-10-31");
    const f = filterFigure(ledger, { from: "2026-10-01", to: "2026-10-31", buckets: ["spending"], categories: ["FOOD_AND_DRINK"], measure: "spend" });
    expect(f.cents).toBe(byCat.figures["category.FOOD_AND_DRINK"]!.cents);
    expect(f.label).toBe("Food and drink · 2026-10 · spending · excluding transfers · cleared only");
  });

  it("split parts and linked refunds appear with their parent purchase", () => {
    const sep = spendingByCategory(ledger, "2026-09-01", "2026-09-30").figures["category.GENERAL_MERCHANDISE"]!;
    const dd = drillDownFigure(ledger, sep);
    expect(dd.groups).toHaveLength(1);
    expect(dd.groups[0]!.row.transactionId).toBe("amazon_sep");
    expect(dd.groups[0]!.refundCents).toEqual({ amazon_refund: -4000 });
    expect(dd.groups[0]!.row.refunds.map((r) => r.transactionId)).toEqual(["amazon_refund"]);
    expect(dd.totalCents).toBe(6000);

    const home = spendingByCategory(ledger, "2026-10-01", "2026-10-31").figures["category.HOME_IMPROVEMENT"]!;
    const dh = drillDownFigure(ledger, home);
    expect(dh.groups[0]!.row.transactionId).toBe("costco_split");
    expect(dh.groups[0]!.partCents).toEqual({ split_home: 6000 });
    expect(dh.groups[0]!.row.parts.map((p) => p.splitId)).toEqual(["split_food", "split_home"]);
  });

  it("rows carry markers for pending, transfer, split, refund, Poker and note, and the transfer label", () => {
    expect(rowFor(ledger, "gas_pending")!.markers.pending).toBe(true);
    expect(rowFor(ledger, "costco_split")!.markers.split).toBe(true);
    expect(rowFor(ledger, "amazon_refund")!.markers.refund).toBe(true);
    expect(rowFor(ledger, "poker_in")!.markers.poker).toBe(true);
    expect(rowFor(ledger, "dine_10b")!.markers.note).toBe(true);
    const hysa = rowFor(ledger, "hysa_in_10")!;
    expect(hysa.markers.transfer).toBe(true);
    expect(hysa.transferLabel).toBe("Transfer: Checking → HYSA");
    expect(rowFor(ledger, "atm_out")!.transferLabel).toBe("Transfer: Checking → Cash");
  });

  it("a note on one half of a matched transfer shows on the pair", () => {
    const withNote = { ...data, overrides: [...data.overrides, { transactionId: "hysa_out_10", category: null, bucket: null, necessity: null, note: "Emergency fund", confirmedAt: null, updatedAt: "x" }] };
    expect(rowFor(buildLedger(withNote), "hysa_in_10")!.note).toBe("Emergency fund");
  });
});

describe("search and filters (§7)", () => {
  const { data, today } = flowsFixture();
  const ledger = buildLedger(data);
  const ids = (f: Parameters<typeof applyFilter>[1]) => [...new Set(applyFilter(ledger, f).map((e) => e.transactionId))].sort();

  it("by merchant, description, amount or note", () => {
    expect(ids({ text: "nopa", from: "2026-10-01", to: "2026-10-31" })).toEqual(["dine_10a", "dine_10b"]);
    expect(ids({ text: "ZELLE" })).toEqual(["zelle_out"]);
    // A Costco split part of $90 and a $90 dinner.
    expect(ids({ text: "$90.00" })).toEqual(["costco_split", "dine_10a"]);
    expect(ids({ text: "work dinner" })).toEqual(["dine_10b"]);
    expect(parseAmountQuery("1,299.00")).toBe(129900);
    expect(parseAmountQuery("coffee")).toBeNull();
  });

  it("filters for date range, account and category; pending only when asked", () => {
    expect(ids({ from: "2026-10-15", to: "2026-10-15", accountIds: ["card"] })).toEqual(["netflix_a", "netflix_b"]);
    expect(ids({ categories: ["FOOD_AND_DRINK_COFFEE"] })).toHaveLength(6);
    expect(ids({ text: "shell" })).toEqual([]);
    expect(ids({ text: "shell", includePending: true })).toEqual(["gas_pending"]);
  });

  it("the transactions.list query returns rows newest first with the filtered total", () => {
    const q = queryRegistry.get("transactions.list")!;
    const r = q.run(data as never, q.params.parse({ from: "2026-10-01", to: "2026-10-31", merchantKeys: ["auto:AMAZON"], measure: "spend" }), today).value as {
      totalCents: number;
      rows: { transactionId: string }[];
    };
    expect(r.rows.map((x) => x.transactionId)).toEqual(["amazon_refund_unlinked", "amazon_oct"]);
    expect(r.totalCents).toBe(0);
  });
});
