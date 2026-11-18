/** §17 activity notes: investments.setNote (added by the recurring-trajectory-invest track). */
import { describe, expect, it } from "vitest";
import { basicFixture } from "../../fixtures/index.ts";
import { ActionError, applyMutations, inverseMutations, type ActionContext } from "../../src/registry.ts";
import { actionRegistry } from "../../src/actions/index.ts";
import { queryRegistry } from "../../src/queries/index.ts";

const ctx: ActionContext = { today: "2026-10-31", now: "2026-10-31T12:00:00.000Z", newId: () => "x" };
const action = actionRegistry.get("investments.setNote")!;

describe("investments.setNote", () => {
  it("sets a note that the activity query then shows, and the inverse restores it", () => {
    const { data, today } = basicFixture();
    const input = action.input.parse({ investmentTransactionId: "itx_dividend", note: "Quarterly dividend" });
    expect(action.describe(data as never, input, ctx)).toEqual({
      summary: "Set the note on VTI DIVIDEND (2026-10-15, $31.50)",
      changes: [{ label: "Note", before: null, after: "Quarterly dividend" }],
    });
    const muts = action.apply(data as never, input, ctx);
    const after = applyMutations(data, muts);
    const rows = queryRegistry.get("investments.activity")!.run(after as never, {}, today).value as { rows: Array<{ id: string; note: string | null }> };
    expect(rows.rows.find((r) => r.id === "itx_dividend")!.note).toBe("Quarterly dividend");
    const restored = applyMutations(after, inverseMutations(data, muts));
    expect(restored.investmentTransactions).toEqual(data.investmentTransactions);
  });

  it("treats a blank note as removing it", () => {
    const { data } = basicFixture();
    data.investmentTransactions[0]!.note = "old";
    const input = action.input.parse({ investmentTransactionId: "itx_dividend", note: "   " });
    const [m] = action.apply(data as never, input, ctx);
    expect(m).toMatchObject({ op: "upsert", table: "investmentTransactions", row: { id: "itx_dividend", note: null } });
    expect(action.describe(data as never, input, ctx).summary).toMatch(/^Remove the note/);
  });

  it("refuses an unknown id", () => {
    const { data } = basicFixture();
    expect(() => action.apply(data as never, action.input.parse({ investmentTransactionId: "nope", note: "x" }), ctx)).toThrow(ActionError);
  });
});
