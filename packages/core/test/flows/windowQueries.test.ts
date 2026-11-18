/**
 * Queries added for the Transactions and Spending windows (Phase 2,
 * transactions-spending): row tags / necessity, filter options and the
 * necessity labelling list.
 */
import { describe, expect, it } from "vitest";
import { queryRegistry } from "../../src/index.ts";
import { flowsFixture } from "../../fixtures/index.ts";

function run(name: string, params: unknown) {
  const { today, data } = flowsFixture();
  const q = queryRegistry.get(name)!;
  return q.run(data as never, q.params.parse(params), today) as { value: any; figures: Record<string, { cents: number; contributions: { cents: number }[] }> };
}

describe("transaction rows carry tags and necessity", () => {
  it("every row has tagIds, necessity and its source", () => {
    const { value } = run("transactions.list", { measure: "amount", includePending: true, limit: 1000, offset: 0 });
    for (const r of value.rows) {
      expect(Array.isArray(r.tagIds)).toBe(true);
      expect(r).toHaveProperty("necessity");
      expect(r).toHaveProperty("necessitySource");
      if (r.necessity === null) expect(r.necessitySource).toBeNull();
    }
    // The fixture labels at least one transaction somehow (merchant or category label).
    expect(value.rows.some((r: { necessity: string | null }) => r.necessity !== null)).toBe(true);
  });
});

describe("transactions.filterOptions", () => {
  it("lists every category in use plus Plaid's broad ones, never Uncategorised, broad before detailed", () => {
    const { value } = run("transactions.filterOptions", {});
    const cats: { category: string; primary: string; isPrimary: boolean }[] = value.categories;
    expect(cats.some((c) => c.category === "FOOD_AND_DRINK" && c.isPrimary)).toBe(true);
    expect(cats.some((c) => c.category === "FOOD_AND_DRINK_RESTAURANT" && !c.isPrimary)).toBe(true);
    expect(cats.some((c) => c.category === "UNCATEGORIZED")).toBe(false);
    const food = cats.filter((c) => c.primary === "FOOD_AND_DRINK");
    expect(food[0]!.isPrimary).toBe(true);
    expect(Array.isArray(value.tags)).toBe(true);
  });
});

describe("spending.necessityLabels", () => {
  it("lists categories and merchants with spend; their figures add up to total spending", () => {
    const range = { from: "2026-10-01", to: "2026-10-31" };
    const { value, figures } = run("spending.necessityLabels", range);
    const total = run("spending.byCategory", { ...range, level: "primary" }).value.totalCents;
    const sum = (xs: { spendCents: number }[]) => xs.reduce((s, x) => s + x.spendCents, 0);
    expect(sum(value.categories)).toBe(total);
    expect(sum(value.merchants)).toBe(total);
    for (const [, f] of Object.entries(figures)) expect(f.contributions.reduce((s, c) => s + c.cents, 0)).toBe(f.cents);
    for (const r of [...value.categories, ...value.merchants]) expect(["necessary", "not_necessary", null]).toContain(r.necessity);
  });

  it("unlabelled things are null (no defaults)", () => {
    const { today, data } = flowsFixture();
    data.necessaryLabels = [];
    const q = queryRegistry.get("spending.necessityLabels")!;
    const { value } = q.run(data as never, q.params.parse({ from: "2026-10-01", to: "2026-10-31" }), today) as { value: any };
    for (const r of [...value.categories, ...value.merchants]) expect(r.necessity).toBeNull();
  });
});
