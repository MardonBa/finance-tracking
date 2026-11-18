/**
 * Trajectory assumption actions (§12): edit the base projection
 * assumptions and add / edit / remove life phases. Inverses come from the
 * generic `inverseMutations` (the previous rows are restored).
 */
import { z } from "zod";
import { ActionError, defineAction, findRow, type Change } from "../../registry.ts";
import { Money } from "../../money.ts";
import { idSchema } from "../../schemas.ts";
import type { CoreData, LifePhase } from "../../types.ts";
import {
  ASSUMPTIONS_ROW_ID,
  lifePhaseFieldsSchema,
  parsePhase,
  phaseOverlap,
  phaseRow,
  readAssumptions,
  trajectoryBaseAssumptionsSchema,
  type AccountContribution,
  type LifePhaseFields,
  type TrajectoryBaseAssumptions,
} from "../../trajectory/assumptions.ts";

const LABELS: Record<keyof TrajectoryBaseAssumptions, string> = {
  investmentReturnPct: "Investment return",
  hysaRatePct: "HYSA interest rate",
  cashRatePct: "Cash interest rate",
  inflationPct: "Inflation",
  monthlyIncomeCents: "Monthly income",
  monthlySpendingCents: "Monthly spending",
  contributions: "Monthly contributions",
  rangePct: "Range (± points of return)",
};

function show(key: string, v: unknown): string | null {
  if (v === null || v === undefined) return key.endsWith("Cents") ? "usual (recent average)" : null;
  if (key.endsWith("Pct")) return `${v as number}%`;
  if (key.endsWith("Cents")) return Money.format(v as number);
  if (key === "contributions") {
    const list = v as AccountContribution[];
    return list.length ? list.map((c) => `${c.accountId} ${Money.format(c.monthlyCents)}/mo`).join(", ") : "none";
  }
  return String(v);
}

export const setAssumptions = defineAction({
  name: "trajectory.setAssumptions",
  description: "Change projection assumptions: investment return, HYSA rate, inflation, monthly income/spending, contributions per account, range width.",
  input: trajectoryBaseAssumptionsSchema.partial(),
  needs: ["trajectoryAssumptions"],
  examples: [{ investmentReturnPct: 6.5, inflationPct: 2.5 }, { contributions: [{ accountId: "acc_brokerage", monthlyCents: 50000 }], monthlyIncomeCents: 600000 }],
  describe(data, input) {
    const { assumptions } = readAssumptions(data.trajectoryAssumptions);
    const changes: Change[] = [];
    for (const [k, v] of Object.entries(input) as Array<[keyof TrajectoryBaseAssumptions, unknown]>) {
      if (v === undefined) continue;
      changes.push({ label: LABELS[k], before: show(k, assumptions[k]), after: show(k, v) });
    }
    return { summary: "Update projection assumptions", changes };
  },
  apply(data, input, ctx) {
    const { assumptions } = readAssumptions(data.trajectoryAssumptions);
    const defined = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    const next = trajectoryBaseAssumptionsSchema.parse({ ...assumptions, ...defined });
    return [{ op: "upsert", table: "trajectoryAssumptions", row: { id: ASSUMPTIONS_ROW_ID, assumptionsJson: JSON.stringify(next), updatedAt: ctx.now } }];
  },
});

const yearsValid = (f: { fromYear?: number; toYear?: number }) => f.fromYear === undefined || f.toYear === undefined || f.fromYear <= f.toYear;

function describePhase(f: Partial<LifePhaseFields>): string {
  const parts: string[] = [];
  if (f.monthlyIncomeCents != null) parts.push(`income ${Money.format(f.monthlyIncomeCents)}/mo`);
  if (f.monthlySpendingCents != null) parts.push(`spending ${Money.format(f.monthlySpendingCents)}/mo`);
  if (f.savingsRatePct != null) parts.push(`savings rate ${f.savingsRatePct}%`);
  if (f.investmentReturnPct != null) parts.push(`return ${f.investmentReturnPct}%`);
  if (f.hysaRatePct != null) parts.push(`HYSA ${f.hysaRatePct}%`);
  if (f.inflationPct != null) parts.push(`inflation ${f.inflationPct}%`);
  if (f.contributions != null) parts.push(`contributions ${show("contributions", f.contributions)}`);
  return `${f.name} (${f.fromYear}–${f.toYear})${parts.length ? `: ${parts.join(", ")}` : ""}`;
}

function checkOverlap(phases: readonly LifePhase[]) {
  const err = phaseOverlap(phases);
  if (err) throw new ActionError(`Life phases can't overlap: ${err}`);
}

const phaseFieldsInput = lifePhaseFieldsSchema.extend({
  monthlyIncomeCents: lifePhaseFieldsSchema.shape.monthlyIncomeCents.default(null),
  monthlySpendingCents: lifePhaseFieldsSchema.shape.monthlySpendingCents.default(null),
  savingsRatePct: lifePhaseFieldsSchema.shape.savingsRatePct.default(null),
  investmentReturnPct: lifePhaseFieldsSchema.shape.investmentReturnPct.default(null),
  hysaRatePct: lifePhaseFieldsSchema.shape.hysaRatePct.default(null),
  inflationPct: lifePhaseFieldsSchema.shape.inflationPct.default(null),
  contributions: lifePhaseFieldsSchema.shape.contributions.default(null),
});

export const addLifePhase = defineAction({
  name: "trajectory.addLifePhase",
  description: "Add a life phase: assumptions (income, spending or savings rate, return, contributions…) for a range of years.",
  input: phaseFieldsInput.refine(yearsValid, { message: "fromYear must be on or before toYear" }),
  needs: ["lifePhases"],
  examples: [{ name: "Early career", fromYear: 2027, toYear: 2030, savingsRatePct: 20, monthlyIncomeCents: null, monthlySpendingCents: null, investmentReturnPct: null, hysaRatePct: null, inflationPct: null, contributions: null }],
  describe(_data, input) {
    return { summary: `Add life phase "${input.name}"`, changes: [{ label: "Life phase", before: null, after: describePhase(input) }] };
  },
  apply(data, input, ctx) {
    const row = phaseRow(ctx.newId(), input, ctx.now);
    checkOverlap([...data.lifePhases, row]);
    return [{ op: "upsert", table: "lifePhases", row }];
  },
});

function needPhase(data: Pick<CoreData, "lifePhases">, id: string): LifePhase {
  const p = findRow(data, "lifePhases", { id });
  if (!p) throw new ActionError(`No life phase ${id}`);
  return p;
}

function fieldsOf(p: LifePhase): LifePhaseFields {
  const { id: _id, updatedAt: _u, ...rest } = parsePhase(p);
  return rest;
}

export const editLifePhase = defineAction({
  name: "trajectory.editLifePhase",
  description: "Change a life phase's name, years or assumptions (null clears an assumption so the previous one carries on).",
  input: lifePhaseFieldsSchema.partial().extend({ phaseId: idSchema }).refine(yearsValid, { message: "fromYear must be on or before toYear" }),
  needs: ["lifePhases"],
  describe(data, input) {
    const p = needPhase(data, input.phaseId);
    const { phaseId: _id, ...patch } = input;
    const after = { ...fieldsOf(p), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as LifePhaseFields;
    return { summary: `Edit life phase "${p.name}"`, changes: [{ label: "Life phase", before: describePhase(fieldsOf(p)), after: describePhase(after) }] };
  },
  apply(data, input, ctx) {
    const p = needPhase(data, input.phaseId);
    const { phaseId, ...patch } = input;
    const merged = lifePhaseFieldsSchema.parse({ ...fieldsOf(p), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) });
    if (merged.fromYear > merged.toYear) throw new ActionError("fromYear must be on or before toYear");
    const row = phaseRow(phaseId, merged, ctx.now);
    checkOverlap([...data.lifePhases.filter((x) => x.id !== phaseId), row]);
    return [{ op: "upsert", table: "lifePhases", row }];
  },
});

export const removeLifePhase = defineAction({
  name: "trajectory.removeLifePhase",
  description: "Remove a life phase; its years fall back to the previous assumptions.",
  input: z.object({ phaseId: idSchema }),
  needs: ["lifePhases"],
  describe(data, input) {
    const p = needPhase(data, input.phaseId);
    return { summary: `Remove life phase "${p.name}"`, changes: [{ label: "Life phase", before: describePhase(fieldsOf(p)), after: null }] };
  },
  apply(data, input) {
    needPhase(data, input.phaseId);
    return [{ op: "delete", table: "lifePhases", key: { id: input.phaseId } }];
  },
});

export const trajectoryActions = [setAssumptions, addLifePhase, editLifePhase, removeLifePhase];
