/**
 * Calendar-date helpers. Dates are ISO strings "YYYY-MM-DD" with no time and
 * no time zone, so arithmetic never shifts a day because of the machine's
 * zone or daylight saving. "Today" is always passed in by the caller; nothing
 * here reads the clock.
 */

/** A calendar date, "YYYY-MM-DD". */
export type IsoDate = string;
/** A calendar month, "YYYY-MM". */
export type IsoMonth = string;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH_RE = /^(\d{4})-(\d{2})$/;
const DAY_MS = 86_400_000;

export interface DateParts {
  year: number;
  /** 1–12 */
  month: number;
  /** 1–31 */
  day: number;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string") return false;
  const m = ISO_DATE_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function isIsoMonth(value: unknown): value is IsoMonth {
  if (typeof value !== "string") return false;
  const m = ISO_MONTH_RE.exec(value);
  return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 12;
}

export function parseIsoDate(date: IsoDate): DateParts {
  if (!isIsoDate(date)) throw new RangeError(`Not an ISO date (YYYY-MM-DD): ${JSON.stringify(date)}`);
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)) };
}

export function formatIsoDate({ year, month, day }: DateParts): IsoDate {
  const out = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!isIsoDate(out)) throw new RangeError(`Invalid date parts: ${out}`);
  return out;
}

/** Days since 1970-01-01 (UTC calendar), used for day arithmetic. */
export function toEpochDay(date: IsoDate): number {
  const { year, month, day } = parseIsoDate(date);
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
}

export function fromEpochDay(epochDay: number): IsoDate {
  if (!Number.isInteger(epochDay)) throw new RangeError("fromEpochDay: not an integer");
  const d = new Date(epochDay * DAY_MS);
  return formatIsoDate({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromEpochDay(toEpochDay(date) + days);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return toEpochDay(b) - toEpochDay(a);
}

export function compareIsoDate(a: IsoDate, b: IsoDate): number {
  // ISO dates sort lexicographically; validate so bad input never sorts silently.
  parseIsoDate(a);
  parseIsoDate(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minIsoDate(a: IsoDate, b: IsoDate): IsoDate {
  return compareIsoDate(a, b) <= 0 ? a : b;
}

export function maxIsoDate(a: IsoDate, b: IsoDate): IsoDate {
  return compareIsoDate(a, b) >= 0 ? a : b;
}

/** Inclusive range check: from ≤ date ≤ to. */
export function isWithin(date: IsoDate, from: IsoDate, to: IsoDate): boolean {
  return compareIsoDate(from, date) <= 0 && compareIsoDate(date, to) <= 0;
}

/**
 * Add calendar months, clamping to the last day of the target month:
 * 2024-01-31 + 1 month = 2024-02-29; 2023-01-31 + 1 month = 2023-02-28.
 */
export function addMonths(date: IsoDate, months: number): IsoDate {
  if (!Number.isInteger(months)) throw new RangeError("addMonths: months must be an integer");
  const { year, month, day } = parseIsoDate(date);
  const index = year * 12 + (month - 1) + months;
  const y = Math.floor(index / 12);
  const m = index - y * 12 + 1;
  return formatIsoDate({ year: y, month: m, day: Math.min(day, daysInMonth(y, m)) });
}

export function monthOf(date: IsoDate): IsoMonth {
  parseIsoDate(date);
  return date.slice(0, 7);
}

export function startOfMonth(date: IsoDate): IsoDate {
  return `${monthOf(date)}-01`;
}

export function endOfMonth(date: IsoDate): IsoDate {
  const { year, month } = parseIsoDate(date);
  return formatIsoDate({ year, month, day: daysInMonth(year, month) });
}

export function monthStart(month: IsoMonth): IsoDate {
  if (!isIsoMonth(month)) throw new RangeError(`Not an ISO month (YYYY-MM): ${JSON.stringify(month)}`);
  return `${month}-01`;
}

export function monthEnd(month: IsoMonth): IsoDate {
  return endOfMonth(monthStart(month));
}

export function addMonthsToMonth(month: IsoMonth, months: number): IsoMonth {
  return monthOf(addMonths(monthStart(month), months));
}

/** 0 = Monday … 6 = Sunday (ISO weekday order). */
export function dayOfWeek(date: IsoDate): number {
  // 1970-01-01 was a Thursday (ISO index 3).
  return (((toEpochDay(date) + 3) % 7) + 7) % 7;
}

/** Monday of the week containing `date`. */
export function startOfWeek(date: IsoDate): IsoDate {
  return addDays(date, -dayOfWeek(date));
}

/** Sunday of the week containing `date` (the "end of week" used for weekly snapshots). */
export function endOfWeek(date: IsoDate): IsoDate {
  return addDays(startOfWeek(date), 6);
}

/** Every date from `from` to `to`, inclusive. Empty when to < from. */
export function eachDay(from: IsoDate, to: IsoDate): IsoDate[] {
  const start = toEpochDay(from);
  const end = toEpochDay(to);
  const out: IsoDate[] = [];
  for (let d = start; d <= end; d++) out.push(fromEpochDay(d));
  return out;
}

/** Every month from the month of `from` to the month of `to`, inclusive. */
export function eachMonth(from: IsoDate, to: IsoDate): IsoMonth[] {
  const out: IsoMonth[] = [];
  let m = monthOf(from);
  const last = monthOf(to);
  while (m <= last) {
    out.push(m);
    m = addMonthsToMonth(m, 1);
  }
  return out;
}

/**
 * The calendar date of an instant in a given IANA time zone. Use this at the
 * edge (API request, cron run) to compute "today" for the user's zone, then
 * pass that IsoDate into core.
 */
export function isoDateInTimeZone(instantMs: number, timeZone: string): IsoDate {
  if (!Number.isFinite(instantMs)) throw new RangeError("isoDateInTimeZone: bad instant");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instantMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return formatIsoDate({ year: Number(get("year")), month: Number(get("month")), day: Number(get("day")) });
}
