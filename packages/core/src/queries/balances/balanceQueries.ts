/**
 * Balance and net worth queries (§5). Provenance for snapshot-based numbers
 * is the snapshot keys (account + date) in the value; figures are only used
 * for transaction-backed numbers.
 */
import { z } from "zod";
import { defineQuery } from "../../registry.ts";
import { addDays, addMonths } from "../../dates.ts";
import { idSchema, isoDateSchema } from "../../schemas.ts";
import type { Account, AccountId } from "../../types.ts";
import { accountKind, displayName, isRebuildableKind } from "../../balances/accountKinds.ts";
import { accountSeries, chartDates, netWorthOn, takeDailySnapshots } from "../../balances/snapshots.ts";
import { netWorthChart, historyStartFor } from "../../balances/chart.ts";
import { rebuildHistory } from "../../balances/rebuild.ts";

function visible(accounts: readonly Account[], includeHidden: boolean): Account[] {
  return accounts.filter((a) => includeHidden || !a.hidden);
}

export const netWorthQuery = defineQuery({
  name: "balances.netWorth",
  description: "Net worth on a day: the sum of that day's account snapshots, with each account's contribution (debts negative).",
  params: z.object({ date: isoDateSchema.optional(), includeHidden: z.boolean().default(false) }),
  needs: ["accounts", "balanceSnapshots", "holdings"],
  examples: [{ includeHidden: false }, { date: "2026-10-31", includeHidden: true }],
  run(data, params, today) {
    const date = params.date ?? today;
    const accounts = visible(data.accounts, params.includeHidden);
    const ids = new Set(accounts.map((a) => a.id));
    let day = netWorthOn(data.balanceSnapshots, date, ids);
    let live = false;
    // Before today's sync has run, today's figure comes from current balances (the snapshot the sync will save).
    if (date === today && day.parts.length < accounts.filter((a) => a.currentBalanceCents !== null).length) {
      day = netWorthOn(takeDailySnapshots(accounts, data.holdings, today), today, ids);
      live = true;
    }
    const names = new Map(accounts.map((a) => [a.id, displayName(a)]));
    return {
      value: {
        date,
        totalCents: day.totalCents,
        live,
        parts: day.parts.map((p) => ({ ...p, accountName: names.get(p.accountId) ?? p.accountId, kind: accountKind(accounts.find((a) => a.id === p.accountId)!) })),
      },
      figures: {},
    };
  },
});

export const netWorthChartQuery = defineQuery({
  name: "balances.netWorthChart",
  description: "Net worth over time stacked by account or grouped by type (cash, credit, investments, loans), with gaps, estimated history and where each account's history starts.",
  params: z.object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    grouping: z.enum(["account", "type"]).default("account"),
    fill: z.enum(["gap", "carry"]).default("gap"),
    includeHidden: z.boolean().default(false),
  }),
  needs: ["accounts", "balanceSnapshots"],
  examples: [
    { grouping: "account", fill: "gap", includeHidden: false },
    { from: "2026-09-01", to: "2026-10-31", grouping: "type", fill: "carry", includeHidden: true },
  ],
  run(data, params, today) {
    const to = params.to ?? today;
    const from = params.from ?? addMonths(to, -12);
    const notRebuiltReasons: Record<AccountId, string> = {};
    for (const a of data.accounts) {
      if (data.balanceSnapshots.some((s) => s.accountId === a.id && s.isEstimated)) continue;
      if (!isRebuildableKind(accountKind(a))) {
        const r = rebuildHistory({ account: a, transactions: [], today });
        if (!r.rebuilt) notRebuiltReasons[a.id] = r.reason;
      }
    }
    return {
      value: netWorthChart({
        accounts: data.accounts,
        snapshots: data.balanceSnapshots,
        from,
        to,
        today,
        grouping: params.grouping,
        fill: params.fill,
        includeHidden: params.includeHidden,
        notRebuiltReasons,
      }),
      figures: {},
    };
  },
});

export const accountHistoryQuery = defineQuery({
  name: "balances.accountHistory",
  description: "One account's balance over time (daily for 90 days, weekly before), marking gaps, carried-forward and estimated days.",
  params: z.object({ accountId: idSchema, from: isoDateSchema.optional(), to: isoDateSchema.optional(), fill: z.enum(["gap", "carry"]).default("gap") }),
  needs: ["accounts", "balanceSnapshots"],
  examples: [{ accountId: "acc_checking", fill: "gap" }, { accountId: "acc_brokerage", from: "2026-01-01", fill: "carry" }],
  run(data, params, today) {
    const account = data.accounts.find((a) => a.id === params.accountId);
    const to = params.to ?? today;
    const from = params.from ?? addDays(to, -365);
    const points = account ? accountSeries(data.balanceSnapshots, account.id, chartDates(from, to, today), today, params.fill) : [];
    return {
      value: {
        accountId: params.accountId,
        found: !!account,
        points,
        historyStart: account ? historyStartFor(account, data.balanceSnapshots) : null,
      },
      figures: {},
    };
  },
});

export const balanceQueries = [netWorthQuery, netWorthChartQuery, accountHistoryQuery];
