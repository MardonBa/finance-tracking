/** Display helpers shared by the Budgets and Goals windows. */
import { Money, parseIsoDate, type IsoDate } from "@ft/core";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "$1,234" (whole dollars; figures stay exact in drill-downs). */
export const usd = (cents: number) => Money.format(cents, { noCents: true });

/** "Oct 3" */
export function shortDate(d: IsoDate): string {
  const { month, day } = parseIsoDate(d);
  return `${MONTHS[month - 1]} ${day}`;
}

/** "Oct 3, 2026" */
export function longDate(d: IsoDate): string {
  const { year } = parseIsoDate(d);
  return `${shortDate(d)}, ${year}`;
}

/** "October 2026" for calendar months, else "Oct 3 – Oct 16". */
export function periodLabel(p: { start: IsoDate; end: IsoDate }): string {
  const s = parseIsoDate(p.start);
  const e = parseIsoDate(p.end);
  const lastDay = new Date(Date.UTC(s.year, s.month, 0)).getUTCDate();
  if (s.day === 1 && s.year === e.year && s.month === e.month && e.day === lastDay) {
    return `${new Date(Date.UTC(s.year, s.month - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${s.year}`;
  }
  return `${shortDate(p.start)} – ${shortDate(p.end)}`;
}

/** "Oct" or "Oct 3" for a grid column header. */
export function periodShort(p: { start: IsoDate; end: IsoDate }): string {
  const s = parseIsoDate(p.start);
  return s.day === 1 ? `${MONTHS[s.month - 1]} ${String(s.year).slice(2)}` : shortDate(p.start);
}

/** Today in the local time zone. */
export function todayIso(): IsoDate {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Parses "12.50" / "$1,200" into cents, or null. */
export function parseDollars(text: string): number | null {
  const t = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [d, c = ""] = t.split(".");
  return Number(d) * 100 + Number(c.padEnd(2, "0"));
}

export const dollarsText = (cents: number | null | undefined) => (cents == null ? "" : (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2));
