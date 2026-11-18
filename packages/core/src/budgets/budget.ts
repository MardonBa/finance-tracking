/**
 * Budgets (§10, decision 004 addendum): one overall amount per period with
 * parts inside it.
 *
 * - Each spending entry counts toward AT MOST ONE part. Priority: a trip
 *   (tag + its dates) → a part targeting one of its tags → a part targeting
 *   its merchant → a part targeting its category (detailed or broad) →
 *   "Everything else". Within a level, parts go in `position` order.
 * - Trip spending counts in the month's OVERALL total as a "Trip: $X this
 *   month" line, never in a monthly part.
 * - "Everything else" = overall − sum of parts; if the parts add up to more
 *   than the overall the result says so.
 * - No carryover: each period is computed on its own (decision 004). The plan
 *   (amount and parts) applies to later periods until changed.
 * - Pending charges are reported separately (shown faded) and never counted
 *   in spent, pace or projection (decision 005).
 */
import type { Cents } from "../money.ts";
import { Money } from "../money.ts";
import type { IsoDate } from "../dates.ts";
import { isWithin, monthOf } from "../dates.ts";
import type { Budget, BudgetAmount, BudgetPart, BudgetPartTarget, CoreData, Id, Trip } from "../types.ts";
import type { Figure } from "../registry.ts";
import { figure, measures } from "../flows/figures.ts";
import { type Ledger, type LedgerEntry } from "../flows/ledger.ts";
import { currentPeriod, elapsedDays, periodDays, shiftPeriod, type Period } from "./periods.ts";

export type BudgetData = Pick<CoreData, "budgets" | "budgetAmounts" | "budgetParts" | "budgetPartTargets" | "trips" | "tags">;

export const BUDGET_NEEDS = ["budgets", "budgetAmounts", "budgetParts", "budgetPartTargets", "trips", "tags"] as const satisfies readonly (keyof CoreData)[];

/** The overall amount for a period: the latest amount effective by its start (else the first one starting inside it). */
export function amountForPeriod(amounts: readonly BudgetAmount[], budgetId: Id, period: Period): Cents | null {
  const own = amounts.filter((a) => a.budgetId === budgetId).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
  let best: BudgetAmount | null = null;
  for (const a of own) if (a.effectiveFrom <= period.start) best = a;
  if (!best) best = own.find((a) => a.effectiveFrom <= period.end) ?? null;
  return best?.amountCents ?? null;
}

/** Parts active in a period; if two versions of one part (same name) overlap, the newer wins. */
export function partsForPeriod(parts: readonly BudgetPart[], budgetId: Id, period: Period): BudgetPart[] {
  const active = parts.filter(
    (p) => p.budgetId === budgetId && p.effectiveFrom <= period.end && (p.effectiveTo === null || p.effectiveTo >= period.start),
  );
  const byName = new Map<string, BudgetPart>();
  for (const p of active) {
    const cur = byName.get(p.name);
    if (!cur || p.effectiveFrom > cur.effectiveFrom || (p.effectiveFrom === cur.effectiveFrom && p.id > cur.id)) byName.set(p.name, p);
  }
  return [...byName.values()].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1));
}

export type Assignment = { kind: "trip"; tripId: Id } | { kind: "part"; partId: Id } | { kind: "everything_else" };

/** Which single line an entry counts toward. */
export function assignEntry(
  e: LedgerEntry,
  parts: readonly BudgetPart[],
  targets: readonly BudgetPartTarget[],
  trips: readonly Trip[],
): Assignment {
  for (const t of [...trips].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (e.tagIds.includes(t.tagId) && isWithin(e.countDate, t.startDate, t.endDate)) return { kind: "trip", tripId: t.id };
  }
  const targetsOf = (p: BudgetPart, kind: BudgetPartTarget["targetKind"]) =>
    targets.filter((t) => t.partId === p.id && t.targetKind === kind).map((t) => t.targetValue);
  for (const p of parts) if (targetsOf(p, "tag").some((tag) => e.tagIds.includes(tag))) return { kind: "part", partId: p.id };
  for (const p of parts) if (targetsOf(p, "merchant").includes(e.merchantKey)) return { kind: "part", partId: p.id };
  for (const p of parts) {
    const cats = targetsOf(p, "category");
    if (cats.includes(e.category) || cats.includes(e.categoryPrimary)) return { kind: "part", partId: p.id };
  }
  return { kind: "everything_else" };
}

export type BarStatus = "on_pace" | "ahead_of_pace" | "over" | "under" | "no_plan";

export interface BudgetBar {
  id: string;
  kind: "overall" | "part" | "everything_else" | "trip";
  name: string;
  /** Null for a trip line inside a month (trips have no monthly amount). */
  plannedCents: Cents | null;
  spentCents: Cents;
  /** Shown faded after `spent`; never counted. */
  pendingCents: Cents;
  /** Where spending "should" be by today: planned × elapsed share. */
  paceCents: Cents | null;
  /** Spent so far, extended linearly to the period end. */
  projectedCents: Cents;
  remainingCents: Cents | null;
  status: BarStatus;
  /** Keys into `figures`. */
  figures: { spent: string; pending: string };
}

function bar(
  id: string,
  kind: BudgetBar["kind"],
  name: string,
  planned: Cents | null,
  spent: Figure,
  pending: Figure,
  period: Period,
  today: IsoDate,
  keys: { spent: string; pending: string },
): BudgetBar {
  const total = periodDays(period);
  const elapsed = elapsedDays(period, today);
  const pace = planned === null ? null : Math.round((planned * elapsed) / total);
  const projected = elapsed === 0 ? spent.cents : Math.round((spent.cents * total) / elapsed);
  const ended = today > period.end;
  let status: BarStatus;
  if (planned === null) status = "no_plan";
  else if (spent.cents > planned) status = "over";
  else if (ended) status = "under";
  else if (pace !== null && spent.cents > pace) status = "ahead_of_pace";
  else status = "on_pace";
  return {
    id,
    kind,
    name,
    plannedCents: planned,
    spentCents: spent.cents,
    pendingCents: pending.cents,
    paceCents: pace,
    projectedCents: projected,
    remainingCents: planned === null ? null : Money.sub(planned, spent.cents),
    status,
    figures: keys,
  };
}

export interface BudgetPeriodView {
  budgetId: Id;
  name: string;
  period: Period;
  overall: BudgetBar;
  parts: BudgetBar[];
  everythingElse: BudgetBar;
  /** "Trip: $X this month" lines (counted in overall, not in parts). */
  trips: BudgetBar[];
  partsTotalCents: Cents;
  /** True when the parts add up to more than the overall amount. */
  partsExceedOverall: boolean;
  partsExcessCents: Cents;
}

export function budgetPeriodView(
  ledger: Ledger,
  data: BudgetData,
  budget: Budget,
  period: Period,
  today: IsoDate,
): { value: BudgetPeriodView; figures: Record<string, Figure> } {
  const parts = partsForPeriod(data.budgetParts, budget.id, period);
  const amount = amountForPeriod(data.budgetAmounts, budget.id, period);
  const inP = ledger.entries.filter((e) => e.bucket === "spending" && isWithin(e.countDate, period.start, period.end));
  const cleared = inP.filter((e) => !e.pending);
  const pending = inP.filter((e) => e.pending);
  const assign = new Map(inP.map((e) => [e.key, assignEntry(e, parts, data.budgetPartTargets, data.trips)]));
  const label = `${period.start} – ${period.end}`;
  const figures: Record<string, Figure> = {};
  const lineFigs = (key: string, name: string, pick: (a: Assignment) => boolean) => {
    const spent = figure(cleared.filter((e) => pick(assign.get(e.key)!)), measures.spend, `${name} · ${label}`);
    const pend = figure(pending.filter((e) => pick(assign.get(e.key)!)), measures.spend, `${name} · pending · ${label}`);
    figures[`${key}.spent`] = spent;
    figures[`${key}.pending`] = pend;
    return { spent, pend, keys: { spent: `${key}.spent`, pending: `${key}.pending` } };
  };

  const o = lineFigs("overall", budget.name, () => true);
  const overall = bar("overall", "overall", budget.name, amount, o.spent, o.pend, period, today, o.keys);
  const partBars = parts.map((p) => {
    const f = lineFigs(`part.${p.id}`, p.name, (a) => a.kind === "part" && a.partId === p.id);
    return bar(p.id, "part", p.name, p.expectedCents, f.spent, f.pend, period, today, f.keys);
  });
  const partsTotal = Money.sum(parts.map((p) => p.expectedCents));
  const elsePlanned = amount === null ? null : Money.sub(amount, partsTotal);
  const ee = lineFigs("everythingElse", "Everything else", (a) => a.kind === "everything_else");
  const everythingElse = bar("everything_else", "everything_else", "Everything else", elsePlanned, ee.spent, ee.pend, period, today, ee.keys);
  const tripIds = [...new Set([...assign.values()].flatMap((a) => (a.kind === "trip" ? [a.tripId] : [])))].sort();
  const trips = tripIds.map((id) => {
    const trip = data.trips.find((t) => t.id === id)!;
    const f = lineFigs(`trip.${id}`, `Trip: ${trip.name}`, (a) => a.kind === "trip" && a.tripId === id);
    return bar(id, "trip", `Trip: ${trip.name}`, null, f.spent, f.pend, period, today, f.keys);
  });
  return {
    value: {
      budgetId: budget.id,
      name: budget.name,
      period,
      overall,
      parts: partBars,
      everythingElse,
      trips,
      partsTotalCents: partsTotal,
      partsExceedOverall: amount !== null && partsTotal > amount,
      partsExcessCents: amount !== null && partsTotal > amount ? partsTotal - amount : 0,
    },
    figures,
  };
}

export function currentBudgetView(ledger: Ledger, data: BudgetData, budget: Budget, today: IsoDate) {
  return budgetPeriodView(ledger, data, budget, currentPeriod(budget, today), today);
}

// ---------------------------------------------------------------- planned vs actual, history, track record

export interface PlanCell {
  period: Period;
  plannedCents: Cents | null;
  actualCents: Cents;
  /** actual − planned (positive = over). */
  diffCents: Cents | null;
  /** diff / planned, null without a plan or with a zero plan. Not money. */
  diffRatio: number | null;
  within: boolean | null;
  figure: string;
}

export interface PlanRow {
  id: string;
  kind: "overall" | "part" | "everything_else";
  name: string;
  cells: PlanCell[];
  track: {
    periods: number;
    withinCount: number;
    /** Average of diffCents over periods with a plan (positive = usually over). */
    averageDiffCents: Cents | null;
  };
}

function cell(period: Period, b: BudgetBar, figureKey: string): PlanCell {
  const diff = b.plannedCents === null ? null : b.spentCents - b.plannedCents;
  return {
    period,
    plannedCents: b.plannedCents,
    actualCents: b.spentCents,
    diffCents: diff,
    diffRatio: diff === null || !b.plannedCents ? null : diff / b.plannedCents,
    within: b.plannedCents === null ? null : b.spentCents <= b.plannedCents,
    figure: figureKey,
  };
}

/**
 * Planned vs actual per row (overall, each part by name, everything else)
 * for the `count` periods ending with the one containing `endDate`, oldest
 * first; plus the track record over those periods. Rows group part versions
 * by name, so editing a part's amount keeps one history row.
 */
export function budgetHistory(
  ledger: Ledger,
  data: BudgetData,
  budget: Budget,
  endDate: IsoDate,
  count: number,
  today: IsoDate,
): { value: { periods: Period[]; rows: PlanRow[] }; figures: Record<string, Figure> } {
  const last = currentPeriod(budget, endDate);
  const periods: Period[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const p = shiftPeriod(budget, last, -i);
    if (p) periods.push(p);
  }
  const figures: Record<string, Figure> = {};
  const rows = new Map<string, PlanRow>();
  const rowFor = (id: string, kind: PlanRow["kind"], name: string) => {
    let r = rows.get(id);
    if (!r) {
      r = { id, kind, name, cells: [], track: { periods: 0, withinCount: 0, averageDiffCents: null } };
      rows.set(id, r);
    }
    return r;
  };
  periods.forEach((period, i) => {
    const { value: v, figures: f } = budgetPeriodView(ledger, data, budget, period, today);
    const put = (key: string, fig: Figure | undefined) => {
      const k = `${i}.${key}`;
      if (fig) figures[k] = fig;
      return k;
    };
    rowFor("overall", "overall", budget.name).cells.push(cell(period, v.overall, put("overall", f["overall.spent"])));
    for (const b of v.parts) rowFor(`part:${b.name}`, "part", b.name).cells.push(cell(period, b, put(`part.${b.id}`, f[`part.${b.id}.spent`])));
    rowFor("everything_else", "everything_else", "Everything else").cells.push(
      cell(period, v.everythingElse, put("everythingElse", f["everythingElse.spent"])),
    );
  });
  for (const r of rows.values()) {
    // The track record only counts finished periods with a plan.
    const done = r.cells.filter((c) => c.plannedCents !== null && c.period.end < today);
    r.track.periods = done.length;
    r.track.withinCount = done.filter((c) => c.within).length;
    r.track.averageDiffCents = done.length === 0 ? null : Math.round(done.reduce((s, c) => s + c.diffCents!, 0) / done.length);
  }
  const order = { overall: 0, part: 1, everything_else: 2 };
  return {
    value: { periods, rows: [...rows.values()].sort((a, b) => order[a.kind] - order[b.kind]) },
    figures,
  };
}

// ---------------------------------------------------------------- trips

export interface TripView {
  tripId: Id;
  name: string;
  startDate: IsoDate;
  endDate: IsoDate;
  bar: BudgetBar;
  /** Trip spending per calendar month (what each month's "Trip: $X" line shows). */
  byMonth: { month: string; cents: Cents }[];
}

export function tripView(ledger: Ledger, trip: Trip, today: IsoDate): { value: TripView; figures: Record<string, Figure> } {
  const period = { start: trip.startDate, end: trip.endDate };
  const tagged = ledger.entries.filter(
    (e) => e.bucket === "spending" && e.tagIds.includes(trip.tagId) && isWithin(e.countDate, trip.startDate, trip.endDate),
  );
  const spent = figure(tagged.filter((e) => !e.pending), measures.spend, `Trip: ${trip.name}`);
  const pending = figure(tagged.filter((e) => e.pending), measures.spend, `Trip: ${trip.name} · pending`);
  const figures: Record<string, Figure> = { spent, pending };
  const months = new Map<string, LedgerEntry[]>();
  for (const e of tagged.filter((x) => !x.pending)) {
    const m = monthOf(e.countDate);
    months.set(m, [...(months.get(m) ?? []), e]);
  }
  const byMonth = [...months.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([month, es]) => {
      const f = figure(es, measures.spend, `Trip: ${trip.name} · ${month}`);
      figures[`month.${month}`] = f;
      return { month, cents: f.cents };
    });
  return {
    value: {
      tripId: trip.id,
      name: trip.name,
      startDate: trip.startDate,
      endDate: trip.endDate,
      bar: bar(trip.id, "trip", trip.name, trip.expectedCents, spent, pending, period, today, { spent: "spent", pending: "pending" }),
      byMonth,
    },
    figures,
  };
}
