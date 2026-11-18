/**
 * Looking forward (§12): net worth and its parts over 1, 20, 30 or 40 years
 * as a lower / expected / higher band, in today's or future dollars, from
 * assumptions I can see and edit (and life phases). Edits preview live.
 */
import { useEffect, useMemo, useState } from "react";
import { monthOf } from "@ft/core";
import { useQuery } from "../../data/hooks.ts";
import { Chart } from "../../ui/Chart.tsx";
import { SegmentedControl, StatNumber, Toggle } from "../../ui/components.tsx";
import { money, todayIso } from "../shared/format.ts";
import { AssumptionsPanel, draftFrom, formFrom, type AssumptionForm } from "./AssumptionsPanel.tsx";
import { basisRanges, projectionOption } from "./charts.ts";
import { PhasesPanel } from "./PhasesPanel.tsx";
import type { AssumptionsValue, LifePhaseFields, ProjectionResult } from "./types.ts";
import { useDebounced } from "./useDebounced.ts";
import type { AccountRow } from "../recurring/types.ts";

const HORIZONS = [
  { value: "1", label: "1 year" },
  { value: "20", label: "20 years" },
  { value: "30", label: "30 years" },
  { value: "40", label: "40 years" },
] as const;

const PANELS = [
  { value: "assumptions", label: "Assumptions" },
  { value: "phases", label: "Life phases" },
] as const;

const DISCLAIMER = "This is a projection from your own assumptions, not a prediction or financial advice.";

interface UsualValue {
  usual: { basis: { label: string }; incomeCents: number | null; spendingCents: number | null };
}

export function ProjectionTab() {
  const [horizon, setHorizon] = useState<"1" | "20" | "30" | "40">("30");
  const [todaysDollars, setTodaysDollars] = useState(true);
  const [panel, setPanel] = useState<"assumptions" | "phases">("assumptions");
  const stored = useQuery<AssumptionsValue>("trajectory.assumptions", {});
  const usual = useQuery<UsualValue>("spending.monthlySummary", { month: monthOf(todayIso()), usualMonths: 3 });
  const accounts = useQuery<{ accounts: AccountRow[] }>("accounts.list", { includeHidden: false });

  const contributionAccounts = useMemo(
    () => (accounts.data?.value.accounts ?? []).filter((a) => a.kind === "investment" || a.kind === "savings").map((a) => ({ id: a.id, name: a.name })),
    [accounts.data],
  );

  const storedA = stored.data?.value.assumptions;
  const [form, setForm] = useState<AssumptionForm | null>(null);
  const resetKey = JSON.stringify([storedA, contributionAccounts.map((a) => a.id)]);
  useEffect(() => {
    if (storedA) setForm(formFrom(storedA, contributionAccounts));
  }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const { draft, errors } = form && storedA ? draftFrom(form, storedA) : { draft: {}, errors: {} };
  const [previewPhases, setPreviewPhases] = useState<LifePhaseFields[] | null>(null);
  const live = useDebounced({ draft, phases: previewPhases }, 250);

  const usualIncome = usual.data?.value.usual.incomeCents ?? null;
  const usualSpending = usual.data?.value.usual.spendingCents ?? null;
  const params = {
    horizonYears: Number(horizon),
    dollars: todaysDollars ? "today" : "future",
    usualMonthlyIncomeCents: usualIncome ?? 0,
    usualMonthlySpendingCents: usualSpending ?? 0,
    ...(Object.keys(live.draft).length ? { assumptions: live.draft } : {}),
    ...(live.phases ? { phases: live.phases } : {}),
  };
  const projection = useQuery<ProjectionResult>("trajectory.projection", params);
  const p = projection.data?.value;
  const last = p?.points.at(-1);
  const firstYear = Number(todayIso().slice(0, 4));

  return (
    <div className="rti-stack">
      <p className="rti-disclaimer" data-testid="disclaimer">
        {p?.disclaimer ?? DISCLAIMER}
      </p>
      <div className="rti-toolbar">
        <SegmentedControl label="How far ahead" size="sm" options={HORIZONS} value={horizon} onChange={setHorizon} />
        <Toggle label="Today's dollars (adjusted for inflation)" checked={todaysDollars} onChange={setTodaysDollars} />
      </div>
      {projection.error && <p className="rti-error">Couldn't project: {projection.error.message}</p>}
      {p && last && (
        <>
          <div className="rti-row">
            <StatNumber
              label={`Expected net worth in ${p.horizonYears === 1 ? "1 year" : `${p.horizonYears} years`}`}
              value={money(last.totalCents)}
              size="lg"
              detail={`${todaysDollars ? "in today's dollars" : "in future dollars"}`}
            />
            <StatNumber label="Range" value={`${money(last.lowCents, { noCents: true })} – ${money(last.highCents, { noCents: true })}`} detail={`returns of ${p.returnRange.lowPct}% to ${p.returnRange.highPct}% a year`} />
          </div>
          <div className="rti-chart rti-chart--tall" data-testid="projection-chart">
            <Chart option={projectionOption(p)} ariaLabel={`Projected net worth over ${p.horizonYears} years, expected ${money(last.totalCents)}, as a range`} />
          </div>
          <ul className="traj-basis" aria-label="What each year is based on">
            {basisRanges(p.years).map((r) => (
              <li key={r.from} className={r.kind === "assumed_same" ? "is-assumed" : undefined}>
                <span className="rti-num">{r.from === r.to ? r.from : `${r.from}–${r.to}`}</span>: {r.kind === "assumed_same" ? <b>{r.label}</b> : r.label}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="rti-toolbar">
        <SegmentedControl label="Edit" size="sm" options={PANELS} value={panel} onChange={(v) => (setPanel(v), setPreviewPhases(null))} />
      </div>
      {panel === "assumptions" && form && storedA && (
        <AssumptionsPanel
          form={form}
          setForm={setForm}
          errors={errors}
          draft={draft}
          contributionAccounts={contributionAccounts}
          usualIncomeCents={usualIncome}
          usualSpendingCents={usualSpending}
          usualLabel={usual.data?.value.usual.basis.label ?? null}
          onDiscard={() => setForm(formFrom(storedA, contributionAccounts))}
        />
      )}
      {panel === "phases" && stored.data && <PhasesPanel phases={stored.data.value.phases} onPreview={setPreviewPhases} firstYear={firstYear} />}
    </div>
  );
}
