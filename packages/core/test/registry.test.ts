import { describe, expect, it } from "vitest";
import { basicFixture } from "../fixtures/index.ts";
import {
  ActionError,
  PRIMARY_KEYS,
  applyMutations,
  buildRegistry,
  findRow,
  inverseMutations,
  type ActionContext,
} from "../src/registry.ts";
import { queryRegistry } from "../src/queries/index.ts";
import { actionRegistry } from "../src/actions/index.ts";
import { DATA_KEYS, emptyData, type CoreData } from "../src/types.ts";
import { Money } from "../src/money.ts";

function ctx(): ActionContext {
  let n = 0;
  return { today: "2026-10-31", now: "2026-10-31T12:00:00.000Z", newId: () => `id_${++n}` };
}

function pick(data: CoreData, keys: readonly string[]): Partial<CoreData> {
  return Object.fromEntries(keys.map((k) => [k, data[k as keyof CoreData]]));
}

describe("CoreData slices", () => {
  it("DATA_KEYS and PRIMARY_KEYS list every slice exactly once", () => {
    const fromEmpty = Object.keys(emptyData()).sort();
    expect([...DATA_KEYS].sort()).toEqual(fromEmpty);
    expect(Object.keys(PRIMARY_KEYS).sort()).toEqual(fromEmpty);
    expect(new Set(DATA_KEYS).size).toBe(DATA_KEYS.length);
  });

  it("the basic fixture has every slice", () => {
    expect(Object.keys(basicFixture().data).sort()).toEqual([...DATA_KEYS].sort());
  });
});

describe("buildRegistry", () => {
  it("rejects names outside their module and duplicates", () => {
    expect(() => buildRegistry({ a: [{ name: "b.x" }] })).toThrow(/not named "a\.<name>"/);
    expect(() => buildRegistry({ a: [{ name: "a.x" }, { name: "a.x" }] })).toThrow(/duplicate/);
    expect(buildRegistry({ a: [{ name: "a.x" }], b: [{ name: "b.y" }] }).names()).toEqual(["a.x", "b.y"]);
  });
});

describe("every registered query", () => {
  const { data, today } = basicFixture();

  it("has a description, needs and examples", () => {
    expect(queryRegistry.all.length).toBeGreaterThan(0);
    for (const q of queryRegistry.all) {
      expect(q.description.length, q.name).toBeGreaterThan(10);
      expect(q.examples.length, q.name).toBeGreaterThan(0);
      for (const k of q.needs) expect(DATA_KEYS, q.name).toContain(k);
    }
  });

  for (const q of queryRegistry.all) {
    it(`${q.name}: examples validate, run deterministically, and every figure equals the sum of its contributions`, () => {
      for (const example of q.examples) {
        const params = q.params.parse(example);
        const slices = pick(data, q.needs);
        const frozen = structuredClone(slices);
        const first = q.run(slices as never, params, today);
        const second = q.run(structuredClone(frozen) as never, params, today);
        expect(second).toEqual(first);
        expect(slices).toEqual(frozen); // queries never mutate their input
        for (const [path, fig] of Object.entries(first.figures)) {
          expect(Money.sum(fig.contributions.map((c) => c.cents)), `${q.name} ${path}`).toBe(fig.cents);
          const known = new Set(data.transactions.map((t) => t.id));
          for (const c of fig.contributions) expect(known.has(c.transactionId), `${q.name} ${path}`).toBe(true);
        }
      }
    });
  }
});

describe("every registered action", () => {
  it("has a description and a valid aiExcluded reason when excluded", () => {
    for (const a of actionRegistry.all) {
      expect(a.description.length, a.name).toBeGreaterThan(10);
      if (a.aiExcluded !== undefined) expect(a.aiExcluded.length, a.name).toBeGreaterThan(5);
    }
  });

  for (const a of actionRegistry.all) {
    it(`${a.name}: apply then inverse restores the data exactly`, () => {
      const { data } = basicFixture();
      for (const example of a.examples ?? []) {
        const input = a.input.parse(example);
        const before = pick(data, a.needs);
        const preview = a.describe(before as never, input, ctx());
        expect(preview.summary.length).toBeGreaterThan(0);
        const applied = a.apply(before as never, input, ctx());
        const inverse = a.inverse ? a.inverse(before as never, input, applied) : inverseMutations(before, applied);
        const after = applyMutations(before, applied);
        const restored = applyMutations(after, inverse);
        for (const k of a.needs) {
          const sortRows = (rows: unknown[]) => [...rows].map((r) => JSON.stringify(r)).sort();
          expect(sortRows(restored[k as keyof CoreData] as unknown[]), `${a.name} ${k}`).toEqual(
            sortRows(before[k as keyof CoreData] as unknown[]),
          );
        }
      }
    });
  }
});

describe("example query", () => {
  it("sums cleared October transactions and ignores pending and removed ones", () => {
    const { data, today } = basicFixture();
    const q = queryRegistry.get("example.sumTransactions")!;
    const result = q.run(data, { from: "2026-10-01", to: "2026-10-31", accountId: "acc_card" }, today);
    // dining -8950, amazon -12999, refund +2999, card payment in +20000, posted grocery -4567
    expect(result.value).toEqual({ totalCents: -3517, count: 5 });
    const ids = result.figures.total!.contributions.map((c) => c.transactionId);
    expect(ids).not.toContain("tx_pending_gas");
    expect(ids).not.toContain("tx_pending_grocery");
  });

  it("rejects bad params", () => {
    const q = queryRegistry.get("example.sumTransactions")!;
    expect(q.params.safeParse({ from: "2026-10-31", to: "2026-10-01" }).success).toBe(false);
    expect(q.params.safeParse({ from: "2026-02-30", to: "2026-03-01" }).success).toBe(false);
  });
});

describe("example action", () => {
  const action = actionRegistry.get("example.setTransactionNote")!;

  it("describes before → after and upserts the override", () => {
    const { data } = basicFixture();
    const preview = action.describe(data, { transactionId: "tx_poker_in", note: "Friday game" }, ctx());
    expect(preview.changes).toEqual([{ label: "Note", before: "Thursday game buy-ins", after: "Friday game" }]);
    const muts = action.apply(data, { transactionId: "tx_poker_in", note: "Friday game" }, ctx());
    const after = applyMutations(data, muts);
    const row = findRow(after, "overrides", { transactionId: "tx_poker_in" });
    expect(row?.note).toBe("Friday game");
    expect(row?.bucket).toBe("poker"); // other override fields are kept
  });

  it("creates an override when none exists, and the inverse deletes it", () => {
    const { data } = basicFixture();
    const muts = action.apply(data, { transactionId: "tx_paycheck", note: "October pay" }, ctx());
    const inverse = inverseMutations(data, muts);
    expect(inverse).toEqual([{ op: "delete", table: "overrides", key: { transactionId: "tx_paycheck" } }]);
  });

  it("refuses unknown transactions", () => {
    const { data } = basicFixture();
    expect(() => action.apply(data, { transactionId: "nope", note: "x" }, ctx())).toThrow(ActionError);
  });
});
