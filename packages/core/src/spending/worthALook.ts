/**
 * "Worth a look" (§8, rule-based, no AI) and the cutting-back list.
 */
import type { Cents } from "../money.ts";
import { Money } from "../money.ts";
import type { IsoDate, IsoMonth } from "../dates.ts";
import { addMonthsToMonth, daysInMonth, monthEnd, monthOf, monthStart, parseIsoDate } from "../dates.ts";
import type { CuttingBackItem, Id, TransactionId } from "../types.ts";
import type { Figure } from "../registry.ts";
import { categoryLabel } from "../flows/categories.ts";
import { figure, groupBy, inPeriod, measures } from "../flows/figures.ts";
import { spendCents, type Ledger, type LedgerEntry } from "../flows/ledger.ts";
import { firstDataMonth, roundDiv, usualBasis, usualValue, type UsualBasis, type UsualMonths } from "./usual.ts";

export const WORTH_A_LOOK_KINDS = ["category_pace", "rising_merchant", "small_frequent", "new_recurring", "price_increase"] as const;
export type WorthALookKind = (typeof WORTH_A_LOOK_KINDS)[number];

export interface WorthALookItem {
  id: string;
  kind: WorthALookKind;
  /** One sentence with the numbers, e.g. "Coffee: 18 purchases, $97 this month". */
  text: string;
  /** Key into `figures` for the number behind it (absent for external signals without transactions). */
  figure: string | null;
  cents: Cents;
  comparedCents: Cents | null;
  /** Category or merchant key the item is about. */
  target: { kind: "category" | "merchant" | "recurring"; value: string };
}

/**
 * Hook for the recurring module (§9): new recurring charges and price
 * increases are detected there and passed in, so this list stays the single
 * place the user sees them.
 */
export interface RecurringSignal {
  kind: "new_recurring" | "price_increase";
  recurringId: Id;
  name: string;
  amountCents: Cents;
  previousAmountCents: Cents | null;
  transactionIds: TransactionId[];
}

export interface WorthALookOptions {
  month: IsoMonth;
  today: IsoDate;
  usualMonths: UsualMonths;
  recurringSignals?: readonly RecurringSignal[];
  // TODO(revisit): thresholds below are first guesses.
  paceRatio?: number;
  paceMinAboveCents?: Cents;
  risingRatio?: number;
  risingMinAboveCents?: Cents;
  smallMaxCents?: Cents;
  smallMinCount?: number;
}

const fmt = (c: Cents) => (Math.abs(c) < 10_000 ? Money.format(c) : Money.format(c, { noCents: true }));

/** Fraction of `month` elapsed by `today` (1 for past months, 0 for future). */
export function monthElapsed(month: IsoMonth, today: IsoDate): number {
  const tm = monthOf(today);
  if (tm > month) return 1;
  if (tm < month) return 0;
  const { year, month: mm, day } = parseIsoDate(today);
  return day / daysInMonth(year, mm);
}

export function worthALook(ledger: Ledger, opts: WorthALookOptions): { value: { basis: UsualBasis; items: WorthALookItem[] }; figures: Record<string, Figure> } {
  const paceRatio = opts.paceRatio ?? 1.25;
  const paceMin = opts.paceMinAboveCents ?? 2_500;
  const risingRatio = opts.risingRatio ?? 1.5;
  const risingMin = opts.risingMinAboveCents ?? 2_000;
  const smallMax = opts.smallMaxCents ?? 1_500;
  const smallCount = opts.smallMinCount ?? 5;
  const { month, today } = opts;
  const basis = usualBasis(month, opts.usualMonths, firstDataMonth(ledger));
  const elapsed = monthElapsed(month, today);
  const figures: Record<string, Figure> = {};
  const items: WorthALookItem[] = [];
  const spendingOf = (m: IsoMonth) => inPeriod(ledger.entries, monthStart(m), monthEnd(m)).filter((e) => e.bucket === "spending");
  const cur = spendingOf(month);
  // "Usual by now": each earlier month counted up to the same day of the
  // month, so a rent paid on the 3rd doesn't look like a fast pace on the 20th.
  const day = elapsed >= 1 ? 31 : parseIsoDate(today).day;
  const upToDay = (es: LedgerEntry[]) => es.filter((e) => parseIsoDate(e.countDate).day <= day);
  const hist = new Map(basis.months.map((m) => [m, spendingOf(m)]));
  const histByNow = new Map(basis.months.map((m) => [m, upToDay(hist.get(m)!)]));
  const sumBy = (es: readonly LedgerEntry[] | undefined, pred: (e: LedgerEntry) => boolean) =>
    (es ?? []).filter(pred).reduce((s, e) => s + spendCents(e), 0);

  // 1. Categories above their usual pace.
  for (const [cat, es] of groupBy(cur, (e) => e.categoryPrimary)) {
    const usual = usualValue(basis, (m) => sumBy(hist.get(m), (e) => e.categoryPrimary === cat));
    const expected = usualValue(basis, (m) => sumBy(histByNow.get(m), (e) => e.categoryPrimary === cat));
    if (usual === null || expected === null || expected <= 0 || elapsed === 0) continue;
    const f = figure(es, measures.spend, `${categoryLabel(cat)} · ${month}`);
    if (f.cents >= expected * paceRatio && f.cents - expected >= paceMin) {
      const key = `category_pace.${cat}`;
      figures[key] = f;
      const times = (f.cents / expected).toFixed(1);
      items.push({
        id: key,
        kind: "category_pace",
        text:
          elapsed < 1
            ? `${categoryLabel(cat)} is ${times}× your usual pace for this point in the month (${fmt(f.cents)} vs ${fmt(expected)}; usual = ${basis.label}).`
            : `${categoryLabel(cat)} was ${times}× usual (${fmt(f.cents)} vs ${fmt(usual)}; usual = ${basis.label}).`,
        figure: key,
        cents: f.cents,
        comparedCents: expected,
        target: { kind: "category", value: cat },
      });
    }
  }

  // 2. Merchants whose spending is rising (vs usual, paced, or three rising months).
  for (const [key, es] of groupBy(cur, (e) => e.merchantKey)) {
    const f = figure(es, measures.spend, `${ledger.merchantNames.get(key) ?? key} · ${month}`);
    if (f.cents <= 0) continue;
    const expected = usualValue(basis, (m) => sumBy(histByNow.get(m), (e) => e.merchantKey === key));
    const prev = [3, 2, 1].map((i) => {
      const m = addMonthsToMonth(month, -i);
      return sumBy(spendingOf(m), (e) => e.merchantKey === key);
    });
    const vsUsual = expected !== null && expected > 0 && f.cents >= expected * risingRatio && f.cents - expected >= risingMin;
    const streak = prev[0]! > 0 && prev[0]! < prev[1]! && prev[1]! < prev[2]! && (elapsed < 1 || prev[2]! < f.cents);
    if (!vsUsual && !streak) continue;
    const name = ledger.merchantNames.get(key) ?? key;
    const fk = `rising_merchant.${key}`;
    figures[fk] = f;
    items.push({
      id: fk,
      kind: "rising_merchant",
      text: vsUsual
        ? `${name}: ${fmt(f.cents)} so far this month vs ${fmt(expected!)} usual by now.`
        : `${name} has gone up three months running (${prev.map(fmt).join(" → ")}).`,
      figure: fk,
      cents: f.cents,
      comparedCents: expected,
      target: { kind: "merchant", value: key },
    });
  }

  // 3. Small, frequent purchases that add up (by detailed category).
  const small = cur.filter((e) => e.amountCents < 0 && spendCents(e) <= smallMax);
  for (const [cat, es] of groupBy(small, (e) => e.category)) {
    const n = new Set(es.map((e) => e.transactionId)).size;
    if (n < smallCount) continue;
    const fk = `small_frequent.${cat}`;
    const f = figure(es, measures.spend, `${categoryLabel(cat)} · small purchases · ${month}`);
    figures[fk] = f;
    items.push({
      id: fk,
      kind: "small_frequent",
      text: `${categoryLabel(cat)}: ${n} purchases, ${fmt(f.cents)} this month.`,
      figure: fk,
      cents: f.cents,
      comparedCents: null,
      target: { kind: "category", value: cat },
    });
  }

  // 4. Signals from the recurring module.
  for (const s of opts.recurringSignals ?? []) {
    const es = s.transactionIds.flatMap((id) => ledger.byTransaction.get(id) ?? []).filter((e) => !e.pending);
    const fk = `${s.kind}.${s.recurringId}`;
    const hasTx = es.length > 0;
    if (hasTx) figures[fk] = figure(es, measures.spend, `${s.name}`);
    items.push({
      id: fk,
      kind: s.kind,
      text:
        s.kind === "new_recurring"
          ? `New recurring charge: ${s.name}, ${fmt(s.amountCents)}.`
          : `${s.name} went up from ${fmt(s.previousAmountCents ?? 0)} to ${fmt(s.amountCents)}.`,
      figure: hasTx ? fk : null,
      cents: s.amountCents,
      comparedCents: s.previousAmountCents,
      target: { kind: "recurring", value: s.recurringId },
    });
  }

  const order = new Map(WORTH_A_LOOK_KINDS.map((k, i) => [k, i]));
  items.sort((a, b) => order.get(a.kind)! - order.get(b.kind)! || b.cents - a.cents || (a.id < b.id ? -1 : 1));
  return { value: { basis, items }, figures };
}

// ---------------------------------------------------------------- cutting back

export interface CuttingBackProgress {
  id: Id;
  targetKind: CuttingBackItem["targetKind"];
  targetValue: string;
  label: string;
  startedOn: IsoDate;
  endedOn: IsoDate | null;
  /** Average monthly spend over the `baselineMonths` before starting (null without history). */
  baselineCents: Cents | null;
  baselineMonths: IsoMonth[];
  months: { month: IsoMonth; cents: Cents; wentDown: boolean | null; diffCents: Cents | null }[];
}

/**
 * The cutting-back list tracked month by month (§8): for each item, spending
 * in each month since it was added, against the average before it was added.
 */
export function cuttingBackProgress(
  ledger: Ledger,
  items: readonly CuttingBackItem[],
  throughMonth: IsoMonth,
  baselineMonths: UsualMonths = 3,
): { value: CuttingBackProgress[]; figures: Record<string, Figure> } {
  const figures: Record<string, Figure> = {};
  const first = firstDataMonth(ledger);
  const value = [...items]
    .sort((a, b) => (a.startedOn < b.startedOn ? -1 : a.startedOn > b.startedOn ? 1 : a.id < b.id ? -1 : 1))
    .map((item) => {
      const match = (e: LedgerEntry) =>
        e.bucket === "spending" &&
        (item.targetKind === "merchant" ? e.merchantKey === item.targetValue : e.category === item.targetValue || e.categoryPrimary === item.targetValue);
      const monthSpend = (m: IsoMonth) => inPeriod(ledger.entries, monthStart(m), monthEnd(m)).filter(match);
      const startMonth = monthOf(item.startedOn);
      const basis = usualBasis(startMonth, baselineMonths, first);
      const baseline =
        basis.months.length === 0 ? null : roundDiv(basis.months.reduce((s, m) => s + monthSpend(m).reduce((t, e) => t + spendCents(e), 0), 0), basis.months.length);
      for (const m of basis.months) figures[`${item.id}.baseline.${m}`] = figure(monthSpend(m), measures.spend, `${item.targetValue} · ${m}`);
      const lastMonth = item.endedOn && monthOf(item.endedOn) < throughMonth ? monthOf(item.endedOn) : throughMonth;
      const months: CuttingBackProgress["months"] = [];
      for (let m = startMonth; m <= lastMonth; m = addMonthsToMonth(m, 1)) {
        const f = figure(monthSpend(m), measures.spend, `${item.targetValue} · ${m}`);
        figures[`${item.id}.${m}`] = f;
        months.push({ month: m, cents: f.cents, wentDown: baseline === null ? null : f.cents < baseline, diffCents: baseline === null ? null : f.cents - baseline });
      }
      return {
        id: item.id,
        targetKind: item.targetKind,
        targetValue: item.targetValue,
        label: item.targetKind === "merchant" ? (ledger.merchantNames.get(item.targetValue) ?? item.targetValue) : categoryLabel(item.targetValue),
        startedOn: item.startedOn,
        endedOn: item.endedOn,
        baselineCents: baseline,
        baselineMonths: basis.months,
        months,
      };
    });
  return { value, figures };
}
