/**
 * Daily snapshot upkeep (§5), run by the backend right after it saves the
 * day's snapshots (apps/api syncHooks.afterDailySnapshots):
 *
 * 1. Manual accounts: the balance and every snapshot come from their
 *    transactions (§3 "its balance updates from them"), so a back-dated edit
 *    corrects past days too.
 * 2. Newly connected checking/savings/cash/credit accounts get their past
 *    balances rebuilt from transactions (marked estimated), once their
 *    history import has finished. Real snapshots always win.
 * 3. Snapshots older than 90 days are reduced to one per account per week.
 *
 * Pure: returns what to write and delete; the caller applies it.
 */
import { Money, type Cents } from "../money.ts";
import { addMonths, type IsoDate } from "../dates.ts";
import type { Account, AccountId, BalanceSnapshot, Transaction } from "../types.ts";
import { accountKind, isRebuildableKind } from "./accountKinds.ts";
import { balanceMovingTransactions, rebuildHistory, MAX_REBUILD_MONTHS } from "./rebuild.ts";
import { chartDates, downsampleSnapshots, type SnapshotKey } from "./snapshots.ts";

export interface SnapshotMaintenanceInput {
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  snapshots: readonly BalanceSnapshot[];
  today: IsoDate;
  /**
   * Accounts whose full transaction history has been imported (their bank's
   * historical update is complete). Rebuilding before that would invent
   * wrong balances, so other accounts are retried on a later day.
   */
  historyCompleteAccountIds: ReadonlySet<AccountId>;
}

export interface SnapshotMaintenancePlan {
  /** Snapshots to insert or overwrite. */
  upserts: BalanceSnapshot[];
  /** Snapshots to delete (downsampling). */
  deletes: SnapshotKey[];
  /** Manual accounts whose stored balance differs from their transactions. */
  balances: Array<{ accountId: AccountId; currentBalanceCents: Cents }>;
  /** Accounts whose history was rebuilt in this run. */
  rebuilt: AccountId[];
}

const key = (s: SnapshotKey) => `${s.accountId}@${s.date}`;

function sameSnapshot(a: BalanceSnapshot, b: BalanceSnapshot): boolean {
  return a.balanceCents === b.balanceCents && a.source === b.source && a.isEstimated === b.isEstimated && a.isCarriedForward === b.isCarriedForward;
}

/** Balance of a manual account at the end of each date: the sum of its cleared transactions up to then. */
function manualSeries(account: Account, transactions: readonly Transaction[], today: IsoDate): BalanceSnapshot[] {
  const txs = balanceMovingTransactions(transactions, account.id).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const earliest = addMonths(today, -MAX_REBUILD_MONTHS);
  const first = txs[0]?.date ?? account.connectedOn;
  let start = first < account.connectedOn ? first : account.connectedOn;
  if (start < earliest) start = earliest;
  if (start > today) start = today;
  // Weekly in the region older than 90 days, daily after: exactly what downsampling keeps.
  const dates = chartDates(start, today, today);
  const out: BalanceSnapshot[] = [];
  let i = 0;
  let running = 0;
  for (const date of dates) {
    while (i < txs.length && txs[i]!.date <= date) running = Money.add(running, txs[i++]!.amountCents);
    out.push({ accountId: account.id, date, balanceCents: running, source: "manual", isEstimated: false, isCarriedForward: false });
  }
  return out;
}

export function planSnapshotMaintenance(input: SnapshotMaintenanceInput): SnapshotMaintenancePlan {
  const { accounts, transactions, today } = input;
  const existing = new Map(input.snapshots.map((s) => [key(s), s]));
  const merged = new Map(existing);
  const balances: SnapshotMaintenancePlan["balances"] = [];
  const rebuilt: AccountId[] = [];

  for (const account of accounts) {
    if (account.isManual) {
      const derived = Money.sum(balanceMovingTransactions(transactions, account.id).map((t) => t.amountCents));
      if (account.currentBalanceCents !== derived) balances.push({ accountId: account.id, currentBalanceCents: derived });
      const wanted = manualSeries(account, transactions, today);
      const wantedKeys = new Set(wanted.map(key));
      for (const s of wanted) merged.set(key(s), s);
      // Days of this account outside the series (e.g. before a moved starting date) no longer have a balance.
      for (const s of input.snapshots) if (s.accountId === account.id && !wantedKeys.has(key(s))) merged.delete(key(s));
      continue;
    }
    if (!isRebuildableKind(accountKind(account))) continue;
    if (!input.historyCompleteAccountIds.has(account.id)) continue;
    if (input.snapshots.some((s) => s.accountId === account.id && s.isEstimated)) continue;
    const r = rebuildHistory({ account, transactions, today });
    if (!r.rebuilt) continue;
    rebuilt.push(account.id);
    for (const s of r.snapshots) if (!merged.has(key(s))) merged.set(key(s), s);
  }

  const { kept } = downsampleSnapshots([...merged.values()], today);
  const keptKeys = new Set(kept.map(key));
  const upserts = kept.filter((s) => {
    const before = existing.get(key(s));
    return !before || !sameSnapshot(before, s);
  });
  const deletes = input.snapshots.filter((s) => !keptKeys.has(key(s))).map((s) => ({ accountId: s.accountId, date: s.date }));
  return { upserts, deletes, balances, rebuilt };
}
