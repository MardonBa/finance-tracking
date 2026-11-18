/**
 * Provenance helpers: every number is built from ledger entries, so it
 * carries the exact transactions (and cents) behind it.
 */
import type { Cents } from "../money.ts";
import { Money } from "../money.ts";
import type { IsoDate } from "../dates.ts";
import { isWithin } from "../dates.ts";
import type { Figure } from "../registry.ts";
import { contribution, countable, incomeCents, spendCents, type LedgerEntry } from "./ledger.ts";

export type Measure = (e: LedgerEntry) => Cents;

/** Spending (positive), income (positive), and the raw signed amount. */
export const measures = {
  spend: spendCents,
  income: incomeCents,
  /** Income plus the Poker net (each Poker entry at its signed amount). */
  incomeWithPoker: (e: LedgerEntry): Cents => (e.bucket === "income" || e.bucket === "poker" ? e.amountCents : 0),
  /** Income − spending, Poker net included (what "saved" is made of). */
  saved: (e: LedgerEntry): Cents => (e.bucket === "transfer" ? 0 : e.amountCents),
  amount: (e: LedgerEntry): Cents => e.amountCents,
  /** Money into the account as a positive number. */
  inflow: (e: LedgerEntry): Cents => (e.amountCents > 0 ? e.amountCents : 0),
  /** Money out of the account as a positive number. */
  outflow: (e: LedgerEntry): Cents => (e.amountCents < 0 ? -e.amountCents : 0),
} satisfies Record<string, Measure>;

/** Build a figure from entries under a measure; zero contributions are dropped. */
export function figure(entries: readonly LedgerEntry[], measure: Measure, label?: string): Figure {
  const contributions = [];
  for (const e of entries) {
    const cents = measure(e);
    if (cents !== 0) contributions.push(contribution(e, cents));
  }
  const fig: Figure = { cents: Money.sum(contributions.map((c) => c.cents)), contributions };
  if (label !== undefined) fig.label = label;
  return fig;
}

export function emptyFigure(label?: string): Figure {
  return label === undefined ? { cents: 0, contributions: [] } : { cents: 0, contributions: [], label };
}

/** Cleared entries that count in [from, to] (by countDate). */
export function inPeriod(entries: readonly LedgerEntry[], from: IsoDate, to: IsoDate): LedgerEntry[] {
  return entries.filter((e) => countable(e) && isWithin(e.countDate, from, to));
}

/** Group entries by a key, keeping first-seen order. */
export function groupBy<T>(items: readonly T[], keyOf: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const it of items) {
    const k = keyOf(it);
    const list = out.get(k);
    if (list) list.push(it);
    else out.set(k, [it]);
  }
  return out;
}

/** Ratio as a plain number, or null when the base is zero. Not money. */
export function ratio(part: Cents, whole: Cents): number | null {
  return whole === 0 ? null : part / whole;
}
