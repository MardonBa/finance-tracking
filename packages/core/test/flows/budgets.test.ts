/**
 * §10 budgets.
 */
import { describe, expect, it } from "vitest";
import { flowsFixture } from "../../fixtures/flows.ts";
import { applyMutations } from "../../src/registry.ts";
import { actionRegistry } from "../../src/actions/index.ts";
import { buildLedger } from "../../src/flows/ledger.ts";
import { assignEntry, budgetHistory, budgetPeriodView, partsForPeriod, tripView } from "../../src/budgets/budget.ts";
import { currentPeriod, elapsedDays, periodContaining, shiftPeriod } from "../../src/budgets/periods.ts";
import { Money } from "../../src/money.ts";
import type { Budget, CoreData } from "../../src/types.ts";
import { ctx, mini, txn } from "./helpers.ts";

const run = (name: string, data: CoreData, input: unknown, today = "2026-10-20") => {
  const a = actionRegistry.get(name)!;
  const parsed = a.input.parse(input);
  return { preview: a.describe(data as never, parsed, ctx(today)), data: applyMutations(data, a.apply(data as never, parsed, ctx(today))) };
};

const spec = (periodKind: Budget["periodKind"], anchorDate: string, customEndDate: string | null = null) => ({ periodKind, anchorDate, customEndDate });

describe("periods (§10, decision 004)", () => {
  it("monthly by default = calendar months, including February in a leap year", () => {
    expect(periodContaining(spec("monthly", "2026-01-01"), "2028-02-29")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(periodContaining(spec("monthly", "2026-01-01"), "2026-02-28")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });
  it("monthly anchored mid-month (pay day on the 15th)", () => {
    expect(periodContaining(spec("monthly", "2026-01-15"), "2026-03-10")).toEqual({ start: "2026-02-15", end: "2026-03-14" });
    expect(periodContaining(spec("monthly", "2026-01-31"), "2026-03-01")).toEqual({ start: "2026-02-28", end: "2026-03-30" });
  });
  it("weekly, biweekly, yearly and custom", () => {
    expect(periodContaining(spec("weekly", "2026-10-05"), "2026-10-20")).toEqual({ start: "2026-10-19", end: "2026-10-25" });
    expect(periodContaining(spec("biweekly", "2026-10-05"), "2026-10-20")).toEqual({ start: "2026-10-19", end: "2026-11-01" });
    expect(periodContaining(spec("biweekly", "2026-10-05"), "2026-10-01")).toEqual({ start: "2026-09-21", end: "2026-10-04" });
    expect(periodContaining(spec("yearly", "2024-04-06"), "2026-01-10")).toEqual({ start: "2025-04-06", end: "2026-04-05" });
    expect(periodContaining(spec("custom", "2026-06-01", "2026-08-15"), "2026-07-01")).toEqual({ start: "2026-06-01", end: "2026-08-15" });
    expect(periodContaining(spec("custom", "2026-06-01", "2026-08-15"), "2026-09-01")).toBeNull();
  });
  it("shifting periods and elapsed days", () => {
    const s = spec("monthly", "2026-01-01");
    expect(shiftPeriod(s, { start: "2026-03-01", end: "2026-03-31" }, -1)).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(elapsedDays({ start: "2026-10-01", end: "2026-10-31" }, "2026-10-20")).toBe(20);
    expect(elapsedDays({ start: "2026-10-01", end: "2026-10-31" }, "2026-09-30")).toBe(0);
    expect(elapsedDays({ start: "2026-10-01", end: "2026-10-31" }, "2026-11-30")).toBe(31);
    expect(currentPeriod(spec("custom", "2026-06-01", "2026-08-15"), "2026-10-20")).toEqual({ start: "2026-06-01", end: "2026-08-15" });
  });
});

describe("budget for a period (§10)", () => {
  const { data, today } = flowsFixture();
  const ledger = buildLedger(data);
  const budget = data.budgets[0]!;
  const oct = budgetPeriodView(ledger, data, budget, { start: "2026-10-01", end: "2026-10-31" }, today);
  const v = oct.value;

  it("each transaction counts toward at most one part; a trip beats a part, a tag beats a category", () => {
    const parts = partsForPeriod(data.budgetParts, budget.id, v.period);
    const counted = new Map<string, number>();
    for (const e of ledger.entries.filter((x) => x.bucket === "spending" && x.countDate >= "2026-10-01" && x.countDate <= "2026-10-31")) {
      const a = assignEntry(e, parts, data.budgetPartTargets, data.trips);
      counted.set(e.key, (counted.get(e.key) ?? 0) + 1);
      if (e.transactionId === "trip_cafe") expect(a).toEqual({ kind: "trip", tripId: "trip_lisbon" });
    }
    for (const n of counted.values()) expect(n).toBe(1);

    // Tag part vs category part.
    const tagged = mini([txn("t", "card", -1000, "2026-10-02", { detailed: "FOOD_AND_DRINK_RESTAURANT" })], {
      transactionTags: [{ transactionId: "t", tagId: "tag_bday" }],
    });
    const e = buildLedger(tagged).byTransaction.get("t")![0]!;
    const cat = { id: "p_cat", budgetId: "b", name: "Eating out", expectedCents: 1, effectiveFrom: "2026-01-01", effectiveTo: null, position: 0 };
    const tag = { ...cat, id: "p_tag", name: "Birthday", position: 1 };
    const targets = [
      { partId: "p_cat", targetKind: "category" as const, targetValue: "FOOD_AND_DRINK" },
      { partId: "p_tag", targetKind: "tag" as const, targetValue: "tag_bday" },
    ];
    expect(assignEntry(e, [cat, tag], targets, [])).toEqual({ kind: "part", partId: "p_tag" });
  });

  it("the overall includes everything; the lines add up to it", () => {
    const lines = [...v.parts, v.everythingElse, ...v.trips];
    expect(Money.sum(lines.map((b) => b.spentCents))).toBe(v.overall.spentCents);
    expect(Money.sum(lines.map((b) => b.pendingCents))).toBe(v.overall.pendingCents);
  });

  it("parts: Eating out (Nopa + coffee, not the trip café), Groceries (incl. Costco food part), Amazon by merchant", () => {
    const by = Object.fromEntries(v.parts.map((p) => [p.name, p.spentCents]));
    expect(by).toEqual({ "Eating out": 9000 + 8000 + 3000, Groceries: 21000 + 9000, Amazon: 2500 - 2500 });
  });

  it("trip spending is a 'Trip: $X this month' line in the overall, not in parts", () => {
    expect(v.trips).toEqual([expect.objectContaining({ name: "Trip: Lisbon", spentCents: 20000, plannedCents: null })]);
    const sep = budgetPeriodView(ledger, data, budget, { start: "2026-09-01", end: "2026-09-30" }, today).value;
    expect(sep.trips.map((t) => t.spentCents)).toEqual([50000]);
  });

  it("Everything else = overall − parts; the amount for the period applies (no carryover)", () => {
    expect(v.overall.plannedCents).toBe(320000);
    expect(v.everythingElse.plannedCents).toBe(320000 - 15000 - 25000 - 5000);
    expect(v.partsExceedOverall).toBe(false);
    const sep = budgetPeriodView(ledger, data, budget, { start: "2026-09-01", end: "2026-09-30" }, today).value;
    // September overspent; October starts fresh at its own amount.
    expect(sep.overall.plannedCents).toBe(300000);
    expect(v.overall.remainingCents).toBe(320000 - v.overall.spentCents);
  });

  it("warns when the parts add up to more than the overall", () => {
    const big = { ...data, budgetAmounts: [{ budgetId: budget.id, effectiveFrom: "2026-07-01", amountCents: 40000 }] };
    const r = budgetPeriodView(ledger, big, budget, v.period, today).value;
    expect(r.partsExceedOverall).toBe(true);
    expect(r.partsExcessCents).toBe(5000);
    expect(r.everythingElse.plannedCents).toBe(-5000);
  });

  it("pace marker and end-of-period projection; pending is separate and never counted", () => {
    const eat = v.parts.find((p) => p.name === "Eating out")!;
    expect(eat.paceCents).toBe(Math.round((15000 * 20) / 31));
    expect(eat.projectedCents).toBe(Math.round((20000 * 31) / 20));
    expect(eat.status).toBe("over");
    expect(v.overall.pendingCents).toBe(3500);
    expect(oct.figures["overall.spent"]!.contributions.some((c) => c.transactionId === "gas_pending")).toBe(false);
    expect(oct.figures["overall.pending"]!.contributions.map((c) => c.transactionId)).toEqual(["gas_pending"]);
    const amz = v.parts.find((p) => p.name === "Amazon")!;
    expect(amz.status).toBe("on_pace");
  });

  it("a trip has its own bar and pace across its dates, spanning months", () => {
    const t = tripView(ledger, data.trips[0]!, today).value;
    expect(t.bar.spentCents).toBe(70000);
    expect(t.bar.plannedCents).toBe(100000);
    expect(t.bar.status).toBe("under");
    expect(t.byMonth).toEqual([
      { month: "2026-09", cents: 50000 },
      { month: "2026-10", cents: 20000 },
    ]);
    const mid = tripView(ledger, data.trips[0]!, "2026-09-29").value.bar;
    // Day 5 of a 10-day trip: half the expected total.
    expect(mid.paceCents).toBe(50000);
  });
});

describe("planned vs actual, history grid and track record (§10)", () => {
  const { data, today } = flowsFixture();
  const ledger = buildLedger(data);
  const h = budgetHistory(ledger, data, data.budgets[0]!, today, 4, today).value;

  it("one row per part (by name), overall and Everything else; one cell per period", () => {
    expect(h.periods.map((p) => p.start)).toEqual(["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"]);
    expect(h.rows.map((r) => r.name)).toEqual(["Monthly", "Eating out", "Groceries", "Amazon", "Everything else"]);
    const eat = h.rows.find((r) => r.name === "Eating out")!;
    expect(eat.cells.map((c) => c.actualCents)).toEqual([4000, 5000, 6000, 20000]);
    expect(eat.cells.map((c) => c.diffCents)).toEqual([-11000, -10000, -9000, 5000]);
    expect(eat.cells[3]!.diffRatio).toBeCloseTo(5000 / 15000, 10);
  });

  it("track record counts finished periods only: within plan and average difference", () => {
    const eat = h.rows.find((r) => r.name === "Eating out")!;
    expect(eat.track).toEqual({ periods: 3, withinCount: 3, averageDiffCents: -10000 });
    const groc = h.rows.find((r) => r.name === "Groceries")!;
    expect(groc.track.withinCount).toBe(3);
    const overall = h.rows.find((r) => r.kind === "overall")!;
    expect(overall.cells.map((c) => c.plannedCents)).toEqual([300000, 300000, 300000, 320000]);
  });

  it("a refund linked later corrects the closed period in the history grid", () => {
    const amz = h.rows.find((r) => r.name === "Amazon")!;
    expect(amz.cells[2]!.actualCents).toBe(6000);
  });
});

describe("editing the plan (§10)", () => {
  const { data } = flowsFixture();

  it("create a budget, then a part; a part needs at least one target", () => {
    const b = run("budgets.create", data, { name: "Weekly fun", amountCents: 20000, periodKind: "weekly", anchorDate: "2026-10-19" });
    const budget = b.data.budgets.find((x) => x.name === "Weekly fun")!;
    expect(b.data.budgetAmounts.find((a) => a.budgetId === budget.id)).toEqual({ budgetId: budget.id, effectiveFrom: "2026-10-19", amountCents: 20000 });
    expect(() => run("budgets.createPart", b.data, { budgetId: budget.id, name: "Bars", expectedCents: 5000, targets: [] })).toThrow();
    const p = run("budgets.createPart", b.data, { budgetId: budget.id, name: "Bars", expectedCents: 5000, targets: [{ kind: "category", value: "FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR" }] });
    expect(p.data.budgetParts.some((x) => x.name === "Bars" && x.effectiveFrom === "2026-10-19")).toBe(true);
    expect(() => run("budgets.createPart", p.data, { budgetId: budget.id, name: "bars", expectedCents: 1, targets: [{ kind: "tag", value: "x" }] })).toThrow(/already exists/);
  });

  it("a monthly budget defaults to calendar months from this month", () => {
    const b = run("budgets.create", data, { name: "M", amountCents: 1000 });
    const budget = b.data.budgets.find((x) => x.name === "M")!;
    expect(budget).toMatchObject({ periodKind: "monthly", anchorDate: "2026-10-01" });
  });

  it("the plan carries forward; editing it applies from the current period, past periods keep their plan", () => {
    const edited = run("budgets.editPart", data, { partId: "part_eat", expectedCents: 25000 });
    expect(edited.preview.changes).toEqual([{ label: "Expected", before: "$150.00", after: "$250.00" }]);
    const parts = edited.data.budgetParts.filter((p) => p.name === "Eating out");
    expect(parts.map((p) => [p.expectedCents, p.effectiveFrom, p.effectiveTo])).toEqual([
      [15000, "2026-07-01", "2026-09-30"],
      [25000, "2026-10-01", null],
    ]);
    const ledger = buildLedger(edited.data);
    const h = budgetHistory(ledger, edited.data, edited.data.budgets[0]!, "2026-10-20", 4, "2026-10-20").value;
    const row = h.rows.find((r) => r.name === "Eating out")!;
    expect(row.cells.map((c) => c.plannedCents)).toEqual([15000, 15000, 15000, 25000]);
    // November uses the new plan, with fresh amounts (no carryover).
    const nov = budgetPeriodView(ledger, edited.data, edited.data.budgets[0]!, { start: "2026-11-01", end: "2026-11-30" }, "2026-11-02").value;
    expect(nov.parts.find((p) => p.name === "Eating out")!.plannedCents).toBe(25000);
    expect(nov.overall.spentCents).toBe(0);
  });

  it("editing the overall amount changes this period and later, not earlier ones", () => {
    const e = run("budgets.edit", data, { budgetId: "budget_monthly", amountCents: 280000 });
    expect(e.preview.changes).toEqual([{ label: "Amount from 2026-10-01", before: "$3,200.00", after: "$2,800.00" }]);
    const l = buildLedger(e.data);
    const b = e.data.budgets[0]!;
    expect(budgetPeriodView(l, e.data, b, { start: "2026-10-01", end: "2026-10-31" }, "2026-10-20").value.overall.plannedCents).toBe(280000);
    expect(budgetPeriodView(l, e.data, b, { start: "2026-09-01", end: "2026-09-30" }, "2026-10-20").value.overall.plannedCents).toBe(300000);
  });

  it("deleting a part keeps it in past periods", () => {
    const d = run("budgets.deletePart", data, { partId: "part_amz" });
    expect(d.data.budgetParts.find((p) => p.id === "part_amz")!.effectiveTo).toBe("2026-09-30");
    const l = buildLedger(d.data);
    expect(budgetPeriodView(l, d.data, d.data.budgets[0]!, { start: "2026-10-01", end: "2026-10-31" }, "2026-10-20").value.parts.map((p) => p.name)).toEqual(["Eating out", "Groceries"]);
  });

  it("trips: create with a new tag, edit dates, delete", () => {
    const c = run("budgets.createTrip", data, { name: "Tahoe", startDate: "2026-12-20", endDate: "2027-01-02", expectedCents: 80000 });
    const trip = c.data.trips.find((t) => t.name === "Tahoe")!;
    expect(c.data.tags.find((t) => t.id === trip.tagId)!.name).toBe("Tahoe");
    expect(() => run("budgets.createTrip", data, { name: "x", startDate: "2026-12-20", endDate: "2026-12-01", expectedCents: 1 })).toThrow();
    const e = run("budgets.editTrip", c.data, { tripId: trip.id, endDate: "2027-01-05" });
    expect(e.data.trips.find((t) => t.id === trip.id)!.endDate).toBe("2027-01-05");
    expect(() => run("budgets.editTrip", c.data, { tripId: trip.id, endDate: "2026-12-01" })).toThrow();
    expect(run("budgets.deleteTrip", e.data, { tripId: trip.id }).data.trips.some((t) => t.id === trip.id)).toBe(false);
    expect(() => run("budgets.createTrip", data, { name: "Lisbon again", tagName: "Lisbon trip", startDate: "2027-01-01", endDate: "2027-01-02", expectedCents: 1 })).toThrow(/already belongs/);
  });
});
