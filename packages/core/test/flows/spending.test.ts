/**
 * §8 spending views and §7 merchants.
 */
import { describe, expect, it } from "vitest";
import { flowsFixture } from "../../fixtures/flows.ts";
import { applyMutations } from "../../src/registry.ts";
import { actionRegistry } from "../../src/actions/index.ts";
import { queryRegistry } from "../../src/queries/index.ts";
import { buildLedger } from "../../src/flows/ledger.ts";
import { merchantResolver, normalizeMerchantKey } from "../../src/flows/merchants.ts";
import { monthlySummary } from "../../src/spending/summary.ts";
import { usualBasis } from "../../src/spending/usual.ts";
import { sankey } from "../../src/spending/sankey.ts";
import {
  categorySeries,
  heatmap,
  necessitySplit,
  notNecessaryTrend,
  savedByDestination,
  spendingByCategory,
  topMerchants,
} from "../../src/spending/breakdowns.ts";
import { cuttingBackProgress, worthALook } from "../../src/spending/worthALook.ts";
import { Money } from "../../src/money.ts";
import type { CoreData } from "../../src/types.ts";
import { ctx, mini, txn } from "./helpers.ts";

const run = (name: string, data: CoreData, input: unknown) => {
  const a = actionRegistry.get(name)!;
  const parsed = a.input.parse(input);
  return { preview: a.describe(data as never, parsed, ctx()), data: applyMutations(data, a.apply(data as never, parsed, ctx())) };
};

const { data, today } = flowsFixture();
const ledger = buildLedger(data);

describe("monthly summary and usual (§8)", () => {
  it("income, spending, saved and savings rate, vs previous month and usual (default 3 months)", () => {
    const s = monthlySummary(ledger, "2026-10", 3).value;
    expect(s.usual.basis.months).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(s.usual.basis.label).toBe("average of Jul, Aug, Sep 2026");
    expect(s.previous.month).toBe("2026-09");
    expect(s.vsPrevious.spending.diffCents).toBe(s.spendingCents - s.previous.spendingCents);
    // Jul: rent 150000 + groceries 20000 + Nopa 4000; Aug: … + Nopa 5000; Sep 232000 → 581000 / 3, rounded.
    expect(s.usual.spendingCents).toBe(Math.round((174000 + 175000 + 232000) / 3));
    expect(s.savingsRate).toBeCloseTo(s.savedCents / s.incomeCents, 10);
  });

  it("usual over 1 or 2 months says which months it used, and never reaches before the data", () => {
    expect(monthlySummary(ledger, "2026-10", 1).value.usual.basis.months).toEqual(["2026-09"]);
    expect(monthlySummary(ledger, "2026-10", 2).value.usual.basis.months).toEqual(["2026-08", "2026-09"]);
    expect(monthlySummary(ledger, "2026-08", 3).value.usual.basis.months).toEqual(["2026-07"]);
    expect(usualBasis("2026-07", 3, "2026-07").label).toBe("no earlier months yet");
    expect(monthlySummary(ledger, "2026-07", 3).value.usual.spendingCents).toBeNull();
  });

  it("the monthly summary query rejects a usual of 4 months", () => {
    const q = queryRegistry.get("spending.monthlySummary")!;
    expect(q.params.safeParse({ month: "2026-10", usualMonths: 4 }).success).toBe(false);
  });
});

describe("flow diagram (§8)", () => {
  it("income sources → categories → top merchants, leftover to Saved or Overspent, and it balances", () => {
    const sep = sankey(ledger, "2026-09-01", "2026-09-30").value;
    const into = (id: string) => sep.links.filter((l) => l.target === id).reduce((s, l) => s + l.cents, 0);
    const outOf = (id: string) => sep.links.filter((l) => l.source === id).reduce((s, l) => s + l.cents, 0);
    expect(into("hub")).toBe(outOf("hub"));
    expect(sep.leftoverCents).toBe(sep.incomeCents - sep.spendingCents);
    expect(sep.nodes.some((n) => n.id === "saved")).toBe(true);
    for (const n of sep.nodes.filter((x) => x.kind === "category")) expect(outOf(n.id)).toBe(into(n.id));
    for (const l of sep.links) expect(l.cents).toBeGreaterThan(0);

    const oct = sankey(ledger, "2026-10-01", "2026-10-31").value;
    // October overspent; Poker lost money, so it flows out.
    expect(oct.nodes.some((n) => n.id === "overspent")).toBe(true);
    expect(oct.nodes.find((n) => n.id === "src:poker")?.label).toBe("Poker (net loss)");
    const into2 = (id: string) => oct.links.filter((l) => l.target === id).reduce((s, l) => s + l.cents, 0);
    const outOf2 = (id: string) => oct.links.filter((l) => l.source === id).reduce((s, l) => s + l.cents, 0);
    expect(into2("hub")).toBe(outOf2("hub"));
  });

  it("smaller merchants are grouped into Other", () => {
    const one = sankey(ledger, "2026-10-01", "2026-10-31", { merchantsPerCategory: 1 }).value;
    const food = one.links.filter((l) => l.source === "cat:FOOD_AND_DRINK");
    expect(food).toHaveLength(2);
    expect(food.map((l) => l.target)).toContain("mer:FOOD_AND_DRINK:other");
  });
});

describe("breakdowns (§8)", () => {
  it("per-category monthly series share a scale and compare with usual", () => {
    const s = categorySeries(ledger, ["2026-08", "2026-09", "2026-10"], 3).value;
    const food = s.series.find((x) => x.category === "FOOD_AND_DRINK")!;
    expect(food.months.map((m) => m.cents)).toEqual([25000, 26000, 20000 + 3000 + 21000 + 9000 + 17000]);
    expect(s.maxCents).toBe(Math.max(...s.series.flatMap((x) => x.months.map((m) => m.cents))));
    expect(food.usualCents).toBe(Math.round((24000 + 25000 + 26000) / 3));
  });

  it("top merchants with count and a 6–12 month trend", () => {
    const t = topMerchants(ledger, "2026-10-01", "2026-10-31", { limit: 3, trendMonths: 6 }).value;
    expect(t.map((m) => m.name)).toEqual(["Oak Apartments", "Best Buy", "Trader Joe's"]);
    const nopa = topMerchants(ledger, "2026-10-01", "2026-10-31", { limit: 20, trendMonths: 6 }).value.find((m) => m.name === "Nopa")!;
    expect(nopa.count).toBe(2);
    expect(nopa.trend.map((p) => p.cents)).toEqual([0, 0, 4000, 5000, 6000, 17000]);
  });

  it("the heatmap: a day grid and a day-of-week summary that add up to the period's spending", () => {
    const h = heatmap(ledger, "2026-10-01", "2026-10-31").value;
    const total = spendingByCategory(ledger, "2026-10-01", "2026-10-31").value.totalCents;
    expect(h.days).toHaveLength(31);
    expect(Money.sum(h.days.map((d) => d.cents))).toBe(total);
    expect(Money.sum(h.byDayOfWeek.map((d) => d.cents))).toBe(total);
    expect(h.byDayOfWeek.reduce((s, d) => s + d.days, 0)).toBe(31);
    expect(h.days.find((d) => d.date === "2026-10-15")!.count).toBe(2);
  });

  it("saved by destination: money moved into HYSA and brokerage each month, interest and buys excluded", () => {
    const s = savedByDestination(ledger, ["2026-09", "2026-10"]).value;
    expect(s.find((x) => x.accountId === "hysa")!.months.map((m) => m.cents)).toEqual([50000, 50000]);
    expect(s.find((x) => x.accountId === "brok")!.months.map((m) => m.cents)).toEqual([0, 100000]);
    expect(s.map((x) => x.accountId).sort()).toEqual(["brok", "hysa"]);
  });

  it("cash flow: savings rate month over month", () => {
    const q = queryRegistry.get("spending.cashFlow")!;
    const r = q.run(data as never, q.params.parse({ endMonth: "2026-10", months: 2 }), today).value as { month: string; savingsRate: number | null }[];
    expect(r.map((x) => x.month)).toEqual(["2026-09", "2026-10"]);
    expect(r[0]!.savingsRate).toBeGreaterThan(0);
    expect(r[1]!.savingsRate).toBeLessThan(0);
  });
});

describe("necessary / not necessary / not set (§8)", () => {
  it("no defaults: unlabelled spending is 'not set'", () => {
    const bare = buildLedger(mini([txn("x", "card", -1000, "2026-10-02", { detailed: "FOOD_AND_DRINK_COFFEE" })]));
    expect(necessitySplit(bare, "2026-10-01", "2026-10-31").value.totals).toEqual({ necessary: 0, not_necessary: 0, not_set: 1000 });
  });

  it("transaction beats merchant beats category (detailed, then broad)", () => {
    const e = (id: string) => ledger.byTransaction.get(id)![0]!;
    expect([e("dine_10b").necessity, e("dine_10b").necessitySource]).toEqual(["necessary", "transaction"]);
    expect([e("dine_10a").necessity, e("dine_10a").necessitySource]).toEqual(["not_necessary", "merchant"]);
    expect([e("groc_10").necessity, e("groc_10").necessitySource]).toEqual(["necessary", "category"]);
    expect([e("coffee_2").necessity, e("coffee_2").necessitySource]).toEqual(["necessary", "category"]);
    expect(e("tv_big").necessity).toBeNull();
  });

  it("split totals add up and the not-necessary trend is per month", () => {
    const n = necessitySplit(ledger, "2026-10-01", "2026-10-31").value;
    expect(n.totals.necessary + n.totals.not_necessary + n.totals.not_set).toBe(spendingByCategory(ledger, "2026-10-01", "2026-10-31").value.totalCents);
    expect(notNecessaryTrend(ledger, ["2026-09", "2026-10"]).value.map((m) => m.cents)).toEqual([6000, 9000]);
  });

  it("label actions change the result; clearing restores 'not set'", () => {
    const labelled = run("spending.setNecessityLabel", data, { targetKind: "merchant", targetValue: "auto:BEST BUY", necessity: "not_necessary" });
    expect(labelled.preview.changes[0]).toEqual({ label: "Necessary?", before: "Not set", after: "Not necessary" });
    expect(buildLedger(labelled.data).byTransaction.get("tv_big")![0]!.necessity).toBe("not_necessary");
    const cleared = run("spending.setNecessityLabel", labelled.data, { targetKind: "merchant", targetValue: "auto:BEST BUY", necessity: null });
    expect(buildLedger(cleared.data).byTransaction.get("tv_big")![0]!.necessity).toBeNull();
    const tx = run("transactions.setNecessity", data, { transactionId: "dine_10a", necessity: "necessary" });
    expect(buildLedger(tx.data).byTransaction.get("dine_10a")![0]!.necessitySource).toBe("transaction");
  });
});

describe("Worth a look and cutting back (§8)", () => {
  it("lists categories above usual pace, rising merchants, small frequent purchases and recurring signals, with numbers", () => {
    const w = worthALook(ledger, { month: "2026-10", today, usualMonths: 3, recurringSignals: [
      { kind: "price_increase", recurringId: "rec_x", name: "Spotify", amountCents: 1299, previousAmountCents: 1099, transactionIds: [] },
    ] });
    const kinds = w.value.items.map((i) => `${i.kind}:${i.target.value}`);
    expect(kinds).toContain("category_pace:FOOD_AND_DRINK");
    expect(kinds).toContain("rising_merchant:auto:NOPA");
    expect(kinds).toContain("small_frequent:FOOD_AND_DRINK_COFFEE");
    expect(kinds).toContain("price_increase:rec_x");
    const coffee = w.value.items.find((i) => i.kind === "small_frequent")!;
    expect(coffee.text).toBe("Food and drink coffee: 6 purchases, $30.00 this month.");
    expect(w.figures[coffee.figure!]!.cents).toBe(3000);
    // Rent paid on the 3rd every month is not "above pace".
    expect(kinds).not.toContain("category_pace:RENT_AND_UTILITIES");
    expect(w.value.items.find((i) => i.kind === "price_increase")!.text).toBe("Spotify went up from $10.99 to $12.99.");
  });

  it("the query derives new recurring charges from the recurring items", () => {
    const q = queryRegistry.get("spending.worthALook")!;
    const r = q.run(data as never, q.params.parse({ month: "2026-10" }), today).value as { items: { kind: string; text: string }[] };
    expect(r.items.find((i) => i.kind === "new_recurring")?.text).toBe("New recurring charge: Netflix, $12.99.");
  });

  it("cutting back is tracked month by month against the average before it started", () => {
    const c = cuttingBackProgress(ledger, data.cuttingBack, "2026-10").value[0]!;
    expect(c.label).toBe("Nopa");
    expect(c.baselineCents).toBe(5000);
    expect(c.months).toEqual([{ month: "2026-10", cents: 17000, wentDown: false, diffCents: 12000 }]);
    const added = run("spending.addCuttingBack", data, { targetKind: "category", targetValue: "FOOD_AND_DRINK_COFFEE" });
    expect(added.data.cuttingBack).toHaveLength(2);
    expect(() => run("spending.addCuttingBack", added.data, { targetKind: "category", targetValue: "FOOD_AND_DRINK_COFFEE" })).toThrow(/Already/);
    const removed = run("spending.removeCuttingBack", data, { id: "cb_nopa" });
    expect(removed.data.cuttingBack[0]!.endedOn).toBe("2026-10-20");
  });
});

describe("merchants (§7)", () => {
  it('normalises "AMAZON MKTP US*2K4" and "Amazon.com" to one merchant', () => {
    expect(normalizeMerchantKey("AMAZON MKTP US*2K4")).toBe("AMAZON");
    expect(normalizeMerchantKey("Amazon.com")).toBe("AMAZON");
    expect(normalizeMerchantKey("AMAZON.COM REFUND")).toBe("AMAZON");
    expect(normalizeMerchantKey("SQ *BLUE BOTTLE COFFEE")).toBe("BLUE BOTTLE COFFEE");
    expect(normalizeMerchantKey("TRADER JOE'S #123")).toBe("TRADER JOES");
    expect(normalizeMerchantKey("TST* SHAKE SHACK 1234")).toBe("SHAKE SHACK");
    const keys = ["amazon_sep", "amazon_refund", "amazon_oct"].map((id) => ledger.byTransaction.get(id)![0]!.merchantKey);
    expect(new Set(keys)).toEqual(new Set(["auto:AMAZON"]));
  });

  it("merge and separate", () => {
    const merged = run("transactions.mergeMerchants", data, { merchantKeys: ["auto:NOPA", "auto:LISBON CAFE"], name: "Restaurants I like" });
    const l = buildLedger(merged.data);
    const key = l.byTransaction.get("dine_10a")![0]!.merchantKey;
    expect(l.byTransaction.get("trip_cafe")![0]!.merchantKey).toBe(key);
    expect(l.merchantNames.get(key)).toBe("Restaurants I like");
    // The Nopa necessity label and cutting-back item follow the merge.
    expect(merged.data.necessaryLabels.find((x) => x.id === "nl_nopa")!.targetValue).toBe(key);
    expect(merged.data.cuttingBack[0]!.targetValue).toBe(key);

    const sep = run("transactions.separateMerchant", data, { transactionId: "amazon_refund", name: "Amazon returns" });
    const l2 = buildLedger(sep.data);
    expect(l2.byTransaction.get("amazon_refund")![0]!.merchantName).toBe("Amazon returns");
    expect(l2.byTransaction.get("amazon_refund_unlinked")![0]!.merchantName).toBe("Amazon returns");
    expect(l2.byTransaction.get("amazon_oct")![0]!.merchantKey).toBe("auto:AMAZON");
    expect(merchantResolver(sep.data.merchants, sep.data.merchantAliases).resolve({ merchantName: "Amazon", rawDescription: "x", merchantEntityId: null }).key).toBe("auto:AMAZON");
  });

  it("the merchant view: transactions, period total, count and trend", () => {
    const q = queryRegistry.get("transactions.merchant")!;
    const r = q.run(data as never, q.params.parse({ from: "2026-09-01", to: "2026-10-31", merchantKey: "auto:AMAZON", trendMonths: 6 }), today).value as {
      totalCents: number;
      count: number;
      trend: { month: string; cents: number }[];
      rows: unknown[];
    };
    expect(r.totalCents).toBe(10000 - 4000 + 2500 - 2500);
    expect(r.count).toBe(4);
    expect(r.trend.slice(-2).map((p) => p.cents)).toEqual([6000, 0]);
    expect(r.rows).toHaveLength(4);
  });
});
