/**
 * Editable projection assumptions (§12). Edits are a local what-if: the
 * projection re-runs with them as you type (debounced), and "Save" stores
 * them through `trajectory.setAssumptions` after a preview.
 */
import { Button, Input } from "../../ui/components.tsx";
import { dollarsText, money, parseDollars } from "../shared/format.ts";
import { ReviewAndConfirm } from "../shared/ReviewAndConfirm.tsx";
import type { BaseAssumptions } from "./types.ts";

export interface AssumptionForm {
  investmentReturnPct: string;
  hysaRatePct: string;
  inflationPct: string;
  rangePct: string;
  monthlyIncome: string;
  monthlySpending: string;
  /** accountId → dollars per month */
  contributions: Record<string, string>;
}

export function formFrom(a: BaseAssumptions, contributionAccounts: ReadonlyArray<{ id: string }>): AssumptionForm {
  const contributions: Record<string, string> = {};
  for (const acc of contributionAccounts) {
    const c = a.contributions.find((x) => x.accountId === acc.id);
    contributions[acc.id] = c ? dollarsText(c.monthlyCents) : "";
  }
  return {
    investmentReturnPct: String(a.investmentReturnPct),
    hysaRatePct: String(a.hysaRatePct),
    inflationPct: String(a.inflationPct),
    rangePct: String(a.rangePct),
    monthlyIncome: dollarsText(a.monthlyIncomeCents),
    monthlySpending: dollarsText(a.monthlySpendingCents),
    contributions,
  };
}

const num = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));
const cents = (s: string): number | null | "bad" => (s.trim() === "" ? null : (parseDollars(s) ?? "bad"));

/** The changed, valid fields as a partial assumptions object (what-if and the action input), plus field errors. */
export function draftFrom(form: AssumptionForm, stored: BaseAssumptions): { draft: Partial<BaseAssumptions>; errors: Partial<Record<keyof AssumptionForm, string>> } {
  const draft: Partial<BaseAssumptions> = {};
  const errors: Partial<Record<keyof AssumptionForm, string>> = {};
  const pctField = (k: "investmentReturnPct" | "hysaRatePct" | "inflationPct" | "rangePct", min: number, max: number) => {
    const v = num(form[k]);
    if (v === null || v < min || v > max) errors[k] = `Between ${min} and ${max}`;
    else if (v !== stored[k]) draft[k] = v;
  };
  pctField("investmentReturnPct", -50, 50);
  pctField("hysaRatePct", 0, 30);
  pctField("inflationPct", -10, 30);
  pctField("rangePct", 0, 20);
  const inc = cents(form.monthlyIncome);
  if (inc === "bad") errors.monthlyIncome = "Enter an amount, or leave empty for usual";
  else if (inc !== stored.monthlyIncomeCents) draft.monthlyIncomeCents = inc;
  const sp = cents(form.monthlySpending);
  if (sp === "bad") errors.monthlySpending = "Enter an amount, or leave empty for usual";
  else if (sp !== stored.monthlySpendingCents) draft.monthlySpendingCents = sp;

  const list: BaseAssumptions["contributions"] = [];
  let bad = false;
  for (const [accountId, text] of Object.entries(form.contributions)) {
    const c = cents(text);
    if (c === "bad") bad = true;
    else if (c !== null && c > 0) list.push({ accountId, monthlyCents: c });
  }
  // Keep contributions to accounts not shown in the form (e.g. hidden ones).
  for (const c of stored.contributions) if (!(c.accountId in form.contributions)) list.push(c);
  if (bad) errors.contributions = "Enter amounts like 250 or 250.00";
  else {
    const norm = (l: BaseAssumptions["contributions"]) => JSON.stringify([...l].sort((a, b) => (a.accountId < b.accountId ? -1 : 1)));
    if (norm(list) !== norm(stored.contributions)) draft.contributions = list;
  }
  return { draft, errors };
}

export interface AssumptionsPanelProps {
  form: AssumptionForm;
  setForm: (f: AssumptionForm) => void;
  errors: Partial<Record<keyof AssumptionForm, string>>;
  draft: Partial<BaseAssumptions>;
  contributionAccounts: ReadonlyArray<{ id: string; name: string }>;
  usualIncomeCents: number | null;
  usualSpendingCents: number | null;
  usualLabel: string | null;
  onDiscard: () => void;
}

export function AssumptionsPanel({ form, setForm, errors, draft, contributionAccounts, usualIncomeCents, usualSpendingCents, usualLabel, onDiscard }: AssumptionsPanelProps) {
  const set = <K extends keyof AssumptionForm>(k: K, v: AssumptionForm[K]) => setForm({ ...form, [k]: v });
  const dirty = Object.keys(draft).length > 0;
  const hasErrors = Object.keys(errors).length > 0;
  const usualHint = (c: number | null) => (c === null ? "Empty = your usual (not enough history yet)" : `Empty = your usual, ${money(c)}/mo${usualLabel ? ` (${usualLabel})` : ""}`);
  return (
    <div className="rti-stack">
      <div className="rti-form">
        <Input label="Investment return (% a year)" inputMode="decimal" value={form.investmentReturnPct} error={errors.investmentReturnPct} onChange={(e) => set("investmentReturnPct", e.target.value)} />
        <Input label="HYSA interest rate (% a year)" inputMode="decimal" value={form.hysaRatePct} error={errors.hysaRatePct} onChange={(e) => set("hysaRatePct", e.target.value)} />
        <Input label="Inflation (% a year)" inputMode="decimal" value={form.inflationPct} error={errors.inflationPct} onChange={(e) => set("inflationPct", e.target.value)} />
        <Input label="Range (± % points of return)" inputMode="decimal" value={form.rangePct} error={errors.rangePct} hint="How wide the lower/higher band is" onChange={(e) => set("rangePct", e.target.value)} />
        <Input label="Monthly income ($)" inputMode="decimal" value={form.monthlyIncome} placeholder={usualIncomeCents === null ? "usual" : dollarsText(usualIncomeCents)} error={errors.monthlyIncome} hint={usualHint(usualIncomeCents)} onChange={(e) => set("monthlyIncome", e.target.value)} />
        <Input label="Monthly spending ($)" inputMode="decimal" value={form.monthlySpending} placeholder={usualSpendingCents === null ? "usual" : dollarsText(usualSpendingCents)} error={errors.monthlySpending} hint={usualHint(usualSpendingCents)} onChange={(e) => set("monthlySpending", e.target.value)} />
      </div>
      {contributionAccounts.length > 0 && (
        <>
          <h4 className="rti-note">Monthly contributions per account</h4>
          <div className="rti-form">
            {contributionAccounts.map((a) => (
              <Input
                key={a.id}
                label={`Into ${a.name} ($/mo)`}
                inputMode="decimal"
                placeholder="0.00"
                value={form.contributions[a.id] ?? ""}
                onChange={(e) => set("contributions", { ...form.contributions, [a.id]: e.target.value })}
              />
            ))}
          </div>
          {errors.contributions && <p className="rti-error">{errors.contributions}</p>}
          <p className="rti-note">Contributions come out of what's left after spending; whatever is left beyond them stays in cash.</p>
        </>
      )}
      {dirty ? (
        <div className="rti-stack">
          <p className="rti-note">The chart shows these changes now. Save them to keep them.</p>
          <ReviewAndConfirm action="trajectory.setAssumptions" input={hasErrors ? null : draft} invalidReason="Fix the highlighted fields first." reviewLabel="Save assumptions…" confirmLabel="Save" onDone={onDiscard} onCancel={onDiscard} />
        </div>
      ) : (
        <div>
          <Button size="sm" variant="ghost" disabled>
            No unsaved changes
          </Button>
        </div>
      )}
    </div>
  );
}
