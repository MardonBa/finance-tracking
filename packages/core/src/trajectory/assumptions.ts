/**
 * Editable projection assumptions (§12) and life phases. The base set is
 * stored as JSON in the singleton `trajectoryAssumptions` row; phases are
 * rows of `lifePhases`.
 */
import { z } from "zod";
import { centsSchema, idSchema } from "../schemas.ts";
import type { LifePhase, TrajectoryAssumptionsRow } from "../types.ts";

export const ASSUMPTIONS_ROW_ID = "default";

export const contributionSchema = z.object({ accountId: idSchema, monthlyCents: centsSchema });
export type AccountContribution = z.infer<typeof contributionSchema>;

const pct = (min: number, max: number) => z.number().finite().min(min).max(max);

export const trajectoryBaseAssumptionsSchema = z.object({
  /** Expected annual return on investments, percent. */
  investmentReturnPct: pct(-50, 50),
  /** HYSA (savings accounts) annual interest rate, percent. */
  hysaRatePct: pct(0, 30),
  /** Interest on checking/cash, percent (usually 0). */
  cashRatePct: pct(0, 30),
  /** Annual inflation for the today's-dollars toggle, percent. */
  inflationPct: pct(-10, 30),
  /** Null = use my recent "usual" income (§8). */
  monthlyIncomeCents: centsSchema.nullable(),
  /** Null = use my recent "usual" spending (§8). */
  monthlySpendingCents: centsSchema.nullable(),
  /** How much goes into each account per month (investments, HYSA…). */
  contributions: z.array(contributionSchema),
  /** Width of the lower/higher range, in percentage points of return. */
  rangePct: pct(0, 20),
});
export type TrajectoryBaseAssumptions = z.infer<typeof trajectoryBaseAssumptionsSchema>;

// TODO(revisit): default assumptions (7% return, 4% HYSA, 3% inflation, ±2 points range); §12 Open asks for the range width.
export const DEFAULT_ASSUMPTIONS: TrajectoryBaseAssumptions = {
  investmentReturnPct: 7,
  hysaRatePct: 4,
  cashRatePct: 0,
  inflationPct: 3,
  monthlyIncomeCents: null,
  monthlySpendingCents: null,
  contributions: [],
  rangePct: 2,
};

/** Read the stored assumptions, falling back to the defaults (also for an unreadable row). */
export function readAssumptions(rows: readonly TrajectoryAssumptionsRow[]): { assumptions: TrajectoryBaseAssumptions; isDefault: boolean } {
  const row = rows.find((r) => r.id === ASSUMPTIONS_ROW_ID);
  if (!row) return { assumptions: DEFAULT_ASSUMPTIONS, isDefault: true };
  try {
    const parsed = trajectoryBaseAssumptionsSchema.safeParse(JSON.parse(row.assumptionsJson));
    if (parsed.success) return { assumptions: parsed.data, isDefault: false };
  } catch {
    // fall through to defaults
  }
  return { assumptions: DEFAULT_ASSUMPTIONS, isDefault: true };
}

export const lifePhaseFieldsSchema = z.object({
  name: z.string().min(1).max(80),
  fromYear: z.number().int().min(1900).max(2200),
  toYear: z.number().int().min(1900).max(2200),
  monthlyIncomeCents: centsSchema.nullable(),
  monthlySpendingCents: centsSchema.nullable(),
  savingsRatePct: pct(-100, 100).nullable(),
  investmentReturnPct: pct(-50, 50).nullable(),
  hysaRatePct: pct(0, 30).nullable(),
  inflationPct: pct(-10, 30).nullable(),
  contributions: z.array(contributionSchema).nullable(),
});
export type LifePhaseFields = z.infer<typeof lifePhaseFieldsSchema>;

/** A life phase with its contributions parsed. */
export interface ParsedLifePhase extends Omit<LifePhase, "contributionsJson"> {
  contributions: AccountContribution[] | null;
}

export function parsePhase(p: LifePhase): ParsedLifePhase {
  const { contributionsJson, ...rest } = p;
  let contributions: AccountContribution[] | null = null;
  if (contributionsJson !== null) {
    try {
      const parsed = z.array(contributionSchema).safeParse(JSON.parse(contributionsJson));
      contributions = parsed.success ? parsed.data : null;
    } catch {
      contributions = null;
    }
  }
  return { ...rest, contributions };
}

export function phaseRow(id: string, fields: LifePhaseFields, updatedAt: string): LifePhase {
  const { contributions, ...rest } = fields;
  return { id, ...rest, contributionsJson: contributions === null ? null : JSON.stringify(contributions), updatedAt };
}

/** Phases sorted by start year; overlapping phases are an error. */
export function phaseOverlap(phases: ReadonlyArray<Pick<LifePhase, "id" | "fromYear" | "toYear" | "name">>): string | null {
  const sorted = [...phases].sort((a, b) => a.fromYear - b.fromYear);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.fromYear <= sorted[i - 1]!.toYear) return `"${sorted[i]!.name}" overlaps "${sorted[i - 1]!.name}".`;
  }
  return null;
}
