/**
 * Monthly summary (§8): income, spending, saved and savings rate for a month,
 * each compared with the previous month and with usual. Income includes the
 * Poker net as one line (§6).
 */
import type { Cents } from "../money.ts";
import { Money } from "../money.ts";
import type { IsoMonth } from "../dates.ts";
import { addMonthsToMonth, monthEnd, monthStart } from "../dates.ts";
import type { Figure } from "../registry.ts";
import { figure, inPeriod, measures, ratio } from "../flows/figures.ts";
import type { Ledger } from "../flows/ledger.ts";
import { firstDataMonth, usualBasis, usualValue, type UsualBasis, type UsualMonths } from "./usual.ts";

export interface MonthTotals {
  month: IsoMonth;
  incomeCents: Cents;
  /** Of which the Poker net (can be negative). */
  pokerNetCents: Cents;
  spendingCents: Cents;
  savedCents: Cents;
  /** saved / income, null when there is no income. Not money. */
  savingsRate: number | null;
}

export function monthFigures(ledger: Ledger, month: IsoMonth): Record<"income" | "poker" | "spending" | "saved", Figure> {
  const entries = inPeriod(ledger.entries, monthStart(month), monthEnd(month));
  return {
    income: figure(entries, measures.incomeWithPoker, `Income · ${month}`),
    poker: figure(
      entries.filter((e) => e.bucket === "poker"),
      measures.amount,
      `Poker net · ${month}`,
    ),
    spending: figure(entries, measures.spend, `Spending · ${month} · excluding transfers`),
    saved: figure(entries, measures.saved, `Saved · ${month}`),
  };
}

export function monthTotals(ledger: Ledger, month: IsoMonth): MonthTotals {
  const f = monthFigures(ledger, month);
  return {
    month,
    incomeCents: f.income.cents,
    pokerNetCents: f.poker.cents,
    spendingCents: f.spending.cents,
    savedCents: f.saved.cents,
    savingsRate: ratio(f.saved.cents, f.income.cents),
  };
}

export interface Comparison {
  cents: Cents | null;
  /** current − compared, null when nothing to compare with. */
  diffCents: Cents | null;
}

function compare(current: Cents, other: Cents | null): Comparison {
  return { cents: other, diffCents: other === null ? null : Money.sub(current, other) };
}

export interface MonthlySummary extends MonthTotals {
  previous: MonthTotals;
  usual: {
    basis: UsualBasis;
    incomeCents: Cents | null;
    spendingCents: Cents | null;
    savedCents: Cents | null;
    savingsRate: number | null;
  };
  vsPrevious: Record<"income" | "spending" | "saved", Comparison> & { savingsRatePoints: number | null };
  vsUsual: Record<"income" | "spending" | "saved", Comparison> & { savingsRatePoints: number | null };
}

export function monthlySummary(
  ledger: Ledger,
  month: IsoMonth,
  usualMonths: UsualMonths,
): { value: MonthlySummary; figures: Record<string, Figure> } {
  const cur = monthFigures(ledger, month);
  const prevMonth = addMonthsToMonth(month, -1);
  const prev = monthFigures(ledger, prevMonth);
  const totals = monthTotals(ledger, month);
  const previous = monthTotals(ledger, prevMonth);
  const basis = usualBasis(month, usualMonths, firstDataMonth(ledger));
  const byMonth = new Map(basis.months.map((m) => [m, monthTotals(ledger, m)]));
  const uIncome = usualValue(basis, (m) => byMonth.get(m)!.incomeCents);
  const uSpending = usualValue(basis, (m) => byMonth.get(m)!.spendingCents);
  const uSaved = usualValue(basis, (m) => byMonth.get(m)!.savedCents);
  const uRate = uIncome === null || uSaved === null ? null : ratio(uSaved, uIncome);
  const points = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);

  const figures: Record<string, Figure> = {
    income: cur.income,
    poker: cur.poker,
    spending: cur.spending,
    saved: cur.saved,
    "previous.income": prev.income,
    "previous.spending": prev.spending,
    "previous.saved": prev.saved,
  };
  for (const m of basis.months) {
    const f = monthFigures(ledger, m);
    figures[`usual.${m}.income`] = f.income;
    figures[`usual.${m}.spending`] = f.spending;
    figures[`usual.${m}.saved`] = f.saved;
  }
  return {
    value: {
      ...totals,
      previous,
      usual: { basis, incomeCents: uIncome, spendingCents: uSpending, savedCents: uSaved, savingsRate: uRate },
      vsPrevious: {
        income: compare(totals.incomeCents, previous.incomeCents),
        spending: compare(totals.spendingCents, previous.spendingCents),
        saved: compare(totals.savedCents, previous.savedCents),
        savingsRatePoints: points(totals.savingsRate, previous.savingsRate),
      },
      vsUsual: {
        income: compare(totals.incomeCents, uIncome),
        spending: compare(totals.spendingCents, uSpending),
        saved: compare(totals.savedCents, uSaved),
        savingsRatePoints: points(totals.savingsRate, uRate),
      },
    },
    figures,
  };
}

/** Income, spending, saved and savings rate for each month (savings rate month over month). */
export function cashFlowSeries(ledger: Ledger, months: readonly IsoMonth[]): { value: MonthTotals[]; figures: Record<string, Figure> } {
  const figures: Record<string, Figure> = {};
  const value = months.map((m) => {
    const f = monthFigures(ledger, m);
    figures[`${m}.income`] = f.income;
    figures[`${m}.spending`] = f.spending;
    figures[`${m}.saved`] = f.saved;
    return monthTotals(ledger, m);
  });
  return { value, figures };
}
