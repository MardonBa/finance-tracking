/**
 * "Am I on track?" math for goals (§11): deadline needs, expected
 * contributions per period, the recent contribution rate, projected
 * completion dates and what-if scenarios.
 */
import { Money, type Cents } from "../money.ts";
import {
  addDays,
  addMonths,
  diffDays,
  endOfMonth,
  endOfWeek,
  parseIsoDate,
  startOfMonth,
  startOfWeek,
  type IsoDate,
} from "../dates.ts";
import type { AccountId, BalanceSnapshot, ContributionPeriod, Id } from "../types.ts";
import { allocate, allocatedFor, byPriority, type AllocGoal } from "./allocation.ts";

/** Average days in a month, for "per month" rates. */
export const DAYS_PER_MONTH = 365.25 / 12;

/** Window for "recent contribution rate". */
// TODO(revisit): 3 months is a default; success-criteria §11 doesn't fix it.
export const RECENT_RATE_MONTHS = 3;

/** How many completed periods "recent periods" shows next to the current one. */
// TODO(revisit): 3 recent periods is a default.
export const RECENT_PERIODS = 3;

/** A function giving an account's balance at the end of a day, or null when unknown. */
export type BalanceOn = (date: IsoDate) => Cents | null;

/**
 * Account balance lookup from snapshots: today (and later) is the current
 * balance; earlier days use the latest snapshot on or before that day.
 */
export function balanceLookup(
  snapshots: readonly BalanceSnapshot[],
  accountId: AccountId,
  today: IsoDate,
  currentBalanceCents: Cents | null,
): BalanceOn {
  const own = snapshots.filter((s) => s.accountId === accountId).sort((a, b) => (a.date < b.date ? -1 : 1));
  return (date) => {
    if (date >= today && currentBalanceCents !== null) return currentBalanceCents;
    let found: Cents | null = null;
    for (const s of own) {
      if (s.date > date) break;
      found = s.balanceCents;
    }
    return found;
  };
}

/** What a goal held on `date`, using today's goals and priorities. Null when the balance is unknown. */
export function savedOn(balanceOn: BalanceOn, protectedCents: Cents, goals: readonly AllocGoal[], goalId: Id, date: IsoDate): Cents | null {
  const b = balanceOn(date);
  if (b === null) return null;
  return allocatedFor(allocate(b, protectedCents, goals), goalId);
}

// ---------------------------------------------------------------- deadline

export interface DeadlineStatus {
  deadline: IsoDate;
  remainingCents: Cents;
  daysLeft: number;
  overdue: boolean;
  /** Needed per month from now to hit the deadline (all of it when under a month is left). */
  neededPerMonthCents: Cents;
  /** Where a straight line from the start to the target says I should be today. */
  onTrackCents: Cents;
  /** Positive = ahead of the straight line, negative = behind. */
  aheadCents: Cents;
  label: string;
}

export function deadlineStatus(input: {
  targetCents: Cents;
  savedCents: Cents;
  deadline: IsoDate;
  today: IsoDate;
  /** When saving for the goal started (its creation day). */
  startDate: IsoDate;
  /** What the goal held on the start date. */
  startSavedCents?: Cents;
}): DeadlineStatus {
  const { targetCents, savedCents, deadline, today } = input;
  const startSaved = Math.min(input.startSavedCents ?? 0, targetCents);
  const remaining = Math.max(0, targetCents - savedCents);
  const daysLeft = diffDays(today, deadline);
  const monthsLeft = daysLeft / DAYS_PER_MONTH;
  const neededPerMonthCents = remaining === 0 ? 0 : monthsLeft <= 1 ? remaining : Math.ceil(remaining / monthsLeft);
  const totalDays = diffDays(input.startDate, deadline);
  const elapsed = Math.min(Math.max(diffDays(input.startDate, today), 0), Math.max(totalDays, 0));
  const onTrackCents = totalDays <= 0 ? targetCents : startSaved + Math.round(((targetCents - startSaved) * elapsed) / totalDays);
  const aheadCents = savedCents - onTrackCents;
  const { month, day, year } = parseIsoDate(deadline);
  const when = `${MONTHS[month - 1]} ${day}, ${year}`;
  let label: string;
  if (remaining === 0) label = `Reached · deadline ${when}`;
  else {
    const pos = aheadCents >= 0 ? `${Money.format(aheadCents, { noCents: true })} ahead` : `${Money.format(-aheadCents, { noCents: true })} behind`;
    label = daysLeft < 0 ? `${pos} · deadline ${when} has passed` : `${pos} · need ${Money.format(neededPerMonthCents, { noCents: true })}/month to hit ${when}`;
  }
  return { deadline, remainingCents: remaining, daysLeft, overdue: daysLeft < 0 && remaining > 0, neededPerMonthCents, onTrackCents, aheadCents, label };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortDate(date: IsoDate): string {
  const { month, day } = parseIsoDate(date);
  return `${MONTHS[month - 1]} ${day}`;
}

// ---------------------------------------------------------------- expected contribution

export interface PeriodContribution {
  start: IsoDate;
  end: IsoDate;
  isCurrent: boolean;
  expectedCents: Cents;
  /** Change in what the goal holds over the period (to today for the current one); null when unknown. */
  actualCents: Cents | null;
  met: boolean | null;
  label: string;
}

export function periodBounds(period: ContributionPeriod, date: IsoDate): { start: IsoDate; end: IsoDate } {
  if (period === "weekly") return { start: startOfWeek(date), end: endOfWeek(date) };
  if (period === "monthly") return { start: startOfMonth(date), end: endOfMonth(date) };
  const y = date.slice(0, 4);
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

function previousPeriodStart(period: ContributionPeriod, start: IsoDate): IsoDate {
  if (period === "weekly") return addDays(start, -7);
  if (period === "monthly") return addMonths(start, -1);
  return addMonths(start, -12);
}

const PERIOD_WORD: Record<ContributionPeriod, string> = { weekly: "this week", monthly: "this month", yearly: "this year" };

/**
 * Actual vs expected for the current period and the `RECENT_PERIODS`
 * before it. `saved(date)` is what the goal held at the end of `date`.
 */
export function contributionStatus(input: {
  expectedCents: Cents;
  period: ContributionPeriod;
  today: IsoDate;
  saved: (date: IsoDate) => Cents | null;
  recentPeriods?: number;
}): PeriodContribution[] {
  const out: PeriodContribution[] = [];
  let { start, end } = periodBounds(input.period, input.today);
  for (let i = 0; i <= (input.recentPeriods ?? RECENT_PERIODS); i++) {
    const isCurrent = i === 0;
    const until = isCurrent ? input.today : end;
    const a = input.saved(addDays(start, -1));
    const b = input.saved(until);
    const actual = a === null || b === null ? null : b - a;
    const word = isCurrent ? PERIOD_WORD[input.period] : `${shortDate(start)}–${shortDate(end)}`;
    out.push({
      start,
      end,
      isCurrent,
      expectedCents: input.expectedCents,
      actualCents: actual,
      met: actual === null ? null : actual >= input.expectedCents,
      label: actual === null ? `? of ${Money.format(input.expectedCents, { noCents: true })} ${word}` : `${Money.format(actual, { noCents: true })} of ${Money.format(input.expectedCents, { noCents: true })} ${word}`,
    });
    start = previousPeriodStart(input.period, start);
    end = periodBounds(input.period, start).end;
  }
  return out;
}

// ---------------------------------------------------------------- rates and projections

/**
 * Average monthly change of a value over the last `months` months (or since
 * `notBefore`). Null when there isn't at least a week of history.
 */
export function recentMonthlyRate(
  valueOn: (date: IsoDate) => Cents | null,
  today: IsoDate,
  opts: { months?: number; notBefore?: IsoDate } = {},
): Cents | null {
  let from = addMonths(today, -(opts.months ?? RECENT_RATE_MONTHS));
  if (opts.notBefore && opts.notBefore > from) from = opts.notBefore;
  let start = valueOn(from);
  // When there's no value that far back, start from the first known day.
  let d = from;
  while (start === null && d < today) {
    d = addDays(d, 1);
    start = valueOn(d);
  }
  const end = valueOn(today);
  if (start === null || end === null) return null;
  const days = diffDays(d, today);
  if (days < 7) return null;
  return Math.round(((end - start) * DAYS_PER_MONTH) / days);
}

export interface GoalProjection {
  goalId: Id;
  /** Null when the money isn't growing at the recent rate. */
  projectedDate: IsoDate | null;
  alreadyComplete: boolean;
  reason: string;
}

/**
 * Projected completion of every goal on one account if the account keeps
 * growing by `monthlyRateCents`: money fills goals in order, so goal g is
 * done when the balance reaches protected + the targets up to and
 * including g (earlier goals finishing speeds up later ones).
 */
export function projectCompletion(input: {
  balanceCents: Cents;
  protectedCents: Cents;
  goals: readonly AllocGoal[];
  order?: readonly Id[];
  monthlyRateCents: Cents | null;
  today: IsoDate;
}): GoalProjection[] {
  const ordered = input.order
    ? input.order.map((id) => input.goals.find((g) => g.id === id)).filter((g): g is AllocGoal => !!g)
    : byPriority(input.goals);
  let cum = Math.max(input.protectedCents, 0);
  return ordered.map((g) => {
    cum += Math.max(g.targetCents, 0);
    if (input.balanceCents >= cum) return { goalId: g.id, projectedDate: input.today, alreadyComplete: true, reason: "Fully funded." };
    const rate = input.monthlyRateCents;
    if (rate === null || rate <= 0) {
      return { goalId: g.id, projectedDate: null, alreadyComplete: false, reason: "The account isn't growing at the recent rate, so there's no projected date." };
    }
    const months = (cum - input.balanceCents) / rate;
    return {
      goalId: g.id,
      projectedDate: addDays(input.today, Math.ceil(months * DAYS_PER_MONTH)),
      alreadyComplete: false,
      reason: `At ${Money.format(rate, { noCents: true })}/month into the account, filled in priority order.`,
    };
  });
}

/** "Target Mar 1 · projected Apr 12": both dates when the projection is later than the deadline. */
export function projectionLabel(projectedDate: IsoDate | null, deadline: IsoDate | null): { showBoth: boolean; label: string } {
  if (projectedDate === null) return { showBoth: deadline !== null, label: deadline ? `Target ${shortDate(deadline)} · no projected date` : "No projected date" };
  if (deadline && projectedDate > deadline) return { showBoth: true, label: `Target ${shortDate(deadline)} · projected ${shortDate(projectedDate)}` };
  return { showBoth: false, label: `Projected ${shortDate(projectedDate)}` };
}

export interface WhatIfResult {
  baseline: GoalProjection[];
  scenario: GoalProjection[];
  /** Days earlier (negative) or later (positive) per goal; null when either has no date. */
  shiftDays: Record<Id, number | null>;
  scenarioAllocation: ReturnType<typeof allocate>;
}

/** What-if: change the monthly contribution and/or the priority order and see new projections. */
export function whatIf(
  base: { balanceCents: Cents; protectedCents: Cents; goals: readonly AllocGoal[]; monthlyRateCents: Cents | null; today: IsoDate },
  change: { contributionDeltaCents?: Cents; order?: readonly Id[] },
): WhatIfResult {
  const baseline = projectCompletion(base);
  const rate = base.monthlyRateCents === null && !change.contributionDeltaCents ? null : (base.monthlyRateCents ?? 0) + (change.contributionDeltaCents ?? 0);
  const scenario = projectCompletion({ ...base, monthlyRateCents: rate, order: change.order });
  const shiftDays: Record<Id, number | null> = {};
  for (const s of scenario) {
    const b = baseline.find((x) => x.goalId === s.goalId)!;
    shiftDays[s.goalId] = s.projectedDate && b.projectedDate ? diffDays(b.projectedDate, s.projectedDate) : null;
  }
  return { baseline, scenario, shiftDays, scenarioAllocation: allocate(base.balanceCents, base.protectedCents, base.goals, change.order) };
}
