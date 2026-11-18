/** Local calendar helpers for windows (core never reads the clock). */
import type { IsoDate, IsoMonth } from "@ft/core";

/** Today's local date as YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): IsoDate {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` as IsoDate;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "October 2026" */
export function monthLong(m: IsoMonth | string): string {
  return `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
}

/** "Oct" */
export function monthShort(m: IsoMonth | string): string {
  return MONTHS[Number(m.slice(5, 7)) - 1]!.slice(0, 3);
}

/** "Oct 16" (adds the year when it isn't `currentYear`). */
export function dayLabel(d: IsoDate | string, currentYear?: string): string {
  const base = `${monthShort(d)} ${Number(d.slice(8, 10))}`;
  return currentYear && d.slice(0, 4) !== currentYear ? `${base}, ${d.slice(0, 4)}` : base;
}
