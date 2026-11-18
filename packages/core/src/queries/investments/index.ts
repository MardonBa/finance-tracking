/** Investment queries (§17): holdings, allocation, performance, activity, history. */
import { z } from "zod";
import { Money } from "../../money.ts";
import { defineQuery, type Figure, type AnyQuery } from "../../registry.ts";
import { idSchema, isoDateSchema } from "../../schemas.ts";
import { activityList, allocation, holdingsByAccount, holdingsHistory, performance } from "../../investments/investments.ts";

export const holdingsQuery = defineQuery({
  name: "investments.holdings",
  description: "Each investment account's current value and holdings: name, ticker, quantity, value and share of the account.",
  params: z.object({ asOf: isoDateSchema.optional() }),
  needs: ["accounts", "holdings", "securities"],
  examples: [{}, { asOf: "2026-10-15" }],
  run(data, params, today) {
    return { value: { accounts: holdingsByAccount(data.accounts, data.holdings, data.securities, params.asOf ?? today) }, figures: {} };
  },
});

export const allocationQuery = defineQuery({
  name: "investments.allocation",
  description: "All investments broken down by type (stocks, ETFs, funds, bonds, cash…) and by holding.",
  params: z.object({}),
  needs: ["accounts", "holdings", "securities"],
  examples: [{}],
  run(data, _params, today) {
    return { value: allocation(holdingsByAccount(data.accounts, data.holdings, data.securities, today)), figures: {} };
  },
});

export const performanceQuery = defineQuery({
  name: "investments.performance",
  description: "Per account and in total: what I put in (transfers in minus out, not cost basis) vs current value, with the gain or loss in dollars and percent.",
  params: z.object({}),
  needs: ["accounts", "holdings", "investmentTransactions", "transactions", "transferLinks"],
  examples: [{}],
  run(data, _params, today) {
    const value = performance({ ...data, today });
    // Transfers in − out drill down to their transactions when every one of them is a bank transaction
    // (brokerage-side activity lives in investment transactions, which aren't in the Transactions window).
    const figures: Record<string, Figure> = {};
    for (const p of value.accounts) {
      if (p.investmentTransactionIds.length > 0 || p.transferTransactionIds.length === 0) continue;
      const txs = data.transactions.filter((t) => p.transferTransactionIds.includes(t.id));
      const cents = Money.sum(txs.map((t) => t.amountCents));
      if (cents !== p.netTransfersCents) continue;
      figures[`${p.accountId}.transfers`] = {
        cents,
        contributions: txs.map((t) => ({ transactionId: t.id, cents: t.amountCents })),
        label: `Transfers into ${p.label} since ${p.historyStartsOn}`,
      };
    }
    return { value, figures };
  },
});

export const activityQuery = defineQuery({
  name: "investments.activity",
  description: "Investment activity (buys, sells, dividends, fees, transfers) with notes; dividends count as income, buys and sells as neither.",
  params: z.object({ accountId: idSchema.optional(), from: isoDateSchema.optional(), to: isoDateSchema.optional() }),
  needs: ["investmentTransactions", "securities"],
  examples: [{}, { accountId: "acc_brokerage", from: "2026-10-01", to: "2026-10-31" }],
  run(data, params) {
    const rows = activityList(data.investmentTransactions, data.securities, params);
    return {
      value: {
        rows,
        dividendIncomeCents: rows.filter((r) => r.countsAs === "income").reduce((s, r) => s + r.amountCents, 0),
        /** Fee activity (signed, negative = paid). */
        feesCents: rows.filter((r) => r.kind === "fee").reduce((s, r) => s + r.amountCents, 0),
        /** Fees charged on trades, as Plaid reports them on each trade. */
        tradeFeesCents: rows.filter((r) => r.kind !== "fee").reduce((s, r) => s + (r.feesCents ?? 0), 0),
      },
      figures: {},
    };
  },
});

export const historyQuery = defineQuery({
  name: "investments.history",
  description: "Holdings and value history of each investment account from the day it was connected, with a history-starts marker.",
  params: z.object({}),
  needs: ["accounts", "holdings"],
  examples: [{}],
  run(data) {
    return { value: { accounts: holdingsHistory(data.accounts, data.holdings) }, figures: {} };
  },
});

/** Queries of the "investments" module. Every name must start with "investments.". Add files in this folder and list them here. */
export const queries: AnyQuery[] = [holdingsQuery, allocationQuery, performanceQuery, activityQuery, historyQuery];
