/**
 * Forward projection of net worth and its parts (§12) over 1, 20, 30 or 40
 * years, from editable assumptions and life phases. Deterministic: monthly
 * compounding at the effective monthly rate (1 + annual)^(1/12) − 1, with
 * contributions at the end of each month, so a single phase matches the
 * standard closed form FV = P(1+r)^n + C·((1+r)^n − 1)/r.
 *
 * It is a projection from my own assumptions, not a prediction or advice.
 */
import type { Cents } from "../money.ts";
import { addMonths, parseIsoDate, type IsoDate } from "../dates.ts";
import type { Account, AccountId } from "../types.ts";
import { accountKind } from "../balances/accountKinds.ts";
import type { AccountContribution, ParsedLifePhase, TrajectoryBaseAssumptions } from "./assumptions.ts";

export const PROJECTION_HORIZONS = [1, 20, 30, 40] as const;
export type ProjectionHorizon = (typeof PROJECTION_HORIZONS)[number];

export const PROJECTION_DISCLAIMER = "This is a projection from your own assumptions, not a prediction or financial advice.";
export const ASSUMED_SAME_LABEL = "assumed to stay the same";

export type ProjectionPart = "cash" | "hysa" | "investments" | "debts";

export function partOfAccount(account: Account): ProjectionPart {
  const kind = accountKind(account);
  if (kind === "investment") return "investments";
  if (kind === "savings") return "hysa";
  if (kind === "credit" || kind === "loan") return "debts";
  return "cash";
}

export function monthlyRate(annualPct: number): number {
  return Math.pow(1 + annualPct / 100, 1 / 12) - 1;
}

/** Standard closed form: future value of P plus C per month (end of month) after n months at monthly rate r. */
export function futureValue(principal: number, monthlyContribution: number, r: number, n: number): number {
  if (r === 0) return principal + monthlyContribution * n;
  const g = Math.pow(1 + r, n);
  return principal * g + (monthlyContribution * (g - 1)) / r;
}

export interface YearAssumptions {
  monthlyIncomeCents: Cents;
  monthlySpendingCents: Cents;
  investmentReturnPct: number;
  hysaRatePct: number;
  cashRatePct: number;
  inflationPct: number;
  contributions: AccountContribution[];
}

export interface YearBasis {
  year: number;
  kind: "current" | "phase" | "assumed_same";
  phaseName: string | null;
  label: string;
  assumptions: YearAssumptions;
}

/**
 * Which assumptions apply to each calendar year. The first year uses my
 * current habits (unless a phase covers it); a year covered by a phase uses
 * that phase on top of what came before; a year with no phase carries the
 * last assumptions forward, labelled "assumed to stay the same".
 */
export function resolveYears(
  base: YearAssumptions,
  phases: readonly ParsedLifePhase[],
  firstYear: number,
  lastYear: number,
): YearBasis[] {
  const sorted = [...phases].sort((a, b) => a.fromYear - b.fromYear);
  const out: YearBasis[] = [];
  let current = base;
  for (let y = firstYear; y <= lastYear; y++) {
    const phase = sorted.find((p) => p.fromYear <= y && y <= p.toYear);
    if (phase) {
      const income = phase.monthlyIncomeCents ?? current.monthlyIncomeCents;
      let spending = phase.monthlySpendingCents ?? current.monthlySpendingCents;
      if (phase.savingsRatePct !== null && phase.monthlySpendingCents === null) {
        spending = Math.round(income * (1 - phase.savingsRatePct / 100));
      }
      current = {
        monthlyIncomeCents: income,
        monthlySpendingCents: spending,
        investmentReturnPct: phase.investmentReturnPct ?? current.investmentReturnPct,
        hysaRatePct: phase.hysaRatePct ?? current.hysaRatePct,
        cashRatePct: current.cashRatePct,
        inflationPct: phase.inflationPct ?? current.inflationPct,
        contributions: phase.contributions ?? current.contributions,
      };
      out.push({ year: y, kind: "phase", phaseName: phase.name, label: phase.name, assumptions: current });
    } else if (y === firstYear) {
      out.push({ year: y, kind: "current", phaseName: null, label: "Current habits", assumptions: current });
    } else {
      out.push({ year: y, kind: "assumed_same", phaseName: null, label: ASSUMED_SAME_LABEL, assumptions: current });
    }
  }
  return out;
}

export interface ProjectionParts {
  cash: Cents;
  hysa: Cents;
  investments: Cents;
  debts: Cents;
}

export interface ProjectionPoint {
  monthIndex: number;
  date: IsoDate;
  year: number;
  parts: ProjectionParts;
  totalCents: Cents;
  lowCents: Cents;
  highCents: Cents;
  basisKind: YearBasis["kind"];
  basisLabel: string;
}

export interface ProjectionResult {
  horizonYears: number;
  dollars: "future" | "today";
  points: ProjectionPoint[];
  years: YearBasis[];
  /** First year whose numbers rest on "assumed to stay the same". */
  assumedSameFromYear: number | null;
  returnRange: { lowPct: number; expectedPct: number; highPct: number };
  disclaimer: string;
}

export interface ProjectionInput {
  today: IsoDate;
  horizonYears: number;
  dollars: "future" | "today";
  /** Starting balances by part (debts negative). */
  start: ProjectionParts;
  /** Which part each account belongs to, for its contributions. */
  partByAccount: Record<AccountId, ProjectionPart>;
  base: TrajectoryBaseAssumptions;
  /** Usual monthly income/spending (§8), used where the base leaves them null. */
  usualMonthlyIncomeCents: Cents;
  usualMonthlySpendingCents: Cents;
  phases: readonly ParsedLifePhase[];
}

function simulate(input: ProjectionInput, years: readonly YearBasis[], returnOffsetPct: number) {
  const months = input.horizonYears * 12;
  const p = { cash: input.start.cash, hysa: input.start.hysa, investments: input.start.investments, debts: input.start.debts };
  let deflator = 1;
  const rows: Array<{ parts: typeof p; deflator: number }> = [{ parts: { ...p }, deflator }];
  for (let m = 1; m <= months; m++) {
    const year = parseIsoDate(addMonths(input.today, m)).year;
    const a = (years.find((y) => y.year === year) ?? years.at(-1)!).assumptions;
    let toInvest = 0;
    let toHysa = 0;
    for (const c of a.contributions) {
      const part = input.partByAccount[c.accountId];
      if (part === "investments") toInvest += c.monthlyCents;
      else if (part === "hysa") toHysa += c.monthlyCents;
    }
    const leftover = a.monthlyIncomeCents - a.monthlySpendingCents - toInvest - toHysa;
    p.investments = p.investments * (1 + monthlyRate(a.investmentReturnPct + returnOffsetPct)) + toInvest;
    p.hysa = p.hysa * (1 + monthlyRate(a.hysaRatePct)) + toHysa;
    p.cash = p.cash * (1 + monthlyRate(a.cashRatePct)) + leftover;
    deflator *= 1 + monthlyRate(a.inflationPct);
    rows.push({ parts: { ...p }, deflator });
  }
  return rows;
}

export function projectNetWorth(input: ProjectionInput): ProjectionResult {
  const firstYear = parseIsoDate(input.today).year;
  const lastYear = parseIsoDate(addMonths(input.today, input.horizonYears * 12)).year;
  const base: YearAssumptions = {
    monthlyIncomeCents: input.base.monthlyIncomeCents ?? input.usualMonthlyIncomeCents,
    monthlySpendingCents: input.base.monthlySpendingCents ?? input.usualMonthlySpendingCents,
    investmentReturnPct: input.base.investmentReturnPct,
    hysaRatePct: input.base.hysaRatePct,
    cashRatePct: input.base.cashRatePct,
    inflationPct: input.base.inflationPct,
    contributions: input.base.contributions,
  };
  const years = resolveYears(base, input.phases, firstYear, lastYear);
  const range = input.base.rangePct;
  const expected = simulate(input, years, 0);
  const low = simulate(input, years, -range);
  const high = simulate(input, years, range);
  const total = (x: ProjectionParts) => x.cash + x.hysa + x.investments + x.debts;
  const points: ProjectionPoint[] = [];
  for (let m = 0; m <= input.horizonYears * 12; m++) {
    // Monthly detail for a 1-year horizon, yearly points otherwise.
    if (input.horizonYears > 1 && m % 12 !== 0) continue;
    const e = expected[m]!;
    const f = input.dollars === "today" ? e.deflator : 1;
    const date = addMonths(input.today, m);
    const year = parseIsoDate(date).year;
    const basis = years.find((y) => y.year === year)!;
    const parts = {
      cash: Math.round(e.parts.cash / f),
      hysa: Math.round(e.parts.hysa / f),
      investments: Math.round(e.parts.investments / f),
      debts: Math.round(e.parts.debts / f),
    };
    points.push({
      monthIndex: m,
      date,
      year,
      parts,
      totalCents: parts.cash + parts.hysa + parts.investments + parts.debts,
      lowCents: Math.round(total(low[m]!.parts) / f),
      highCents: Math.round(total(high[m]!.parts) / f),
      basisKind: m === 0 ? "current" : basis.kind,
      basisLabel: m === 0 ? "Today" : basis.label,
    });
  }
  const assumed = years.find((y) => y.kind === "assumed_same");
  return {
    horizonYears: input.horizonYears,
    dollars: input.dollars,
    points,
    years,
    assumedSameFromYear: assumed?.year ?? null,
    returnRange: { lowPct: input.base.investmentReturnPct - range, expectedPct: input.base.investmentReturnPct, highPct: input.base.investmentReturnPct + range },
    disclaimer: PROJECTION_DISCLAIMER,
  };
}

/** Starting balances by part and the part of each account, from current balances. */
export function startingParts(accounts: readonly Account[]): { start: ProjectionParts; partByAccount: Record<AccountId, ProjectionPart> } {
  const start: ProjectionParts = { cash: 0, hysa: 0, investments: 0, debts: 0 };
  const partByAccount: Record<AccountId, ProjectionPart> = {};
  for (const a of accounts) {
    const part = partOfAccount(a);
    partByAccount[a.id] = part;
    start[part] += a.currentBalanceCents ?? 0;
  }
  return { start, partByAccount };
}
