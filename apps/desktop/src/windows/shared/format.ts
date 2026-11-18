/**
 * Display helpers shared by the Recurring, Trajectory and Investments windows.
 * Money always goes through core's `Money.format` (cents in, "$1,234.56" out).
 */
import { Money } from "@ft/core";

export const money = (cents: number, opts?: { showPlus?: boolean; noCents?: boolean }) => Money.format(Math.round(cents), opts);

/** Compact money for chart axes: $1.2k, $3.4M. */
export function moneyShort(cents: number): string {
  const d = cents / 100;
  const abs = Math.abs(d);
  const sign = d < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const dateYearFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const weekdayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const monthShortFmt = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });

const utc = (iso: string) => new Date(`${iso.length === 7 ? `${iso}-01` : iso}T00:00:00Z`);

/** "Nov 3" */
export const shortDate = (iso: string) => dateFmt.format(utc(iso));
/** "Nov 3, 2026" */
export const longDate = (iso: string) => dateYearFmt.format(utc(iso));
/** "Tue, Nov 3" */
export const dayDate = (iso: string) => weekdayFmt.format(utc(iso));
/** "November 2026" from "2026-11" */
export const monthName = (month: string) => monthFmt.format(utc(month));
/** "Nov 26" from "2026-11" */
export const monthShort = (month: string) => monthShortFmt.format(utc(month));

export const pct = (ratio: number | null, digits = 0) => (ratio === null ? "–" : `${(ratio * 100).toFixed(digits)}%`);

/** Today in the user's time zone, as YYYY-MM-DD (the UI may read the clock; core may not). */
export function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const FREQUENCY_LABELS: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  semi_monthly: "Twice a month",
  monthly: "Monthly",
  annually: "Yearly",
  unknown: "Irregular",
};

/** "12.50" → 1250 cents; null when not a positive amount. */
export function parseDollars(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export const dollarsText = (cents: number | null | undefined) => (cents == null ? "" : (cents / 100).toFixed(2));
