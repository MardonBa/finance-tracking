/**
 * "Usual" (§8): the average of the previous 1, 2 or 3 months (default 3).
 * Every comparison carries which months it used, so the UI can say
 * "vs usual (Jul–Sep)". Months before the first data month don't count, so a
 * new user's usual isn't dragged down by empty months.
 */
import type { Cents } from "../money.ts";
import type { IsoMonth } from "../dates.ts";
import { addMonthsToMonth, monthOf } from "../dates.ts";
import { countable, type Ledger } from "../flows/ledger.ts";

export const USUAL_MONTH_CHOICES = [1, 2, 3] as const;
export type UsualMonths = (typeof USUAL_MONTH_CHOICES)[number];
export const DEFAULT_USUAL_MONTHS: UsualMonths = 3;

export interface UsualBasis {
  /** What the user chose (1–3). */
  chosen: UsualMonths;
  /** The months actually averaged (may be fewer at the start of the data). */
  months: IsoMonth[];
  /** e.g. "average of Jul, Aug, Sep 2026" */
  label: string;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthName(m: IsoMonth): string {
  return `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
}

/** The first month that has any cleared entry, or null with no data. */
export function firstDataMonth(ledger: Ledger): IsoMonth | null {
  let first: string | null = null;
  for (const e of ledger.entries) if (countable(e) && (first === null || e.countDate < first)) first = e.countDate;
  return first ? monthOf(first) : null;
}

export function usualBasis(month: IsoMonth, chosen: UsualMonths, firstMonth: IsoMonth | null): UsualBasis {
  const months: IsoMonth[] = [];
  for (let i = chosen; i >= 1; i--) {
    const m = addMonthsToMonth(month, -i);
    if (firstMonth !== null && m >= firstMonth) months.push(m);
  }
  const label =
    months.length === 0
      ? "no earlier months yet"
      : `average of ${months.map((m) => monthName(m).slice(0, 3)).join(", ")} ${months[months.length - 1]!.slice(0, 4)}`;
  return { chosen, months, label };
}

/** Integer division rounding half away from zero (cents stay whole). */
export function roundDiv(total: Cents, n: number): Cents {
  if (n <= 0) throw new RangeError("roundDiv: n must be positive");
  const q = Math.abs(total) / n;
  const r = Math.floor(q + 0.5);
  return r === 0 ? 0 : total < 0 ? -r : r;
}

/** The usual of a monthly value, or null when there are no earlier months. */
export function usualValue(basis: UsualBasis, valueOf: (m: IsoMonth) => Cents): Cents | null {
  if (basis.months.length === 0) return null;
  return roundDiv(
    basis.months.reduce((s, m) => s + valueOf(m), 0),
    basis.months.length,
  );
}
