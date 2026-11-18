/**
 * Every core-flows action on the flows fixture: input schema, a before → after
 * preview, apply, and an inverse that restores every touched row exactly.
 */
import { describe, expect, it } from "vitest";
import { flowsFixture } from "../../fixtures/flows.ts";
import { applyMutations, inverseMutations, type AnyAction } from "../../src/registry.ts";
import { actionRegistry } from "../../src/actions/index.ts";
import type { CoreData } from "../../src/types.ts";
import { ctx } from "./helpers.ts";

const CASES: Record<string, unknown[]> = {
  "flows.setBucket": [{ transactionId: "tv_big", bucket: "income" }, { transactionId: "pay_10", bucket: "spending", always: { kind: "merchant" } }],
  "flows.markTransfer": [{ transactionId: "zelle_out" }, { transactionId: "amazon_oct", counterpartTransactionId: "amazon_refund_unlinked" }],
  "flows.unmarkTransfer": [{ transactionId: "hysa_in_10" }, { transactionId: "zelle_out", countAs: "poker" }, { transactionId: "atm_out" }],
  "flows.linkRefund": [{ refundTransactionId: "amazon_refund_unlinked", purchaseTransactionId: "amazon_oct" }],
  "flows.unlinkRefund": [{ refundTransactionId: "amazon_refund" }],
  "flows.markPoker": [{ transactionId: "zelle_out", poker: true, always: { kind: "description_contains" } }, { transactionId: "poker_in", poker: false }],
  "flows.confirm": [{ transactionIds: ["zelle_out", "cash_market"] }],
  "flows.deleteRule": [{ ruleId: "rule_poker_in" }],
  "transactions.recategorise": [{ transactionId: "cash_market", category: "FOOD_AND_DRINK_GROCERIES", alwaysForMerchant: true }, { transactionId: "dine_10b", category: null }],
  "transactions.setNote": [{ transactionId: "hysa_out_10", note: "Emergency fund" }, { transactionId: "dine_10b", note: null }],
  "transactions.setTags": [{ transactionId: "dine_10a", tags: ["Lisbon trip", "Birthday"] }, { transactionId: "trip_cafe", tags: [] }],
  "transactions.setNecessity": [{ transactionId: "tv_big", necessity: "not_necessary" }],
  "transactions.split": [{ transactionId: "costco_split", parts: [{ amountCents: -14000 }, { amountCents: -1000, category: "PERSONAL_CARE" }] }],
  "transactions.unsplit": [{ transactionId: "costco_split" }],
  "transactions.mergeMerchants": [{ merchantKeys: ["auto:NOPA", "auto:LISBON CAFE"], name: "Restaurants" }],
  "transactions.separateMerchant": [{ transactionId: "amazon_refund", name: "Amazon returns" }],
  "spending.setNecessityLabel": [{ targetKind: "merchant", targetValue: "auto:NOPA", necessity: null }, { targetKind: "category", targetValue: "TRAVEL", necessity: "not_necessary" }],
  "spending.addCuttingBack": [{ targetKind: "category", targetValue: "FOOD_AND_DRINK_COFFEE" }],
  "spending.removeCuttingBack": [{ id: "cb_nopa" }],
  "budgets.create": [{ name: "Holidays", amountCents: 50000, periodKind: "custom", anchorDate: "2026-12-01", customEndDate: "2026-12-31" }],
  "budgets.edit": [{ budgetId: "budget_monthly", name: "Everyday", amountCents: 310000 }],
  "budgets.delete": [{ budgetId: "budget_monthly" }],
  "budgets.createPart": [{ budgetId: "budget_monthly", name: "Lisbon", expectedCents: 10000, targets: [{ kind: "tag", value: "tag_lisbon" }] }],
  "budgets.editPart": [{ partId: "part_groc", targets: [{ kind: "category", value: "FOOD_AND_DRINK_GROCERIES" }, { kind: "merchant", value: "auto:COSTCO" }] }],
  "budgets.deletePart": [{ partId: "part_eat" }],
  "budgets.createTrip": [{ name: "Tahoe", startDate: "2026-12-20", endDate: "2027-01-02", expectedCents: 80000 }],
  "budgets.editTrip": [{ tripId: "trip_lisbon", expectedCents: 120000 }],
  "budgets.deleteTrip": [{ tripId: "trip_lisbon" }],
};

const MODULES = /^(flows|transactions|spending|budgets)\./;

describe("core-flows actions", () => {
  const ours = actionRegistry.all.filter((a: AnyAction) => MODULES.test(a.name));

  it("every action of these modules has cases here and none is AI-excluded", () => {
    expect(ours.map((a) => a.name).sort()).toEqual(Object.keys(CASES).sort());
    for (const a of ours) expect(a.aiExcluded, a.name).toBeUndefined();
  });

  for (const [name, inputs] of Object.entries(CASES)) {
    it(`${name}: preview shows before → after; apply then inverse restores the data`, () => {
      const a = actionRegistry.get(name)!;
      const { data } = flowsFixture();
      for (const raw of inputs) {
        const input = a.input.parse(raw);
        const before = Object.fromEntries(a.needs.map((k: keyof CoreData) => [k, data[k]])) as Partial<CoreData>;
        const preview = a.describe(before as never, input, ctx());
        expect(preview.summary.length, name).toBeGreaterThan(0);
        expect(preview.changes.length, name).toBeGreaterThan(0);
        const applied = a.apply(before as never, input, ctx());
        expect(applied.length, name).toBeGreaterThan(0);
        expect(a.inverse, name).toBeDefined();
        const inverse = a.inverse!(before as never, input, applied);
        expect(inverse).toEqual(inverseMutations(before, applied));
        const restored = applyMutations(applyMutations(before, applied), inverse);
        for (const k of a.needs as (keyof CoreData)[]) {
          const norm = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).sort();
          expect(norm(restored[k] as unknown[]), `${name} ${k}`).toEqual(norm(before[k] as unknown[]));
        }
      }
    });
  }

  it("invalid requests are refused with a message", () => {
    const { data } = flowsFixture();
    const c = ctx();
    const bad: [string, unknown][] = [
      ["flows.unlinkRefund", { refundTransactionId: "dine_10a" }],
      ["flows.unmarkTransfer", { transactionId: "dine_10a" }],
      ["transactions.recategorise", { transactionId: "nope", category: "X" }],
      ["transactions.unsplit", { transactionId: "dine_10a" }],
      ["flows.linkRefund", { refundTransactionId: "dine_10a", purchaseTransactionId: "amazon_oct" }],
      ["budgets.editPart", { partId: "nope", expectedCents: 1 }],
    ];
    for (const [name, input] of bad) {
      const a = actionRegistry.get(name)!;
      expect(() => a.apply(data as never, a.input.parse(input), c), name).toThrow();
    }
  });
});
