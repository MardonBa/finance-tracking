/**
 * "Will I be covered?" (§9): for each account that pays bills, the current
 * balance, every charge due before the next expected income (including
 * credit card statement payments), the lowest projected point, and a
 * below-zero warning. Each projection lists what it's based on.
 */
import { Money, type Cents } from "../money.ts";
import { addDays, monthEnd, monthStart, type IsoDate, type IsoMonth } from "../dates.ts";
import type { Account, AccountId, Id, Liability, Transaction, TransactionId, TransferLink } from "../types.ts";
import { accountKind, displayName, isCashKind } from "../balances/accountKinds.ts";
import type { MergedRecurring } from "./merge.ts";
import { occurrencesBetween } from "./schedule.ts";

/** How far ahead to project when no income is expected. */
// TODO(revisit): success-criteria §9 leaves this open; 30 days is the suggested default.
export const NO_INCOME_HORIZON_DAYS = 30;
/** How far ahead to look for the next income at all. */
export const INCOME_LOOKAHEAD_DAYS = 62;

export interface CardPayment {
  cardAccountId: AccountId;
  cardName: string;
  payingAccountId: AccountId;
  dueDate: IsoDate;
  statementBalanceCents: Cents;
  /** Payments already made toward this statement. */
  paidCents: Cents;
  /** What is still due (statement − paid). */
  amountCents: Cents;
  minimumPaymentCents: Cents | null;
  paymentTransactionIds: TransactionId[];
}

/**
 * Card statement payments still due: statement balance minus payments
 * received on the card since the statement was issued. A payment is a
 * cleared positive transaction on the card that is either the in-half of a
 * transfer link or categorised as a loan/card payment by Plaid.
 */
export function cardPaymentsDue(input: {
  accounts: readonly Account[];
  liabilities: readonly Liability[];
  transactions: readonly Transaction[];
  transferLinks: readonly TransferLink[];
  today: IsoDate;
}): CardPayment[] {
  const linkedIn = new Set(input.transferLinks.filter((l) => l.undoneAt === null).map((l) => l.inTransactionId));
  const out: CardPayment[] = [];
  for (const l of input.liabilities) {
    if (!l.payingAccountId || !l.nextPaymentDueDate || l.lastStatementBalanceCents === null) continue;
    if (l.nextPaymentDueDate < input.today) continue;
    const statement = Math.abs(l.lastStatementBalanceCents);
    if (statement === 0) continue;
    const card = input.accounts.find((a) => a.id === l.accountId);
    const payments = input.transactions.filter(
      (t) =>
        t.accountId === l.accountId &&
        !t.pending &&
        !t.removed &&
        t.amountCents > 0 &&
        (l.lastStatementIssueDate === null || t.date > l.lastStatementIssueDate) &&
        (linkedIn.has(t.id) || t.plaidCategoryPrimary === "LOAN_PAYMENTS"),
    );
    const paid = Money.sum(payments.map((t) => t.amountCents));
    const due = statement - paid;
    if (due <= 0) continue;
    out.push({
      cardAccountId: l.accountId,
      cardName: card ? displayName(card) : l.accountId,
      payingAccountId: l.payingAccountId,
      dueDate: l.nextPaymentDueDate,
      statementBalanceCents: statement,
      paidCents: paid,
      amountCents: due,
      minimumPaymentCents: l.minimumPaymentCents,
      paymentTransactionIds: payments.map((t) => t.id),
    });
  }
  return out;
}

export interface ProjectionEvent {
  date: IsoDate;
  kind: "charge" | "income" | "card_payment";
  name: string;
  /** Signed: charges negative, income positive. */
  amountCents: Cents;
  isEstimate: boolean;
  recurringItemId: Id | null;
  cardAccountId: AccountId | null;
  /** Running balance after this event. */
  balanceAfterCents: Cents;
  /** Past occurrences behind this projected amount. */
  basedOnTransactionIds: TransactionId[];
}

export interface BelowZeroWarning {
  accountId: AccountId;
  accountName: string;
  /** How much short at the lowest point. */
  shortfallCents: Cents;
  /** First day the balance goes below zero. */
  date: IsoDate;
  lowestDate: IsoDate;
  message: string;
}

export interface AccountProjection {
  accountId: AccountId;
  accountName: string;
  currentBalanceCents: Cents;
  windowEnd: IsoDate;
  windowReason: string;
  nextIncome: { date: IsoDate; name: string; amountCents: Cents; recurringItemId: Id } | null;
  events: ProjectionEvent[];
  lowestPoint: { cents: Cents; date: IsoDate };
  warning: BelowZeroWarning | null;
  /** Plain list of what the projection is based on, for checking it. */
  basis: string[];
}

/**
 * Projection for every cash account that has recurring charges, income or
 * a card paid from it. Events on `today` count (assumed not yet posted).
 * TODO(revisit): charges dated today are assumed not yet posted; only cash accounts (checking, savings, cash) get a projection.
 * On the income day, charges due that day come after the window.
 */
export function upcomingProjections(input: {
  accounts: readonly Account[];
  items: readonly MergedRecurring[];
  cardPayments: readonly CardPayment[];
  today: IsoDate;
}): AccountProjection[] {
  const { today } = input;
  const out: AccountProjection[] = [];
  for (const account of input.accounts) {
    if (!isCashKind(accountKind(account)) || account.currentBalanceCents === null) continue;
    const own = input.items.filter((i) => i.accountId === account.id && i.nextDate !== null);
    const cards = input.cardPayments.filter((c) => c.payingAccountId === account.id);
    if (own.length === 0 && cards.length === 0) continue;

    // Next expected income.
    let nextIncome: AccountProjection["nextIncome"] = null;
    for (const i of own.filter((x) => x.direction === "inflow")) {
      const d = occurrencesBetween(i.nextDate!, i.frequency, today, addDays(today, INCOME_LOOKAHEAD_DAYS))[0];
      if (d && (!nextIncome || d < nextIncome.date)) nextIncome = { date: d, name: i.name, amountCents: i.amountCents, recurringItemId: i.id };
    }
    const windowEnd = nextIncome ? nextIncome.date : addDays(today, NO_INCOME_HORIZON_DAYS);
    const windowReason = nextIncome
      ? `Charges due before the next income (${nextIncome.name} on ${nextIncome.date}).`
      : `No income expected soon, so this looks ${NO_INCOME_HORIZON_DAYS} days ahead.`;

    const raw: Array<Omit<ProjectionEvent, "balanceAfterCents">> = [];
    for (const i of own.filter((x) => x.direction === "outflow")) {
      const last = nextIncome ? addDays(windowEnd, -1) : windowEnd;
      for (const d of occurrencesBetween(i.nextDate!, i.frequency, today, last)) {
        raw.push({
          date: d,
          kind: "charge",
          name: i.name,
          amountCents: -i.amountCents,
          isEstimate: i.isEstimate,
          recurringItemId: i.id,
          cardAccountId: null,
          basedOnTransactionIds: i.estimateBasis?.transactionIds ?? i.transactionIds,
        });
      }
    }
    for (const c of cards) {
      const last = nextIncome ? addDays(windowEnd, -1) : windowEnd;
      if (c.dueDate > last) continue;
      raw.push({
        date: c.dueDate,
        kind: "card_payment",
        name: `${c.cardName} statement`,
        amountCents: -c.amountCents,
        isEstimate: false,
        recurringItemId: null,
        cardAccountId: c.cardAccountId,
        basedOnTransactionIds: c.paymentTransactionIds,
      });
    }
    raw.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.amountCents - b.amountCents || (a.name < b.name ? -1 : 1)));
    if (nextIncome) {
      raw.push({
        date: nextIncome.date,
        kind: "income",
        name: nextIncome.name,
        amountCents: nextIncome.amountCents,
        isEstimate: own.find((i) => i.id === nextIncome!.recurringItemId)!.isEstimate,
        recurringItemId: nextIncome.recurringItemId,
        cardAccountId: null,
        basedOnTransactionIds: own.find((i) => i.id === nextIncome!.recurringItemId)!.transactionIds,
      });
    }

    let bal = account.currentBalanceCents;
    let lowest = { cents: bal, date: today };
    let firstBelow: IsoDate | null = bal < 0 ? today : null;
    const events: ProjectionEvent[] = raw.map((e) => {
      bal = Money.add(bal, e.amountCents);
      if (bal < lowest.cents) lowest = { cents: bal, date: e.date };
      if (bal < 0 && firstBelow === null) firstBelow = e.date;
      return { ...e, balanceAfterCents: bal };
    });
    const name = displayName(account);
    const warning: BelowZeroWarning | null =
      lowest.cents < 0
        ? {
            accountId: account.id,
            accountName: name,
            shortfallCents: -lowest.cents,
            date: firstBelow ?? lowest.date,
            lowestDate: lowest.date,
            message: `${name} is projected to be ${Money.format(-lowest.cents)} short on ${firstBelow ?? lowest.date}.`,
          }
        : null;
    const basis = [
      `Starts from today's balance of ${Money.format(account.currentBalanceCents)}.`,
      windowReason,
      ...events.map(
        (e) => `${e.date}: ${e.name} ${Money.format(e.amountCents, { showPlus: true })}${e.isEstimate ? " (estimate)" : ""}`,
      ),
    ];
    out.push({
      accountId: account.id,
      accountName: name,
      currentBalanceCents: account.currentBalanceCents,
      windowEnd,
      windowReason,
      nextIncome,
      events,
      lowestPoint: lowest,
      warning,
      basis,
    });
  }
  return out;
}

export interface CalendarEntry {
  recurringItemId: Id | null;
  cardAccountId: AccountId | null;
  name: string;
  kind: "charge" | "income" | "card_payment";
  amountCents: Cents;
  isEstimate: boolean;
  accountId: AccountId;
}

export interface MonthCalendar {
  month: IsoMonth;
  days: Array<{ date: IsoDate; entries: CalendarEntry[] }>;
  /** Total of recurring charges in the month (card statement payments are not fixed costs). */
  fixedCostsCents: Cents;
  /** The part of the fixed total that comes from estimates. */
  estimatedCents: Cents;
  incomeCents: Cents;
}

/** Month calendar: when each charge hits, plus the month's fixed-cost total. */
export function monthCalendar(month: IsoMonth, items: readonly MergedRecurring[], cardPayments: readonly CardPayment[] = []): MonthCalendar {
  const from = monthStart(month);
  const to = monthEnd(month);
  const byDate = new Map<IsoDate, CalendarEntry[]>();
  const add = (d: IsoDate, e: CalendarEntry) => byDate.set(d, [...(byDate.get(d) ?? []), e]);
  let fixed = 0;
  let estimated = 0;
  let income = 0;
  for (const i of items) {
    const anchor = i.nextDate ?? i.lastDate;
    if (!anchor) continue;
    for (const d of occurrencesBetween(anchor, i.frequency, from, to)) {
      add(d, {
        recurringItemId: i.id,
        cardAccountId: null,
        name: i.name,
        kind: i.direction === "outflow" ? "charge" : "income",
        amountCents: i.amountCents,
        isEstimate: i.isEstimate,
        accountId: i.accountId,
      });
      if (i.direction === "outflow") {
        fixed += i.amountCents;
        if (i.isEstimate) estimated += i.amountCents;
      } else income += i.amountCents;
    }
  }
  for (const c of cardPayments) {
    if (c.dueDate < from || c.dueDate > to) continue;
    add(c.dueDate, {
      recurringItemId: null,
      cardAccountId: c.cardAccountId,
      name: `${c.cardName} statement`,
      kind: "card_payment",
      amountCents: c.amountCents,
      isEstimate: false,
      accountId: c.payingAccountId,
    });
  }
  const days = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, entries]) => ({ date, entries: entries.sort((x, y) => (x.name < y.name ? -1 : 1)) }));
  return { month, days, fixedCostsCents: fixed, estimatedCents: estimated, incomeCents: income };
}
