/**
 * The numbers add up (§6):
 *  - per account and period: start balance + money in − money out = end
 *    balance, checked against the snapshots; any difference is "unexplained".
 *    For investment accounts the difference is market gains/losses, not
 *    unexplained.
 *  - across everything: income − spending + Poker net ± transfers that leave
 *    or enter the linked accounts + investment gains/losses = change in net
 *    worth, with any leftover shown.
 *
 * Balances move when a transaction posts, so reconciliation uses the posted
 * date (not the purchase date the spending views use). Snapshots are end-of-day.
 */
import type { Cents } from "../money.ts";
import { Money } from "../money.ts";
import type { IsoDate } from "../dates.ts";
import { addDays } from "../dates.ts";
import type { AccountId, BalanceSnapshot, Bucket } from "../types.ts";
import type { Figure } from "../registry.ts";
import { accountKind } from "./accounts.ts";
import { figure, measures } from "./figures.ts";
import type { Ledger, LedgerEntry } from "./ledger.ts";

export interface AccountReconciliation {
  accountId: AccountId;
  isInvestment: boolean;
  status: "ok" | "unexplained" | "missing_snapshot";
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  startBalanceCents: Cents | null;
  endBalanceCents: Cents | null;
  inCents: Cents;
  outCents: Cents;
  expectedEndCents: Cents | null;
  /** End − expected end, for cash accounts. Never hidden. */
  unexplainedCents: Cents;
  /** End − expected end, for investment accounts (market moves). */
  marketChangeCents: Cents;
}

/** Latest snapshot on or before `date`. */
function snapshotAtOrBefore(snaps: readonly BalanceSnapshot[], date: IsoDate): BalanceSnapshot | null {
  let best: BalanceSnapshot | null = null;
  for (const s of snaps) if (s.date <= date && (best === null || s.date > best.date)) best = s;
  return best;
}

function entriesBetween(ledger: Ledger, accountId: AccountId, afterExclusive: IsoDate, toInclusive: IsoDate): LedgerEntry[] {
  return ledger.entries.filter(
    (e) => e.accountId === accountId && !e.pending && e.postedDate > afterExclusive && e.postedDate <= toInclusive,
  );
}

export function reconcileAccount(
  ledger: Ledger,
  snapshots: readonly BalanceSnapshot[],
  accountId: AccountId,
  from: IsoDate,
  to: IsoDate,
): { value: AccountReconciliation; figures: { in: Figure; out: Figure } } {
  const acc = ledger.accounts.get(accountId);
  const isInvestment = !!acc && accountKind(acc) === "investment";
  const own = snapshots.filter((s) => s.accountId === accountId);
  const start = snapshotAtOrBefore(own, addDays(from, -1));
  const end = snapshotAtOrBefore(own, to);
  const missing = !start || !end || end.date <= start.date;
  const entries = missing ? [] : entriesBetween(ledger, accountId, start.date, end.date);
  const inFig = figure(entries, measures.inflow, `Money in · ${from} – ${to}`);
  const outFig = figure(entries, measures.outflow, `Money out · ${from} – ${to}`);
  const value: AccountReconciliation = {
    accountId,
    isInvestment,
    status: "missing_snapshot",
    startDate: start?.date ?? null,
    endDate: end?.date ?? null,
    startBalanceCents: start?.balanceCents ?? null,
    endBalanceCents: end?.balanceCents ?? null,
    inCents: inFig.cents,
    outCents: outFig.cents,
    expectedEndCents: null,
    unexplainedCents: 0,
    marketChangeCents: 0,
  };
  if (!missing) {
    const expected = Money.sub(Money.add(start.balanceCents, inFig.cents), outFig.cents);
    const diff = Money.sub(end.balanceCents, expected);
    value.expectedEndCents = expected;
    if (isInvestment) {
      value.marketChangeCents = diff;
      value.status = "ok";
    } else {
      value.unexplainedCents = diff;
      value.status = diff === 0 ? "ok" : "unexplained";
    }
  }
  return { value, figures: { in: inFig, out: outFig } };
}

export interface NetWorthEquation {
  from: IsoDate;
  to: IsoDate;
  /** Accounts in the equation (both snapshots exist). */
  accountIds: AccountId[];
  missingSnapshotAccountIds: AccountId[];
  startNetWorthCents: Cents;
  endNetWorthCents: Cents;
  changeCents: Cents;
  incomeCents: Cents;
  spendingCents: Cents;
  pokerNetCents: Cents;
  /** Net of transfer-bucket money: matched pairs inside the set cancel, so this is money to/from accounts that aren't linked. */
  transfersNetCents: Cents;
  investmentChangeCents: Cents;
  /** change − (income − spending + poker + transfers + investment change). Shown, never hidden. */
  leftoverCents: Cents;
}

export function netWorthEquation(
  ledger: Ledger,
  snapshots: readonly BalanceSnapshot[],
  from: IsoDate,
  to: IsoDate,
): { value: NetWorthEquation; figures: Record<string, Figure> } {
  const ids = [...ledger.accounts.keys()].sort();
  const recs = ids.map((id) => ({ id, ...reconcileAccount(ledger, snapshots, id, from, to) }));
  const ok = recs.filter((r) => r.value.status !== "missing_snapshot");
  const included: LedgerEntry[] = [];
  for (const r of ok) included.push(...entriesBetween(ledger, r.id, r.value.startDate!, r.value.endDate!));
  const by = (b: Bucket) => included.filter((e) => e.bucket === b);
  const income = figure(by("income"), measures.income, `Income · ${from} – ${to}`);
  const spending = figure(by("spending"), measures.spend, `Spending · ${from} – ${to}`);
  const poker = figure(by("poker"), measures.amount, `Poker net · ${from} – ${to}`);
  const transfers = figure(by("transfer"), measures.amount, `Transfers net · ${from} – ${to}`);
  const start = Money.sum(ok.map((r) => r.value.startBalanceCents!));
  const end = Money.sum(ok.map((r) => r.value.endBalanceCents!));
  const investment = Money.sum(ok.map((r) => r.value.marketChangeCents));
  const change = Money.sub(end, start);
  const explained = Money.sum([income.cents, Money.negate(spending.cents), poker.cents, transfers.cents, investment]);
  return {
    value: {
      from,
      to,
      accountIds: ok.map((r) => r.id),
      missingSnapshotAccountIds: recs.filter((r) => r.value.status === "missing_snapshot").map((r) => r.id),
      startNetWorthCents: start,
      endNetWorthCents: end,
      changeCents: change,
      incomeCents: income.cents,
      spendingCents: spending.cents,
      pokerNetCents: poker.cents,
      transfersNetCents: transfers.cents,
      investmentChangeCents: investment,
      leftoverCents: Money.sub(change, explained),
    },
    figures: { income, spending, poker, transfers },
  };
}
