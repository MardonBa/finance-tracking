/**
 * Budget periods (§10, decision 004): weekly, biweekly, monthly (default),
 * yearly, or one custom date range. Recurring periods are anchored on the
 * budget's `anchorDate` (monthly on the 1st = calendar months).
 */
import type { IsoDate } from "../dates.ts";
import { addDays, addMonths, diffDays, parseIsoDate } from "../dates.ts";
import type { Budget } from "../types.ts";

export interface Period {
  start: IsoDate;
  end: IsoDate;
}

type PeriodSpec = Pick<Budget, "periodKind" | "anchorDate" | "customEndDate">;

function monthIndex(d: IsoDate): number {
  const p = parseIsoDate(d);
  return p.year * 12 + p.month - 1;
}

function monthlyPeriod(anchor: IsoDate, date: IsoDate, step: number): Period {
  let k = Math.floor((monthIndex(date) - monthIndex(anchor)) / step);
  // addMonths clamps (Jan 31 → Feb 28), always from the anchor so it never drifts.
  while (addMonths(anchor, k * step) > date) k -= 1;
  while (addMonths(anchor, (k + 1) * step) <= date) k += 1;
  return { start: addMonths(anchor, k * step), end: addDays(addMonths(anchor, (k + 1) * step), -1) };
}

/** The period containing `date`, or null (custom budgets outside their dates). */
export function periodContaining(spec: PeriodSpec, date: IsoDate): Period | null {
  switch (spec.periodKind) {
    case "weekly":
    case "biweekly": {
      const len = spec.periodKind === "weekly" ? 7 : 14;
      const k = Math.floor(diffDays(spec.anchorDate, date) / len);
      const start = addDays(spec.anchorDate, k * len);
      return { start, end: addDays(start, len - 1) };
    }
    case "monthly":
      return monthlyPeriod(spec.anchorDate, date, 1);
    case "yearly":
      return monthlyPeriod(spec.anchorDate, date, 12);
    case "custom": {
      const end = spec.customEndDate ?? spec.anchorDate;
      return date >= spec.anchorDate && date <= end ? { start: spec.anchorDate, end } : null;
    }
  }
}

/** The period `n` periods before (negative) or after `period`. */
export function shiftPeriod(spec: PeriodSpec, period: Period, n: number): Period | null {
  if (spec.periodKind === "custom") return n === 0 ? period : null;
  let p: Period | null = period;
  for (let i = 0; i < Math.abs(n) && p; i++) p = periodContaining(spec, n > 0 ? addDays(p.end, 1) : addDays(p.start, -1));
  return p;
}

/** The period for "today", or the custom range itself. */
export function currentPeriod(spec: PeriodSpec, today: IsoDate): Period {
  const p = periodContaining(spec, today);
  if (p) return p;
  // Custom budget not running today: show its own dates.
  return { start: spec.anchorDate, end: spec.customEndDate ?? spec.anchorDate };
}

export function periodDays(p: Period): number {
  return diffDays(p.start, p.end) + 1;
}

/** Days of the period elapsed by `today`, counting today (0 before, all after). */
export function elapsedDays(p: Period, today: IsoDate): number {
  if (today < p.start) return 0;
  if (today > p.end) return periodDays(p);
  return diffDays(p.start, today) + 1;
}
