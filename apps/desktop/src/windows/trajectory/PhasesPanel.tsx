/**
 * Life phases (§12): assumptions for a range of years ("2027–2030: savings
 * rate 20%"). Empty fields carry the previous assumption forward. While a
 * phase is being edited, the projection previews it live; saving goes
 * through trajectory.addLifePhase / editLifePhase / removeLifePhase.
 */
import { useEffect, useMemo, useState } from "react";
import { Button, Card, Input } from "../../ui/components.tsx";
import { dollarsText, money, parseDollars } from "../shared/format.ts";
import { ReviewAndConfirm } from "../shared/ReviewAndConfirm.tsx";
import type { LifePhaseFields, ParsedLifePhase } from "./types.ts";

export function fieldsOf(p: ParsedLifePhase): LifePhaseFields {
  const { id: _id, updatedAt: _u, ...rest } = p;
  return rest;
}

export function describePhase(p: LifePhaseFields): string {
  const parts: string[] = [];
  if (p.monthlyIncomeCents != null) parts.push(`income ${money(p.monthlyIncomeCents)}/mo`);
  if (p.monthlySpendingCents != null) parts.push(`spending ${money(p.monthlySpendingCents)}/mo`);
  if (p.savingsRatePct != null) parts.push(`savings rate ${p.savingsRatePct}%`);
  if (p.investmentReturnPct != null) parts.push(`return ${p.investmentReturnPct}%`);
  if (p.hysaRatePct != null) parts.push(`HYSA ${p.hysaRatePct}%`);
  if (p.inflationPct != null) parts.push(`inflation ${p.inflationPct}%`);
  return parts.length ? parts.join(", ") : "same as before (nothing changed)";
}

interface Form {
  name: string;
  fromYear: string;
  toYear: string;
  income: string;
  spending: string;
  savingsRate: string;
  ret: string;
  hysa: string;
  inflation: string;
}

const optNum = (s: string): number | null | "bad" => (s.trim() === "" ? null : Number.isFinite(Number(s)) ? Number(s) : "bad");
const optCents = (s: string): number | null | "bad" => (s.trim() === "" ? null : (parseDollars(s) ?? "bad"));
const txt = (n: number | null) => (n === null ? "" : String(n));

function toForm(p: LifePhaseFields): Form {
  return {
    name: p.name,
    fromYear: String(p.fromYear),
    toYear: String(p.toYear),
    income: dollarsText(p.monthlyIncomeCents),
    spending: dollarsText(p.monthlySpendingCents),
    savingsRate: txt(p.savingsRatePct),
    ret: txt(p.investmentReturnPct),
    hysa: txt(p.hysaRatePct),
    inflation: txt(p.inflationPct),
  };
}

function fromForm(f: Form, contributions: LifePhaseFields["contributions"]): LifePhaseFields | string {
  const from = Number(f.fromYear);
  const to = Number(f.toYear);
  if (!f.name.trim()) return "Give the phase a name.";
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1900 || to > 2200) return "Enter the years, e.g. 2027 to 2030.";
  if (from > to) return "The first year must be on or before the last.";
  const vals = [optCents(f.income), optCents(f.spending), optNum(f.savingsRate), optNum(f.ret), optNum(f.hysa), optNum(f.inflation)];
  if (vals.includes("bad")) return "Check the numbers (leave a field empty to keep the previous assumption).";
  const [income, spending, rate, ret, hysa, infl] = vals as Array<number | null>;
  return {
    name: f.name.trim(),
    fromYear: from,
    toYear: to,
    monthlyIncomeCents: income!,
    monthlySpendingCents: spending!,
    savingsRatePct: rate!,
    investmentReturnPct: ret!,
    hysaRatePct: hysa!,
    inflationPct: infl!,
    contributions,
  };
}

type Editing = { mode: "add" } | { mode: "edit"; phase: ParsedLifePhase } | { mode: "remove"; phase: ParsedLifePhase } | null;

export interface PhasesPanelProps {
  phases: readonly ParsedLifePhase[];
  /** Called with the phases to preview live (null = use the stored ones). */
  onPreview: (phases: LifePhaseFields[] | null) => void;
  firstYear: number;
}

export function PhasesPanel({ phases, onPreview, firstYear }: PhasesPanelProps) {
  const [editing, setEditing] = useState<Editing>(null);
  const [form, setForm] = useState<Form | null>(null);

  const start = (e: Editing) => {
    setEditing(e);
    if (e?.mode === "add") {
      const lastTo = phases.at(-1)?.toYear;
      const from = lastTo ? lastTo + 1 : firstYear + 1;
      setForm({ name: "", fromYear: String(from), toYear: String(from + 4), income: "", spending: "", savingsRate: "", ret: "", hysa: "", inflation: "" });
    } else if (e?.mode === "edit") setForm(toForm(fieldsOf(e.phase)));
    else setForm(null);
  };

  const parsed = useMemo(() => (form ? fromForm(form, editing?.mode === "edit" ? editing.phase.contributions : null) : null), [form, editing]);

  const previewPhases = useMemo((): LifePhaseFields[] | null => {
    if (!editing) return null;
    const others = phases.filter((p) => editing.mode === "add" || p.id !== editing.phase.id).map(fieldsOf);
    if (editing.mode === "remove") return others;
    if (!parsed || typeof parsed === "string") return null;
    const all = [...others, parsed].sort((a, b) => a.fromYear - b.fromYear);
    // Overlapping phases can't be previewed (the action would refuse them too).
    for (let i = 1; i < all.length; i++) if (all[i]!.fromYear <= all[i - 1]!.toYear) return null;
    return all;
  }, [editing, parsed, phases]);

  const previewKey = JSON.stringify(previewPhases);
  useEffect(() => onPreview(previewPhases), [previewKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof Form, v: string) => form && setForm({ ...form, [k]: v });
  const close = () => start(null);

  const input =
    editing?.mode === "remove"
      ? { phaseId: editing.phase.id }
      : parsed && typeof parsed !== "string"
        ? editing?.mode === "edit"
          ? { phaseId: editing.phase.id, ...parsed }
          : parsed
        : null;

  return (
    <div className="rti-stack">
      {phases.length === 0 && !editing && (
        <p className="rti-note">No life phases yet. Without them, today's habits are carried forward and marked "assumed to stay the same".</p>
      )}
      {phases.length > 0 && (
        <table className="rti-table" aria-label="Life phases">
          <thead>
            <tr>
              <th scope="col">Years</th>
              <th scope="col">Phase</th>
              <th scope="col">Assumptions</th>
              <th scope="col">
                <span className="ui-visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {phases.map((p) => (
              <tr key={p.id}>
                <td className="rti-num">
                  {p.fromYear}–{p.toYear}
                </td>
                <td>{p.name}</td>
                <td>{describePhase(fieldsOf(p))}</td>
                <td>
                  <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
                    <Button size="sm" variant="ghost" aria-label={`Edit ${p.name}`} onClick={() => start({ mode: "edit", phase: p })}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" aria-label={`Remove ${p.name}`} onClick={() => start({ mode: "remove", phase: p })}>
                      Remove
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!editing && (
        <div>
          <Button size="sm" icon="plus" onClick={() => start({ mode: "add" })}>
            Add life phase
          </Button>
        </div>
      )}
      {editing?.mode === "remove" && (
        <Card title={`Remove ${editing.phase.name}?`}>
          <p className="rti-note">The chart shows the projection without it. Its years fall back to the previous assumptions.</p>
          <ReviewAndConfirm action="trajectory.removeLifePhase" input={input} confirmLabel="Remove" onDone={close} onCancel={close} />
        </Card>
      )}
      {form && (editing?.mode === "add" || editing?.mode === "edit") && (
        <Card title={editing.mode === "add" ? "New life phase" : `Edit ${editing.phase.name}`}>
          <div className="rti-stack">
            <div className="rti-form">
              <Input label="Name" value={form.name} placeholder="e.g. Early career" onChange={(e) => set("name", e.target.value)} />
              <Input label="From year" inputMode="numeric" value={form.fromYear} onChange={(e) => set("fromYear", e.target.value)} />
              <Input label="To year" inputMode="numeric" value={form.toYear} onChange={(e) => set("toYear", e.target.value)} />
              <Input label="Monthly income ($)" inputMode="decimal" value={form.income} placeholder="same as before" onChange={(e) => set("income", e.target.value)} />
              <Input label="Monthly spending ($)" inputMode="decimal" value={form.spending} placeholder="same as before" onChange={(e) => set("spending", e.target.value)} />
              <Input label="Savings rate (%)" inputMode="decimal" value={form.savingsRate} placeholder="same as before" hint="Used when spending is empty" onChange={(e) => set("savingsRate", e.target.value)} />
              <Input label="Investment return (%)" inputMode="decimal" value={form.ret} placeholder="same as before" onChange={(e) => set("ret", e.target.value)} />
              <Input label="HYSA rate (%)" inputMode="decimal" value={form.hysa} placeholder="same as before" onChange={(e) => set("hysa", e.target.value)} />
              <Input label="Inflation (%)" inputMode="decimal" value={form.inflation} placeholder="same as before" onChange={(e) => set("inflation", e.target.value)} />
            </div>
            <p className="rti-note">{previewPhases ? "The chart previews this phase now." : "Empty fields keep the previous assumption."}</p>
            <ReviewAndConfirm
              action={editing.mode === "add" ? "trajectory.addLifePhase" : "trajectory.editLifePhase"}
              input={input}
              invalidReason={typeof parsed === "string" ? parsed : undefined}
              reviewLabel="Save phase…"
              confirmLabel="Save"
              onDone={close}
              onCancel={close}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
