/**
 * Looking back (§12): earning vs spending with the savings rate,
 * investments split into contributions and growth, and interest vs
 * principal for interest-earning accounts.
 */
import { Money, type Cents } from "../money.ts";
import { monthOf, type IsoDate, type IsoMonth } from "../dates.ts";
import type { AccountId, Transaction, TransactionId, TransactionOverride } from "../types.ts";

// ---------------------------------------------------------------- earning vs spending

export interface PeriodTotals {
  /** "YYYY-MM" or "YYYY". */
  period: string;
  incomeCents: Cents;
  /** Positive magnitude. */
  spendingCents: Cents;
}

export interface EarningVsSpendingRow extends PeriodTotals {
  savedCents: Cents;
  /** Saved / income, 0–1 (can be negative); null when there was no income. */
  savingsRate: number | null;
  /** Spending / income; null when there was no income. */
  spendingShare: number | null;
}

/** Totals come from core-flows (income and spending by month); this adds the rates. */
export function earningVsSpending(rows: readonly PeriodTotals[]): EarningVsSpendingRow[] {
  return rows.map((r) => {
    const saved = r.incomeCents - r.spendingCents;
    return {
      ...r,
      savedCents: saved,
      savingsRate: r.incomeCents > 0 ? saved / r.incomeCents : null,
      spendingShare: r.incomeCents > 0 ? r.spendingCents / r.incomeCents : null,
    };
  });
}

/** Roll monthly totals ("YYYY-MM") up to years ("YYYY"). */
export function rollUpToYears(rows: readonly PeriodTotals[]): PeriodTotals[] {
  const byYear = new Map<string, PeriodTotals>();
  for (const r of rows) {
    const y = r.period.slice(0, 4);
    const cur = byYear.get(y) ?? { period: y, incomeCents: 0, spendingCents: 0 };
    byYear.set(y, { period: y, incomeCents: cur.incomeCents + r.incomeCents, spendingCents: cur.spendingCents + r.spendingCents });
  }
  return [...byYear.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
}

// ---------------------------------------------------------------- investments: contributions vs growth

export interface ContributionEvent {
  date: IsoDate;
  /** Positive = money put in, negative = taken out. */
  cents: Cents;
  id: string;
}

export interface GrowthPoint {
  date: IsoDate;
  valueCents: Cents;
  /** Value when history starts + net money put in since. */
  contributedCents: Cents;
  /** Market gains and losses and dividends: value − contributed. */
  growthCents: Cents;
}

/**
 * Split value over time into what I put in and growth. History starts at
 * the first value point (the connection day, §5); the value then counts as
 * what was put in, and later contributions add to it.
 */
export function contributionsVsGrowth(
  values: ReadonlyArray<{ date: IsoDate; valueCents: Cents }>,
  contributions: readonly ContributionEvent[],
): { historyStartsOn: IsoDate | null; startingValueCents: Cents; points: GrowthPoint[] } {
  const sorted = [...values].sort((a, b) => (a.date < b.date ? -1 : 1));
  const first = sorted[0];
  if (!first) return { historyStartsOn: null, startingValueCents: 0, points: [] };
  const points = sorted.map((v) => {
    const put = Money.sum(contributions.filter((c) => c.date > first.date && c.date <= v.date).map((c) => c.cents));
    const contributed = first.valueCents + put;
    return { date: v.date, valueCents: v.valueCents, contributedCents: contributed, growthCents: v.valueCents - contributed };
  });
  return { historyStartsOn: first.date, startingValueCents: first.valueCents, points };
}

// ---------------------------------------------------------------- interest vs principal

export const INTEREST_CATEGORY = "INCOME_INTEREST_EARNED";

export function isInterestTransaction(t: Transaction, override?: Pick<TransactionOverride, "category"> | null): boolean {
  const category = override?.category ?? t.plaidCategoryDetailed;
  return category === INTEREST_CATEGORY;
}

export interface InterestMonth {
  month: IsoMonth;
  interestCents: Cents;
  interestTransactionIds: TransactionId[];
  principalMovedCents: Cents;
  /** Cumulative principal (starting balance + net deposits) at month end. */
  principalCents: Cents;
  /** Total interest earned so far at month end. */
  totalInterestCents: Cents;
}

export interface InterestVsPrincipal {
  accountId: AccountId;
  startingBalanceCents: Cents;
  months: InterestMonth[];
  years: Array<{ year: string; interestCents: Cents; interestTransactionIds: TransactionId[] }>;
  totalInterestCents: Cents;
  principalCents: Cents;
}

/**
 * Principal deposited vs total interest earned, cumulative by month, plus
 * interest per month and year. `startingBalanceCents` is the balance before
 * the first transaction (e.g. the first rebuilt snapshot); it counts as
 * principal.
 */
export function interestVsPrincipal(input: {
  accountId: AccountId;
  transactions: readonly Transaction[];
  overrides?: readonly TransactionOverride[];
  startingBalanceCents: Cents;
}): InterestVsPrincipal {
  const ov = new Map((input.overrides ?? []).map((o) => [o.transactionId, o]));
  const txs = input.transactions
    .filter((t) => t.accountId === input.accountId && !t.pending && !t.removed)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const byMonth = new Map<IsoMonth, { interest: Transaction[]; principal: Cents }>();
  for (const t of txs) {
    const m = monthOf(t.date);
    const cur = byMonth.get(m) ?? { interest: [], principal: 0 };
    if (isInterestTransaction(t, ov.get(t.id))) cur.interest.push(t);
    else cur.principal += t.amountCents;
    byMonth.set(m, cur);
  }
  let principal = input.startingBalanceCents;
  let interestTotal = 0;
  const months: InterestMonth[] = [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, v]) => {
      const interest = Money.sum(v.interest.map((t) => t.amountCents));
      principal += v.principal;
      interestTotal += interest;
      return {
        month,
        interestCents: interest,
        interestTransactionIds: v.interest.map((t) => t.id),
        principalMovedCents: v.principal,
        principalCents: principal,
        totalInterestCents: interestTotal,
      };
    });
  const years = new Map<string, { interestCents: Cents; interestTransactionIds: TransactionId[] }>();
  for (const m of months) {
    const y = m.month.slice(0, 4);
    const cur = years.get(y) ?? { interestCents: 0, interestTransactionIds: [] };
    years.set(y, { interestCents: cur.interestCents + m.interestCents, interestTransactionIds: [...cur.interestTransactionIds, ...m.interestTransactionIds] });
  }
  return {
    accountId: input.accountId,
    startingBalanceCents: input.startingBalanceCents,
    months,
    years: [...years.entries()].map(([year, v]) => ({ year, ...v })),
    totalInterestCents: interestTotal,
    principalCents: principal,
  };
}
