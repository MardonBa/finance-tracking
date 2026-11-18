/** Manual account transactions with a category and a note (§3 "amount, date, description, category, note"). */
import { describe, expect, it } from "vitest";
import { actionRegistry } from "../../src/actions/index.ts";
import { applyMutations, inverseMutations, type AnyAction } from "../../src/registry.ts";
import type { CoreData } from "../../src/types.ts";
import { basicFixture } from "../../fixtures/index.ts";

const ctx = { today: "2026-10-31", now: "2026-10-31T12:00:00.000Z", newId: () => "tx_new" };

function apply(name: string, data: CoreData, input: unknown) {
  const a = actionRegistry.get(name) as AnyAction;
  const slices = Object.fromEntries(a.needs.map((k: keyof CoreData) => [k, data[k]])) as never;
  const muts = a.apply(slices, a.input.parse(input), ctx);
  return { muts, after: applyMutations(data, muts), slices };
}

describe("accounts.addManualTransaction with a category and note", () => {
  it("saves them as the new transaction's override, updates the balance, and undoes cleanly", () => {
    const { data } = basicFixture();
    const { muts, after, slices } = apply("accounts.addManualTransaction", data, {
      accountId: "acc_cash",
      amountCents: -1200,
      date: "2026-10-20",
      description: "Farmers market",
      category: "FOOD_AND_DRINK",
      note: "Peaches",
    });
    expect(after.overrides.find((o) => o.transactionId === "tx_new")).toMatchObject({ category: "FOOD_AND_DRINK", note: "Peaches", bucket: null });
    const before = data.transactions.filter((t) => t.accountId === "acc_cash" && !t.pending && !t.removed).reduce((s, t) => s + t.amountCents, 0);
    expect(after.accounts.find((x) => x.id === "acc_cash")!.currentBalanceCents).toBe(before - 1200);
    const restored = applyMutations(after, inverseMutations(slices, muts));
    expect(restored.overrides).toEqual(data.overrides);
    expect(restored.transactions.length).toBe(data.transactions.length);
  });

  it("writes no override without a category or note", () => {
    const { data } = basicFixture();
    const { muts } = apply("accounts.addManualTransaction", data, { accountId: "acc_cash", amountCents: 500, date: "2026-10-20", description: "Found", note: "  " });
    expect(muts.some((m) => m.table === "overrides")).toBe(false);
  });
});
