import { z } from "zod";
import { defineQuery, type Contribution } from "../../registry.ts";
import { Money } from "../../money.ts";
import { isWithin } from "../../dates.ts";
import { dateRangeSchema } from "../../schemas.ts";

/**
 * Example query (template for real ones): the net of cleared, not-removed
 * transactions in a date range. Pending and removed rows never count.
 */
export const sumTransactions = defineQuery({
  name: "example.sumTransactions",
  description: "Net amount of cleared transactions between two dates (example query).",
  params: dateRangeSchema.and(z.object({ accountId: z.string().optional() })),
  needs: ["transactions"],
  examples: [{ from: "2026-10-01", to: "2026-10-31" }, { from: "2026-09-01", to: "2026-10-31", accountId: "acc_card" }],
  run(data, params) {
    const contributions: Contribution[] = data.transactions
      .filter(
        (t) =>
          !t.pending &&
          !t.removed &&
          isWithin(t.date, params.from, params.to) &&
          (params.accountId === undefined || t.accountId === params.accountId),
      )
      .map((t) => ({ transactionId: t.id, cents: t.amountCents }));
    const total = Money.sum(contributions.map((c) => c.cents));
    return {
      value: { totalCents: total, count: contributions.length },
      figures: { total: { cents: total, contributions, label: `${params.from} – ${params.to}` } },
    };
  },
});
