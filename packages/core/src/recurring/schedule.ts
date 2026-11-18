/** Occurrence dates of a recurring item, anchored on one known date. */
import { addDays, addMonths, daysInMonth, formatIsoDate, parseIsoDate, type IsoDate } from "../dates.ts";
import type { RecurringFrequency } from "../types.ts";

/**
 * The k-th occurrence from `anchor` (k may be negative). Monthly and
 * annual steps are taken from the anchor so day 31 doesn't drift to 28.
 * Semi-monthly alternates between the anchor's day and the day 15 days
 * away (e.g. the 1st and the 16th). "unknown" only has the anchor.
 */
export function occurrence(anchor: IsoDate, frequency: RecurringFrequency, k: number): IsoDate | null {
  switch (frequency) {
    case "weekly":
      return addDays(anchor, 7 * k);
    case "biweekly":
      return addDays(anchor, 14 * k);
    case "monthly":
      return addMonths(anchor, k);
    case "annually":
      return addMonths(anchor, 12 * k);
    case "semi_monthly": {
      const { year, month, day } = parseIsoDate(anchor);
      const other = day <= 15 ? day + 15 : day - 15;
      const first = Math.min(day, other);
      const second = Math.max(day, other);
      const p = day === first ? 0 : 1;
      const idx = p + k;
      const monthOffset = Math.floor(idx / 2);
      const m = year * 12 + (month - 1) + monthOffset;
      const y = Math.floor(m / 12);
      const mm = m - y * 12 + 1;
      const d = idx - monthOffset * 2 === 0 ? first : second;
      return formatIsoDate({ year: y, month: mm, day: Math.min(d, daysInMonth(y, mm)) });
    }
    default:
      return k === 0 ? anchor : null;
  }
}

/** All occurrences between `from` and `to` inclusive. */
export function occurrencesBetween(anchor: IsoDate, frequency: RecurringFrequency, from: IsoDate, to: IsoDate): IsoDate[] {
  if (frequency === "unknown") return anchor >= from && anchor <= to ? [anchor] : [];
  const out: IsoDate[] = [];
  // Walk back to before `from`, then forward to `to`.
  let k = 0;
  while ((occurrence(anchor, frequency, k) as IsoDate) >= from) k -= 1;
  for (; ; k++) {
    const d = occurrence(anchor, frequency, k) as IsoDate;
    if (d > to) break;
    if (d >= from) out.push(d);
  }
  return out;
}

/** The first occurrence on or after `date`. */
export function nextOnOrAfter(anchor: IsoDate, frequency: RecurringFrequency, date: IsoDate): IsoDate | null {
  if (frequency === "unknown") return anchor >= date ? anchor : null;
  let k = 0;
  while ((occurrence(anchor, frequency, k) as IsoDate) >= date) k -= 1;
  while ((occurrence(anchor, frequency, k) as IsoDate) < date) k += 1;
  return occurrence(anchor, frequency, k);
}
