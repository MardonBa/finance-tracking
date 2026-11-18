/**
 * Rebuilding past balances (§5): start from today's balance and undo
 * cleared transactions backwards day by day. Rebuilt snapshots are marked
 * estimated. Accounts that can't be rebuilt start their history on the day
 * they were connected, with a reason.
 */
import { Money, type Cents } from "../money.ts";
import { addDays, addMonths, eachDay, type IsoDate } from "../dates.ts";
import type { Account, AccountId, BalanceSnapshot, Transaction, TransactionId } from "../types.ts";
import { accountKind, isRebuildableKind } from "./accountKinds.ts";

/** How far back rebuilding goes: the transaction history Plaid gives (§3). */
export const MAX_REBUILD_MONTHS = 24;

/** Transactions that move a balance: cleared and not removed. */
export function balanceMovingTransactions(transactions: readonly Transaction[], accountId: AccountId): Transaction[] {
  return transactions.filter((t) => t.accountId === accountId && !t.pending && !t.removed);
}

export type RebuildResult =
  | {
      rebuilt: true;
      accountId: AccountId;
      /** Daily estimated snapshots, oldest first, from the day before the first transaction to yesterday. */
      snapshots: BalanceSnapshot[];
      /** History starts on the first rebuilt day. */
      startsOn: IsoDate;
      /** Transactions undone on each day (provenance for each estimated point). */
      transactionIdsByDate: Record<IsoDate, TransactionId[]>;
    }
  | { rebuilt: false; accountId: AccountId; startsOn: IsoDate; reason: string };

export interface RebuildInput {
  account: Account;
  transactions: readonly Transaction[];
  today: IsoDate;
  /** Today's balance (end of today), as a net-worth contribution. Defaults to the account's current balance. */
  todayBalanceCents?: Cents | null;
  /**
   * False when transactions are known to be missing for this account (a
   * gap in the import), so a rebuild would be wrong.
   */
  historyComplete?: boolean;
  maxMonths?: number;
}

/**
 * Rebuild daily balances before today. balance(end of D−1) =
 * balance(end of D) − sum(cleared transactions dated D).
 */
export function rebuildHistory(input: RebuildInput): RebuildResult {
  const { account, today } = input;
  const kind = accountKind(account);
  const startsOn = account.connectedOn;
  if (!isRebuildableKind(kind)) {
    const reason =
      kind === "investment"
        ? "Investment values change with the market, so past values can't be rebuilt from transactions. History starts when the account was connected."
        : `Past balances of ${kind} accounts can't be rebuilt from transactions. History starts when the account was connected.`;
    return { rebuilt: false, accountId: account.id, startsOn, reason };
  }
  const todayBalance = input.todayBalanceCents === undefined ? account.currentBalanceCents : input.todayBalanceCents;
  if (todayBalance === null) {
    return { rebuilt: false, accountId: account.id, startsOn, reason: "No current balance is known, so there is nothing to rebuild from." };
  }
  if (input.historyComplete === false) {
    return {
      rebuilt: false,
      accountId: account.id,
      startsOn,
      reason: "Some transactions are missing for this account, so a rebuilt history would be wrong. History starts when the account was connected.",
    };
  }
  const earliestAllowed = addMonths(today, -(input.maxMonths ?? MAX_REBUILD_MONTHS));
  const txs = balanceMovingTransactions(input.transactions, account.id).filter((t) => t.date <= today && t.date >= earliestAllowed);
  if (txs.length === 0) {
    return { rebuilt: false, accountId: account.id, startsOn, reason: "No transaction history to rebuild from. History starts when the account was connected." };
  }
  const byDate = new Map<IsoDate, Transaction[]>();
  let first = today;
  for (const t of txs) {
    const list = byDate.get(t.date) ?? [];
    list.push(t);
    byDate.set(t.date, list);
    if (t.date < first) first = t.date;
  }
  const start = addDays(first, -1);
  const days = eachDay(start, addDays(today, -1)).reverse(); // yesterday … start
  const snapshots: BalanceSnapshot[] = [];
  const transactionIdsByDate: Record<IsoDate, TransactionId[]> = {};
  let balance = todayBalance;
  for (const day of days) {
    const undone = byDate.get(addDays(day, 1)) ?? [];
    balance = Money.sub(balance, Money.sum(undone.map((t) => t.amountCents)));
    if (undone.length) transactionIdsByDate[addDays(day, 1)] = undone.map((t) => t.id).sort();
    snapshots.push({ accountId: account.id, date: day, balanceCents: balance, source: "rebuilt", isEstimated: true, isCarriedForward: false });
  }
  snapshots.reverse();
  return { rebuilt: true, accountId: account.id, snapshots, startsOn: start, transactionIdsByDate };
}

/** Replay forward: the balance at the end of `to`, starting from the end of `from`. */
export function replayForward(
  startBalanceCents: Cents,
  from: IsoDate,
  to: IsoDate,
  transactions: readonly Transaction[],
  accountId: AccountId,
): Cents {
  const moves = balanceMovingTransactions(transactions, accountId).filter((t) => t.date > from && t.date <= to);
  return Money.add(startBalanceCents, Money.sum(moves.map((t) => t.amountCents)));
}

/**
 * Merge rebuilt (estimated) snapshots with real ones: a real snapshot for
 * the same day always wins.
 */
export function mergeRebuilt(existing: readonly BalanceSnapshot[], rebuilt: readonly BalanceSnapshot[]): BalanceSnapshot[] {
  const real = new Set(existing.map((s) => `${s.accountId}@${s.date}`));
  return [...existing, ...rebuilt.filter((s) => !real.has(`${s.accountId}@${s.date}`))];
}
