/**
 * Daily balance snapshots (§5): taking them, net worth for a day, weekly
 * downsampling of old history, and gaps / carried-forward days.
 *
 * Balances are net-worth contributions (debts negative), see types.ts.
 */
import { Money, type Cents } from "../money.ts";
import { addDays, compareIsoDate, diffDays, endOfWeek, startOfWeek, type IsoDate } from "../dates.ts";
import type { Account, AccountId, BalanceSnapshot, Holding } from "../types.ts";
import { accountKind } from "./accountKinds.ts";

/** Days of daily detail kept before snapshots are reduced to one per week. */
// TODO(revisit): success-criteria §5 asks whether 90 days of daily detail is right.
export const DAILY_DETAIL_DAYS = 90;

export interface SnapshotKey {
  accountId: AccountId;
  date: IsoDate;
}

export function snapshotKey(s: SnapshotKey): string {
  return `${s.accountId}@${s.date}`;
}

/**
 * Total value of an investment account on `date`: the sum of its holdings
 * on the latest holdings day on or before `date`. Null when no holdings
 * were synced by then.
 */
export function investmentValueOn(holdings: readonly Holding[], accountId: AccountId, date: IsoDate): Cents | null {
  let latest: IsoDate | null = null;
  for (const h of holdings) {
    if (h.accountId !== accountId || h.asOfDate > date) continue;
    if (latest === null || h.asOfDate > latest) latest = h.asOfDate;
  }
  if (latest === null) return null;
  return Money.sum(holdings.filter((h) => h.accountId === accountId && h.asOfDate === latest).map((h) => h.valueCents));
}

/**
 * The snapshots the daily sync saves for `date`: one per account with a
 * known balance. Credit cards and loans are already negative (ingest
 * convention); investment accounts use the total value of their holdings
 * when holdings exist for the day, else the reported balance (which Plaid
 * gives as total value). Accounts with no known balance get NO snapshot:
 * a missing day is a gap, never a fake zero.
 */
export function takeDailySnapshots(
  accounts: readonly Account[],
  holdings: readonly Holding[],
  date: IsoDate,
): BalanceSnapshot[] {
  const out: BalanceSnapshot[] = [];
  for (const a of accounts) {
    let balance = a.currentBalanceCents;
    if (accountKind(a) === "investment") {
      const fromHoldings = holdings.some((h) => h.accountId === a.id && h.asOfDate === date)
        ? investmentValueOn(holdings, a.id, date)
        : null;
      balance = fromHoldings ?? balance;
    }
    if (balance === null) continue;
    out.push({
      accountId: a.id,
      date,
      balanceCents: balance,
      source: a.isManual ? "manual" : "plaid",
      isEstimated: false,
      isCarriedForward: false,
    });
  }
  return out;
}

/**
 * For a day the sync missed: carry each account's last known balance
 * forward, marked as carried forward. Accounts with no earlier snapshot
 * stay a gap. Accounts that already have a snapshot on `date` are skipped.
 */
export function carryForwardSnapshots(snapshots: readonly BalanceSnapshot[], accountIds: readonly AccountId[], date: IsoDate): BalanceSnapshot[] {
  const out: BalanceSnapshot[] = [];
  for (const accountId of accountIds) {
    const own = snapshots.filter((s) => s.accountId === accountId);
    if (own.some((s) => s.date === date)) continue;
    const last = latestOnOrBefore(own, addDays(date, -1));
    if (!last) continue;
    out.push({
      accountId,
      date,
      balanceCents: last.balanceCents,
      source: "carried_forward",
      isEstimated: last.isEstimated,
      isCarriedForward: true,
    });
  }
  return out;
}

export function latestOnOrBefore<T extends { date: IsoDate }>(rows: readonly T[], date: IsoDate): T | undefined {
  let best: T | undefined;
  for (const r of rows) if (r.date <= date && (!best || r.date > best.date)) best = r;
  return best;
}

export interface NetWorthPart {
  accountId: AccountId;
  balanceCents: Cents;
  isEstimated: boolean;
  isCarriedForward: boolean;
  snapshot: SnapshotKey;
}

export interface NetWorthDay {
  date: IsoDate;
  totalCents: Cents;
  parts: NetWorthPart[];
}

/**
 * Net worth for a day = the sum of that day's snapshots, nothing else.
 * `accountIds` limits which accounts count (e.g. visible ones).
 */
export function netWorthOn(snapshots: readonly BalanceSnapshot[], date: IsoDate, accountIds?: ReadonlySet<AccountId>): NetWorthDay {
  const parts = snapshots
    .filter((s) => s.date === date && (!accountIds || accountIds.has(s.accountId)))
    .sort((a, b) => (a.accountId < b.accountId ? -1 : 1))
    .map((s) => ({
      accountId: s.accountId,
      balanceCents: s.balanceCents,
      isEstimated: s.isEstimated,
      isCarriedForward: s.isCarriedForward,
      snapshot: { accountId: s.accountId, date: s.date },
    }));
  return { date, totalCents: Money.sum(parts.map((p) => p.balanceCents)), parts };
}

/** True when `date` is old enough that only one snapshot per week is kept. */
export function isWeeklyRegion(date: IsoDate, today: IsoDate): boolean {
  return diffDays(date, today) > DAILY_DETAIL_DAYS;
}

/**
 * Reduce snapshots older than 90 days to one per account per week: the
 * latest one in that week (the end of the week when it exists). Recent
 * snapshots stay daily. Returns what to keep and the keys to delete.
 */
export function downsampleSnapshots(
  snapshots: readonly BalanceSnapshot[],
  today: IsoDate,
): { kept: BalanceSnapshot[]; removed: SnapshotKey[] } {
  const keepByWeek = new Map<string, BalanceSnapshot>();
  const kept: BalanceSnapshot[] = [];
  for (const s of snapshots) {
    if (!isWeeklyRegion(s.date, today)) {
      kept.push(s);
      continue;
    }
    const k = `${s.accountId}@${endOfWeek(s.date)}`;
    const cur = keepByWeek.get(k);
    if (!cur || s.date > cur.date) keepByWeek.set(k, s);
  }
  const weekly = new Set([...keepByWeek.values()]);
  const removed: SnapshotKey[] = [];
  for (const s of snapshots) {
    if (!isWeeklyRegion(s.date, today)) continue;
    if (weekly.has(s)) kept.push(s);
    else removed.push({ accountId: s.accountId, date: s.date });
  }
  kept.sort((a, b) => compareIsoDate(a.date, b.date) || (a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0));
  return { kept, removed };
}

/**
 * The dates a chart shows between `from` and `to`: one per week (its
 * Sunday, or `to`/the region boundary when earlier) in the weekly region,
 * then every day for the last 90 days.
 */
export function chartDates(from: IsoDate, to: IsoDate, today: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  let d = from;
  while (d <= to) {
    if (isWeeklyRegion(d, today)) {
      let end = endOfWeek(d);
      // Do not step past the last weekly-region day or past `to`.
      const lastWeekly = addDays(today, -(DAILY_DETAIL_DAYS + 1));
      if (end > lastWeekly) end = lastWeekly;
      if (end > to) end = to;
      out.push(end);
      d = addDays(end, 1);
    } else {
      out.push(d);
      d = addDays(d, 1);
    }
  }
  return out;
}

export type FillMode = "gap" | "carry";

export interface SeriesPoint {
  date: IsoDate;
  /** Null = no data that day (a gap, or before history starts). Never a fake zero. */
  balanceCents: Cents | null;
  isEstimated: boolean;
  isCarriedForward: boolean;
  /** True when history for this account has not started yet on this date. */
  beforeHistory: boolean;
  snapshot: SnapshotKey | null;
}

/**
 * One account's balance at each chart date. A chart date in the weekly
 * region uses the latest snapshot in that week. A missing day is a gap
 * (`balanceCents: null`), or in "carry" mode the last known balance
 * flagged `isCarriedForward`.
 */
export function accountSeries(
  snapshots: readonly BalanceSnapshot[],
  accountId: AccountId,
  dates: readonly IsoDate[],
  today: IsoDate,
  fill: FillMode,
): SeriesPoint[] {
  const own = snapshots.filter((s) => s.accountId === accountId).sort((a, b) => (a.date < b.date ? -1 : 1));
  const first = own[0]?.date ?? null;
  const byDate = new Map(own.map((s) => [s.date, s]));
  return dates.map((date) => {
    if (first === null || date < first) {
      return { date, balanceCents: null, isEstimated: false, isCarriedForward: false, beforeHistory: true, snapshot: null };
    }
    let snap = byDate.get(date);
    if (!snap && isWeeklyRegion(date, today)) {
      const inWeek = latestOnOrBefore(own, date);
      if (inWeek && inWeek.date >= startOfWeek(date)) snap = inWeek;
    }
    if (snap) {
      return {
        date,
        balanceCents: snap.balanceCents,
        isEstimated: snap.isEstimated,
        isCarriedForward: snap.isCarriedForward,
        beforeHistory: false,
        snapshot: { accountId, date: snap.date },
      };
    }
    if (fill === "carry") {
      const last = latestOnOrBefore(own, date);
      if (last) {
        return {
          date,
          balanceCents: last.balanceCents,
          isEstimated: last.isEstimated,
          isCarriedForward: true,
          beforeHistory: false,
          snapshot: { accountId, date: last.date },
        };
      }
    }
    return { date, balanceCents: null, isEstimated: false, isCarriedForward: false, beforeHistory: false, snapshot: null };
  });
}
