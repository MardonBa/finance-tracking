/**
 * Spending breakdowns (§8): by category, per-category monthly series (small
 * multiples), top merchants with trends, the day heatmap, saved by
 * destination account, and necessary / not necessary / not set.
 */
import type { Cents } from "../money.ts";
import type { IsoDate, IsoMonth } from "../dates.ts";
import { addMonthsToMonth, dayOfWeek, eachDay, monthEnd, monthOf, monthStart } from "../dates.ts";
import type { AccountId, Necessity } from "../types.ts";
import type { Figure } from "../registry.ts";
import { accountKind, accountLabel } from "../flows/accounts.ts";
import { categoryLabel } from "../flows/categories.ts";
import { figure, groupBy, inPeriod, measures } from "../flows/figures.ts";
import { spendCents, type Ledger, type LedgerEntry } from "../flows/ledger.ts";
import { firstDataMonth, usualBasis, usualValue, type UsualBasis, type UsualMonths } from "./usual.ts";

const spendingIn = (ledger: Ledger, from: IsoDate, to: IsoDate) =>
  inPeriod(ledger.entries, from, to).filter((e) => e.bucket === "spending");

/** The `count` months ending with `last`, oldest first. */
export function monthsEnding(last: IsoMonth, count: number): IsoMonth[] {
  const out: IsoMonth[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(addMonthsToMonth(last, -i));
  return out;
}

// ---------------------------------------------------------------- by category

export interface CategoryTotal {
  category: string;
  label: string;
  cents: Cents;
  count: number;
}

/**
 * Spending per category for a period. Invariant (tested): the categories add
 * up to total spending.
 */
export function spendingByCategory(
  ledger: Ledger,
  from: IsoDate,
  to: IsoDate,
  level: "primary" | "detailed" = "primary",
): { value: { totalCents: Cents; categories: CategoryTotal[] }; figures: Record<string, Figure> } {
  const entries = spendingIn(ledger, from, to);
  const figures: Record<string, Figure> = { total: figure(entries, measures.spend, `Spending · ${from} – ${to}`) };
  const categories: CategoryTotal[] = [];
  for (const [cat, es] of groupBy(entries, (e) => (level === "primary" ? e.categoryPrimary : e.category))) {
    const f = figure(es, measures.spend, `${categoryLabel(cat)} · ${from} – ${to}`);
    figures[`category.${cat}`] = f;
    categories.push({ category: cat, label: categoryLabel(cat), cents: f.cents, count: new Set(es.map((e) => e.transactionId)).size });
  }
  categories.sort((a, b) => b.cents - a.cents || (a.category < b.category ? -1 : 1));
  return { value: { totalCents: figures.total!.cents, categories }, figures };
}

// ---------------------------------------------------------------- per-category monthly series

export interface CategorySeries {
  category: string;
  label: string;
  months: { month: IsoMonth; cents: Cents }[];
  totalCents: Cents;
  /** Usual for the last month in the range (null with no earlier months). */
  usualCents: Cents | null;
  /** Last month − usual. */
  vsUsualCents: Cents | null;
}

export function categorySeries(
  ledger: Ledger,
  months: readonly IsoMonth[],
  usualMonths: UsualMonths,
): { value: { months: IsoMonth[]; maxCents: Cents; basis: UsualBasis; series: CategorySeries[] }; figures: Record<string, Figure> } {
  const figures: Record<string, Figure> = {};
  const last = months[months.length - 1]!;
  const basis = usualBasis(last, usualMonths, firstDataMonth(ledger));
  const allMonths = [...new Set([...basis.months, ...months])].sort();
  const cats = new Map<string, Map<IsoMonth, Figure>>();
  for (const m of allMonths) {
    for (const [cat, es] of groupBy(spendingIn(ledger, monthStart(m), monthEnd(m)), (e) => e.categoryPrimary)) {
      const byMonth = cats.get(cat) ?? new Map<IsoMonth, Figure>();
      byMonth.set(m, figure(es, measures.spend, `${categoryLabel(cat)} · ${m}`));
      cats.set(cat, byMonth);
    }
  }
  const series: CategorySeries[] = [];
  let max = 0;
  for (const [cat, byMonth] of cats) {
    const points = months.map((m) => ({ month: m, cents: byMonth.get(m)?.cents ?? 0 }));
    if (points.every((p) => p.cents === 0) && !months.some((m) => byMonth.has(m))) continue;
    for (const m of months) {
      const f = byMonth.get(m);
      if (f) figures[`${cat}.${m}`] = f;
    }
    const usual = usualValue(basis, (m) => byMonth.get(m)?.cents ?? 0);
    const lastCents = byMonth.get(last)?.cents ?? 0;
    for (const p of points) max = Math.max(max, p.cents);
    series.push({
      category: cat,
      label: categoryLabel(cat),
      months: points,
      totalCents: points.reduce((s, p) => s + p.cents, 0),
      usualCents: usual,
      vsUsualCents: usual === null ? null : lastCents - usual,
    });
  }
  series.sort((a, b) => b.totalCents - a.totalCents || (a.category < b.category ? -1 : 1));
  return { value: { months: [...months], maxCents: max, basis, series }, figures };
}

// ---------------------------------------------------------------- top merchants

export interface MerchantTrend {
  merchantKey: string;
  name: string;
  totalCents: Cents;
  count: number;
  trend: { month: IsoMonth; cents: Cents }[];
}

export function topMerchants(
  ledger: Ledger,
  from: IsoDate,
  to: IsoDate,
  opts: { limit?: number; trendMonths?: number } = {},
): { value: MerchantTrend[]; figures: Record<string, Figure> } {
  const limit = opts.limit ?? 10;
  const trendMonths = Math.min(12, Math.max(6, opts.trendMonths ?? 12));
  const figures: Record<string, Figure> = {};
  const groups = [...groupBy(spendingIn(ledger, from, to), (e) => e.merchantKey).entries()].map(([key, es]) => ({
    key,
    es,
    fig: figure(es, measures.spend, `${ledger.merchantNames.get(key) ?? key} · ${from} – ${to}`),
  }));
  groups.sort((a, b) => b.fig.cents - a.fig.cents || (a.key < b.key ? -1 : 1));
  const months = monthsEnding(monthOf(to), trendMonths);
  const value = groups.slice(0, limit).map((g) => {
    figures[`${g.key}.total`] = g.fig;
    const trend = months.map((m) => {
      const es = spendingIn(ledger, monthStart(m), monthEnd(m)).filter((e) => e.merchantKey === g.key);
      const f = figure(es, measures.spend, `${ledger.merchantNames.get(g.key) ?? g.key} · ${m}`);
      figures[`${g.key}.${m}`] = f;
      return { month: m, cents: f.cents };
    });
    return {
      merchantKey: g.key,
      name: ledger.merchantNames.get(g.key) ?? g.key,
      totalCents: g.fig.cents,
      count: new Set(g.es.map((e) => e.transactionId)).size,
      trend,
    };
  });
  return { value, figures };
}

// ---------------------------------------------------------------- heatmap

export interface Heatmap {
  days: { date: IsoDate; dayOfWeek: number; cents: Cents; count: number }[];
  /** 0 = Monday … 6 = Sunday. */
  byDayOfWeek: { dayOfWeek: number; cents: Cents; days: number; averageCents: Cents }[];
  maxDayCents: Cents;
}

export function heatmap(ledger: Ledger, from: IsoDate, to: IsoDate): { value: Heatmap; figures: Record<string, Figure> } {
  const figures: Record<string, Figure> = {};
  const byDate = groupBy(spendingIn(ledger, from, to), (e) => e.countDate);
  const dow = Array.from({ length: 7 }, () => ({ es: [] as LedgerEntry[], days: 0 }));
  const days = eachDay(from, to).map((date) => {
    const es = byDate.get(date) ?? [];
    const d = dayOfWeek(date);
    dow[d]!.es.push(...es);
    dow[d]!.days += 1;
    const f = figure(es, measures.spend, `Spending · ${date}`);
    if (es.length > 0) figures[`day.${date}`] = f;
    return { date, dayOfWeek: d, cents: f.cents, count: new Set(es.map((e) => e.transactionId)).size };
  });
  const NAMES = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
  const byDayOfWeek = dow.map((x, i) => {
    const f = figure(x.es, measures.spend, `Spending on ${NAMES[i]} · ${from} – ${to}`);
    figures[`dow.${i}`] = f;
    return { dayOfWeek: i, cents: f.cents, days: x.days, averageCents: x.days === 0 ? 0 : Math.round(f.cents / x.days) };
  });
  return { value: { days, byDayOfWeek, maxDayCents: Math.max(0, ...days.map((d) => d.cents)) }, figures };
}

// ---------------------------------------------------------------- saved by destination

export interface SavedDestination {
  accountId: AccountId;
  name: string;
  kind: "savings" | "investment";
  months: { month: IsoMonth; cents: Cents }[];
  totalCents: Cents;
}

/**
 * Money moved into savings and investment accounts each month, by
 * destination (§8 "How I save"): the net of transfers in and out of each such
 * account. Interest stays income; buys/sells inside a brokerage don't count.
 */
export function savedByDestination(ledger: Ledger, months: readonly IsoMonth[]): { value: SavedDestination[]; figures: Record<string, Figure> } {
  const figures: Record<string, Figure> = {};
  const value: SavedDestination[] = [];
  const isMove = (e: LedgerEntry) => e.bucket === "transfer" && e.bucketReason !== "investment_account";
  for (const acc of [...ledger.accounts.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const kind = accountKind(acc);
    if (kind !== "savings" && kind !== "investment") continue;
    const points = months.map((m) => {
      const es = inPeriod(ledger.entries, monthStart(m), monthEnd(m)).filter((e) => e.accountId === acc.id && isMove(e));
      const f = figure(es, measures.amount, `Saved into ${accountLabel(acc)} · ${m}`);
      figures[`${acc.id}.${m}`] = f;
      return { month: m, cents: f.cents };
    });
    value.push({ accountId: acc.id, name: accountLabel(acc), kind, months: points, totalCents: points.reduce((s, p) => s + p.cents, 0) });
  }
  return { value, figures };
}

// ---------------------------------------------------------------- necessary / not necessary

export type NecessityKey = Necessity | "not_set";
export const NECESSITY_KEYS: readonly NecessityKey[] = ["necessary", "not_necessary", "not_set"];

export function necessitySplit(
  ledger: Ledger,
  from: IsoDate,
  to: IsoDate,
): { value: { totals: Record<NecessityKey, Cents>; byCategory: { category: string; label: string; totals: Record<NecessityKey, Cents> }[] }; figures: Record<string, Figure> } {
  const entries = spendingIn(ledger, from, to);
  const key = (e: LedgerEntry): NecessityKey => e.necessity ?? "not_set";
  const figures: Record<string, Figure> = {};
  const totals = {} as Record<NecessityKey, Cents>;
  for (const k of NECESSITY_KEYS) {
    const f = figure(entries.filter((e) => key(e) === k), measures.spend, `${k.replace("_", " ")} · ${from} – ${to}`);
    figures[k] = f;
    totals[k] = f.cents;
  }
  const byCategory = [...groupBy(entries, (e) => e.categoryPrimary).entries()].map(([cat, es]) => {
    const t = {} as Record<NecessityKey, Cents>;
    for (const k of NECESSITY_KEYS) {
      const f = figure(es.filter((e) => key(e) === k), measures.spend, `${categoryLabel(cat)} · ${k.replace("_", " ")} · ${from} – ${to}`);
      if (f.contributions.length > 0) figures[`${cat}.${k}`] = f;
      t[k] = f.cents;
    }
    return { category: cat, label: categoryLabel(cat), totals: t };
  });
  byCategory.sort((a, b) => (a.category < b.category ? -1 : 1));
  return { value: { totals, byCategory }, figures };
}

export function notNecessaryTrend(ledger: Ledger, months: readonly IsoMonth[]): { value: { month: IsoMonth; cents: Cents; notSetCents: Cents }[]; figures: Record<string, Figure> } {
  const figures: Record<string, Figure> = {};
  const value = months.map((m) => {
    const es = spendingIn(ledger, monthStart(m), monthEnd(m));
    const nn = figure(es.filter((e) => e.necessity === "not_necessary"), measures.spend, `Not necessary · ${m}`);
    const ns = figure(es.filter((e) => e.necessity === null), measures.spend, `Not set · ${m}`);
    figures[`${m}.not_necessary`] = nn;
    figures[`${m}.not_set`] = ns;
    return { month: m, cents: nn.cents, notSetCents: ns.cents };
  });
  return { value, figures };
}

/** Spending of one entry list (helper for other modules). */
export function spendOf(entries: readonly LedgerEntry[]): Cents {
  return entries.reduce((s, e) => s + spendCents(e), 0);
}
