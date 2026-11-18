/**
 * §16 "each figure in an answer links to the chart or transactions behind
 * it": amounts the model wrote without a tag (e.g. month-by-month trend
 * amounts) are linked when exactly one figure seen this turn has that amount.
 */
import { describe, expect, it } from "vitest";
import { linkUntaggedAmounts } from "../../src/ai/citations.ts";
import type { Citation } from "../../src/ai/harness.ts";

const fig = (figureId: string, cents: number, params: unknown = { months: 6 }): Citation => ({ kind: "figure", query: "transactions.merchant", params, figureId, cents, label: null });
const tags = new Map<string, Citation>([
  ["C1", { kind: "chart", query: "transactions.merchant", params: { months: 6 } }],
  ["F2", fig("month.2026-08", -4250)],
  ["F3", fig("month.2026-09", -6100)],
  ["F4", fig("month.2026-10", -9733)],
  ["F5", fig("total", -20083)],
  // The same figure seen twice (two tool calls) is still one figure.
  ["F6", fig("month.2026-10", -9733)],
  // Two different figures with the same amount: ambiguous.
  ["F7", fig("category.A", 1500, {})],
  ["F8", fig("category.B", -1500, {})],
]);

describe("linking untagged amounts in answers", () => {
  it("links each trend amount to the one figure with that amount", () => {
    expect(linkUntaggedAmounts("Coffee went $42.50 → $61.00 → $97.33 over three months, $200.83 [F5] in all.", tags)).toBe(
      "Coffee went $42.50 [F2] → $61.00 [F3] → $97.33 [F4] over three months, $200.83 [F5] in all.",
    );
  });

  it("leaves tagged, ambiguous, unknown and rounded amounts alone", () => {
    expect(linkUntaggedAmounts("Dining $42.50 [F2], also $42.50[F2, F3].", tags)).toBe("Dining $42.50 [F2], also $42.50[F2, F3].");
    expect(linkUntaggedAmounts("Two things cost $15.00 each.", tags)).toBe("Two things cost $15.00 each.");
    expect(linkUntaggedAmounts("About $43 a month, and $1,234.56 elsewhere.", tags)).toBe("About $43 a month, and $1,234.56 elsewhere.");
  });

  it("handles thousands separators, signs and sentence punctuation", () => {
    const t = new Map<string, Citation>([["F9", fig("total", -123456)]]);
    expect(linkUntaggedAmounts("You spent $1,234.56, then -$1,234.56.", t)).toBe("You spent $1,234.56 [F9], then -$1,234.56 [F9].");
  });
});
