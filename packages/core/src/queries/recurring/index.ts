/** Recurring queries (§9): the list, the upcoming view with warnings, and the month calendar. */
import { z } from "zod";
import { defineQuery, type AnyQuery, type Figure } from "../../registry.ts";
import { Money } from "../../money.ts";
import { monthOf } from "../../dates.ts";
import { isoMonthSchema } from "../../schemas.ts";
import type { CoreData } from "../../types.ts";
import { displayName } from "../../balances/accountKinds.ts";
import { mergeRecurring, type MergedRecurring } from "../../recurring/merge.ts";
import { cardPaymentsDue, monthCalendar, upcomingProjections } from "../../recurring/projection.ts";

const MERGE_NEEDS = ["recurringItems", "recurringOverrides", "recurringItemTransactions", "transactions"] as const;

function merged(data: Pick<CoreData, (typeof MERGE_NEEDS)[number]>, today: string) {
  return mergeRecurring({ ...data, today });
}

/** Past occurrences of each item, so "what is this based on" drills down to transactions. */
function occurrenceFigures(items: readonly MergedRecurring[], data: Pick<CoreData, "transactions">): Record<string, Figure> {
  const out: Record<string, Figure> = {};
  for (const i of items) {
    const txs = data.transactions.filter((t) => i.transactionIds.includes(t.id));
    if (txs.length === 0) continue;
    out[`occurrences.${i.id}`] = {
      cents: Money.sum(txs.map((t) => t.amountCents)),
      contributions: txs.map((t) => ({ transactionId: t.id, cents: t.amountCents })),
      label: `Past ${i.name} payments`,
    };
  }
  return out;
}

export const listRecurring = defineQuery({
  name: "recurring.list",
  description: "All recurring charges and income: name, amount (estimates marked), how often, next date, account; plus quiet notes on new charges and price changes.",
  params: z.object({}),
  needs: [...MERGE_NEEDS, "accounts"],
  examples: [{}],
  run(data, _params, today) {
    const r = merged(data, today);
    const name = (id: string) => {
      const a = data.accounts.find((x) => x.id === id);
      return a ? displayName(a) : id;
    };
    return {
      value: { ...r, items: r.items.map((i) => ({ ...i, accountName: name(i.accountId) })) },
      figures: occurrenceFigures(r.items, data),
    };
  },
});

export const upcomingRecurring = defineQuery({
  name: "recurring.upcoming",
  description: "For each account that pays bills: current balance, charges and card payments due before the next income, the lowest projected point, below-zero warnings and what it is based on.",
  params: z.object({}),
  needs: [...MERGE_NEEDS, "accounts", "liabilities", "transferLinks"],
  examples: [{}],
  run(data, _params, today) {
    const r = merged(data, today);
    const cardPayments = cardPaymentsDue({ accounts: data.accounts, liabilities: data.liabilities, transactions: data.transactions, transferLinks: data.transferLinks, today });
    const projections = upcomingProjections({ accounts: data.accounts.filter((a) => !a.hidden), items: r.items, cardPayments, today });
    return {
      value: { projections, warnings: projections.flatMap((p) => (p.warning ? [p.warning] : [])), cardPayments },
      figures: occurrenceFigures(r.items, data),
    };
  },
});

export const recurringCalendar = defineQuery({
  name: "recurring.calendar",
  description: "Month calendar of when each recurring charge and income hits, with the month's total of fixed costs (estimates marked).",
  params: z.object({ month: isoMonthSchema.optional() }),
  needs: [...MERGE_NEEDS, "accounts", "liabilities", "transferLinks"],
  examples: [{}, { month: "2026-12" }],
  run(data, params, today) {
    const r = merged(data, today);
    const cardPayments = cardPaymentsDue({ accounts: data.accounts, liabilities: data.liabilities, transactions: data.transactions, transferLinks: data.transferLinks, today });
    return { value: monthCalendar(params.month ?? monthOf(today), r.items, cardPayments), figures: {} };
  },
});

/** Queries of the "recurring" module. Every name must start with "recurring.". Add files in this folder and list them here. */
export const queries: AnyQuery[] = [listRecurring, upcomingRecurring, recurringCalendar];
