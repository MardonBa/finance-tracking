/**
 * Core additions for the Budgets and Goals windows (Phase 2 budgets-goals):
 * the `budgets.config` query, the goals fixture, and the `plan` fields on
 * `goals.list` cards.
 */
import { describe, expect, it } from "vitest";
import { flowsFixture, goalsFixture } from "../fixtures/index.ts";
import { queryRegistry } from "../src/queries/index.ts";
import type { CoreData } from "../src/types.ts";

function query(name: string, data: CoreData, params: unknown, today: string) {
  const q = queryRegistry.get(name)!;
  return q.run(data as never, q.params.parse(params), today) as { value: any; figures: Record<string, unknown> };
}

describe("budgets.config", () => {
  it("lists the budget's period, current amount and parts with their targets", () => {
    const { data, today } = flowsFixture();
    const { value } = query("budgets.config", data, {}, today);
    expect(value.budgets).toHaveLength(1);
    const b = value.budgets[0];
    expect(b).toMatchObject({ budgetId: "budget_monthly", periodKind: "monthly", amountCents: 320000, period: { start: "2026-10-01", end: "2026-10-31" } });
    expect(b.parts.map((p: { name: string }) => p.name)).toEqual(["Eating out", "Groceries", "Amazon"]);
    expect(b.parts[0].targets).toEqual([
      { kind: "category", value: "FOOD_AND_DRINK_RESTAURANT" },
      { kind: "category", value: "FOOD_AND_DRINK_COFFEE" },
    ]);
    expect(b.parts[2].targets).toEqual([{ kind: "merchant", value: "auto:AMAZON" }]);
  });

  it("lists trips with their tag and the choices a part can target", () => {
    const { data, today } = flowsFixture();
    const { value } = query("budgets.config", data, {}, today);
    expect(value.trips).toEqual([expect.objectContaining({ id: "trip_lisbon", tagName: "Lisbon trip", startDate: "2026-09-25" })]);
    expect(value.choices.tags).toEqual([{ value: "tag_lisbon", label: "Lisbon trip" }]);
    const cats = value.choices.categories.map((c: { value: string }) => c.value);
    expect(cats).toContain("FOOD_AND_DRINK_GROCERIES");
    expect(cats).toContain("FOOD_AND_DRINK");
    expect(value.choices.merchants.map((m: { label: string }) => m.label)).toContain("Trader Joe's");
  });

  it("is empty without budgets", () => {
    const { data, today } = goalsFixture();
    expect(query("budgets.config", data, {}, today).value.budgets).toEqual([]);
  });
});

describe("goals fixture through the goal queries", () => {
  it("cards carry the goal's own plan for edit forms", () => {
    const { data, today } = goalsFixture();
    const { value } = query("goals.list", data, {}, today);
    const dgx = value.goals.find((g: { goalId: string }) => g.goalId === "goal_dgx");
    expect(dgx.plan).toEqual({ deadline: "2027-06-01", expectedContributionCents: 30000, contributionPeriod: "monthly" });
    expect(dgx.savedCents).toBe(431234);
    expect(value.achievements).toEqual([expect.objectContaining({ goalId: "goal_headphones", purchase: expect.objectContaining({ transactionId: "tx_card_purchase_amazon" }) })]);
  });

  it("has one new DGX milestone and the Bike completion to celebrate", () => {
    const { data, today } = goalsFixture();
    const { value } = query("goals.celebrations", data, {}, today);
    expect(value.pending.map((p: { goalId: string; cents: number; kind: string }) => [p.goalId, p.cents, p.kind])).toEqual([
      ["goal_bike", 30000, "progress"],
      ["goal_bike", 60000, "progress"],
      ["goal_bike", 90000, "progress"],
      ["goal_bike", 120000, "completion"],
      ["goal_dgx", 420000, "progress"],
    ]);
    expect(value.hasCompletion).toBe(true);
  });

  it("explains the Oct 20 withdrawal as a loss on the lowest-priority funded goal", () => {
    const { data, today } = goalsFixture();
    const { value } = query("goals.explainChanges", data, { accountId: "acc_hysa", since: "2026-10-17" }, today);
    const dgx = value.changes.find((c: { goalId: string }) => c.goalId === "goal_dgx");
    expect(dgx.changeCents).toBeLessThan(0);
    expect(dgx.summary).toMatch(/lost/);
  });
});
