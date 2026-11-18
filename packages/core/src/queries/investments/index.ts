/** Investment queries (§17): holdings, allocation, performance, activity, history. */
import { z } from "zod";
import { defineQuery, type AnyQuery } from "../../registry.ts";
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
    return { value: performance({ ...data, today }), figures: {} };
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
