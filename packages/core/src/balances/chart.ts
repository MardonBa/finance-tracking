/**
 * Net worth chart data (§5 "Seeing it"): series stacked by account (assets
 * above zero, debts below), a per-point breakdown for the hover, grouping by
 * type, and where each account's history starts.
 */
import { Money, type Cents } from "../money.ts";
import type { IsoDate } from "../dates.ts";
import type { Account, AccountId, BalanceSnapshot } from "../types.ts";
import { accountKind, BALANCE_GROUP_LABELS, displayName, groupOfKind, isDebtKind, type BalanceGroup } from "./accountKinds.ts";
import { accountSeries, chartDates, type FillMode, type SnapshotKey } from "./snapshots.ts";

export type ChartGrouping = "account" | "type";

export interface ChartSeries {
  /** Account id, or the group name when grouped by type. */
  key: string;
  label: string;
  /** Debts are drawn below zero, assets above. */
  side: "asset" | "debt";
  accountIds: AccountId[];
  points: Array<{ date: IsoDate; cents: Cents | null; isEstimated: boolean; isCarriedForward: boolean }>;
}

export interface HoverEntry {
  key: string;
  label: string;
  cents: Cents | null;
  isEstimated: boolean;
  isCarriedForward: boolean;
  /** Snapshots behind this number (drill-down provenance). */
  snapshots: SnapshotKey[];
}

export interface ChartPoint {
  date: IsoDate;
  /** Sum of the known balances on this date. */
  totalCents: Cents;
  /** True when an account whose history had started has no balance this day (a gap). */
  incomplete: boolean;
  missingAccountIds: AccountId[];
  isEstimated: boolean;
  breakdown: HoverEntry[];
}

export interface HistoryStart {
  accountId: AccountId;
  label: string;
  startsOn: IsoDate | null;
  estimatedUntil: IsoDate | null;
  reason: string;
}

export interface NetWorthChart {
  grouping: ChartGrouping;
  series: ChartSeries[];
  points: ChartPoint[];
  historyStarts: HistoryStart[];
}

export interface NetWorthChartInput {
  accounts: readonly Account[];
  snapshots: readonly BalanceSnapshot[];
  from: IsoDate;
  to: IsoDate;
  today: IsoDate;
  grouping: ChartGrouping;
  fill: FillMode;
  /** Hidden accounts are left out unless this is true. */
  // TODO(revisit): hidden accounts are left out of the net worth chart by default.
  includeHidden?: boolean;
  /** Reasons from rebuildHistory for accounts that couldn't be rebuilt. */
  notRebuiltReasons?: Record<AccountId, string>;
}

export function historyStartFor(account: Account, snapshots: readonly BalanceSnapshot[], notRebuiltReason?: string): HistoryStart {
  const own = snapshots.filter((s) => s.accountId === account.id).sort((a, b) => (a.date < b.date ? -1 : 1));
  const first = own[0];
  const lastEstimated = [...own].reverse().find((s) => s.isEstimated);
  const kind = accountKind(account);
  let reason: string;
  if (!first) reason = "No balance history yet.";
  else if (first.isEstimated) reason = "Rebuilt from transactions before the account was connected (estimated).";
  else if (notRebuiltReason) reason = notRebuiltReason;
  else if (kind === "investment") reason = "Investment values can't be rebuilt, so history starts when the account was connected.";
  else reason = "History starts when the account was connected.";
  return {
    accountId: account.id,
    label: displayName(account),
    startsOn: first?.date ?? null,
    estimatedUntil: lastEstimated?.date ?? null,
    reason,
  };
}

export function netWorthChart(input: NetWorthChartInput): NetWorthChart {
  const accounts = input.accounts.filter((a) => input.includeHidden || !a.hidden);
  const dates = chartDates(input.from, input.to, input.today);
  const perAccount = accounts.map((a) => ({
    account: a,
    kind: accountKind(a),
    series: accountSeries(input.snapshots, a.id, dates, input.today, input.fill),
  }));

  type Bucket = { key: string; label: string; side: "asset" | "debt"; members: typeof perAccount };
  let buckets: Bucket[];
  if (input.grouping === "account") {
    buckets = perAccount.map((p) => ({
      key: p.account.id,
      label: displayName(p.account),
      side: isDebtKind(p.kind) ? "debt" : "asset",
      members: [p],
    }));
  } else {
    const byGroup = new Map<BalanceGroup, typeof perAccount>();
    for (const p of perAccount) {
      const g = groupOfKind(p.kind);
      byGroup.set(g, [...(byGroup.get(g) ?? []), p]);
    }
    buckets = [...byGroup.entries()].map(([g, members]) => ({
      key: g,
      label: BALANCE_GROUP_LABELS[g],
      side: g === "credit" || g === "loans" ? "debt" : "asset",
      members,
    }));
  }

  const series: ChartSeries[] = buckets.map((b) => ({
    key: b.key,
    label: b.label,
    side: b.side,
    accountIds: b.members.map((m) => m.account.id),
    points: dates.map((date, i) => {
      const pts = b.members.map((m) => m.series[i]!).filter((p) => p.balanceCents !== null);
      return {
        date,
        cents: pts.length ? Money.sum(pts.map((p) => p.balanceCents!)) : null,
        isEstimated: pts.some((p) => p.isEstimated),
        isCarriedForward: pts.some((p) => p.isCarriedForward),
      };
    }),
  }));

  const points: ChartPoint[] = dates.map((date, i) => {
    const missing = perAccount.filter((p) => p.series[i]!.balanceCents === null && !p.series[i]!.beforeHistory).map((p) => p.account.id);
    const breakdown: HoverEntry[] = buckets.map((b) => {
      const pts = b.members.map((m) => m.series[i]!).filter((p) => p.balanceCents !== null);
      return {
        key: b.key,
        label: b.label,
        cents: pts.length ? Money.sum(pts.map((p) => p.balanceCents!)) : null,
        isEstimated: pts.some((p) => p.isEstimated),
        isCarriedForward: pts.some((p) => p.isCarriedForward),
        snapshots: b.members.map((m) => m.series[i]!.snapshot).filter((s): s is SnapshotKey => s !== null),
      };
    });
    return {
      date,
      totalCents: Money.sum(breakdown.map((e) => e.cents ?? 0)),
      incomplete: missing.length > 0,
      missingAccountIds: missing,
      isEstimated: breakdown.some((e) => e.isEstimated),
      breakdown,
    };
  });

  return {
    grouping: input.grouping,
    series,
    points,
    historyStarts: accounts.map((a) => historyStartFor(a, input.snapshots, input.notRebuiltReasons?.[a.id])),
  };
}
